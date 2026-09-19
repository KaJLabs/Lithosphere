import { ethers } from 'ethers';
import { verifyDirectNativePayout } from './nativePayoutEvidence.js';
import { requireNativeRedemptionEvidence } from './nativeRedemption.js';

function normalize(a) {
 if(a?.mode!=='direct-native' || typeof a.swapId!=='string' || !a.swapId.trim() || a.swapId.length>200) throw Error('invalid payout assignment');
 for(const k of ['chainId','nonce','confirmations']) if(!Number.isSafeInteger(a[k]) || a[k] < (k==='nonce'?0:1)) throw Error('invalid '+k);
 if(a.confirmations>2147483647 || !/^0x[0-9a-f]{64}$/i.test(a.transactionHash)) throw Error('invalid hash or confirmations');
 if(typeof a.minimumOutputBaseUnits!=='string' || !/^[1-9][0-9]{0,77}$/.test(a.minimumOutputBaseUnits) || BigInt(a.minimumOutputBaseUnits)>=2n**256n) throw Error('invalid amount');
 const sender=ethers.getAddress(a.sender).toLowerCase(),recipient=ethers.getAddress(a.recipient).toLowerCase();
 if(sender===recipient || sender===ethers.ZeroAddress || recipient===ethers.ZeroAddress) throw Error('invalid parties');
 return {mode:'direct-native',swapId:a.swapId,chainId:a.chainId,transactionHash:a.transactionHash.toLowerCase(),sender,recipient,nonce:a.nonce,minimumOutputBaseUnits:a.minimumOutputBaseUnits,confirmations:a.confirmations};
}
function assignment(r){return {mode:'direct-native',swapId:r.swap_id,chainId:Number(r.chain_id),transactionHash:r.transaction_hash,sender:r.sender,recipient:r.recipient,nonce:Number(r.nonce),minimumOutputBaseUnits:r.minimum_output,confirmations:r.confirmations};}
async function transaction(pool, run){
 const db=await pool.connect();
 try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");const result=await run(db);await db.query('COMMIT');return result;}
 catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
async function lockEligibleSwap(db,swapId,a){
 const {rows}=await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId]);
 const swap=rows[0];
 if(!swap || !['payout_ready','completed'].includes(swap.state))throw Error('swap not eligible for payout');
 if(Number(swap.destination_chain)!==a.chainId || swap.recipient!==a.recipient || BigInt(a.minimumOutputBaseUnits)<BigInt(swap.minimum_output))throw Error('payout terms do not match swap');
 return swap;
}
// Internal coordinator interface, never mount directly as a public assignment API.
export async function assignNativePayout(pool,input){
 const a=normalize(input);
 return transaction(pool,async db=>{
  const swap=await lockEligibleSwap(db,a.swapId,a);
  if(swap.state==='completed')throw Error('swap already completed');
  await db.query(`INSERT INTO native_payout_assignments (swap_id,chain_id,transaction_hash,sender,recipient,nonce,minimum_output,confirmations)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (swap_id) DO NOTHING`,[a.swapId,a.chainId,a.transactionHash,a.sender,a.recipient,a.nonce,a.minimumOutputBaseUnits,a.confirmations]);
  const {rows}=await db.query('SELECT * FROM native_payout_assignments WHERE swap_id=$1 FOR UPDATE',[a.swapId]);
  const saved=assignment(rows[0]);
  if(JSON.stringify(saved)!==JSON.stringify(a))throw Error('conflicting immutable payout assignment');
  return saved;
 });
}
export async function verifyAndRecordNativePayout(pool,provider,swapId){
 return transaction(pool,async db=>{
  // Always lock swap before payout, matching assignment lock order.
  const swapResult=await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId]);
  const swap=swapResult.rows[0];
  if(!swap || !['payout_ready','completed'].includes(swap.state))throw Error('swap not eligible for payout');
  const {rows}=await db.query('SELECT * FROM native_payout_assignments WHERE swap_id=$1 FOR UPDATE',[swapId]);
  if(!rows.length)throw Error('payout assignment missing');
  await lockEligibleSwap(db,swapId,assignment(rows[0]));
  if(swap.state==='completed'){
   if(rows[0].state!=='verified')throw Error('inconsistent completed swap');
   return {alreadyRecorded:true,evidence:rows[0].evidence};
  }
  if(rows[0].state==='verified')throw Error('verified payout requires reconciliation');
  // Older isolated payout fixtures predate route policies; normal startup tracks
  // the complete migration set before allowing candidate coordination.
  if((await db.query("SELECT to_regclass('native_route_policies') AS relation")).rows[0].relation){
   const p=(await db.query('SELECT policy FROM native_route_policies WHERE policy_id=$1',[swap.route_policy_ref])).rows[0]?.policy;
   if(p?.nativeOutput)await requireNativeRedemptionEvidence(db,provider,swapId,p);
  }
  let timer;
  const evidence=await Promise.race([
   verifyDirectNativePayout(provider,assignment(rows[0])),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('payout verification timed out')),15000);}),
  ]).finally(()=>clearTimeout(timer));
  await db.query("UPDATE native_payout_assignments SET state='verified', evidence=$2::jsonb, verified_at=now() WHERE swap_id=$1",[swapId,JSON.stringify(evidence)]);
  await db.query("UPDATE native_swaps SET state='completed',completed_at=now() WHERE swap_id=$1",[swapId]);
  return {alreadyRecorded:false,evidence};
 });
}
