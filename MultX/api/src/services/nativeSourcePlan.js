import { ethers } from 'ethers';
const wrapperAbi=new ethers.Interface(['function deposit() payable','function approve(address,uint256) returns(bool)']);
const bridgeAbi=['function paused() view returns(bool)','function supportedTokens(address) view returns(bool)','function supportedRoutes(address,uint256) view returns(bool)','function lockTokens(address,uint256,uint256) returns(bytes32)'];
// Internal preparation only. Registry policy must be independently approved.
// The user's wallet signs each step; no intermediary becomes TokensLocked.user.
export async function prepareNativeSourcePlan(provider,policy,{sender,amountBaseUnits,targetChain}){
 if(!policy?.enabled||!Number.isSafeInteger(policy.chainId)||policy.chainId<=0||!Number.isSafeInteger(targetChain)||targetChain<=0||targetChain===policy.chainId||!policy.targetChains?.includes(targetChain))throw Error('unsupported native source route');
 if(!Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=Math.floor(Date.now()/1000)||typeof policy.approvalRef!=='string'||!policy.approvalRef.trim())throw Error('active native source approval required');
 if(typeof amountBaseUnits!=='string'||! /^[1-9][0-9]{0,77}$/.test(amountBaseUnits)||BigInt(amountBaseUnits)>=2n**256n)throw Error('invalid native input');
 const from=ethers.getAddress(sender),wrapper=ethers.getAddress(policy.wrapper),bridge=ethers.getAddress(policy.bridge);
 if([from,wrapper,bridge].includes(ethers.ZeroAddress)||from===wrapper||from===bridge||wrapper===bridge)throw Error('invalid source parties');
 if(BigInt((await provider.getNetwork()).chainId)!==BigInt(policy.chainId))throw Error('wrong source chain');
 for(const [address,expected] of [[wrapper,policy.wrapperCodeHash],[bridge,policy.bridgeCodeHash]]){
  const code=await provider.getCode(address);
  if(code==='0x'||ethers.keccak256(code)!==expected)throw Error('source runtime mismatch');
 }
 const contract=new ethers.Contract(bridge,bridgeAbi,provider);
 if(await contract.paused()||!await contract.supportedTokens(wrapper)||!await contract.supportedRoutes(wrapper,targetChain))throw Error('source bridge route unavailable');
 const common={from,chainId:policy.chainId};
 return {approvalRef:policy.approvalRef,expiresAt:policy.expiresAt,sender:from,
  steps:[
   {...common,kind:'wrap',to:wrapper,value:amountBaseUnits,data:wrapperAbi.encodeFunctionData('deposit')},
   {...common,kind:'approve',to:wrapper,value:'0',data:wrapperAbi.encodeFunctionData('approve',[bridge,amountBaseUnits])},
   {...common,kind:'lock',to:bridge,value:'0',data:contract.interface.encodeFunctionData('lockTokens',[wrapper,amountBaseUnits,targetChain])},
  ]};
}
