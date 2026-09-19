import { requireNativeDexEvidence } from './nativeDexExecution.js';
import { outstandingNativeFunds } from './nativeFunding.js';
import { requireNativeBridgeBinding } from './nativeBridgeBinding.js';
import { requireNativeRedemptionEvidence } from './nativeRedemption.js';
import { ethers } from 'ethers';
import { bindSignedNativePayout } from './nativeSignedPayout.js';
import { verifySourceEvidence } from './sourceEvidence.js';
import { verifyDestinationSettlement } from './destinationSettlement.js';
const bounded=async work=>{let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RPC deadline exceeded')),15000);})]);}finally{clearTimeout(timer);}};
// Internal worker only. No production worker/endpoint is wired to this function.
// Custody retains signed bytes and must resupply the same payload after restart.
export async function submitBoundNativePayout(pool,provider,swapId,serialized,sourcePolicy,sourceClient){
 const bound=await bindSignedNativePayout(pool,swapId,serialized);
 const tx=ethers.Transaction.from(serialized),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(swap?.state!=='payout_ready')throw Error('swap not payout ready');
  const p=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[swap.route_policy_ref])).rows[0];
  if(!p?.enabled||!p.current)throw Error('payout policy revoked or expired');
  await bounded(()=>requireNativeDexEvidence(db,swapId,p.policy,provider));
  await bounded(()=>requireNativeRedemptionEvidence(db,provider,swapId,p.policy));
  if(BigInt((await bounded(()=>provider.getNetwork())).chainId)!==tx.chainId)throw Error('wrong submission chain');
  const record=async state=>{
   await db.query(`INSERT INTO native_payout_submissions(swap_id,transaction_hash,state) VALUES($1,$2,$3)
    ON CONFLICT(swap_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()
    WHERE native_payout_submissions.transaction_hash=EXCLUDED.transaction_hash`,[swapId,bound.transactionHash,state]);
   await db.query('COMMIT');return {transactionHash:bound.transactionHash,state};
  };
  // Hash lookup handles a lost broadcast response or process restart without
  // creating a new transfer. No success/completion claim is made here.
  const known=await bounded(()=>provider.getTransaction(bound.transactionHash));
  if(known){if(known.hash?.toLowerCase()!==bound.transactionHash)throw Error('RPC transaction mismatch');return await record('submitted');}
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${tx.chainId}:${tx.from.toLowerCase()}`]);
  const source=(await db.query('SELECT * FROM native_swap_sources WHERE swap_id=$1',[swapId])).rows[0];
  const dest=(await db.query('SELECT * FROM native_swap_destinations WHERE swap_id=$1',[swapId])).rows[0];
  if(!source?.verified_evidence||!dest?.verified_evidence||dest.policy_id!==p.policy_id)throw Error('settlement evidence missing');
  requireNativeBridgeBinding(source.expectation,dest.expectation);
  await bounded(()=>verifySourceEvidence(sourcePolicy,source.expectation,sourceClient));
  await bounded(()=>verifyDestinationSettlement(provider,dest.expectation,p.policy));
  if(await bounded(()=>provider.getTransactionCount(tx.from,'pending'))!==tx.nonce)throw Error('nonce changed; reconcile without replacement');
  if(await bounded(()=>provider.getCode(tx.from))!=='0x'||await bounded(()=>provider.getCode(tx.to))!=='0x')throw Error('payout parties changed');
  const reserved=await outstandingNativeFunds(db,Number(tx.chainId),tx.from,tx.gasPrice,swapId);
  if(await bounded(()=>provider.getBalance(tx.from,'pending'))<reserved+tx.value+tx.gasLimit*tx.gasPrice)throw Error('insufficient payout funds');
  if(await bounded(()=>provider.estimateGas({from:tx.from,to:tx.to,value:tx.value,data:tx.data,nonce:tx.nonce,type:0,gasPrice:tx.gasPrice}))>tx.gasLimit)throw Error('reserved gas limit insufficient');
  if(!(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[p.policy_id])).rows[0].current)throw Error('policy expired before broadcast');
  // A broadcast may succeed even when its response fails. Preserve uncertainty;
  // subsequent attempts can only reconcile/rebroadcast these identical bytes.
  try{
   const sent=await bounded(()=>provider.broadcastTransaction(serialized));
   if(sent.hash?.toLowerCase()!==bound.transactionHash)return await record('uncertain');
  }catch{return await record('uncertain');}
  return await record('submitted');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
