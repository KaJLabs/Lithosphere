import {it,expect} from 'vitest';
import {ethers} from 'ethers';
import {submitInjectedNativeSourceStep} from '../src/nativeInjectedWallet.js';
it('lost wallet response leaves a durable stop and never opens a second send prompt',async()=>{
 const wallet=ethers.Wallet.createRandom(),records=new Map<string,string>();let sends=0,reserves=0;
 const args:any={swapId:'s',step:0,signer:{provider:{getNetwork:async()=>({chainId:1n})},getAddress:async()=>wallet.address,sendTransaction:async()=>{sends++;throw Error('wallet response lost');}},
 backend:{getStep:async()=>({kind:'wrap',chainId:1,from:wallet.address,to:'0x0000000000000000000000000000000000000099',value:'1000',data:'0xd0e30db0'}),assertCanSubmit:async()=>{},reserveAttempt:async()=>{reserves++;return {granted:true};}},
 store:{get:async(key:string)=>records.get(key)??null,putIfAbsent:async(key:string,value:string)=>{if(!records.has(key))records.set(key,value);return records.get(key);}}};
 expect((await submitInjectedNativeSourceStep(args)).state).toBe('wallet_reconciliation_required');
 expect((await submitInjectedNativeSourceStep(args)).state).toBe('wallet_reconciliation_required');
 expect(sends).toBe(1);expect(reserves).toBe(1);
});
