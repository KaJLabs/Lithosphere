import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { NativeSourceSignedStore } from './nativeSource.js';

export interface NativeDestinationStep {
  kind: 'approve' | 'trade'; chainId: number; from: string; to: string;
  value: '0'; data: string; gasLimit: string; expiresAt?: number;
}
export interface NativeDestinationProgress {
  swapId: string; chainId: number;
  state: 'awaiting_settlement' | 'wallet_action_required' | 'wallet_reconciliation_required' |
    'pending_or_unknown' | 'awaiting_finality' | 'awaiting_verification' | 'dex_confirmed' |
    'operator_managed' | 'route_disabled' | 'transaction_failed' | 'recovery_required' | 'completed';
  step?: number; submissionReserved?: boolean; transactionHash?: string;
}
export interface NativeDestinationWalletBackend {
  getStep(id: string, step: number): Promise<NativeDestinationStep>;
  getProgress(id: string): Promise<NativeDestinationProgress>;
  assertCanSubmit(id: string, step: number): Promise<void>;
  reserveAttempt(id: string, step: number, attemptId: string): Promise<{granted: boolean}>;
  observeTransaction(id: string, step: number, hash: string): Promise<{transactionHash: string}>;
}

/** EOA-authenticated destination API; signing/broadcast stays in the user's wallet. */
export function createNativeDestinationWalletBackend(options: {
  baseUrl: string; audience: string; signer: Signer; fetch?: typeof globalThis.fetch;
}): NativeDestinationWalletBackend {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname)))) throw Error('secure native destination API required');
  if (!options.audience.trim() || options.audience.length > 200) throw Error('native destination audience required');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(id: string, step?: number, action?: string, value?: string): Promise<unknown> {
    if (!id.trim() || id.length > 200 || (step !== undefined && ![0,1].includes(step))) throw Error('invalid destination request');
    const path = `/${encodeURIComponent(id)}/${step === undefined ? 'status' : `steps/${step}${action ? '/' + action : ''}`}`;
    const method = action ? 'POST' : 'GET';
    const body = method === 'POST' ? JSON.stringify(action === 'reserve' ? {attemptId:value} : action === 'observe' ? {transactionHash:value} : {}) : '';
    const timestamp = Date.now().toString(), nonce = ethers.hexlify(ethers.randomBytes(32));
    const message = 'MultX destination request v1\n' + JSON.stringify([options.audience,method,path,ethers.keccak256(ethers.toUtf8Bytes(body)),timestamp,nonce]);
    const signature = await options.signer.signMessage(message);
    const response = await fetcher(base.href.replace(/\/$/,'') + path, {method,
      headers:{'content-type':'application/json','x-multx-time':timestamp,'x-multx-nonce':nonce,'x-multx-signature':signature},
      ...(method === 'POST' ? {body} : {}), redirect:'error', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error(`Native destination request rejected (${response.status})`);
    return response.json();
  }
  return {
    getStep: async (id,step) => {
      const result = await request(id,step) as NativeDestinationStep;
      validateStep(result,step);
      return result;
    },
    getProgress: async id => {
      const result = await request(id) as NativeDestinationProgress;
      if (result?.swapId !== id || !Number.isSafeInteger(result.chainId) || result.chainId < 1 ||
          !['awaiting_settlement','wallet_action_required','wallet_reconciliation_required','pending_or_unknown','awaiting_finality','awaiting_verification','dex_confirmed','operator_managed','route_disabled','transaction_failed','recovery_required','completed'].includes(result.state) ||
          (result.step !== undefined && ![0,1].includes(result.step)) ||
          (['wallet_action_required','wallet_reconciliation_required'].includes(result.state) && result.step === undefined) ||
          (result.transactionHash !== undefined && !/^0x[0-9a-f]{64}$/i.test(result.transactionHash))) throw Error('invalid native destination progress');
      return result;
    },
    assertCanSubmit: async (id,step) => {
      if ((await request(id,step,'check') as {eligible?: boolean}).eligible !== true) throw Error('destination step not eligible');
    },
    reserveAttempt: async (id,step,attempt) => {
      if (!/^0x[0-9a-f]{64}$/.test(attempt)) throw Error('invalid destination attempt');
      const result = await request(id,step,'reserve',attempt) as {granted: boolean};
      if (typeof result?.granted !== 'boolean') throw Error('invalid destination reservation');
      return result;
    },
    observeTransaction: async (id,step,hash) => {
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('invalid destination hash');
      const result = await request(id,step,'observe',hash) as {transactionHash: string};
      if (result?.transactionHash?.toLowerCase() !== hash.toLowerCase()) throw Error('invalid destination observation');
      return result;
    },
  };
}
function validateStep(action: NativeDestinationStep,step: number): void {
  if (!action || action.kind !== ['approve','trade'][step] || !Number.isSafeInteger(action.chainId) || action.chainId < 1 ||
      action.value !== '0' || !/^[1-9][0-9]{0,77}$/.test(action.gasLimit) || BigInt(action.gasLimit) >= 2n**256n ||
      !/^0x[0-9a-f]+$/i.test(action.data) || action.data.length > 4096 ||
      [ethers.getAddress(action.from),ethers.getAddress(action.to)].includes(ethers.ZeroAddress)) throw Error('invalid destination action');
  const abi = new ethers.Interface(['function approve(address,uint256)','function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)']);
  const parsed = abi.parseTransaction({data:action.data});
  if (!parsed || parsed.name !== (step === 0 ? 'approve' : 'swapExactTokensForTokens')) throw Error('invalid destination calldata');
  if (step === 0) {
    if (ethers.getAddress(parsed.args[0]) === ethers.ZeroAddress || parsed.args[1] <= 0n) throw Error('invalid destination approval');
  } else if (parsed.args[0] <= 0n || parsed.args[1] <= 0n || parsed.args[2].length !== 2 ||
             parsed.args[2].some((address: string) => ethers.getAddress(address) === ethers.ZeroAddress) ||
             ethers.getAddress(parsed.args[3]) === ethers.ZeroAddress || !Number.isSafeInteger(action.expiresAt) ||
             BigInt(action.expiresAt!) !== parsed.args[4]) throw Error('invalid destination trade');
}

/** One explicit destination action. No automatic retry, mode switch or advance. */
export async function submitInjectedNativeDestinationStep({swapId,step,signer,backend,store}: {
  swapId: string; step: number; signer: Signer; backend: NativeDestinationWalletBackend; store: NativeSourceSignedStore;
}): Promise<{state:'submitted'|'wallet_reconciliation_required';transactionHash?:string}> {
  if (!swapId.trim() || ![0,1].includes(step) || !signer.provider) throw Error('destination wallet required');
  const action = await backend.getStep(swapId,step);
  validateStep(action,step);
  async function identity() {
    if (ethers.getAddress(await signer.getAddress()) !== ethers.getAddress(action.from) ||
        BigInt((await signer.provider!.getNetwork()).chainId) !== BigInt(action.chainId)) throw Error('destination wallet identity mismatch');
  }
  await identity();
  const key = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(['multx-destination-injected-attempt-v1',swapId,step,
    action.chainId,ethers.getAddress(action.from),ethers.getAddress(action.to),action.value,action.data.toLowerCase(),action.gasLimit,action.expiresAt??null])));
  const hashKey = ethers.keccak256(ethers.toUtf8Bytes(key + ':hash'));
  const savedHash = await store.get(hashKey);
  if (savedHash) {
    if((await backend.observeTransaction(swapId,step,savedHash)).transactionHash.toLowerCase()!==savedHash.toLowerCase())throw Error('destination observation mismatch');
    return {state:'submitted',transactionHash:savedHash};
  }
  if (await store.get(key)) return {state:'wallet_reconciliation_required'};
  await backend.assertCanSubmit(swapId,step);
  const attempt = ethers.hexlify(ethers.randomBytes(32));
  if (await store.putIfAbsent(key,attempt) !== attempt) return {state:'wallet_reconciliation_required'};
  if (!(await backend.reserveAttempt(swapId,step,attempt)).granted) return {state:'wallet_reconciliation_required'};
  await backend.assertCanSubmit(swapId,step);
  await identity();
  let hash: string;
  try {
    hash = (await signer.sendTransaction({from:action.from,to:action.to,chainId:action.chainId,value:0n,data:action.data,gasLimit:action.gasLimit})).hash;
  } catch { return {state:'wallet_reconciliation_required'}; }
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('invalid destination wallet hash');
  if ((await store.putIfAbsent(hashKey,hash)).toLowerCase() !== hash.toLowerCase()) throw Error('conflicting destination wallet hash');
  if((await backend.observeTransaction(swapId,step,hash)).transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('destination observation mismatch');
  return {state:'submitted',transactionHash:hash};
}
