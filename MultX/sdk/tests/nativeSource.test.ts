import { IDBFactory } from 'fake-indexeddb';
import { openNativeSourceSignedStore } from '../src/nativeSourceStore.js';
import { it, expect } from 'vitest';
import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { submitNativeSourceStep } from '../src/nativeSource.js';

function fixture() {
 const wallet=ethers.Wallet.createRandom();
 let broadcasts=0,signs=0,known=false;
 const records=new Map<string,string>();
 const expected={kind:'wrap' as const,chainId:31337,from:wallet.address,to:'0x0000000000000000000000000000000000000099',value:'1000',data:'0xd0e30db0'};
 const provider={getNetwork:async()=>({chainId:31337n}),getTransaction:async(hash:string)=>known?{hash}:null,broadcastTransaction:async()=>{broadcasts++;known=true;throw Error('lost response');}};
 const signer={provider,getAddress:async()=>wallet.address,populateTransaction:async(tx:object)=>({...tx,type:0,gasLimit:50000,gasPrice:1,nonce:0}),signTransaction:async(tx:ethers.TransactionRequest)=>{signs++;return wallet.signTransaction(tx);}} as unknown as Signer;
 const backend={getStep:async()=>expected,assertCanSubmit:async()=>{},bindSignedStep:async(_id:string,_step:number,raw:string)=>({transactionHash:ethers.Transaction.from(raw).hash!})};
 const store={get:async(key:string)=>records.get(key)??null,putIfAbsent:async(key:string,raw:string)=>{if(!records.has(key))records.set(key,raw);return records.get(key)!;}};
 return {signer,backend,store,records,counts:()=>({broadcasts,signs})};
}
it('persists before broadcast and resumes the same signed transaction after a lost response',async()=>{
 const f=fixture();const args={...f,swapId:'s',step:0};
 expect((await submitNativeSourceStep(args)).state).toBe('uncertain');
 expect(f.records.size).toBe(1);
 expect((await submitNativeSourceStep({...args,store:{...f.store}})).state).toBe('submitted');
 expect(f.counts()).toEqual({broadcasts:1,signs:1});
});
it('does not broadcast if durable storage fails',async()=>{
 const f=fixture();
 await expect(submitNativeSourceStep({...f,swapId:'s',step:0,store:{...f.store,putIfAbsent:async()=>{throw Error('storage unavailable');}}})).rejects.toThrow('storage unavailable');
 expect(f.counts().broadcasts).toBe(0);
});
it('blocks revoked approval after signing and before broadcast',async()=>{
 const f=fixture();let checks=0;
 f.backend.assertCanSubmit=async()=>{if(++checks===2)throw Error('revoked');};
 await expect(submitNativeSourceStep({...f,swapId:'s',step:0})).rejects.toThrow('revoked');
 expect(f.counts().broadcasts).toBe(0);
});
it('refuses a different backend binding hash',async()=>{
 const f=fixture();f.backend.bindSignedStep=async()=>({transactionHash:ethers.ZeroHash});
 await expect(submitNativeSourceStep({...f,swapId:'s',step:0})).rejects.toThrow('hash mismatch');
 expect(f.counts().broadcasts).toBe(0);
});
it('rejects a corrupt durable artifact without signing again',async()=>{
 const f=fixture();f.store.get=async()=> '0x00';
 await expect(submitNativeSourceStep({...f,swapId:'s',step:0})).rejects.toThrow();
 expect(f.counts()).toEqual({broadcasts:0,signs:0});
});

it('SDK resumes from IndexedDB after closing and reopening storage',async()=>{
 const f=fixture(),factory=new IDBFactory();
 const first=await openNativeSourceSignedStore('sdk-reload',factory);
 expect((await submitNativeSourceStep({...f,swapId:'s',step:0,store:first})).state).toBe('uncertain');
 first.close();
 const second=await openNativeSourceSignedStore('sdk-reload',factory);
 expect((await submitNativeSourceStep({...f,swapId:'s',step:0,store:second})).state).toBe('submitted');
 expect(f.counts()).toEqual({broadcasts:1,signs:1});second.close();
});
