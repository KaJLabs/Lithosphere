import { requireNativeDexEvidence } from './nativeDexExecution.js';
import { ethers } from 'ethers';
const address=v=>ethers.getAddress(v).toLowerCase();
// Binding only: no key access, provider, signing or broadcast. The signed bytes
// remain with the caller; only the recovered identity/hash is stored.
export async function bindSignedNativePayout(pool,swapId,serialized){
 if(typeof serialized!=='string'||serialized.length>2048||!/^0x[0-9a-f]+$/i.test(serialized))throw Error('invalid signed payout');
 let tx;try{tx=ethers.Transaction.from(serialized);if(!tx.isSigned())throw Error();}catch{throw Error('invalid signed payout');}
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!swap||swap.state!=='payout_ready')throw Error('swap not payout ready');
  const draft=(await db.query('SELECT * FROM native_payout_drafts WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!draft||draft.policy_id!==swap.route_policy_ref)throw Error('reserved payout draft required');
  const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[draft.policy_id])).rows[0];
  if(!row?.enabled||!row.current)throw Error('payout policy revoked or expired');
  await requireNativeDexEvidence(db,swapId,row.policy);
  const p=row.policy,d=draft.transaction;
  if(address(p.payoutSender)!==draft.sender||p.custodyRef!==draft.custody_ref||p.mode!=='direct-native-payout')throw Error('custody does not match reservation');
  if(tx.type!==0||tx.chainId!==BigInt(d.chainId)||tx.chainId!==BigInt(swap.destination_chain)||tx.nonce!==d.nonce||tx.nonce!==Number(draft.nonce)||address(tx.from)!==draft.sender||address(tx.from)!==address(d.from)||!tx.to||address(tx.to)!==address(d.to)||address(tx.to)!==swap.recipient||tx.data!=='0x'||tx.value!==BigInt(d.value)||tx.value!==BigInt(swap.minimum_output)||tx.gasLimit!==BigInt(d.gasLimit)||tx.gasPrice!==BigInt(d.gasPrice))throw Error('signed payout differs from reserved draft');
  if(!Number.isSafeInteger(p.confirmations)||p.confirmations<1||p.confirmations>2147483647)throw Error('approved payout finality required');
  const result=await db.query(`INSERT INTO native_payout_assignments(swap_id,chain_id,transaction_hash,sender,recipient,nonce,minimum_output,confirmations)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(swap_id) DO NOTHING RETURNING swap_id`,[swapId,d.chainId,tx.hash,draft.sender,swap.recipient,d.nonce,swap.minimum_output,p.confirmations]);
  const saved=(await db.query('SELECT * FROM native_payout_assignments WHERE swap_id=$1',[swapId])).rows[0];
  if(saved.transaction_hash!==tx.hash||saved.sender!==draft.sender||saved.recipient!==swap.recipient||Number(saved.chain_id)!==Number(d.chainId)||Number(saved.nonce)!==d.nonce||saved.minimum_output!==swap.minimum_output||saved.confirmations!==p.confirmations)throw Error('conflicting payout transaction binding');
  await db.query('COMMIT');return {swapId,transactionHash:tx.hash,alreadyBound:result.rows.length===0};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
