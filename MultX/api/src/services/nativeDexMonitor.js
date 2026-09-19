import { verifyNativeDexExecution } from './nativeDexExecution.js';
// Read-only chain reconciliation. It never signs, retries swaps or replaces nonces.
export async function reconcileNativeDexBatch(pool,providers,{after='',limit=50,signal}={}){
 if(typeof after!=='string'||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid DEX reconciliation cursor');
 const {rows}=await pool.query(`SELECT d.swap_id,d.chain_id FROM native_dex_executions d JOIN native_swaps s USING(swap_id)
  WHERE s.state='payout_ready' AND d.transaction_hash IS NOT NULL AND d.evidence IS NULL AND d.swap_id>$1 ORDER BY d.swap_id LIMIT $2`,[after,limit]);
 const results=[];let next=after;
 for(const row of rows){
  if(signal?.aborted)return {results,next};
  const provider=providers.get(Number(row.chain_id));
  if(!provider)results.push({swapId:row.swap_id,state:'provider_missing'});
  else{try{await verifyNativeDexExecution(pool,provider,row.swap_id);results.push({swapId:row.swap_id,state:'dex_verified'});}catch{results.push({swapId:row.swap_id,state:'unverified'});}}
  next=row.swap_id;
 }
 return {results,next:rows.length<limit?'':next};
}
