import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { NativeSourceStep } from './nativeSource.js';

export interface NativeQuoteRequest {
  sourceChain: number;
  destinationChain: number;
  inputAmount: string;
  minimumOutput: string;
  recipient: string;
}

export interface NativeQuote extends NativeQuoteRequest {
  quoteId: string;
  policyId: string;
  wallet: string;
  expiresAt: number;
  terms: {
    fundingMode: 'prefunded-fixed-fill' | 'dex-wrapped-native'; atomic: false; automaticTimeoutRefund: false;
    fundingRef: string; recoveryRef: string; payoutSender: string; claimant: string; nativeOutputAmount: string;
    fees: {kind: 'source-gas' | 'destination-gas' | 'bridge' | 'protocol'; amountBaseUnits: string; chainId: number; accounting: 'separate-estimate' | 'included-in-fixed-output'}[];
    destinationQuote?: {chainId:number;path:string[];minimumOutput:string;blockNumber:number;blockHash:string;expiresAt:number};
  };
  sourcePlan: { approvalRef: string; expiresAt: number; sender: string; steps: NativeSourceStep[] };
}

export interface NativeQuoteHttpBackend {
  createQuote(request: NativeQuoteRequest): Promise<NativeQuote>;
  acceptQuote(quoteId: string): Promise<{ swapId: string; alreadyAccepted: boolean }>;
}

/** Wallet-authenticated quote creation. The server alone selects an approved route policy. */
export function createNativeQuoteBackend(options: {
  baseUrl: string; audience: string; signer: Signer; fetch?: typeof globalThis.fetch;
}): NativeQuoteHttpBackend {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) throw Error('secure native quote API required');
  if (!options.audience.trim() || options.audience.length > 200) throw Error('native quote audience required');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(path: string, value: unknown): Promise<unknown> {
    const body = JSON.stringify(value);
    const timestamp = Date.now().toString();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const message = 'MultX quote request v1\n' + JSON.stringify([
      options.audience, 'POST', path, ethers.keccak256(ethers.toUtf8Bytes(body)), timestamp, nonce,
    ]);
    const signature = await options.signer.signMessage(message);
    const response = await fetcher(base.href.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-multx-time': timestamp, 'x-multx-nonce': nonce, 'x-multx-signature': signature },
      body, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error(`Native quote request rejected (${response.status})`);
    return response.json();
  }

  return {
    createQuote: async input => {
      const normalized = validateRequest(input);
      const result = await request('/', normalized) as NativeQuote;
      const wallet = ethers.getAddress(await options.signer.getAddress());
      if (!/^0x[0-9a-f]{64}$/.test(result?.quoteId ?? '') || typeof result.policyId !== 'string' || !result.policyId.trim() ||
          ethers.getAddress(result.wallet) !== wallet || result.sourceChain !== normalized.sourceChain ||
          result.destinationChain !== normalized.destinationChain || result.inputAmount !== normalized.inputAmount ||
          result.minimumOutput !== normalized.minimumOutput || ethers.getAddress(result.recipient) !== normalized.recipient ||
          !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() ||
          !result.sourcePlan || ethers.getAddress(result.sourcePlan.sender) !== wallet || result.sourcePlan.steps?.length !== 3) throw Error('invalid native quote response');
      validateQuote(result, wallet);
      return result;
    },
    acceptQuote: async quoteId => {
      if (!/^0x[0-9a-f]{64}$/.test(quoteId)) throw Error('invalid quote id');
      const result = await request(`/${quoteId}/accept`, {}) as { swapId: string; alreadyAccepted: boolean };
      if (result?.swapId !== quoteId || typeof result.alreadyAccepted !== 'boolean') throw Error('invalid quote acceptance response');
      return result;
    },
  };
}

