import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDurableCursor, processBlockRange } from '../src/services/eventListener.js';

const bridge = '0x1111111111111111111111111111111111111111';
const sourceToken = '0xC0FC628e3aB128fe387e7ed5e729bD809C017888';
const blockHash = `0x${'ab'.repeat(32)}`;

const spec = (overrides = {}) => ({
  name: 'kamet',
  chainId: 900523,
  bridge,
  startBlock: 100,
  confirmations: 12,
  reorgOverlap: 10,
  ...overrides,
});

test('cold start begins immediately before the configured deployment block', async () => {
  const database = { query: async () => ({ rows: [] }) };
  const cursor = await loadDurableCursor(spec(), {}, database, 500);
  assert.equal(cursor, 99);
});

test('persisted cursor resumes with the configured reorg overlap', async () => {
  const database = {
    query: async () => ({ rows: [{ last_processed_block: '120', last_processed_hash: blockHash }] }),
  };
  const provider = { getBlock: async () => ({ hash: blockHash }) };
  const cursor = await loadDurableCursor(spec(), provider, database);
  assert.equal(cursor, 110);
});

test('cursor hash mismatch fails closed for manual reconciliation', async () => {
  const database = {
    query: async () => ({ rows: [{ last_processed_block: '120', last_processed_hash: blockHash }] }),
  };
  const provider = { getBlock: async () => ({ hash: `0x${'cd'.repeat(32)}` }) };
  await assert.rejects(
    loadDurableCursor(spec(), provider, database),
    /manual reconciliation required/
  );
});

function rangeFixture({ failInsert = false, targetChain = 11155111, targetChains = null } = {}) {
  const calls = [];
  const params = [];
  const client = {
    async query(sql, values) {
      const text = String(sql).trim();
      calls.push(text);
      params.push(values);
      if (failInsert && text.startsWith('INSERT INTO bridge_transactions')) {
        throw new Error('temporary database failure');
      }
      return { rows: [] };
    },
    release() { calls.push('RELEASE_CLIENT'); },
  };
  const watcher = {
    spec: spec(),
    lastBlock: 99,
    provider: { getBlock: async () => ({ hash: blockHash }) },
    contract: {
      filters: { TokensLocked: () => ({}) },
      queryFilter: async () => (targetChains || [targetChain]).map((chain, index) => ({
        args: {
          txHash: `0x${String(index + 12).padStart(2, '0').repeat(32)}`,
          token: sourceToken,
          user: '0x2222222222222222222222222222222222222222',
          amount: 10n,
          targetChain: BigInt(chain),
          nonce: BigInt(index + 7),
        },
        blockNumber: 100,
        blockHash,
        transactionHash: `0x${String(index + 22).padStart(2, '0').repeat(32)}`,
        index,
      })),
    },
  };
  return { calls, params, client, watcher, database: { connect: async () => client } };
}

test('events and cursor commit atomically before in-memory progress advances', async () => {
  const fixture = rangeFixture();
  await processBlockRange(fixture.watcher, 100, fixture.database);
  assert.equal(fixture.watcher.lastBlock, 100);
  assert.equal(fixture.calls[0], 'BEGIN');
  assert.match(fixture.calls[1], /^INSERT INTO bridge_transactions/);
  assert.equal(fixture.params[1][5], bridge.toLowerCase());
  assert.doesNotMatch(fixture.calls[1], /status='locked'/);
  assert.match(fixture.calls[2], /^INSERT INTO bridge_event_cursors/);
  assert.equal(fixture.calls[3], 'COMMIT');
  assert.equal(fixture.calls[4], 'RELEASE_CLIENT');
});

test('database failure rolls back and never advances the cursor', async () => {
  const fixture = rangeFixture({ failInsert: true });
  await assert.rejects(
    processBlockRange(fixture.watcher, 100, fixture.database),
    /temporary database failure/
  );
  assert.equal(fixture.watcher.lastBlock, 99);
  assert.ok(fixture.calls.includes('ROLLBACK'));
  assert.ok(!fixture.calls.includes('COMMIT'));
});

