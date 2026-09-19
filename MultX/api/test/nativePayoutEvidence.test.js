import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDirectNativePayout } from '../src/services/nativePayoutEvidence.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0');
const h=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture(){
 const expected={mode:'direct-native',swapId:'swap-1',chainId:9005,confirmations:12,nonce:7,transactionHash:h(1),sender:a(100000),recipient:a(200000),minimumOutputBaseUnits:'1000'};
 const tx={hash:h(1),from:expected.sender,to:expected.recipient,nonce:7,data:'0x',value:1000n,blockNumber:50,blockHash:h(2)};
 const receipt={hash:h(1),status:1,blockNumber:50,blockHash:h(2)};
 const provider={getNetwork:async()=>({chainId:9005n}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getBlockNumber:async()=>61,getBlock:async()=>({hash:h(2)}),getCode:async()=> '0x',getBalance:async(_,height)=>height===49?500n:1500n};
 return {expected,tx,receipt,provider};
}
test('verifies direct native credit using pinned receipt and historical balances',async()=>{
 const f=fixture();const result=await verifyDirectNativePayout(f.provider,f.expected);
 assert.equal(result.amountBaseUnits,'1000');assert.equal(result.evidenceKey,'9005:'+h(1));assert(Object.isFrozen(result));
});
for(const [name,change] of [
 ['wrong chain',f=>f.provider.getNetwork=async()=>({chainId:1n})],
 ['pending',f=>f.provider.getTransactionReceipt=async()=>null],
 ['reverted',f=>f.receipt.status=0],
 ['wrong recipient',f=>f.tx.to=a(300000)],
 ['wrong sender',f=>f.tx.from=a(300000)],
 ['wrong nonce',f=>f.tx.nonce=8],
 ['token call',f=>f.tx.data='0xa9059cbb'],
 ['underpayment',f=>f.tx.value=999n],
 ['insufficient finality',f=>f.provider.getBlockNumber=async()=>60],
 ['reorg',f=>f.provider.getBlock=async()=>({hash:h(3)})],
 ['contract recipient',f=>f.provider.getCode=async()=> '0x6000'],
 ['missing native credit',f=>f.provider.getBalance=async()=>500n],
 ['reorg during reads',f=>{let reads=0;f.provider.getBlock=async()=>({hash:++reads===1?h(2):h(3)});} ],
 ['unapproved finality',f=>f.expected.confirmations=0],
 ['self payout',f=>f.expected.recipient=f.expected.sender],
])test('rejects '+name,async()=>{const f=fixture();change(f);await assert.rejects(verifyDirectNativePayout(f.provider,f.expected));});
