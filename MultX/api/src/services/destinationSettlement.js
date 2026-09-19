import { ethers } from 'ethers';
const abi=new ethers.Interface(['event TokensReleased(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 sourceChain,address sourceBridge,address releasedBy)','function balanceOf(address) view returns(uint256)']);
const hash=v=>{if(typeof v!=='string'||!/^0x[0-9a-f]{64}$/i.test(v))throw Error('invalid hash');return v.toLowerCase();};
const addr=v=>{const a=ethers.getAddress(v);if(a===ethers.ZeroAddress)throw Error('zero address');return a.toLowerCase();};
// Both expectation and deployment policy must be coordinator/operator-owned.
// This verifies a bridge settlement leg, not native payout or route liquidity.
export async function verifyDestinationSettlement(provider,expected,policy){
 if(!expected || !policy || !Number.isSafeInteger(policy.chainId)||policy.chainId<=0 || !Number.isSafeInteger(policy.confirmations)||policy.confirmations<=0)throw Error('explicit destination policy required');
 const bridge=addr(policy.bridge),token=addr(policy.token),holder=addr(expected.holder);
 if(expected.destinationChain!==policy.chainId || addr(expected.token)!==token || !Number.isSafeInteger(expected.sourceChain)||expected.sourceChain<=0 || expected.sourceChain===policy.chainId)throw Error('settlement policy mismatch');
 if(typeof expected.amount!=='string'||! /^[1-9][0-9]{0,77}$/.test(expected.amount)||BigInt(expected.amount)>=2n**256n)throw Error('invalid settlement amount');
 const txHash=hash(expected.transactionHash),lockHash=hash(expected.sourceLockHash),sourceBridge=addr(expected.sourceBridge);
 if(BigInt((await provider.getNetwork()).chainId)!==BigInt(policy.chainId))throw Error('wrong destination RPC');
 const receipt=await provider.getTransactionReceipt(txHash);
 if(!receipt||receipt.status!==1||hash(receipt.hash)!==txHash||addr(receipt.to)!==bridge)throw Error('successful bridge receipt required');
 const height=receipt.blockNumber;
 if(!Number.isSafeInteger(height)||height<1)throw Error('invalid settlement height');
 async function canonical(){
  const tip=await provider.getBlockNumber(),block=await provider.getBlock(height);
  if(!Number.isSafeInteger(tip)||tip-height+1<policy.confirmations)throw Error('settlement not final');
  if(!block||hash(block.hash)!==hash(receipt.blockHash))throw Error('settlement reorged');
 }
 await canonical();
 const code=await provider.getCode(bridge,height);
 if(code==='0x'||ethers.keccak256(code).toLowerCase()!==hash(policy.bridgeCodeHash))throw Error('unverified bridge code');
 const matches=receipt.logs.filter(l=>addr(l.address)===bridge&&l.topics?.[0]===abi.getEvent('TokensReleased').topicHash);
 if(matches.length!==1)throw Error('missing or ambiguous release');
 const log=matches[0];if(log.removed)throw Error('removed release');
 const a=abi.parseLog(log).args;
 if(hash(a.txHash)!==lockHash||addr(a.token)!==token||addr(a.user)!==holder||a.amount!==BigInt(expected.amount)||a.sourceChain!==BigInt(expected.sourceChain)||addr(a.sourceBridge)!==sourceBridge)throw Error('release does not match assigned settlement');
 const data=abi.encodeFunctionData('balanceOf',[holder]);
 const balance=async block=>abi.decodeFunctionResult('balanceOf',await provider.call({to:token,data,blockTag:block}))[0];
 const [before,after]=await Promise.all([balance(height-1),balance(height)]);
 if(after-before<BigInt(expected.amount))throw Error('settlement asset credit not established');
 await canonical();
 return Object.freeze({kind:'verified-bridge-settlement',chainId:policy.chainId,transactionHash:txHash,sourceLockHash:lockHash,sourceChain:expected.sourceChain,sourceBridge,bridge,token,holder,amount:expected.amount,blockNumber:height,blockHash:hash(receipt.blockHash)});
}
