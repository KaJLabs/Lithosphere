import { ethers } from 'ethers';
import { verifyDestinationSettlement } from './destinationSettlement.js';
import { verifySourceEvidence } from './sourceEvidence.js';
import { requireNativeBridgeBinding } from './nativeBridgeBinding.js';
const address=v=>ethers.getAddress(v).toLowerCase();
// Internal-only. Policies/assignments must be provisioned from actual approvals;
// this service does not accept a policy or settlement expectation from its caller.
export async function verifyNativeSwapReadiness(pool,swapId,sourcePolicy,sourceClient,destinationProvider){
 const db=await pool.connect();let timer;
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!swap||swap.state!=='awaiting_settlement')throw Error('swap not awaiting settlement');
  const source=(await db.query('SELECT * FROM native_swap_sources WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  const dest=(await db.query('SELECT * FROM native_swap_destinations WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!source?.verified_evidence||!dest||dest.verified_evidence)throw Error('verified source and unconsumed destination assignment required');
  const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[dest.policy_id])).rows[0];
  if(!row?.enabled||!row.current)throw Error('approved active route required');
  const e=dest.expectation,p=row.policy,lock=source.expectation;
  requireNativeBridgeBinding(lock,e);
  const quote=(await db.query('SELECT policy_id,wallet FROM native_quotes WHERE quote_id=$1 AND accepted_at IS NOT NULL',[swapId])).rows[0];
  if(quote&&(quote.policy_id!==dest.policy_id||quote.wallet!==address(lock.user)))throw Error('accepted quote settlement mismatch');
  if(p.mode!=='direct-native-payout' || e.destinationChain!==Number(swap.destination_chain) || Number(dest.destination_chain)!==e.destinationChain || e.transactionHash.toLowerCase()!==dest.transaction_hash || e.sourceChain!==Number(source.source_chain) || e.sourceLockHash.toLowerCase()!==source.source_lock_hash || address(e.sourceBridge)!==source.source_bridge)throw Error('destination/source binding mismatch');
  if(Number(lock.sourceChain)!==Number(source.source_chain)||String(lock.sourceTxHash).toLowerCase()!==source.source_lock_hash||address(lock.sourceBridge)!==source.source_bridge||Number(lock.targetChain)!==Number(swap.destination_chain))throw Error('source binding mismatch');
  if(p.settlementAmountBaseUnits!==e.amount || p.sourceAmountBaseUnits!==lock.amount || p.sourceChain!==e.sourceChain || address(p.sourceBridge)!==address(e.sourceBridge) || address(p.settlementHolder)!==address(e.holder) || address(p.sourceToken)!==address(lock.sourceToken))throw Error('route does not cover settlement');
  // No pricing is inferred from the release. Only an approved fixed native-payout
  // commitment can authorize this narrow path; general DEX execution is separate.
  if(typeof p.minimumNativeOutputBaseUnits!=='string'||!/^[1-9][0-9]{0,77}$/.test(p.minimumNativeOutputBaseUnits)||BigInt(p.minimumNativeOutputBaseUnits)<BigInt(swap.minimum_output)||typeof p.liquidityCommitmentRef!=='string'||!p.liquidityCommitmentRef.trim())throw Error('approved payout commitment required');
  const verify=async()=>{
   await verifySourceEvidence(sourcePolicy,lock,sourceClient);
   return verifyDestinationSettlement(destinationProvider,e,p);
  };
  const evidence=await Promise.race([verify(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('readiness verification timed out')),15000);})]);
  const active=(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[dest.policy_id])).rows[0];
  if(!active.current)throw Error('route expired during verification');
  await db.query('UPDATE native_swap_destinations SET verified_evidence=$2::jsonb,verified_at=now() WHERE swap_id=$1',[swapId,JSON.stringify(evidence)]);
  await db.query("UPDATE native_swaps SET state='payout_ready',route_policy_ref=$2,settlement_evidence_ref=$3 WHERE swap_id=$1",[swapId,dest.policy_id,dest.transaction_hash]);
  await db.query('COMMIT');return evidence;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{clearTimeout(timer);db.release();}
}
