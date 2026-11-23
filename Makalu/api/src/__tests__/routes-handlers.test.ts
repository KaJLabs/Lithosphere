import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  query: vi.fn(),
  getPool: vi.fn(),
}));

const { query } = await import('../db.js');
const { explorerRouter } = await import('../routes.js');

const mockQuery = vi.mocked(query);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', explorerRouter());
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('GET /api/config', () => {
  it('returns LITHO token config (no DB call)', async () => {
    const res = await request(makeApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: { symbol: 'LITHO', decimals: 18 },
      fiat: { symbol: 'USD', price: null, fetchedAt: null },
      network: { evmChainId: 700777, cosmosChainId: 'lithosphere_700777-2' },
      features: { faucet: true, bridge: true, swap: false },
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/blocks', () => {
  it('returns mapped blocks with default pagination', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        height: 100,
        hash: '0xabc',
        block_time: new Date('2026-05-11T12:00:00Z'),
        num_txs: 3,
        total_gas: '21000',
      },
      {
        height: 99,
        hash: '0xdef',
        block_time: new Date('2026-05-11T11:59:30Z'),
        num_txs: 0,
        total_gas: '0',
      },
    ]);

    const res = await request(makeApp()).get('/api/blocks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        height: 100,
        hash: '0xabc',
        timestamp: '2026-05-11T12:00:00.000Z',
        txCount: 3,
        gasUsed: '21000',
      },
      {
        height: 99,
        hash: '0xdef',
        timestamp: '2026-05-11T11:59:30.000Z',
        txCount: 0,
        gasUsed: '0',
      },
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM blocks ORDER BY height DESC LIMIT $1 OFFSET $2',
      [20, 0],
    );
  });

  it('honours an explicit limit query param', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(makeApp()).get('/api/blocks?limit=5');
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [5, 0]);
  });

  it('caps the limit at MAX_LIMIT (100) regardless of input', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(makeApp()).get('/api/blocks?limit=9999');
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [100, 0]);
  });

  it('applies a 1-indexed page query param when offset is absent', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await request(makeApp()).get('/api/blocks?limit=10&page=3');
    // page=3, limit=10 → offset = (3 - 1) * 10 = 20
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [10, 20]);
  });

  it('returns 500 when the DB throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp()).get('/api/blocks');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/blocks/:height', () => {
  it('returns 404 when the block does not exist', async () => {
    mockQuery.mockResolvedValueOnce([]); // SELECT * FROM blocks WHERE height = $1
    const res = await request(makeApp()).get('/api/blocks/999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Block not found' });
  });
});

describe('GET /api/validators', () => {
  it('returns mapped validators with formatted voting power and commission', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        operator_address: 'lithovaloper1abc',
        moniker: 'Node-A',
        // 5000 LITHO expressed in ulitho (18 decimals)
        tokens: '5000000000000000000000',
        commission_rate: '0.100000000000000000',
        status: 3, // Bonded
      },
      {
        operator_address: 'lithovaloper1def',
        moniker: null,
        tokens: '1500000000000000000000',
        commission_rate: '0.075000000000000000',
        status: 2, // Unbonding
      },
    ]);

    const res = await request(makeApp()).get('/api/validators');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        address: 'lithovaloper1abc',
        moniker: 'Node-A',
        votingPower: '5,000',
        commission: '10%',
        status: 'Bonded',
      },
      {
        address: 'lithovaloper1def',
        moniker: 'lithovaloper1def...', // null moniker falls back to address prefix
        votingPower: '1,500',
        commission: '7.5%',
        status: 'Unbonding',
      },
    ]);
  });

  it('returns 500 on DB failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(makeApp()).get('/api/validators');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/validators/:operatorAddress', () => {
  it('returns validator identity, signing metrics, rank, and voting-power share', async () => {
    mockQuery.mockResolvedValueOnce([{
      operator_address: 'lithovaloper1abc',
      consensus_address: 'lithovalcons1abc',
      moniker: 'Node-A',
      identity: 'A1B2C3D4',
      website: 'https://node.example',
      security_contact: 'security@node.example',
      details: 'Independent validator',
      tokens: '250000000000000000000',
      delegator_shares: '250000000000000000000',
      min_self_delegation: '1000000000000000000',
      commission_rate: '0.05',
      commission_max_rate: '0.20',
      commission_max_change: '0.01',
      status: 3,
      jailed: false,
      // pg returns NUMERIC columns as strings in production.
      uptime_percentage: '99.8',
      missed_blocks_counter: 2,
      rank: '2',
      total_bonded_tokens: '1000000000000000000000',
      updated_at: new Date('2026-09-19T10:00:00Z'),
    }]);

    const res = await request(makeApp()).get('/api/validators/lithovaloper1abc');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      address: 'lithovaloper1abc',
      consensusAddress: 'lithovalcons1abc',
      uptimePercentage: 99.8,
      missedBlocks: '2',
      rank: 2,
      votingPowerPercentage: 25,
      profileImageUrl: '/api/validators/lithovaloper1abc/avatar',
    });
  });

  it('returns 404 for a validator without a resolvable avatar identity', async () => {
    mockQuery.mockResolvedValueOnce([{ identity: null }]);
    const res = await request(makeApp()).get('/api/validators/lithovaloper1abc/avatar');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/faucet/info', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the upstream payload merged with ok:true when faucet is healthy', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ remaining: 5, cooldown: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const res = await request(makeApp()).get('/api/faucet/info');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, remaining: 5, cooldown: 3600 });
  });

  it('returns the upstream status with sanitized message on non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const res = await request(makeApp()).get('/api/faucet/info');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      ok: false,
      message: 'Rate limit exceeded',
    });
  });

  it('returns 502 when the upstream fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')) as typeof fetch;

    const res = await request(makeApp()).get('/api/faucet/info');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      ok: false,
      message: 'Faucet service is unavailable. Please try again later.',
    });
  });
});

