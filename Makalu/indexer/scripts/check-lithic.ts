// Read-only smoke check. Run with: pnpm exec tsx scripts/check-lithic.ts
import { discoverLithicToken } from '../src/lithovm.js';
import { nativeDeploymentCode, parseLithicInterface, isLithicToken } from '../src/lithic-interface.js';
const endpoint = process.env.LITHIC_CHECK_RPC || 'https://rpc-mainnet.litho.ai';
async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const body = await response.json() as { result?: T; error?: unknown };
  if (!response.ok || body.error) return null;
  return body.result ?? null;
}
const hash = '0xf873b5ec0116fdeff9ea9283469115138212263d0395378d61d1c98485181ec5';
const [tx, receipt] = await Promise.all([
  rpc<{ input: string }>('eth_getTransactionByHash', [hash]),
  rpc<{ blockNumber: string; logs: { blockNumber: string }[] }>('eth_getTransactionReceipt', [hash]),
]);
if (!tx || !receipt) throw new Error('LAX deployment unavailable');
const code = nativeDeploymentCode(tx.input, '0xbf8236de51fb4c9595e95882ac2951d526e7ad20c53a59ca349288169e71c42c');
if (!code) throw new Error('LAX deployment hash mismatch');
const abi = parseLithicInterface(code);
if (!isLithicToken(abi)) throw new Error('LAX interface does not match LEP-100');
const metadata = await discoverLithicToken('0x29147bebb1c49c3a54aa464137611fe708886df3', rpc, abi);
if (!metadata) throw new Error('LAX gateway metadata unavailable');
const chain = await rpc<string>('eth_chainId', []);
const bulk = await rpc<unknown[]>('eth_getBlockReceipts', [receipt.blockNumber]);
const block = await rpc<{ transactions: string[] }>('eth_getBlockByNumber', ['latest', false]);
const hashes = block?.transactions.slice(0, 24) ?? [];
const batchStarted = performance.now();
const batchResponse = hashes.length ? await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(hashes.map((hash, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'eth_getTransactionReceipt', params: [hash] }))),
  signal: AbortSignal.timeout(15000) }).then(r => r.json()) : [];
console.log(JSON.stringify({ chainId: chain ? Number(BigInt(chain)) : null, metadata,
  deploymentHeight: Number(BigInt(receipt.blockNumber)), logHeights: receipt.logs.map(l => l.blockNumber),
  bulkReceiptsSupported: Array.isArray(bulk),
  receiptBatchCount: hashes.length,
  receiptBatchSupported: Array.isArray(batchResponse) && batchResponse.length === hashes.length && batchResponse.every(r => r.result),
  receiptBatchMilliseconds: Math.round(performance.now() - batchStarted) }, null, 2));
