import { Router, json } from 'express';
import type { NativeWorkers, Observation, Registration, SourceMatch } from './worker.js';

const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const height = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= (1n << 64n) - 1n;
export interface VerifiedSource {
  registration: Registration; result: SourceMatch; request: unknown;
}
export interface NativeSourceRepository {
  put(value: VerifiedSource): Promise<void>;
  get(chainId: number, contract: string): Promise<VerifiedSource | null>;
  invalidate(chainId: number, blockHash: string): Promise<void>;
}
export interface NativeContractDependencies {
  chainId: number;
  /** Configured trusted reader checks chain/runtime pins; no request-supplied URLs or receipts. */
  assertRuntime(): Promise<void>;
  receipt(transactionHash: string): Promise<unknown | null>;
  canonicalBlockHash(height: string): Promise<string>;
  /** Must return the native KV record at this exact block, not latest state. */
  nativeRecord(contract: string, height: string, blockHash: string): Promise<Uint8Array>;
  workers: NativeWorkers;
  sources: NativeSourceRepository;
}

export function nativeContractService(deps: NativeContractDependencies) {
  async function canonical(observed: { blockHash: string; blockHeight: string }) {
    if (!height(observed.blockHeight) || !hash(observed.blockHash)) throw new Error('Invalid native block identity');
    if (await deps.canonicalBlockHash(observed.blockHeight) !== observed.blockHash) {
      await deps.sources.invalidate(deps.chainId, observed.blockHash);
      throw new Error('Native observation block is no longer canonical');
    }
  }
  async function observe(transactionHash: string): Promise<Observation | null> {
    if (!hash(transactionHash)) throw new Error('Invalid transaction hash');
    await deps.assertRuntime();
    const receipt = await deps.receipt(transactionHash);
    if (receipt === null) return null;
    const result = await deps.workers.decode(receipt);
    if (result.schemaVersion !== 'lithovm-receipt-observation-v1' || result.chainId !== deps.chainId.toString()
      || result.transactionHash !== transactionHash || result.canonicalProofVerified !== false
      || !['included', 'failed'].includes(result.state) || !Array.isArray(result.deployments)
      || result.deployments.length > 4096 || !Array.isArray(result.events)) throw new Error('Native observation context mismatch');
    const seen = new Set<string>();
    result.deployments.forEach((entry, index) => {
      if (result.state !== 'included' || entry.creationIndex !== index || !address(entry.contractAddress) || !hash(entry.codeHash)
        || entry.chainId !== result.chainId || entry.transactionHash !== transactionHash
        || entry.blockHash !== result.blockHash || entry.blockHeight !== result.blockHeight
        || entry.state !== 'included' || entry.verificationState !== 'unverified'
        || entry.deploymentId !== `${result.chainId}:${result.blockHash}:${transactionHash}:${index}`
        || seen.has(entry.contractAddress)) throw new Error('Invalid native registration');
      seen.add(entry.contractAddress);
    });
    if (result.state === 'failed' && (result.deployments.length || result.events.length)) throw new Error('Failed receipt has native effects');
    await canonical(result);
    return result;
  }
  return {
    observe,
    async verify(contract: string, transactionHash: string, request: unknown) {
      if (!address(contract)) throw new Error('Invalid native contract address');
      const observation = await observe(transactionHash);
      const registration = observation?.deployments.find((entry) => entry.contractAddress === contract);
      if (!registration) throw new Error('No canonical host registration for this contract');
      const submitted = request as Record<string, unknown> | null;
      if (!submitted || typeof submitted !== 'object' || submitted.chainId !== deps.chainId
        || submitted.contractAddress !== contract || submitted.codeHash !== registration.codeHash
        || (submitted.transactionHash !== undefined && submitted.transactionHash !== transactionHash))
        throw new Error('Source submission identity mismatch');
      // Fetch code independently. User-provided bytecode is never the comparison target.
      const record = await deps.nativeRecord(contract, registration.blockHeight, registration.blockHash);
      const result = await deps.workers.verify(request, contract, record);
      if (result.rebuiltCodeHash !== registration.codeHash || !hash(result.sourceHash)
        || typeof result.compilerVersion !== 'string' || !result.compilerVersion)
        throw new Error('Native source result context mismatch');
      await canonical(registration);
      await deps.sources.put({ registration, result, request });
      await canonical(registration);
      return { ...result, chainId: deps.chainId, contractAddress: contract, verificationState: 'source_match',
        deploymentId: registration.deploymentId, blockHash: registration.blockHash,
        blockHeight: registration.blockHeight, canonicalProofVerified: false };
    },
    async source(contract: string) {
      if (!address(contract)) throw new Error('Invalid native contract address');
      await deps.assertRuntime();
      const saved = await deps.sources.get(deps.chainId, contract);
      if (!saved) return null;
      await canonical(saved.registration);
      return { ...saved, verificationState: 'source_match', canonicalProofVerified: false };
    },
  };
}

/** Absent owner configuration means disabled before any worker, RPC or database access. */
export function nativeContractRouter(deps?: NativeContractDependencies): Router {
  const router = Router();
  const service = deps && nativeContractService(deps);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!service) { res.status(503).json({ error: 'native_runtime_unavailable' }); return; }
    next();
  });
  router.use(json({ limit: '4mb', strict: true }));
  router.get('/deployments/:hash', async (req, res) => {
    if (!hash(req.params.hash)) { res.status(400).json({ error: 'invalid_transaction_hash' }); return; }
    try {
      const result = await service!.observe(req.params.hash);
      if (!result) { res.status(404).json({ state: 'unknown' }); return; }
      res.json(result);
    } catch { res.status(503).json({ error: 'native_observation_unavailable' }); }
  });
  router.post('/contracts/:address/verify', async (req, res) => {
    if (!address(req.params.address) || !hash(req.body?.transactionHash) || !req.body?.request
      || Object.keys(req.body).sort().join(',') !== 'request,transactionHash') {
      res.status(400).json({ error: 'invalid_verification_request' }); return;
    }
    try { res.json(await service!.verify(req.params.address, req.body.transactionHash, req.body.request)); }
    catch { res.status(422).json({ error: 'native_source_not_verified' }); }
  });
  router.get('/contracts/:address/source', async (req, res) => {
    if (!address(req.params.address)) { res.status(400).json({ error: 'invalid_contract_address' }); return; }
    try {
      const result = await service!.source(req.params.address);
      if (!result) { res.status(404).json({ verificationState: 'unverified' }); return; }
      res.json(result);
    } catch { res.status(503).json({ error: 'native_source_unavailable' }); }
  });
  return router;
}