describe('GET /api/price', () => {
  it('returns the fixed testnet price when NETWORK env is not "mainnet"', async () => {
    // Default test env has no NETWORK var set → IS_MAINNET = false → testnet path
    const res = await request(makeApp()).get('/api/price');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ price: 5, symbol: 'LITHO', currency: 'USD' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/tokens/:address', () => {
  it('returns native LITHO metadata for the special "native" address', async () => {
    mockQuery
      .mockResolvedValueOnce([{ count: '1234' }]) // holder count
      .mockResolvedValueOnce([{ count: '5678' }]); // total tx count

    const res = await request(makeApp()).get('/api/tokens/native');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      address: 'native',
      name: 'Lithosphere',
      symbol: 'LITHO',
      decimals: 18,
      type: 'native',
      standard: 'Native',
      verified: true,
      holders: 1234,
      transfers: 5678,
      contractAddress: null,
    });
  });

  it('returns 404 when the contract is not in the contracts table', async () => {
    mockQuery.mockResolvedValueOnce([]); // contracts query
    const res = await request(makeApp()).get('/api/tokens/0xdeadbeef');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Token contract not found' });
  });

  it('returns 404 for hidden tokens even when they exist in the contracts table', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        address: '0x468022f17cafebd43c18f68d53c66a1a7f0e5249',
        name: 'Hidden',
        symbol: 'HID',
        decimals: 18,
        total_supply: '1',
        contract_type: 'token',
        creator: '0xabc',
        creation_tx: null,
        creation_block: null,
        verified: false,
        created_at: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const res = await request(makeApp()).get(
      '/api/tokens/0x468022f17cafebd43c18f68d53c66a1a7f0e5249',
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Token contract not found' });
  });
});

describe('POST /api/faucet/claim', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects requests with no address (400)', async () => {
    const res = await request(makeApp()).post('/api/faucet/claim').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, message: 'Wallet address is required.' });
  });

  it('rejects malformed addresses (400)', async () => {
    const res = await request(makeApp())
      .post('/api/faucet/claim')
      .send({ address: 'not-an-address' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid wallet address/);
  });

  it('rejects bech32 cosmos addresses — faucet only supports EVM (400)', async () => {
    const res = await request(makeApp())
      .post('/api/faucet/claim')
      .send({ address: 'litho1ytf8n5j0pd72t4yutfa87qed5st0wgu8lvvmtr' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/EVM \(0x\) addresses only/);
  });

  it('rejects malformed amounts (400)', async () => {
    const res = await request(makeApp()).post('/api/faucet/claim').send({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 'one-litho',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid amount/);
  });

  it('forwards a valid EVM address to the upstream and returns the txHash', async () => {
    const validTxHash = '0xf3df3dce8dce77d8b1172dc9d191e11caed85563f5b5a323f6ea4a18ab97077f';
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ txHash: validTxHash, amount: '1', retryAfterSeconds: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const res = await request(makeApp()).post('/api/faucet/claim').send({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: '1',
      assetId: 'LITHO',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      txHash: validTxHash,
      cooldownSeconds: 7200,
      assetId: 'LITHO',
    });
    expect(res.body.message).toMatch(/Sent 1/);
  });

  it('returns txHash:null when the upstream returns a malformed hash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ txHash: 'definitely-not-a-hash', cooldownHours: 24 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const res = await request(makeApp()).post('/api/faucet/claim').send({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.txHash).toBeNull();
    expect(res.body.cooldownSeconds).toBe(24 * 3600);
  });

  it('passes through upstream non-200 with a sanitized message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Rate limit exceeded.', retryAfterSeconds: 600 }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const res = await request(makeApp()).post('/api/faucet/claim').send({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: '2',
    });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      ok: false,
      message: 'Rate limit exceeded.',
      cooldownSeconds: 600,
    });
  });

  it('returns 502 when the upstream fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')) as typeof fetch;

    const res = await request(makeApp()).post('/api/faucet/claim').send({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      amount: '1',
    });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      ok: false,
      message: 'Faucet service is unavailable. Please try again later.',
    });
  });
});

const HIDDEN_TOKEN_ADDRESS = '0x468022f17cafebd43c18f68d53c66a1a7f0e5249';

