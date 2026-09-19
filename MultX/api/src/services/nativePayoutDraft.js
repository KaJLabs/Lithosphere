import { requireNativeDexEvidence } from './nativeDexExecution.js';
import { outstandingNativeFunds } from './nativeFunding.js';
import { requireNativeRedemptionEvidence } from './nativeRedemption.js';
import { ethers } from 'ethers';
const address=v=>{const a=ethers.getAddress(v).toLowerCase();if(a===ethers.ZeroAddress)throw Error('zero payout address');return a;};
// Internal, unsigned draft only. Does not load keys, sign, broadcast or mark paid.
export async function prepareNativePayout(pool,provider,swapId){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!swap||swap.state!=='payout_ready')throw Error('swap not payout ready');
  const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[swap.route_policy_ref])).rows[0];
  if(!row?.enabled||!row.current)throw Error('payout policy revoked or expired');
  await requireNativeDexEvidence(db,swapId,row.policy,provider);
  await requireNativeRedemptionEvidence(db,provider,swapId,row.policy);
  const p=row.policy,sender=address(p.payoutSender),recipient=address(swap.recipient),chainId=Number(swap.destination_chain);
  if(p.mode!=='direct-native-payout'||p.chainId!==chainId||typeof p.custodyRef!=='string'||!p.custodyRef.trim()||!Array.isArray(p.excludedRecipients))throw Error('explicit payout custody/recipient policy required');
  if(sender===recipient||p.excludedRecipients.map(address).includes(recipient))throw Error('recipient excluded');
  if(BigInt((await provider.getNetwork()).chainId)!==BigInt(chainId))throw Error('wrong payout chain');
  if(await provider.getCode(sender)!=='0x'||await provider.getCode(recipient)!=='0x')throw Error('direct payout requires supported EOA parties');
  // Serialize cooperating writers using this sender, across different swaps.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${chainId}:${sender}`]);
  const old=(await db.query('SELECT * FROM native_payout_drafts WHERE swap_id=$1',[swapId])).rows[0];
  if(old){
   if(old.policy_id!==row.policy_id||old.sender!==sender||old.custody_ref!==p.custodyRef)throw Error('draft policy mismatch');
   await db.query('COMMIT');return {alreadyPrepared:true,transaction:old.transaction};
  }
  const nonce=await provider.getTransactionCount(sender,'pending');
  if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('invalid sender nonce');
  // Do not guess around an existing reservation: reconcile/broadcast it first.
  const existing=await db.query('SELECT swap_id FROM native_payout_drafts WHERE chain_id=$1 AND sender=$2 AND nonce=$3',[chainId,sender,nonce]);
  if(existing.rows.length)throw Error('sender nonce already reserved');
  const value=BigInt(swap.minimum_output);
  const fees=await provider.getFeeData();
  if(fees.gasPrice===null||fees.gasPrice<=0n)throw Error('gas price unavailable');
  const request={from:sender,to:recipient,value,nonce,chainId,type:0,data:'0x',gasPrice:fees.gasPrice};
  const gas=await provider.estimateGas(request),gasLimit=(gas*120n+99n)/100n;
  if(gas<=0n||typeof p.maxPayoutGas!=='string'||!/^[1-9][0-9]*$/.test(p.maxPayoutGas)||gasLimit>BigInt(p.maxPayoutGas))throw Error('payout gas exceeds approved bound');
  const reserved=await outstandingNativeFunds(db,chainId,sender,fees.gasPrice,swapId);
  if(await provider.getBalance(sender,'pending')<reserved+value+gasLimit*fees.gasPrice)throw Error('insufficient payout funds');
  const active=(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[row.policy_id])).rows[0];
  if(!active.current)throw Error('policy expired during preparation');
  const transaction={...request,value:value.toString(),gasPrice:fees.gasPrice.toString(),gasLimit:gasLimit.toString()};
  await db.query('INSERT INTO native_payout_drafts(swap_id,policy_id,chain_id,sender,nonce,custody_ref,transaction) VALUES($1,$2,$3,$4,$5,$6,$7)',[swapId,row.policy_id,chainId,sender,nonce,p.custodyRef,transaction]);
  await db.query('COMMIT');return {alreadyPrepared:false,transaction};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
