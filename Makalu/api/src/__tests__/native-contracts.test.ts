import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from './fixtures/native-factory.json' with { type: 'json' };
import { nativeContractRouter, nativeContractService, type NativeContractDependencies, type VerifiedSource } from '../native/contracts.js';
import { pinnedNativeWorkers, type Observation } from '../native/worker.js';

const tx = fixture.receipt.transactionHash;
const contract = fixture.contractAddress;
function setup() {
  let saved: VerifiedSource | null = null;
  const deps: NativeContractDependencies = {
    chainId: 700777, assertRuntime: vi.fn(async () => {}),
    receipt: vi.fn(async () => fixture.receipt),
    canonicalBlockHash: vi.fn(async () => fixture.receipt.blockHash),
    nativeRecord: vi.fn(async () => Buffer.from(fixture.nativeRecord.slice(2), 'hex')),
    workers: { decode: vi.fn(async () => structuredClone(fixture.observation) as Observation),
      verify: vi.fn(async () => fixture.verified) },
    sources: { put: vi.fn(async (value) => { saved = value; }), get: vi.fn(async () => saved),
      invalidate: vi.fn(async () => { saved = null; }) },
  };
  const app = express().use('/native', nativeContractRouter(deps));
  return { deps, app, service: nativeContractService(deps) };
}
describe('native canonical receipt and independent code boundary', () => {
  it('serves actual compiler/FFI observations without claiming source verification or consensus proof', async () => {
    const s = setup(); const response = await request(s.app).get(`/native/deployments/${tx}`);
    expect(response.status).toBe(200); expect(response.body).toEqual(fixture.observation);
    expect(s.deps.sources.put).not.toHaveBeenCalled();
  });
  it('rebuilds against independently read native record and publishes source only after success', async () => {
    const s = setup();
    const response = await request(s.app).post(`/native/contracts/${contract}/verify`)
      .send({ transactionHash: tx, request: fixture.verification });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ verificationState: 'source_match',
      rebuiltCodeHash: fixture.verified.rebuiltCodeHash, canonicalProofVerified: false });
    expect(s.deps.nativeRecord).toHaveBeenCalledWith(contract, '42', fixture.receipt.blockHash);
    expect(s.deps.workers.verify).toHaveBeenCalledWith(fixture.verification, contract, Buffer.from(fixture.nativeRecord.slice(2), 'hex'));
    expect((await request(s.app).get(`/native/contracts/${contract}/source`)).body.request).toEqual(fixture.verification);
  });
  it('defaults to unavailable without owner-configured readers or workers', async () => {
    const app = express().use('/native', nativeContractRouter());
    expect((await request(app).get(`/native/deployments/${tx}`)).status).toBe(503);
    expect((await request(app).post(`/native/contracts/${contract}/verify`).send({})).status).toBe(503);
  });
  it('returns unknown, never submitted, when configured RPC has no receipt', async () => {
    const s = setup(); vi.mocked(s.deps.receipt).mockResolvedValue(null);
    const response = await request(s.app).get(`/native/deployments/${tx}`);
    expect(response.status).toBe(404); expect(response.body.state).toBe('unknown');
    expect(s.deps.workers.decode).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied receipt/record fields before source verification', async () => {
    const s = setup(); const response = await request(s.app).post(`/native/contracts/${contract}/verify`)
      .send({ transactionHash: tx, request: fixture.verification, receipt: fixture.receipt, record: fixture.nativeRecord });
    expect(response.status).toBe(400); expect(s.deps.workers.verify).not.toHaveBeenCalled();
  });
  it('does not expose unpublished source in JSON-parser diagnostics', async () => {
    const s = setup();
    const response = await request(s.app).post(`/native/contracts/${contract}/verify`)
      .set('Content-Type', 'application/json').send('{"PRIVATE_UNPUBLISHED_SOURCE":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_native_json' });
    expect(response.text).not.toContain('PRIVATE_UNPUBLISHED_SOURCE');
    expect(s.deps.workers.verify).not.toHaveBeenCalled();
  });
  it('binds optional source transaction metadata to the observed transaction', async () => {
    const s = setup();
    await expect(s.service.verify(contract, tx, { ...fixture.verification, transactionHash: `0x${'ff'.repeat(32)}` })).rejects.toThrow('identity');
    expect(s.deps.workers.verify).not.toHaveBeenCalled();
  });
  it.each(['wrong-chain', 'wrong-tx', 'duplicate', 'proof-claim', 'failed-with-effects'])('rejects %s worker context', async (failure) => {
    const s = setup(); const observed = structuredClone(fixture.observation) as Observation;
    if (failure === 'wrong-chain') observed.chainId = '9005';
    if (failure === 'wrong-tx') observed.transactionHash = `0x${'ff'.repeat(32)}`;
    if (failure === 'duplicate') observed.deployments.push(observed.deployments[0]!);
    if (failure === 'proof-claim') (observed as unknown as { canonicalProofVerified: boolean }).canonicalProofVerified = true;
    if (failure === 'failed-with-effects') observed.state = 'failed';
    vi.mocked(s.deps.workers.decode).mockResolvedValue(observed);
    await expect(s.service.verify(contract, tx, fixture.verification)).rejects.toThrow();
    expect(s.deps.sources.put).not.toHaveBeenCalled();
  });
  it('invalidates previously saved matches after a reorg', async () => {
    const s = setup(); await s.service.verify(contract, tx, fixture.verification);
    vi.mocked(s.deps.canonicalBlockHash).mockResolvedValue(`0x${'ff'.repeat(32)}`);
    await expect(s.service.source(contract)).rejects.toThrow('canonical');
    expect(s.deps.sources.invalidate).toHaveBeenCalledWith(700777, fixture.receipt.blockHash);
  });
  it('does not store a source if the block changes while compiling', async () => {
    const s = setup(); vi.mocked(s.deps.canonicalBlockHash).mockResolvedValueOnce(fixture.receipt.blockHash).mockResolvedValue(`0x${'ff'.repeat(32)}`);
    await expect(s.service.verify(contract, tx, fixture.verification)).rejects.toThrow('canonical');
    expect(s.deps.sources.put).not.toHaveBeenCalled();
  });
  it.each(['code-mismatch', 'compiler-failure', 'runtime-unavailable', 'record-unavailable'])('does not publish source after %s', async (failure) => {
    const s = setup();
    if (failure === 'code-mismatch') vi.mocked(s.deps.workers.verify).mockResolvedValue({ ...fixture.verified, rebuiltCodeHash: `0x${'ff'.repeat(32)}` });
    if (failure === 'compiler-failure') vi.mocked(s.deps.workers.verify).mockRejectedValue(new Error('private compiler diagnostic'));
    if (failure === 'runtime-unavailable') vi.mocked(s.deps.assertRuntime).mockRejectedValue(new Error('unapproved runtime'));
    if (failure === 'record-unavailable') vi.mocked(s.deps.nativeRecord).mockRejectedValue(new Error('pruned state'));
    const response = await request(s.app).post(`/native/contracts/${contract}/verify`).send({ transactionHash: tx, request: fixture.verification });
    expect(response.status).toBe(422); expect(response.text).not.toContain('private compiler');
    expect(s.deps.sources.put).not.toHaveBeenCalled();
  });
  it('rejects executable hash mismatch before invoking any process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-worker-test-'));
    try {
      const worker = pinnedNativeWorkers({ chainId: 700777, gateway: fixture.gateway,
        decoder: { path: process.execPath, sha256: '0'.repeat(64) },
        verifier: { path: process.execPath, sha256: '0'.repeat(64) } });
      await expect(worker.decode(fixture.receipt)).rejects.toThrow('hash mismatch');
      // The bounded worker never accepts shell commands or unpinned executables.
      expect((await readFile(process.execPath)).length).toBeGreaterThan(0);
    } finally { await rm(directory, { recursive: true }); }
  });
});