test('an unmapped route is quarantined and the cursor advances', async () => {
  const fixture = rangeFixture({ targetChain: 999999 });
  await processBlockRange(fixture.watcher, 100, fixture.database);
  assert.equal(fixture.watcher.lastBlock, 100);
  assert.match(fixture.calls[1], /^INSERT INTO bridge_rejected_events/);
  assert.ok(fixture.calls.includes('COMMIT'));
  assert.ok(!fixture.calls.includes('ROLLBACK'));
});

for (const [position, targetChains] of [
  ['first', [999999, 11155111, 11155111]],
  ['middle', [11155111, 999999, 11155111]],
  ['last', [11155111, 11155111, 999999]],
]) {
  test(`an unsupported ${position} event in a block cannot poison valid later progress`, async () => {
    const fixture = rangeFixture({ targetChains });
    await processBlockRange(fixture.watcher, 100, fixture.database);
    assert.equal(fixture.watcher.lastBlock, 100);
    assert.equal(fixture.calls.filter((call) => /^INSERT INTO bridge_rejected_events/.test(call)).length, 1);
    assert.equal(fixture.calls.filter((call) => /^INSERT INTO bridge_transactions/.test(call)).length, 2);
    assert.ok(fixture.calls.includes('COMMIT'));
  });
}

test('restart overlap reprocesses a quarantined event idempotently and advances', async () => {
  const fixture = rangeFixture({ targetChain: 999999 });
  await processBlockRange(fixture.watcher, 100, fixture.database);
  fixture.watcher.lastBlock = 99;
  await processBlockRange(fixture.watcher, 100, fixture.database);
  assert.equal(fixture.watcher.lastBlock, 100);
  assert.equal(fixture.calls.filter((call) => /^INSERT INTO bridge_rejected_events/.test(call)).length, 2);
  assert.equal(fixture.calls.filter((call) => call === 'COMMIT').length, 2);
});

test('an arbitrary uint256 target chain is quarantined without overflowing PostgreSQL BIGINT', async () => {
  const fixture = rangeFixture({ targetChain: (2n ** 256n - 1n).toString() });
  await processBlockRange(fixture.watcher, 100, fixture.database);
  assert.equal(fixture.watcher.lastBlock, 100);
  assert.match(fixture.calls[1], /^INSERT INTO bridge_rejected_events/);
  assert.ok(fixture.calls.includes('COMMIT'));
});

test('removed logs never enter a database transaction', async () => {
  const f = rangeFixture();
  const query = f.watcher.contract.queryFilter;
  f.watcher.contract.queryFilter = async () => (await query()).map(e => ({ ...e, removed: true }));
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /Removed or invalid/);
  assert.deepEqual(f.calls, []);
});

test('event hashes must match their canonical block', async () => {
  const f = rangeFixture();
  f.watcher.provider.getBlock = async () => ({ hash: `0x${'ff'.repeat(32)}` });
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /event block hash mismatch/);
  assert.deepEqual(f.calls, []);
});

test('range reorganization during database writes rolls back cursor and events', async () => {
  const f = rangeFixture();
  let reads = 0;
  f.watcher.provider.getBlock = async () => ({ hash: ++reads === 1 ? blockHash : `0x${'ff'.repeat(32)}` });
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /reorganized before commit/);
  assert.equal(f.watcher.lastBlock, 99);
  assert.ok(f.calls.includes('ROLLBACK'));
  assert.ok(!f.calls.includes('COMMIT'));
});

test('continuous polling rejects a changed previous checkpoint', async () => {
  const f = rangeFixture();
  f.watcher.lastBlockHash = `0x${'ff'.repeat(32)}`;
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /checkpoint hash mismatch/);
  assert.deepEqual(f.calls, []);
});
