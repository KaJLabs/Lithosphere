import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  query: vi.fn(),
  slowQuery: vi.fn(),
  getPool: vi.fn(),
}));

const { query, slowQuery } = await import('../db.js');
const { explorerRouter } = await import('../routes.js');

const mockQuery = vi.mocked(query);
const mockSlowQuery = vi.mocked(slowQuery);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', explorerRouter());
  return app;
}

// Module-scope runtime cache inside routes.ts has TTLs measured in seconds.
// Advance fake time meaningfully per test so cache entries written by one
// test are expired by the next call. Sufficient for any TTL up to ~16 min.
let testTime = Date.UTC(2026, 4, 11, 12, 0, 0);

beforeEach(() => {
  testTime += 30 * 60 * 1000;
  vi.setSystemTime(new Date(testTime));
  mockQuery.mockReset();
  mockSlowQuery.mockReset();
  global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
});

afterEach(() => {
  vi.useRealTimers();
});

// ── /stats/summary ──────────────────────────────────────────────────────────

describe('GET /api/stats/summary', () => {
  it('aggregates sync, counts, avg block time, and gas price', async () => {
    // Mock order matches the Promise.all in routes.ts:getStatsSummaryResponse:
    //   1. getSyncSummary — tip block + tx counts (uses query under the hood)
    //   2. transactions-total count
    //   3. wallet-addresses count
    //   4. avg block time
    // The sync summary uses several internal queries; for an unforgiving
    // black-box smoke test we just mock everything optimistically.
    mockQuery.mockImplementation(async (sql: string) => {
      if (/MAX\(height\)/.test(sql)) return [{ height: '12345', block_time: new Date('2026-05-11T11:59:00Z') }] as any;
      if (/COALESCE\(MAX\(block_height\)/.test(sql)) return [{ height: '12340', timestamp: new Date('2026-05-11T11:58:00Z') }] as any;
      if (/FROM transactions\s*$/m.test(sql)) return [{ count: '100' }] as any;
      if (/inconsistent_blocks/.test(sql)) return [{ count: '0' }] as any;
      if (/FROM accounts\s*UNION/.test(sql)) return [{ count: '42' }] as any;
      if (/avg_seconds/.test(sql)) return [{ avg_seconds: '0.525' }] as any;
      if (/FROM blocks$/m.test(sql)) return [{ count: '12345' }] as any;
      return [] as any;
    });

    // The heavy COUNT(*) totals moved to the slow pool (slowQuery) in the
    // slow-pool fix, so they must be mocked separately from `query`.
    mockSlowQuery.mockImplementation(async (sql: string) => {
      if (/all_addrs/.test(sql)) return [{ count: '42' }] as any; // wallet UNION
      if (/FROM transactions/.test(sql)) return [{ count: '100' }] as any;
      return [] as any;
    });

    const res = await request(makeApp()).get('/api/stats/summary');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      avgBlockTime: 0.53, // Preserve useful precision for fast chains.
    });
    expect(typeof res.body.totalTransactions).toBe('number');
    expect(typeof res.body.walletAddresses).toBe('number');
  });
});

// ── /txs (list) ─────────────────────────────────────────────────────────────

const FIXTURE_TX_HASH = '0x' + 'a'.repeat(64);
const FIXTURE_COSMOS_HASH = 'b'.repeat(64);

