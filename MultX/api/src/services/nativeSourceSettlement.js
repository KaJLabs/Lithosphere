import { verifySourceEvidence } from './sourceEvidence.js';

// Internal coordinator call. Source expectation is durably bound before this call;
// policy/client must be selected from the operator-controlled chain registry.
export async function verifyAndRecordNativeSource(pool,swapId,source,client){
 const db=await pool.connect();let timer;
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!swap || swap.state!=='awaiting_settlement')throw Error('swap not awaiting settlement');
  const row=(await db.query('SELECT * FROM native_swap_sources WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!row)throw Error('source assignment missing');
  const lock=row.expectation;
  if(Number(lock.sourceChain)!==Number(row.source_chain) || String(lock.sourceBridge).toLowerCase()!==row.source_bridge || String(lock.sourceTxHash).toLowerCase()!==row.source_lock_hash || Number(lock.targetChain)!==Number(swap.destination_chain))throw Error('source assignment mismatch');
  // Always revalidate, even on replay, to detect changed canonical evidence.
  await Promise.race([verifySourceEvidence(source,lock,client),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('source verification timed out')),15000);})]);
  const evidence={kind:'verified-source-lock',chainId:Number(row.source_chain),bridge:row.source_bridge,lockHash:row.source_lock_hash,blockNumber:Number(lock.sourceBlock),blockHash:lock.sourceBlockHash.toLowerCase()};
  if(!row.verified_evidence)await db.query('UPDATE native_swap_sources SET verified_evidence=$2::jsonb,verified_at=now() WHERE swap_id=$1',[swapId,JSON.stringify(evidence)]);
  await db.query('COMMIT');return {alreadyRecorded:Boolean(row.verified_evidence),evidence};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{clearTimeout(timer);db.release();}
}
