// Offline Linux smoke using actual Rust workers; never opens RPC or a database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pinnedNativeWorkers } from '../dist/native/worker.js';
import { nativeContractService } from '../dist/native/contracts.js';

if (process.argv.length !== 4) throw new Error('usage: node native-worker-smoke.mjs BINARY_DIR REPORT.json');
const fixture = JSON.parse(await readFile(new URL('../src/__tests__/fixtures/native-factory.json', import.meta.url), 'utf8'));
const pin = async (name) => {
  const path = join(process.argv[2], name);
  return { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
};
const decoder = await pin('lithdev'), verifier = await pin('lithverify');
const workers = pinnedNativeWorkers({ chainId: 700777, gateway: fixture.gateway, decoder, verifier });
assert.deepEqual(await workers.decode(fixture.receipt), fixture.observation);
const record = Buffer.from(fixture.nativeRecord.slice(2), 'hex');
assert.deepEqual(await workers.verify(fixture.verification, fixture.contractAddress, record), fixture.verified);
const wrongContext = { ...fixture.verification, chainId: 9005 };
await assert.rejects(() => workers.verify(wrongContext, fixture.contractAddress, record));
const corrupt = Buffer.from(record); corrupt[0] ^= 1;
await assert.rejects(() => workers.verify(fixture.verification, fixture.contractAddress, corrupt));
const unpinned = pinnedNativeWorkers({ chainId: 700777, gateway: fixture.gateway,
  decoder: { ...decoder, sha256: '0'.repeat(64) }, verifier });
await assert.rejects(() => unpinned.decode(fixture.receipt), /hash mismatch/);
let saved = null;
const service = nativeContractService({ chainId: 700777,
  assertRuntime: async () => {}, receipt: async () => fixture.receipt,
  canonicalBlockHash: async () => fixture.receipt.blockHash,
  nativeRecord: async () => record, workers,
  sources: { put: async (value) => { saved = value; }, get: async () => saved,
    invalidate: async () => { saved = null; } } });
const matched = await service.verify(fixture.contractAddress, fixture.receipt.transactionHash, fixture.verification);
assert.equal(matched.verificationState, 'source_match');
assert.equal(matched.canonicalProofVerified, false);
assert.deepEqual((await service.source(fixture.contractAddress)).request, fixture.verification);
await writeFile(process.argv[3], JSON.stringify({ result: 'PASS', scope: 'offline synthetic compiler/FFI fixture, no chain deployment',
  decoder, verifier, fixtureSha256: createHash('sha256').update(await readFile(new URL('../src/__tests__/fixtures/native-factory.json', import.meta.url))).digest('hex'),
  cases: ['actual receipt decoder', 'actual source rebuild against independent record', 'wrong-chain rejection',
    'corrupt-record rejection', 'worker-pin rejection', 'service/source persistence integration'],
  canonicalProofVerified: false }, null, 2) + '\n', { mode: 0o600 });
console.log('PASS: real pinned decoder/verifier and service integration (offline only)');
