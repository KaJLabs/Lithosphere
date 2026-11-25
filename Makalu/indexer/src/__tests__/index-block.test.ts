import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared fake client that captures every query made against it
type CapturedQuery = { sql: string; params?: unknown[] };
let captured: CapturedQuery[];
let mockQueryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
let releaseSpy: ReturnType<typeof vi.fn>;

vi.mock('pg', () => {
  class FakePool {
    on() {
      return this;
    }
    async connect() {
      return {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          captured.push({ sql, params });
          return mockQueryImpl(sql, params);
        }),
        release: releaseSpy,
      };
    }
    async query(sql: string, params?: unknown[]) {
      captured.push({ sql, params });
      return mockQueryImpl(sql, params);
    }
  }
  return { default: { Pool: FakePool }, Pool: FakePool };
});

// Stub fetch globally — rpcGet uses fetch(url, { signal })
const originalFetch = globalThis.fetch;
beforeEach(() => {
  captured = [];
  mockQueryImpl = async () => ({ rows: [] });
  releaseSpy = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubRpc(responses: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    for (const [key, body] of Object.entries(responses)) {
      if (u.includes(key)) {
        return new Response(JSON.stringify({ result: body }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: { message: 'unknown rpc path: ' + u } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

const { indexBlock, prepareBlock, auditConsistency, commitPreparedRepair } = await import('../mappings.js');

describe('integrity maintenance at the writer boundary', () => {
  it('audits bounded history, prepares repairs without writes, then commits without moving the live checkpoint', async () => {
    mockQueryImpl = async (sql, params) => {
      if (sql.includes("key = 'last_indexed_block'")) return { rows: [{ value: '10011' }] };
      if (sql.includes('FULL OUTER JOIN') && params?.[0] === 1) return { rows: [99, 100, 101, 102, 103, 104].map(height => ({ height: String(height) })) };
      return { rows: [] };
    };
    stubRpc(Object.fromEntries([99, 100, 101, 102, 103, 104].flatMap(height => [
      [`/block?height=${height}`, { block_id: { hash: 'repair' }, block: { header: { proposer_address: 'a', time: '2026-11-25T00:00:00Z' }, data: { txs: [] } } }],
      [`/block_results?height=${height}`, { txs_results: [] }],
    ])));
    await auditConsistency();
    const scans = captured.filter(q => q.sql.includes('FULL OUTER JOIN'));
    expect(scans.map(q => q.params)).toEqual([[7963, 10010], [1, 10000]]);
    expect(captured.some(q => q.sql.includes('INSERT INTO blocks'))).toBe(false);
    expect(captured.some(q => q.sql.includes('consistency_audit_') && q.sql.includes('SELECT'))).toBe(true);
    expect(captured.find(q => q.sql.includes('jsonb_to_recordset'))?.params?.[0]).toContain('consistency_audit_repairs');
    const rpcCalls = vi.mocked(globalThis.fetch).mock.calls.length;
    await commitPreparedRepair();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(rpcCalls);
    expect(captured.some(q => q.sql.includes('INSERT INTO blocks') && q.params?.[0] === 99)).toBe(true);
    expect(captured.some(q => q.sql.includes("VALUES ('last_indexed_block'"))).toBe(false);
    for (let i = 0; i < 3; i++) await commitPreparedRepair();
    await auditConsistency();
    expect(captured.filter(q => q.sql.includes('FULL OUTER JOIN'))).toHaveLength(2);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(rpcCalls + 4);
    await commitPreparedRepair();
    await commitPreparedRepair();
    await auditConsistency();
    expect(captured.filter(q => q.sql.includes('FULL OUTER JOIN')).at(-1)?.params).toEqual([10001, 10010]);
  });
});

describe('indexBlock', () => {
  it('prepares RPC data without database writes and consumes it without refetching', async () => {
    stubRpc({
      '/block?height=100': {
        block_id: { hash: 'abc' },
        block: { header: { proposer_address: 'abc', time: '2026-11-24T00:00:00Z' }, data: { txs: [] } },
      },
      '/block_results?height=100': { txs_results: [] },
    });
    const prepared = await prepareBlock(100);
    expect(captured).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await expect(indexBlock(101, {}, prepared)).rejects.toThrow('Prepared block height');
    expect(captured).toEqual([]);
    await indexBlock(100, {}, prepared);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(captured.at(-1)?.sql).toBe('COMMIT');
  });
  it.each(['0x1', '0x0'])('uses receipt deployment and effective fee data, status=%s', async (status) => {
    const contract = '0x' + 'cd'.repeat(20);
    const evmHash = '0x' + 'ab'.repeat(32);
    const sender = '0x' + 'ef'.repeat(20);
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = init?.body ? JSON.parse(String(init.body)).method : '';
      const result = method === 'eth_getTransactionByHash'
        ? { hash: evmHash, from: sender, to: null, value: '0x0', gasPrice: '0x64', gas: '0xffff', nonce: '0x1', input: '0x6000' }
        : method === 'eth_getTransactionReceipt'
          ? { contractAddress: contract, status, effectiveGasPrice: '0x7', gasUsed: '0x5208', logs: [] }
          : String(url).includes('/block_results')
            ? { txs_results: [{ code: 0, gas_used: '50000', events: [
                { type: 'message', attributes: [{ key: 'action', value: '/ethermint.evm.v1.MsgEthereumTx' }] },
                { type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: evmHash }] },
              ] }] }
            : { block_id: { hash: 'abc' }, block: { header: { proposer_address: 'abc', time: '2026-11-04T00:00:00Z' }, data: { txs: [''] } } };
      return new Response(JSON.stringify({ result }));
    }) as typeof fetch;
    await indexBlock(200);
    const deployment = captured.find(item => item.sql.includes('INSERT INTO contracts'));
    if (status === '0x1') expect(deployment?.params).toEqual([contract, sender, evmHash, 200]);
    else expect(deployment).toBeUndefined();
    const transaction = captured.find(item => item.sql.includes('INSERT INTO evm_transactions'));
    expect(transaction?.params?.[7]).toBe('7');
    expect(transaction?.params?.[9]).toBe(21000);
  });
  it('indexes LithoVM native deployments and Transfer events from the gateway log', async () => {
    const evmHash = '0xf873b5ec0116fdeff9ea9283469115138212263d0395378d61d1c98485181ec5';
    const deployer = '0xbaa8feac6d01c3e75ca137da562c59b5b7eef293';
    const lax = '0x29147bebb1c49c3a54aa464137611fe708886df3';
    const holder = '0xc2c32eb0601e01bd3c9573bf2f865aeecb38c73b';
    const json = JSON.stringify({
      Deployments: [{ codeHash: '0x' + 'bf'.repeat(32), contract: lax, creator: deployer, origin: { kind: 'transaction', nonce: '0' } }],
      // Exact LVAL values of the mainnet LAX mint event.
      Events: [{ contract: lax, name: 'Transfer', values: '0x4c56414c01000304000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000c2c32eb0601e01bd3c9573bf2f865aeecb38c73b020000000000000000000000000000000000000000204fce5e3e25026110000000' }],
    });
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = init?.body ? JSON.parse(String(init.body)).method : '';
      const result = method === 'eth_getTransactionByHash'
        ? { hash: evmHash, from: deployer, to: '0x000000000000000000000000000000000000f000', value: '0x0', gasPrice: '0x1', gas: '0x83c4c0', nonce: '0x0', input: '0x36605535' }
        : method === 'eth_getTransactionReceipt'
          ? { status: '0x1', blockNumber: '0xe44c54', gasUsed: '0x83c4c0', logs: [{
              address: '0x000000000000000000000000000000000000f000',
              topics: ['0x093843f5e9eb40384e28a2de05071eb8158d09a803dec22fa5b5fb21a61e29a2'],
              data: '0x' + Buffer.from(json, 'utf8').toString('hex'),
              logIndex: '0x0',
              blockNumber: '0x0',
            }] }
          : String(url).includes('/block_results')
            ? { txs_results: [{ code: 0, gas_used: '8635911', events: [
                { type: 'message', attributes: [{ key: 'action', value: '/ethermint.evm.v1.MsgEthereumTx' }] },
                { type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: evmHash }] },
              ] }] }
            : { block_id: { hash: 'abc' }, block: { header: { proposer_address: 'abc', time: '2026-11-20T21:46:09Z' }, data: { txs: [''] } } };
      return new Response(JSON.stringify({ result }));
    }) as typeof fetch;
    await indexBlock(14_961_748);
    const deployment = captured.find(item => item.sql.includes("VALUES ($1, $2, $3, $4, 'lithovm', $5, $6)"));
    expect(deployment?.params?.slice(0, 4)).toEqual([lax, deployer, evmHash, 14_961_748]);
    expect(deployment?.params?.[5]).toBe('2026-11-20T21:46:09Z');
    const transfer = captured.find(item => item.sql.includes('INSERT INTO token_transfers'));
    expect(transfer?.params).toEqual([evmHash, 1_000_000_000, lax, '0x0000000000000000000000000000000000000000', holder,
      '10000000000000000000000000000', 14_961_748, '2026-11-20T21:46:09Z']);
    expect(captured.some(item => item.sql === 'COMMIT')).toBe(true);
  });
  it('continues indexing when a rejected transaction has malformed protobuf bytes', async () => {
    stubRpc({
      '/block?height=12050205': {
        block_id: { hash: 'abc' },
        block: { header: { proposer_address: 'abc', time: '2026-10-12T07:50:09Z' }, data: { txs: [Buffer.from([10, 5, 18]).toString('base64')] } },
      },
      '/block_results?height=12050205': { txs_results: [{ code: 2, gas_used: '0', gas_wanted: '0', events: [] }] },
    });
    await indexBlock(12050205);
    expect(captured.some((c) => c.sql === 'COMMIT')).toBe(true);
  });
  it('stores the transaction body memo even when events contain no memo', async () => {
    // TxRaw.body_bytes (field 1), containing TxBody.memo (field 2).
    const memo = Buffer.from('123456');
    const body = Buffer.concat([Buffer.from([18, memo.length]), memo]);
    const raw = Buffer.concat([Buffer.from([10, body.length]), body]).toString('base64');
    stubRpc({
      '/block?height=12050204': {
        block_id: { hash: 'abc' },
        block: { header: { proposer_address: 'abc', time: '2026-10-12T07:50:08Z' }, data: { txs: [raw] } },
      },
      '/block_results?height=12050204': { txs_results: [{ code: 0, gas_used: '116180', gas_wanted: '150000', events: [] }] },
    });
    await indexBlock(12050204);
    const insert = captured.find((c) => c.sql.trim().startsWith('INSERT INTO transactions'));
    expect(insert?.params?.[13]).toBe('123456');
  });
  it('issues BEGIN → INSERT blocks → COMMIT for an empty block', async () => {
    stubRpc({
      '/block?height=100': {
        block_id: { hash: '0xabc' },
        block: {
          header: { proposer_address: '0xprop', time: '2026-05-11T12:00:00Z' },
          data: { txs: [] },
        },
      },
      '/block_results?height=100': {
        txs_results: [],
      },
    });

    await indexBlock(100);

    const sqls = captured.map((c) => c.sql.trim());
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => s.startsWith('INSERT INTO blocks'))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it('lowercases block hash and proposer address before INSERT', async () => {
    stubRpc({
      '/block?height=101': {
        block_id: { hash: '0xABCDEF' },
        block: {
          header: { proposer_address: '0xPROP', time: '2026-05-11T12:00:00Z' },
          data: { txs: [] },
        },
      },
      '/block_results?height=101': { txs_results: [] },
    });

    await indexBlock(101);

    const blocksInsert = captured.find((c) => c.sql.trim().startsWith('INSERT INTO blocks'));
    expect(blocksInsert).toBeDefined();
    const params = blocksInsert!.params as unknown[];
    expect(params[1]).toBe('0xabcdef');
    expect(params[2]).toBe('0xprop');
  });

  it('rolls back and releases the client on RPC failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('boom', { status: 400 }),
    ) as typeof fetch;

    await expect(indexBlock(102)).rejects.toThrow();

    // RPC failed before any DB write, so we never reach BEGIN.
    expect(captured.find((c) => c.sql.trim() === 'ROLLBACK')).toBeUndefined();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it('retries transient RPC 503 responses without aborting the block cycle', async () => {
    let blockAttempts = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/block?height=104')) {
        blockAttempts++;
        if (blockAttempts < 3) {
          return new Response('rate limited', {
            status: 503,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({
          result: {
            block_id: { hash: '0xretry' },
            block: {
              header: { proposer_address: '0xprop', time: '2026-07-29T00:00:00Z' },
              data: { txs: [] },
            },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/block_results?height=104')) {
        return new Response(JSON.stringify({ result: { txs_results: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected path', { status: 404 });
    }) as typeof fetch;

    await indexBlock(104);

    expect(blockAttempts).toBe(3);
    expect(captured.some((c) => c.sql.trim().startsWith('INSERT INTO blocks'))).toBe(true);
  });

  it('deletes existing block rows first when replaceExisting=true', async () => {
    stubRpc({
      '/block?height=103': {
        block_id: { hash: '0xabc' },
        block: {
          header: { proposer_address: '0xprop', time: '2026-05-11T12:00:00Z' },
          data: { txs: [] },
        },
      },
      '/block_results?height=103': { txs_results: [] },
    });

    await indexBlock(103, { replaceExisting: true });

    const sqls = captured.map((c) => c.sql.trim());
    const deleteIndex = sqls.findIndex((s) => s.startsWith('DELETE FROM token_transfers'));
    const insertIndex = sqls.findIndex((s) => s.startsWith('INSERT INTO blocks'));
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(deleteIndex);

    // Verify all 5 expected tables are cleared
    expect(sqls).toEqual(expect.arrayContaining([
      expect.stringMatching(/^DELETE FROM token_transfers/),
      expect.stringMatching(/^DELETE FROM evm_transactions/),
      expect.stringMatching(/^DELETE FROM transactions/),
      expect.stringMatching(/^DELETE FROM contracts/),
      expect.stringMatching(/^DELETE FROM blocks/),
    ]));
  });
});
