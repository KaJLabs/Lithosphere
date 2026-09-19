import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { NativeSourceWalletBackend, NativeSourceStep } from './nativeSource.js';

export interface NativeSourceProgress {
  swapId: string;
  source: { state: 'wallet_reconciliation_required' | 'pending_or_unknown' | 'transaction_failed' | 'awaiting_finality' | 'source_locked'; step?: string; submissionReserved?: boolean; evidence: unknown[] };
  swapState: 'awaiting_settlement' | 'payout_ready' | 'recovery_required' | 'completed';
}
export interface NativeSourceHttpBackend extends NativeSourceWalletBackend {
  reserveAttempt(swapId: string, step: number, attemptId: string): Promise<{granted: boolean}>;
  observeTransaction(swapId: string, step: number, transactionHash: string): Promise<{transactionHash: string}>;
  getProgress(swapId: string): Promise<NativeSourceProgress>;
}

/** Wallet-signed HTTP adapter for the explicitly configured native source router. */
export function createNativeSourceWalletBackend(options: {
  baseUrl: string; audience: string; signer: Signer; fetch?: typeof globalThis.fetch;
}): NativeSourceHttpBackend {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) throw Error('secure native source API required');
  if (!options.audience.trim() || options.audience.length > 200) throw Error('native source audience required');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(swapId: string, step: number, action?: 'check' | 'bind' | 'status' | 'reserve' | 'observe', raw?: string): Promise<unknown> {
    if (!swapId.trim() || swapId.length > 200 || !Number.isInteger(step) || step < 0 || step > 2) throw Error('invalid source request');
    const path = `/${encodeURIComponent(swapId)}/steps/${step}${action ? '/' + action : ''}`;
    const method = action && action !== 'status' ? 'POST' : 'GET';
    const body = method === 'POST' ? JSON.stringify(raw === undefined ? {} : action === 'reserve' ? {attemptId: raw} : action === 'observe' ? {transactionHash: raw} : {raw}) : '';
    const timestamp = Date.now().toString(), nonce = ethers.hexlify(ethers.randomBytes(32));
    const message = 'MultX source request v1\n' + JSON.stringify([options.audience, method, path, ethers.keccak256(ethers.toUtf8Bytes(body)), timestamp, nonce]);
    const signature = await options.signer.signMessage(message);
    const response = await fetcher(base.href.replace(/\/$/, '') + path, {
      method, headers: { 'content-type': 'application/json', 'x-multx-time': timestamp, 'x-multx-nonce': nonce, 'x-multx-signature': signature },
      ...(method === 'POST' ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Native source request rejected (${response.status})`);
    return response.json();
  }
  return {
    reserveAttempt: async (id, step, attemptId) => await request(id, step, 'reserve', attemptId) as {granted: boolean},
    observeTransaction: async (id, step, hash) => await request(id, step, 'observe', hash) as {transactionHash: string},
    getProgress: async id => {
      const result = await request(id, 0, 'status') as NativeSourceProgress;
      if (result?.swapId !== id || !['awaiting_settlement', 'payout_ready', 'recovery_required', 'completed'].includes(result.swapState) ||
          !['wallet_reconciliation_required', 'pending_or_unknown', 'transaction_failed', 'awaiting_finality', 'source_locked'].includes(result.source?.state) || !Array.isArray(result.source?.evidence)) throw Error('invalid native progress response');
      return result;
    },
    getStep: async (id, step) => await request(id, step) as NativeSourceStep,
    assertCanSubmit: async (id, step) => {
      const response = await request(id, step, 'check') as { eligible?: boolean };
      if (response.eligible !== true) throw Error('source step not eligible');
    },
    bindSignedStep: async (id, step, raw) => await request(id, step, 'bind', raw) as { transactionHash: string },
  };
}
