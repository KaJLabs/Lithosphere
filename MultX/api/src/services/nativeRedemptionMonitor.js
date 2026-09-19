import { verifyNativeRedemption } from './nativeRedemption.js';
export async function reconcileNativeRedemptionBatch(pool,providers,{after='',limit=50,signal}={}) {
  if(typeof after!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100) throw Error('invalid redemption cursor');
  const rows=(await pool.query(`SELECT swap_id,chain_id FROM native_redemptions WHERE evidence IS NULL
    AND transaction_hash IS NOT NULL AND swap_id>$1 ORDER BY swap_id LIMIT $2`,[after,limit])).rows;
  const results=[]; let next=after;
  for(const row of rows){
    if(signal?.aborted) return {results,next};
    const provider=providers.get(Number(row.chain_id));
    if(!provider) results.push({swapId:row.swap_id,state:'provider_missing'});
    else {try{await verifyNativeRedemption(pool,provider,row.swap_id);results.push({swapId:row.swap_id,state:'redemption_verified'});}catch{results.push({swapId:row.swap_id,state:'unverified'});}}
    next=row.swap_id;
  }
  return {results,next:rows.length<limit?'':next};
}
