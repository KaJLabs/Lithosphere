import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { verifyDestinationSettlement } from '../src/services/destinationSettlement.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),h=n=>'0x'+n.toString(16).padStart(64,'0');
const abi=new ethers.Interface(['event TokensReleased(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 sourceChain,address sourceBridge,address releasedBy)']);
function fixture(){
 const policy={chainId:9005,confirmations:12,bridge:a(20),token:a(30),bridgeCodeHash:ethers.keccak256('0x6000')};
 const expected={destinationChain:9005,sourceChain:1,sourceBridge:a(40),sourceLockHash:h(2),transactionHash:h(1),token:a(30),holder:a(50),amount:'1000'};
 const event=abi.encodeEventLog(abi.getEvent('TokensReleased'),[h(2),a(30),a(50),1000,1,a(40),a(60)]);
 const receipt={status:1,hash:h(1),to:a(20),blockNumber:50,blockHash:h(3),logs:[{address:a(20),...event}]};
 const provider={getNetwork:async()=>({chainId:9005n}),getTransactionReceipt:async()=>receipt,getBlockNumber:async()=>61,getBlock:async()=>({hash:h(3)}),getCode:async()=> '0x6000',call:async req=>ethers.AbiCoder.defaultAbiCoder().encode(['uint256'],[req.blockTag===49?0:1000])};
 return {provider,receipt,expected,policy};
}
test('bridge settlement requires exact release and credited asset',async()=>{const f=fixture();const e=await verifyDestinationSettlement(f.provider,f.expected,f.policy);assert.equal(e.kind,'verified-bridge-settlement');assert.equal(e.amount,'1000');});
for(const [name,change] of [
 ['revert',f=>f.receipt.status=0],['wrong chain',f=>f.provider.getNetwork=async()=>({chainId:1n})],
 ['wrong bridge',f=>f.receipt.to=a(99)],['unknown runtime',f=>f.provider.getCode=async()=> '0x6001'],
 ['missing event',f=>f.receipt.logs=[]],['duplicate event',f=>f.receipt.logs.push(f.receipt.logs[0])],
 ['wrong source',f=>f.expected.sourceLockHash=h(99)],['wrong holder',f=>f.expected.holder=a(99)],
 ['wrong amount',f=>f.expected.amount='999'],['removed',f=>f.receipt.logs[0].removed=true],
 ['not final',f=>f.provider.getBlockNumber=async()=>60],['reorg',f=>f.provider.getBlock=async()=>({hash:h(99)})],
 ['no credit',f=>f.provider.call=async()=>ethers.AbiCoder.defaultAbiCoder().encode(['uint256'],[0])],
 ['reorg while reading',f=>{let n=0;f.provider.getBlock=async()=>({hash:++n===1?h(3):h(99)});}]
])test('rejects '+name,async()=>{const f=fixture();change(f);await assert.rejects(verifyDestinationSettlement(f.provider,f.expected,f.policy));});
