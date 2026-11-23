import { describe, expect, it, vi } from 'vitest';
import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import {
  LITHOVM_GATEWAY,
  LITHOVM_LOG_TOPIC,
  backfillLithicLogs,
  decodeLithicTransfer,
  decodeLval,
  discoverLithicToken,
  encodeLval,
  indexLithicReceiptLogs,
  lithicLogIndex,
  lithicSelector,
  parseGatewayLog,
  resolveLithovmStartBlock,
  type LithicRpc,
} from '../lithovm.js';

// Gateway log of the LAX v13 deploy on LITHO mainnet: tx 0xf873…81ec5, block 14,961,748.
const LAX = '0x29147bebb1c49c3a54aa464137611fe708886df3';
const HOLDER = '0xc2c32eb0601e01bd3c9573bf2f865aeecb38c73b';
const DEPLOY_TX = '0xf873b5ec0116fdeff9ea9283469115138212263d0395378d61d1c98485181ec5';
const DEPLOY_JSON = '{"Deployments":[{"codeHash":"0xbf8236de51fb4c9595e95882ac2951d526e7ad20c53a59ca349288169e71c42c","contract":"0x29147bebb1c49c3a54aa464137611fe708886df3","creator":"0xbaa8feac6d01c3e75ca137da562c59b5b7eef293","origin":{"kind":"transaction","nonce":"0"}}],"Events":[{"contract":"0x29147bebb1c49c3a54aa464137611fe708886df3","name":"AdminTransferred","values":"0x4c56414c01000204000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000602699fa64ab8f981e074e267bae633d389b78da"},{"contract":"0x29147bebb1c49c3a54aa464137611fe708886df3","name":"Transfer","values":"0x4c56414c01000304000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000c2c32eb0601e01bd3c9573bf2f865aeecb38c73b020000000000000000000000000000000000000000204fce5e3e25026110000000"}]}';
const deployLog = {
  address: LITHOVM_GATEWAY,
  topics: [LITHOVM_LOG_TOPIC],
  data: '0x' + Buffer.from(DEPLOY_JSON, 'utf8').toString('hex'),
  logIndex: '0x0',
};
const SUPPLY = '10000000000000000000000000000'; // 10^28 = 10B LAX × 10^18

describe('LVAL', () => {
  it('decodes the protocol test vector ["Aé", ""]', () => {
    expect(decodeLval('0x4c56414c01000206000341c3a9060000')).toEqual([
      { type: 'string', value: 'Aé' },
      { type: 'string', value: '' },
    ]);
  });

  it('round-trips every type', () => {
    const hex = encodeLval([
      ['u64', 18n], ['u256', 10n ** 28n], ['bool', true],
      ['address', HOLDER], ['bytes32', '0x' + '11'.repeat(32)], ['string', 'LAX'],
    ]);
    expect(decodeLval(hex).map((v) => v.value)).toEqual([18n, 10n ** 28n, true, HOLDER, '0x' + '11'.repeat(32), 'LAX']);
  });

  it.each([
    ['trailing bytes', '0x4c56414c01000006000000'],
    ['unknown tag', '0x4c56414c0100010700'],
    ['wrong version', '0x4c56414c020000'],
    ['non-canonical u64', '0x4c56414c01000101' + '01'.repeat(32)],
    ['non-canonical bool', '0x4c56414c01000103' + '00'.repeat(31) + '02'],
    ['non-canonical address', '0x4c56414c01000104' + '01' + '00'.repeat(31)],
    ['truncated word', '0x4c56414c01000102' + '00'.repeat(31)],
    ['invalid utf-8', '0x4c56414c0100010600' + '01' + 'ff'],
  ])('rejects %s', (_name, hex) => {
    expect(() => decodeLval(hex)).toThrow();
  });
});

