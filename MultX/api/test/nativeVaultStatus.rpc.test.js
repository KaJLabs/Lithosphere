import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createNativeVaultStatusReader } from '../src/services/nativeVaultStatus.js';
import { createNativeVaultStatusProvider } from '../src/nativeVaultStatusProvider.js';

const sourceVault = '0x1111111111111111111111111111111111111111';
const destinationVault = '0x2222222222222222222222222222222222222222';
const operationId = `0x${'3'.repeat(64)}`;
const runtimeA = '0x6001';
const runtimeB = '0x6002';
const hashCode = code => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');

async function rpcFixture(chainId, height, strictQuantity = true) {
  const state = { hash: `0x${'a'.repeat(64)}`, code: runtimeA, codeReads: 0, blockTags: [] };
  const respond = request => {
    const { method, params = [], id } = request;
    let result;
    if (method === 'eth_chainId') result = `0x${chainId.toString(16)}`;
    else if (method === 'eth_blockNumber') result = `0x${height.toString(16)}`;
    else if (method === 'eth_getBlockByNumber') {
      state.blockTags.push(params[0]);
      if (strictQuantity && !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(params[0])) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'noncanonical block quantity' } };
      }
      result = { number: `0x${height.toString(16)}`, hash: state.hash };
    } else if (method === 'eth_getCode') {
      state.codeReads++;
      result = state.code;
    } else throw Error(`unexpected RPC method: ${method}`);
    return { jsonrpc: '2.0', id, result };
  };
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(Array.isArray(payload) ? payload.map(respond) : respond(payload)));
    } catch (error) {
      response.statusCode = 500;
      response.end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

function reader(sourceProvider, destinationProvider) {
  return createNativeVaultStatusReader({
    routes: [{ sourceChainId: 1, destinationChainId: 56, sourceVault, destinationVault,
      sourceConfirmations: 1, destinationConfirmations: 1,
      sourceRuntimeSha256: hashCode(runtimeA), destinationRuntimeSha256: hashCode(runtimeA) }],
    providers: new Map([[1, sourceProvider], [56, destinationProvider]]),
    contractFactory: vault => vault.toLowerCase() === sourceVault.toLowerCase()
      ? {
          deposits: async () => ({ depositor: sourceVault, recipient: destinationVault,
            amount: 1n, targetChain: 56n, quotedOutput: 1n, quoteExpiry: 999n,
            targetVault: destinationVault, state: 2n }),
          supportedChains: async () => true,
          sourceVaults: async () => destinationVault,
        }
      : {
          releaseStates: async () => 1n,
          supportedChains: async () => true,
          sourceVaults: async () => sourceVault,
        },
  });
}

test('strict RPC accepts status at odd-width and even-width block heights', async () => {
  for (const height of [15, 16, 256]) {
    const source = await rpcFixture(1, height);
    const destination = await rpcFixture(56, height);
    const sourceProvider = createNativeVaultStatusProvider(source.url);
    const destinationProvider = createNativeVaultStatusProvider(destination.url);
    try {
      const status = await reader(sourceProvider, destinationProvider)(1, 56, operationId);
      assert.equal(status.status, 'completed');
      assert.ok(source.state.blockTags.every(tag => tag === `0x${height.toString(16)}`));
    } finally {
      sourceProvider.destroy(); destinationProvider.destroy();
      await Promise.all([source.close(), destination.close()]);
    }
  }
});

test('same-height anchor change requires a fresh runtime read', async () => {
  const source = await rpcFixture(1, 16);
  const destination = await rpcFixture(56, 16);
  const sourceProvider = createNativeVaultStatusProvider(source.url);
  const destinationProvider = createNativeVaultStatusProvider(destination.url);
  try {
    const read = reader(sourceProvider, destinationProvider);
    assert.equal((await read(1, 56, operationId)).status, 'completed');
    source.state.hash = `0x${'b'.repeat(64)}`;
    source.state.code = runtimeB;
    await assert.rejects(read(1, 56, operationId), /native vault runtime mismatch/);
    assert.ok(source.state.codeReads >= 2);
  } finally {
    sourceProvider.destroy(); destinationProvider.destroy();
    await Promise.all([source.close(), destination.close()]);
  }
});
