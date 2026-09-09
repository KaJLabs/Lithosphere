import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';
import { processBlockRange, createEventProvider } from '../src/services/eventListener.js';

const hash = `0x${'ab'.repeat(32)}`;
const changedHash = `0x${'cd'.repeat(32)}`;
const bridge = '0x1111111111111111111111111111111111111111';
const abi = ['event TokensLocked(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 targetChain,uint256 nonce)'];
const iface = new ethers.Interface(abi);
const encoded = iface.encodeEventLog(iface.getEvent('TokensLocked'), [
  `0x${'12'.repeat(32)}`, '0xC0FC628e3aB128fe387e7ed5e729bD809C017888',
  '0x2222222222222222222222222222222222222222', 10n, 11155111n, 7n,
]);

async function fixture(t, changeOnInsert = false, removed = false) {
  const requests = [], calls = [];
  let changed = false;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    function answer(r) {
      requests.push(r);
      let result;
      if (r.method === 'eth_chainId') result = '0xdbdbb';
      else if (r.method === 'eth_getBlockByNumber') result = {
        number: '0x64', hash: changed ? changedHash : hash, parentHash: hash,
        timestamp: '0x6553f100', nonce: '0x0000000000000000', difficulty: '0x0',
        gasLimit: '0x1c9c380', gasUsed: '0x5208', miner: bridge, extraData: '0x',
        transactions: [],
      };
      else if (r.method === 'eth_getLogs') result = [{
        address: bridge, blockNumber: '0x64', blockHash: hash,
        transactionHash: `0x${'34'.repeat(32)}`, transactionIndex: '0x0',
        logIndex: '0x0', removed, ...encoded,
      }];
      else return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: r.method } };
      return { jsonrpc: '2.0', id: r.id, result };
    }
    const payload = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(Array.isArray(payload) ? payload.map(answer) : answer(payload)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const provider = createEventProvider({ rpc: `http://127.0.0.1:${server.address().port}`, chainId: 900523 });
  t.after(async () => { provider.destroy(); await new Promise(resolve => server.close(resolve)); });
  const watcher = { spec: { name: 'rpc-fixture', chainId: 900523, bridge }, lastBlock: 99,
    provider, contract: new ethers.Contract(bridge, abi, provider) };
  const database = { connect: async () => ({
    query: async (sql) => {
      const s = sql.trim(); calls.push(s);
      if (changeOnInsert && s.startsWith('INSERT INTO bridge_transactions')) changed = true;
      return { rows: [] };
    }, release() {},
  }) };
  return { watcher, database, requests, calls };
}

test('real ethers RPC log filter decodes and commits a stable event range', async t => {
  const f = await fixture(t);
  await processBlockRange(f.watcher, 100, f.database);
  const filter = f.requests.find(r => r.method === 'eth_getLogs').params[0];
  assert.equal(filter.address, bridge);
  assert.equal(filter.fromBlock, '0x64'); assert.equal(filter.toBlock, '0x64');
  assert.deepEqual(filter.topics, [iface.getEvent('TokensLocked').topicHash]);
  assert.ok(f.calls.includes('COMMIT'));
});

test('real ethers RPC does not hide a rapid reorg behind its block cache', async t => {
  const f = await fixture(t, true);
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /reorganized before commit/);
  assert.ok(f.requests.filter(r => r.method === 'eth_getBlockByNumber').length >= 2);
  assert.ok(f.calls.includes('ROLLBACK')); assert.ok(!f.calls.includes('COMMIT'));
  assert.equal(f.watcher.lastBlock, 99);
});

test('real ethers RPC preserves removed-log flag for rejection', async t => {
  const f = await fixture(t, false, true);
  await assert.rejects(processBlockRange(f.watcher, 100, f.database), /Removed or invalid/);
  assert.deepEqual(f.calls, []);
});