describe('gateway logs', () => {
  it('uses the documented topic and selector hashes', () => {
    expect(keccak256(toUtf8Bytes('LithoNativeLab(bytes)'))).toBe(LITHOVM_LOG_TOPIC);
    expect(lithicSelector('transfer(address,u256)')).toBe('0xf61367304e4e32065cad538b10a44bb599f78e0771530108572d225c74122c1f');
    expect(lithicSelector('balance_of(address)')).toBe('0xb144adfb505c053e0d50877cc29fb830ff028d3498efa8f33757758d63bec35d');
  });

  it('parses the mainnet LAX deploy log', () => {
    const record = parseGatewayLog(deployLog)!;
    expect(record.deployments).toEqual([{
      contract: LAX,
      creator: '0xbaa8feac6d01c3e75ca137da562c59b5b7eef293',
      codeHash: '0xbf8236de51fb4c9595e95882ac2951d526e7ad20c53a59ca349288169e71c42c',
    }]);
    expect(record.events.map((e) => e.name)).toEqual(['AdminTransferred', 'Transfer']);
    expect(decodeLithicTransfer(record.events[0])).toBeNull();
    expect(decodeLithicTransfer(record.events[1])).toEqual({
      from: '0x0000000000000000000000000000000000000000', to: HOLDER, value: SUPPLY,
    });
  });

  it('ignores ordinary EVM logs and malformed gateway data', () => {
    expect(parseGatewayLog({ ...deployLog, address: '0x' + '12'.repeat(20) })).toBeNull();
    expect(parseGatewayLog({ ...deployLog, topics: [LITHOVM_LOG_TOPIC, LITHOVM_LOG_TOPIC] })).toBeNull();
    expect(parseGatewayLog({ ...deployLog, data: '0x' + Buffer.from('{not json').toString('hex') })).toBeNull();
    const bad = parseGatewayLog({ ...deployLog, data: '0x' + Buffer.from(JSON.stringify({
      Deployments: [{ contract: 'nope' }], Events: [{ contract: LAX, name: 'Transfer', values: 'zz' }],
    })).toString('hex') });
    expect(bad).toEqual({ deployments: [], events: [] });
  });

  it('rejects a Transfer whose fields are not (address, address, u256)', () => {
    const values = encodeLval([['address', HOLDER], ['address', HOLDER], ['u64', 5n]]);
    expect(decodeLithicTransfer({ contract: LAX, name: 'Transfer', values })).toBeNull();
  });

  it('keeps synthetic log indexes above real EVM indexes and within INTEGER', () => {
    expect(lithicLogIndex(0, 1)).toBe(1_000_000_001);
    expect(lithicLogIndex(3, 999)).toBe(1_000_003_999);
    expect(lithicLogIndex(0, 1000)).toBeNull();
    expect(lithicLogIndex(1_147_483, 0)).toBeNull();
    expect(lithicLogIndex(1_147_482, 999)).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe('indexLithicReceiptLogs', () => {
  it('stores the LAX deployment and its genesis mint', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = { query: vi.fn(async (sql: string, params?: unknown[]) => { queries.push({ sql, params }); return { rows: [] }; }) };
    const ordinary = { address: '0x' + '34'.repeat(20), topics: ['0x' + '00'.repeat(32)], data: '0x', logIndex: '0x0' };
    const result = await indexLithicReceiptLogs(client, DEPLOY_TX.toUpperCase().replace('0X', '0x'), 14_961_748, '2026-11-20T21:46:09Z', [ordinary, deployLog]);
    expect(result).toEqual({ deployments: 1, transfers: 1 });

    const deployment = queries.find((q) => q.sql.includes('INSERT INTO contracts (address, creator'));
    expect(deployment?.params).toEqual([LAX, '0xbaa8feac6d01c3e75ca137da562c59b5b7eef293', DEPLOY_TX, 14_961_748,
      '0xbf8236de51fb4c9595e95882ac2951d526e7ad20c53a59ca349288169e71c42c']);
    const transfer = queries.find((q) => q.sql.includes('INSERT INTO token_transfers'));
    // Log at receipt position 1, event at position 1 → 1,000,001,001.
    expect(transfer?.params).toEqual([DEPLOY_TX, 1_000_001_001, LAX,
      '0x0000000000000000000000000000000000000000', HOLDER, SUPPLY, 14_961_748, '2026-11-20T21:46:09Z']);
    expect(queries.findIndex((q) => q.sql.includes('INSERT INTO contracts (address, creator')))
      .toBeLessThan(queries.findIndex((q) => q.sql.includes('INSERT INTO token_transfers')));
    expect(queries.some((q) => q.sql.includes("VALUES ($1, 'token', 'lithovm')"))).toBe(true);
  });
});

const gateway = new Interface(['function call(address contract, bytes32 selector, bytes args) returns (bytes)']);

function tokenRpc(values: Record<string, string | null>): LithicRpc {
  const bySelector = new Map(Object.entries(values).map(([sig, lval]) => [lithicSelector(sig), lval]));
  return vi.fn(async (method: string, params: unknown[]) => {
    expect(method).toBe('eth_call');
    const call = params[0] as { from?: string; to: string; data: string };
    expect(call.to).toBe(LITHOVM_GATEWAY);
    expect(call.from).toMatch(/^0x0{39}1$/); // gateway reads need a non-zero from
    const [, selector] = gateway.decodeFunctionData('call', call.data);
    const lval = bySelector.get(String(selector));
    return (lval ? gateway.encodeFunctionResult('call', [lval]) : null) as never;
  }) as LithicRpc;
}

describe('discoverLithicToken', () => {
  const lax = {
    'name()': encodeLval([['string', 'Lithosphere Algorithmic']]),
    'symbol()': encodeLval([['string', 'LAX']]),
    'decimals()': encodeLval([['u64', 18n]]),
    'total_supply()': encodeLval([['u256', 10n ** 28n]]),
    'balance_of(address)': encodeLval([['u256', 0n]]),
  };

  it('reads LAX metadata through the gateway', async () => {
    expect(await discoverLithicToken(LAX, tokenRpc(lax))).toEqual({
      name: 'Lithosphere Algorithmic', symbol: 'LAX', decimals: 18, totalSupply: SUPPLY, contractType: 'token',
    });
  });

  it('requires token return types (decimals must be u64)', async () => {
    expect(await discoverLithicToken(LAX, tokenRpc({ ...lax, 'decimals()': encodeLval([['u256', 18n]]) }))).toBeNull();
    expect(await discoverLithicToken(LAX, tokenRpc({ ...lax, 'balance_of(address)': null }))).toBeNull();
  });

  it('bounds names to the column sizes', async () => {
    const token = await discoverLithicToken(LAX, tokenRpc({ ...lax, 'name()': encodeLval([['string', 'N'.repeat(500)]]) }));
    expect(token?.name).toHaveLength(100);
  });
});

describe('backfillLithicLogs', () => {
  it('indexes each gateway transaction from its receipt block number, not the log', async () => {
    const getLogsCalls: unknown[] = [];
    const rpc = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_getLogs') {
        getLogsCalls.push(params[0]);
        const { fromBlock } = params[0] as { fromBlock: string };
        // Gateway logs report blockNumber 0x0 on mainnet.
        return (fromBlock === '0xe44c40' ? [{ ...deployLog, blockNumber: '0x0', transactionHash: DEPLOY_TX }] : []) as never;
      }
      if (method === 'eth_getTransactionReceipt') {
        return { status: '0x1', blockNumber: '0xe44c54', transactionHash: DEPLOY_TX, logs: [deployLog] } as never;
      }
      return null;
    }) as LithicRpc;
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const record = async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return sql.includes('FROM blocks') ? { rows: [{ block_time: '2026-11-20T21:46:09Z' }] } : { rows: [] };
    };
    const db = { query: record, connect: async () => ({ query: record, release: () => {} }) };

    const result = await backfillLithicLogs({ rpc, db, fromBlock: 14_961_728, toBlock: 14_961_800, window: 20 });
    expect(result).toMatchObject({ complete: true, transactions: 1, deployments: 1, transfers: 1 });
    expect(getLogsCalls).toHaveLength(4);
    expect(getLogsCalls[0]).toMatchObject({ address: LITHOVM_GATEWAY, topics: [LITHOVM_LOG_TOPIC] });
    expect(queries.find((q) => q.sql.includes('FROM blocks'))?.params).toEqual([14_961_748]);
    expect(queries.find((q) => q.sql.includes('INSERT INTO token_transfers'))?.params?.[6]).toBe(14_961_748);
    expect(queries.map((q) => q.sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
  });

  it('is not complete when a window fails, so it is retried', async () => {
    const rpc = vi.fn(async () => null) as LithicRpc;
    const db = { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({}), release: () => {} }) };
    expect(await backfillLithicLogs({ rpc, db, fromBlock: 1, toBlock: 10 })).toMatchObject({ complete: false, failedWindows: 1 });
  });
});

describe('resolveLithovmStartBlock', () => {
  it('defaults to the mainnet activation height only on chain 9005', () => {
    expect(resolveLithovmStartBlock(9005, undefined)).toBe(14_946_527);
    expect(resolveLithovmStartBlock(700777, undefined)).toBeNull();
    expect(resolveLithovmStartBlock(700777, '123')).toBe(123);
    expect(() => resolveLithovmStartBlock(9005, 'x')).toThrow();
  });
});