describe('GET /api/tokens/:address/roles', () => {
  it('returns 404 for hidden tokens', async () => {
    const res = await request(makeApp()).get(
      `/api/tokens/${HIDDEN_TOKEN_ADDRESS}/roles`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Token contract not found' });
  });

  it('returns an empty role list for the native token (no on-chain roles)', async () => {
    const res = await request(makeApp()).get('/api/tokens/native/roles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [] });
  });

  it('returns an empty role list for addresses without an 0x prefix', async () => {
    const res = await request(makeApp()).get('/api/tokens/not-an-evm-address/roles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roles: [] });
  });
});

describe('GET /api/tokens/:address/transfers', () => {
  it('returns 404 for hidden tokens', async () => {
    const res = await request(makeApp()).get(
      `/api/tokens/${HIDDEN_TOKEN_ADDRESS}/transfers`,
    );
    expect(res.status).toBe(404);
  });

  it('returns LEP100 transfers for a non-native token from token_transfers', async () => {
    const contract = '0xcccccccccccccccccccccccccccccccccccccccc';
    mockQuery
      .mockResolvedValueOnce([
        {
          tx_hash: '0xabc' + 'd'.repeat(61),
          from_address: '0xfrom' + '0'.repeat(36),
          to_address: '0x' + 'e'.repeat(40),
          value: '5000',
          token_id: null,
          block_height: '1234',
          timestamp: new Date('2026-05-11T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([{ count: '42' }]);

    const res = await request(makeApp()).get(`/api/tokens/${contract}/transfers?limit=10`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 42,
      limit: 10,
      offset: 0,
    });
    expect(res.body.transfers).toHaveLength(1);
    expect(res.body.transfers[0]).toMatchObject({
      value: '5000',
      tokenId: null,
      blockHeight: 1234,
      timestamp: '2026-05-11T00:00:00.000Z',
    });
  });
});

describe('GET /api/tokens/:address/holders', () => {
  it('returns 404 for hidden tokens', async () => {
    const res = await request(makeApp()).get(
      `/api/tokens/${HIDDEN_TOKEN_ADDRESS}/holders`,
    );
    expect(res.status).toBe(404);
  });

  it('computes percentages from total_supply for a LEP100 token', async () => {
    const contract = '0xcccccccccccccccccccccccccccccccccccccccc';
    mockQuery
      .mockResolvedValueOnce([{ total_supply: '1000000' }])
      .mockResolvedValueOnce([
        { address: '0xholder1' + '0'.repeat(33), balance: '500000' },
        { address: '0xholder2' + '0'.repeat(33), balance: '250000' },
      ])
      .mockResolvedValueOnce([{ count: '2' }]);

    const res = await request(makeApp()).get(`/api/tokens/${contract}/holders?limit=25`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.holders).toEqual([
      { address: expect.stringMatching(/^0xholder1/), balance: '500000', percentage: 50 },
      { address: expect.stringMatching(/^0xholder2/), balance: '250000', percentage: 25 },
    ]);
  });
});

describe('GET /api/txs/:hash', () => {
  it('returns 404 when neither cosmos nor evm tables match a non-hex hash', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // exact cosmos hash match (uppercased)
      .mockResolvedValueOnce([]); // exact cosmos match as given
    // Third query is skipped because normalizeEvmTxHash('not-a-hash') === null

    const res = await request(makeApp()).get('/api/txs/not-a-hash');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Transaction not found' });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('looks a 0x EVM hash up in evm_transactions only, never scanning transactions', async () => {
    const evmHash = '0x' + 'ab'.repeat(32);
    mockQuery.mockResolvedValue([]);
    // DB miss falls through to the RPC fallback; make it answer "not found".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }))));

    const res = await request(makeApp()).get(`/api/txs/${evmHash}`);

    expect(res.status).toBe(404);
    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqls[0]).toContain('FROM evm_transactions WHERE LOWER(hash) = LOWER($1)');
    expect(sqls.some((sql) => sql.includes('FROM transactions t'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('never uses an unindexable LOWER(t.hash) comparison for Cosmos hashes', async () => {
    mockQuery.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }))));

    await request(makeApp()).get('/api/txs/' + 'cd'.repeat(32));

    const calls = mockQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    expect(calls.some((c) => c.sql.includes('LOWER(t.hash)'))).toBe(false);
    // Lowercase input: uppercase exact match first, then the exact input.
    expect(calls[0]).toMatchObject({ params: ['CD'.repeat(32)] });
    expect(calls[0].sql).toContain('WHERE t.hash = $1');
    expect(calls[1]).toMatchObject({ params: ['cd'.repeat(32)] });
    vi.unstubAllGlobals();
  });
});

describe('GET /api/txs/:hash/logs', () => {
  it('returns empty logs without hitting the DB when the hash is structurally invalid', async () => {
    // 0x-prefixed but too short → normalizeEvmTxHash returns null and the
    // startsWith('0x') branch skips the DB lookup. isEvmTxHash then rejects
    // and the handler short-circuits to {logs: [], raw: null}.
    const res = await request(makeApp()).get('/api/txs/0x123/logs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ logs: [], raw: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