function validateQuote(quote: NativeQuote, wallet: string): void {
  const t = quote.terms;
  if (!t || !['prefunded-fixed-fill','dex-wrapped-native'].includes(t.fundingMode) || t.atomic !== false || t.automaticTimeoutRefund !== false ||
      !t.fundingRef?.trim() || !t.recoveryRef?.trim() || ethers.getAddress(t.claimant) !== wallet ||
      !/^[1-9][0-9]{0,77}$/.test(t.nativeOutputAmount) || BigInt(t.nativeOutputAmount) < BigInt(quote.minimumOutput) ||
      BigInt(t.nativeOutputAmount) >= 2n ** 256n || !Array.isArray(t.fees) || t.fees.length !== 4) throw Error('invalid native quote terms');
  const kinds = new Set<string>();
  if(t.fundingMode==='dex-wrapped-native'){
    const d=t.destinationQuote;
    if(!d||d.chainId!==quote.destinationChain||!Array.isArray(d.path)||d.path.length!==2||
       !/^[1-9][0-9]{0,77}$/.test(d.minimumOutput)||BigInt(d.minimumOutput)<BigInt(t.nativeOutputAmount)||
       !Number.isSafeInteger(d.blockNumber)||d.blockNumber<1||!/^0x[0-9a-f]{64}$/i.test(d.blockHash)||
       !Number.isSafeInteger(d.expiresAt)||d.expiresAt*1000<quote.expiresAt)throw Error('invalid native DEX quote');
    d.path.forEach(value=>{if(ethers.getAddress(value)===ethers.ZeroAddress)throw Error('zero DEX asset');});
  }
  for (const fee of t.fees) {
    if (!['source-gas','destination-gas','bridge','protocol'].includes(fee.kind) || kinds.has(fee.kind) ||
        !/^(0|[1-9][0-9]{0,77})$/.test(fee.amountBaseUnits) || BigInt(fee.amountBaseUnits) >= 2n ** 256n ||
        fee.chainId !== (fee.kind === 'source-gas' ? quote.sourceChain : quote.destinationChain) ||
        fee.accounting !== (fee.kind === 'source-gas' || (fee.kind === 'destination-gas' && t.fundingMode === 'dex-wrapped-native') ? 'separate-estimate' : 'included-in-fixed-output')) throw Error('invalid native quote fees');
    kinds.add(fee.kind);
  }
  const [wrap, approve, lock] = quote.sourcePlan.steps;
  const wrapper = ethers.getAddress(wrap!.to), bridge = ethers.getAddress(lock!.to);
  if (wrapper === ethers.ZeroAddress || bridge === ethers.ZeroAddress || wrapper === bridge ||
      !quote.sourcePlan.approvalRef?.trim() || !Number.isSafeInteger(quote.sourcePlan.expiresAt) ||
      quote.sourcePlan.expiresAt * 1000 < quote.expiresAt) throw Error('invalid quote source plan');
  const abi = new ethers.Interface(['function deposit() payable','function approve(address,uint256)','function lockTokens(address,uint256,uint256)']);
  const expected = [abi.encodeFunctionData('deposit'), abi.encodeFunctionData('approve',[bridge,quote.inputAmount]),
    abi.encodeFunctionData('lockTokens',[wrapper,quote.inputAmount,quote.destinationChain])];
  for (const [i, step] of quote.sourcePlan.steps.entries()) {
    if (step.kind !== ['wrap','approve','lock'][i] || step.chainId !== quote.sourceChain || ethers.getAddress(step.from) !== wallet ||
        ethers.getAddress(step.to) !== (i === 2 ? bridge : wrapper) || step.value !== (i === 0 ? quote.inputAmount : '0') ||
        step.data.toLowerCase() !== expected[i]!.toLowerCase()) throw Error('invalid quote transaction plan');
  }
}

function validateRequest(input: NativeQuoteRequest): NativeQuoteRequest {
  if (!Number.isSafeInteger(input.sourceChain) || input.sourceChain <= 0 ||
      !Number.isSafeInteger(input.destinationChain) || input.destinationChain <= 0 || input.sourceChain === input.destinationChain ||
      !/^[1-9][0-9]{0,77}$/.test(input.inputAmount) || !/^[1-9][0-9]{0,77}$/.test(input.minimumOutput) ||
      BigInt(input.inputAmount) >= 2n ** 256n || BigInt(input.minimumOutput) >= 2n ** 256n) throw Error('invalid native quote request');
  const recipient = ethers.getAddress(input.recipient);
  if (recipient === ethers.ZeroAddress) throw Error('invalid native quote recipient');
  return { sourceChain: input.sourceChain, destinationChain: input.destinationChain, inputAmount: input.inputAmount, minimumOutput: input.minimumOutput, recipient };
}
