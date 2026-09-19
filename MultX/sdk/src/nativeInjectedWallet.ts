import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import type { NativeSourceSignedStore } from './nativeSource.js';
import type { NativeSourceHttpBackend } from './nativeSourceBackend.js';

/** Explicit alternative for sendTransaction-only wallets. Never automatically resend. */
export async function submitInjectedNativeSourceStep({swapId,step,signer,backend,store}: {
 swapId:string;step:number;signer:Signer;backend:NativeSourceHttpBackend;store:NativeSourceSignedStore;
}):Promise<{state:'submitted'|'wallet_reconciliation_required';transactionHash?:string}>{
 if(!swapId.trim()||!Number.isInteger(step)||step<0||step>2||!signer.provider)throw Error('source wallet required');
 const expected=await backend.getStep(swapId,step);
 if(expected.kind!==['wrap','approve','lock'][step]||ethers.getAddress(await signer.getAddress())!==ethers.getAddress(expected.from)||BigInt((await signer.provider.getNetwork()).chainId)!==BigInt(expected.chainId))throw Error('source wallet identity mismatch');
 const key=ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(['multx-injected-attempt-v1',swapId,step,expected])));
 const hashKey=ethers.keccak256(ethers.toUtf8Bytes(key+':hash'));
 const savedHash=await store.get(hashKey);
 if(savedHash){
  const observed=await backend.observeTransaction(swapId,step,savedHash);
  if(observed.transactionHash.toLowerCase()!==savedHash.toLowerCase())throw Error('source observation mismatch');
  return {state:'submitted',transactionHash:savedHash};
 }
 if(await store.get(key))return {state:'wallet_reconciliation_required'};
 await backend.assertCanSubmit(swapId,step);
 const attempt=ethers.hexlify(ethers.randomBytes(32));
 if(await store.putIfAbsent(key,attempt)!==attempt)return {state:'wallet_reconciliation_required'};
 // A lost reservation response is intentionally not retried as permission to send.
 if((await backend.reserveAttempt(swapId,step,attempt)).granted!==true)return {state:'wallet_reconciliation_required'};
 await backend.assertCanSubmit(swapId,step);
 let hash:string;
 try{
  const tx=await signer.sendTransaction({from:expected.from,to:expected.to,chainId:expected.chainId,value:expected.value,data:expected.data});
  hash=tx.hash;
 }catch{return {state:'wallet_reconciliation_required'};}
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('invalid source wallet hash');
 const stored=await store.putIfAbsent(hashKey,hash);
 if(stored.toLowerCase()!==hash.toLowerCase())throw Error('conflicting source wallet hash');
 const observed=await backend.observeTransaction(swapId,step,hash);
 if(observed.transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('source observation mismatch');
 return {state:'submitted',transactionHash:hash};
}
