import { ethers } from 'ethers';
import type { Signer, TransactionRequest } from 'ethers';

export interface NativeSourceStep {
  kind: 'wrap' | 'approve' | 'lock';
  chainId: number;
  from: string;
  to: string;
  value: string;
  data: string;
}
export interface NativeSourceWalletBackend {
  /** Authenticated original intent, never a caller-supplied transaction target. */
  getStep(swapId: string, step: number): Promise<NativeSourceStep>;
  /** Recheck approval/expiry, prior-step finality and route state before sending. */
  assertCanSubmit(swapId: string, step: number): Promise<void>;
  bindSignedStep(swapId: string, step: number, raw: string): Promise<{ transactionHash: string }>;
}
export interface NativeSourceSignedStore {
  get(key: string): Promise<string | null>;
  /** Durable, atomic insert-if-absent. Return the existing winner on a conflict. */
  putIfAbsent(key: string, raw: string): Promise<string>;
}
export interface NativeSourceSubmission {
  state: 'submitted' | 'uncertain';
  transactionHash: string;
}

/** One explicit wallet step. No nonce replacement, step auto-advance or refund. */
export async function submitNativeSourceStep(options: {
  swapId: string; step: number; signer: Signer;
  backend: NativeSourceWalletBackend; store: NativeSourceSignedStore;
}): Promise<NativeSourceSubmission> {
  const { swapId, step, signer, backend, store } = options;
  if (!swapId.trim() || !Number.isInteger(step) || step < 0 || step > 2) throw Error('invalid source step');
  const provider = signer.provider;
  if (!provider) throw Error('source wallet provider required');
  const expected = await backend.getStep(swapId, step);
  if (expected.kind !== ['wrap', 'approve', 'lock'][step] || !Number.isSafeInteger(expected.chainId) || expected.chainId <= 0) throw Error('invalid source intent step');
  const sender = ethers.getAddress(await signer.getAddress());
  if (sender !== ethers.getAddress(expected.from) || BigInt((await provider.getNetwork()).chainId) !== BigInt(expected.chainId)) throw Error('source wallet identity mismatch');
  const request: TransactionRequest = { from: sender, to: expected.to, chainId: expected.chainId, value: expected.value, data: expected.data };
  // Identity includes the exact step; old signed payloads cannot migrate to a changed intent.
  const key = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(['multx-source-wallet-v1', swapId, step, expected.chainId, sender, ethers.getAddress(expected.to), expected.value, expected.data.toLowerCase()])));
  await backend.assertCanSubmit(swapId, step);
  let raw = await store.get(key);
  if (raw === null) {
    // Some injected wallets do not implement signTransaction. Their explicit error
    // propagates; never fall back to sendTransaction before persisting the hash.
    const candidate = await signer.signTransaction(await signer.populateTransaction(request));
    validate(candidate);
    raw = await store.putIfAbsent(key, candidate);
  }
  const tx = validate(raw);
  const bound = await backend.bindSignedStep(swapId, step, raw);
  if (bound.transactionHash.toLowerCase() !== tx.hash) throw Error('source binding hash mismatch');
  await backend.assertCanSubmit(swapId, step);
  if (BigInt((await provider.getNetwork()).chainId) !== tx.chainId) throw Error('source chain changed');
  const known = await provider.getTransaction(tx.hash!);
  if (known) {
    if (known.hash.toLowerCase() !== tx.hash) throw Error('source RPC hash mismatch');
    return { state: 'submitted', transactionHash: tx.hash! };
  }
  try {
    const sent = await provider.broadcastTransaction(raw);
    return { state: sent.hash.toLowerCase() === tx.hash ? 'submitted' : 'uncertain', transactionHash: tx.hash! };
  } catch {
    return { state: 'uncertain', transactionHash: tx.hash! };
  }

  function validate(serialized: string): ethers.Transaction {
    if (typeof serialized !== 'string' || serialized.length > 4096 || !/^0x[0-9a-f]+$/i.test(serialized)) throw Error('invalid stored source transaction');
    const tx = ethers.Transaction.from(serialized);
    if (!tx.isSigned() || ![0, 2].includes(tx.type!) || tx.from !== sender || tx.to !== ethers.getAddress(expected.to) || tx.chainId !== BigInt(expected.chainId) || tx.value !== BigInt(expected.value) || tx.data.toLowerCase() !== expected.data.toLowerCase()) throw Error('signed source transaction differs from intent');
    return tx;
  }
}