describe('GET /api/txs', () => {
  it('returns transactions with total, limit, and offset', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          hash: FIXTURE_COSMOS_HASH,
          block_height: 100,
          sender: 'litho1aaa',
          receiver: 'litho1bbb',
          amount: '1000',
          fee: '10',
          gas_wanted: '100000',
          gas_used: '21000',
          memo: '',
          timestamp: new Date('2026-05-11T12:00:00Z'),
          tx_type: 'send',
          status: 'success',
          evm_hash: null,
          evm_input_data: null,
          evm_contract_address: null,
          evm_from_address: null,
          evm_to_address: null,
          evm_value: null,
          evm_gas_price: null,
          evm_nonce: null,
        },
      ])
      .mockResolvedValueOnce([{ count: '42' }]); // total

    const res = await request(makeApp()).get('/api/txs?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.txs).toHaveLength(1);
    // hash is returned in normalized form (lowercase, with proper format)
    expect(res.body.txs[0].hash).toBe(FIXTURE_COSMOS_HASH);
    expect(res.body.total).toBe(42);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(0);
  });

  it('returns empty list when nothing matches', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    const res = await request(makeApp()).get('/api/txs');

    expect(res.status).toBe(200);
    expect(res.body.txs).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ── /address/:address ───────────────────────────────────────────────────────

describe('GET /api/address/:address', () => {
  const HOLDER_0X = '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387';

  it('returns the account record when found', async () => {
    mockQuery
      // 1. accounts table lookup
      .mockResolvedValueOnce([
        {
          address: 'litho1aaa',
          evm_address: HOLDER_0X,
          balance: '1000000000000000000',
          sequence: 5,
          account_number: 1,
        },
      ])
      // 2. contracts table lookup (not a contract)
      .mockResolvedValueOnce([]);

    const res = await request(makeApp()).get(`/api/address/${HOLDER_0X}`);

    expect(res.status).toBe(200);
    expect(res.body.balance).toBeDefined();
  });

  it('returns 404 when address is unknown', async () => {
    // Per the route handler, the not-found path runs four queries:
    //   1. accounts table, 2. contracts table, 3. tx-count fallthrough,
    //   4. proposer-blocks fallthrough — only then returns 404.
    mockQuery
      .mockResolvedValueOnce([])                              // 1. accounts
      .mockResolvedValueOnce([])                              // 2. contracts
      .mockResolvedValueOnce([{ count: '0' }])                // 3. tx-count
      .mockResolvedValueOnce([{ count: '0', last_time: null }]); // 4. proposer

    const res = await request(makeApp()).get(`/api/address/${HOLDER_0X}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: expect.stringMatching(/not found/i) });
  });
});

// ── /address/:address/txs ───────────────────────────────────────────────────

describe('GET /api/address/:address/txs', () => {
  const ADDR = '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387';

  it('returns paginated transactions touching the address', async () => {
    mockQuery
      // 1. linked-address resolution
      .mockResolvedValueOnce([])
      // 2. count query
      .mockResolvedValueOnce([{ count: '1' }])
      // 3. row query
      .mockResolvedValueOnce([
        {
          hash: FIXTURE_COSMOS_HASH,
          block_height: 100,
          sender: 'litho1aaa',
          receiver: 'litho1bbb',
          amount: '500',
          fee: '5',
          gas_wanted: '100000',
          gas_used: '21000',
          memo: '',
          timestamp: new Date('2026-05-11T12:00:00Z'),
          tx_type: 'send',
          status: 'success',
          evm_hash: null,
          evm_input_data: null,
          evm_contract_address: null,
          evm_from_address: null,
          evm_to_address: null,
          evm_value: null,
          evm_gas_price: null,
          evm_nonce: null,
        },
      ]);

    const res = await request(makeApp()).get(`/api/address/${ADDR}/txs?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns empty list when no txs match', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // linked accounts
      .mockResolvedValueOnce([{ count: '0' }]) // count
      .mockResolvedValueOnce([]); // rows

    const res = await request(makeApp()).get(`/api/address/${ADDR}/txs`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ── /address/:address/tokens ────────────────────────────────────────────────

describe('GET /api/address/:address/tokens', () => {
  const ADDR = '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387';

  it('returns token holdings with metadata joined from contracts', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        contract_address: '0xtok1',
        name: 'Token One',
        symbol: 'TKN1',
        decimals: 18,
        contract_type: 'token',
        balance: '5000000000000000000',
      },
      {
        contract_address: '0xnft1',
        name: 'NFT Collection',
        symbol: 'NFT',
        decimals: 0,
        contract_type: 'nft',
        balance: '3',
      },
    ]);

    const res = await request(makeApp()).get(`/api/address/${ADDR}/tokens`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      contractAddress: '0xtok1',
      symbol: 'TKN1',
      type: 'LEP100',
    });
    expect(res.body[1]).toMatchObject({
      type: 'LEP100-6', // nft → LEP100-6
      decimals: 0,
    });
  });

  it('returns empty when address holds no tokens', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await request(makeApp()).get(`/api/address/${ADDR}/tokens`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── /address/:address/token-transfers ───────────────────────────────────────

describe('GET /api/address/:address/token-transfers', () => {
  const ADDR = '0x22d279d24f0b7ca5d49c5a7a7f032da416f72387';

  it('returns paginated token transfer records', async () => {
    mockQuery
      // 1. rows
      .mockResolvedValueOnce([
        {
          tx_hash: FIXTURE_TX_HASH,
          from_address: '0xfrom',
          to_address: '0xto',
          value: '1000',
          token_id: null,
          block_height: '100',
          timestamp: new Date('2026-05-11T12:00:00Z'),
          contract_address: '0xtok1',
          name: 'Token One',
          symbol: 'TKN1',
          decimals: 18,
          contract_type: 'token',
        },
      ])
      // 2. count — matches items.length so hasMore=false
      .mockResolvedValueOnce([{ count: '1' }]);

    const res = await request(makeApp()).get(`/api/address/${ADDR}/token-transfers?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      txHash: FIXTURE_TX_HASH,
      tokenSymbol: 'TKN1',
      type: 'LEP100',
    });
    expect(res.body.total).toBe(1);
    expect(res.body.hasMore).toBe(false);
  });
});

// ── /tokens (list) ──────────────────────────────────────────────────────────

describe('GET /api/tokens', () => {
  it('always includes native LITHO plus discovered contract tokens', async () => {
    mockQuery
      // contract tokens
      .mockResolvedValueOnce([
        {
          address: '0xtok1',
          name: 'Discovery Token',
          symbol: 'DSC',
          decimals: 18,
          total_supply: '1000000000000000000000',
          contract_type: 'token',
          creator: '0xcreator',
          created_at: new Date('2026-05-01T00:00:00Z'),
        },
      ])
      // holder count (native LITHO)
      .mockResolvedValueOnce([{ count: '500' }])
      // total tx count
      .mockResolvedValueOnce([{ count: '10000' }])
      // token-transfer-index status query result — needs to resolve quickly
      .mockResolvedValue([]);

    const res = await request(makeApp()).get('/api/tokens');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({
      symbol: 'LITHO',
      type: 'native',
      contractAddress: null,
    });
  });
});

// ── /debug ──────────────────────────────────────────────────────────────────

describe('GET /api/debug', () => {
  it('returns combined indexer and chain diagnostics', async () => {
    // Per the route handler, /debug runs an 11-way Promise.all. Each query
    // has a .catch(() => fallback), so we mock everything optimistically;
    // unmocked queries return [] which is the fallback shape.
    mockQuery.mockImplementation(async (sql: string) => {
      if (/SELECT \* FROM indexer_state/.test(sql)) {
        return [{ key: 'last_indexed_block', value: '12345' }] as any;
      }
      if (/FROM blocks\s*$/m.test(sql) && /COUNT/.test(sql)) {
        return [{ count: '12345' }] as any;
      }
      if (/FROM transactions\s*$/m.test(sql) && /COUNT/.test(sql)) {
        return [{ count: '500' }] as any;
      }
      if (/FROM evm_transactions/.test(sql) && /COUNT/.test(sql)) {
        return [{ count: '480' }] as any;
      }
      if (/MIN\(height\)/.test(sql)) return [{ height: '1' }] as any;
      if (/MAX\(height\)/.test(sql)) return [{ height: '12345' }] as any;
      if (/COALESCE\(MAX\(block_height\)/.test(sql)) return [{ height: '12345' }] as any;
      if (/FROM blocks ORDER BY height ASC LIMIT 1/.test(sql)) {
        return [{ height: 1, hash: '0xgenesis' }] as any;
      }
      if (/information_schema\.columns/.test(sql)) {
        return [{ column_name: 'height', data_type: 'bigint', character_maximum_length: null }] as any;
      }
      return [] as any;
    });

    const res = await request(makeApp()).get('/api/debug');

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      blocks: '12345',
      transactions: '500',
      evmTransactions: '480',
    });
    expect(res.body.blockRange).toMatchObject({ min: '1', max: '12345' });
    expect(res.body.indexerState).toEqual([
      { key: 'last_indexed_block', value: '12345' },
    ]);
  });
});
