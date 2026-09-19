import { expect, it, vi } from 'vitest';
import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { createNativeDestinationWalletBackend, submitInjectedNativeDestinationStep } from '../src/nativeDestination.js';
import type { NativeDestinationWalletBackend, NativeDestinationStep } from '../src/nativeDestination.js';

const abi=new ethers.Interface(['function approve(address,uint256)','function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)']);
const token='0x0000000000000000000000000000000000000091',router='0x0000000000000000000000000000000000000092';
function fixture(){
 const wallet=ethers.Wallet.createRandom(),hash='0x'+'33'.repeat(32);
 const action:NativeDestinationStep={kind:'approve',chainId:56,from:wallet.address,to:token,value:'0',data:abi.encodeFunctionData('approve',[router,1000]),gasLimit:'80000'};
 const signer={getAddress:async()=>wallet.address,provider:{getNetwork:async()=>({chainId:56n})},sendTransaction:vi.fn(async()=>({hash}))} as unknown as Signer;
 const backend:NativeDestinationWalletBackend={getStep:vi.fn(async()=>action),getProgress:vi.fn(),assertCanSubmit:vi.fn(async()=>{}),reserveAttempt:vi.fn(async()=>({granted:true})),observeTransaction:vi.fn(async()=>({transactionHash:hash}))};
 const records=new Map<string,string>(),store={get:async(key:string)=>records.get(key)??null,putIfAbsent:async(key:string,value:string)=>{if(!records.has(key))records.set(key,value);return records.get(key)!;}};
 return {wallet,hash,action,signer,backend,store};
}
it('binds destination request audience, path and body under a separate signature namespace',async()=>{
 const {wallet,action}=fixture();let captured:RequestInit|undefined;
 const backend=createNativeDestinationWalletBackend({baseUrl:'https://native.example/destination',audience:'candidate',signer:wallet,
  fetch:(async(_url,init)=>{captured=init;return new Response(JSON.stringify(action),{status:200});}) as typeof fetch});
 await backend.getStep('swap',0);
 const headers=captured!.headers as Record<string,string>;
 const payload=JSON.stringify(['candidate','GET','/swap/steps/0',ethers.keccak256(ethers.toUtf8Bytes('')),headers['x-multx-time'],headers['x-multx-nonce']]);
 expect(ethers.verifyMessage('MultX destination request v1\n'+payload,headers['x-multx-signature'])).toBe(wallet.address);
 expect(ethers.verifyMessage('MultX source request v1\n'+payload,headers['x-multx-signature'])).not.toBe(wallet.address);
});
it('persists one attempt across concurrent callers and never repeats the wallet send',async()=>{
 const f=fixture(),args={...f,swapId:'swap',step:0};
 const results=await Promise.all([submitInjectedNativeDestinationStep(args),submitInjectedNativeDestinationStep(args)]);
 expect(results.filter(result=>result.state==='submitted')).toHaveLength(1);
 expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
 expect((await submitInjectedNativeDestinationStep(args)).transactionHash).toBe(f.hash);
 expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
});
it('retains uncertainty after a lost wallet response or reservation response',async()=>{
 const f=fixture();vi.mocked(f.signer.sendTransaction).mockRejectedValue(Error('wallet response lost'));
 const args={...f,swapId:'swap',step:0};
 expect((await submitInjectedNativeDestinationStep(args)).state).toBe('wallet_reconciliation_required');
 expect((await submitInjectedNativeDestinationStep(args)).state).toBe('wallet_reconciliation_required');
 expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
 const g=fixture();vi.mocked(g.backend.reserveAttempt).mockRejectedValue(Error('reservation response lost'));
 await expect(submitInjectedNativeDestinationStep({...g,swapId:'other',step:0})).rejects.toThrow('reservation response lost');
 expect((await submitInjectedNativeDestinationStep({...g,swapId:'other',step:0})).state).toBe('wallet_reconciliation_required');
 expect(g.signer.sendTransaction).not.toHaveBeenCalled();
});
it('restores the same send when persisted JSON order and address casing differ',async()=>{
 const f=fixture(),args={...f,swapId:'ordered',step:0};
 await submitInjectedNativeDestinationStep(args);
 vi.mocked(f.backend.getStep).mockResolvedValue(Object.fromEntries(Object.entries({...f.action,from:f.action.from.toLowerCase()}).reverse()) as unknown as NativeDestinationStep);
 expect((await submitInjectedNativeDestinationStep(args)).transactionHash).toBe(f.hash);
 expect(f.signer.sendTransaction).toHaveBeenCalledOnce();
});
it('refuses a wallet chain change between reservation and send',async()=>{
 const f=fixture();let checks=0;
 vi.spyOn(f.signer.provider!,'getNetwork').mockImplementation(async()=>({chainId:++checks===1?56n:1n}) as ethers.Network);
 await expect(submitInjectedNativeDestinationStep({...f,swapId:'swap',step:0})).rejects.toThrow('identity mismatch');
 expect(f.signer.sendTransaction).not.toHaveBeenCalled();
});
it('rejects malformed actions, unsafe endpoints and conflicting observations',async()=>{
 const f=fixture();
 expect(()=>createNativeDestinationWalletBackend({baseUrl:'http://native.example',audience:'x',signer:f.wallet})).toThrow('secure');
 const backend=createNativeDestinationWalletBackend({baseUrl:'https://native.example',audience:'x',signer:f.wallet,
  fetch:(async()=>new Response(JSON.stringify({...f.action,data:abi.encodeFunctionData('swapExactTokensForTokens',[1000,900,[token,router],f.wallet.address,1])}),{status:200})) as typeof fetch});
 await expect(backend.getStep('swap',0)).rejects.toThrow('calldata');
 vi.mocked(f.backend.observeTransaction).mockResolvedValue({transactionHash:'0x'+'44'.repeat(32)});
 await expect(submitInjectedNativeDestinationStep({...f,swapId:'swap',step:0})).rejects.toThrow('observation mismatch');
});
