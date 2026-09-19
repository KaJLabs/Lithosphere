import { ethers } from 'ethers';
import { prepareNativeSourcePlan } from './nativeSourcePlan.js';
import { inspectNativeSourceProgress } from './nativeSourceRecovery.js';
async function transaction(pool,work){
 const db=await pool.connect();
 try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");const result=await work(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
// Trusted coordinator only; no public caller may choose a registry policy.
export async function createNativeSourceIntent(pool,provider,swapId,policy,input){
 const plan=await prepareNativeSourcePlan(provider,policy,input);
 return transaction(pool,async db=>{
  const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(swap?.state!=='awaiting_settlement'||Number(swap.destination_chain)!==input.targetChain)throw Error('source intent swap mismatch');
  await db.query('INSERT INTO native_source_intents(swap_id,plan) VALUES($1,$2) ON CONFLICT(swap_id) DO NOTHING',[swapId,plan]);
  const saved=(await db.query('SELECT plan,plan=$2::jsonb AS matches FROM native_source_intents WHERE swap_id=$1',[swapId,plan])).rows[0];
  if(!saved.matches)throw Error('conflicting source intent');
  return saved.plan;
 });
}
export async function bindSignedNativeSourceStep(pool,swapId,step,raw){
 if(!Number.isInteger(step)||step<0||step>2||typeof raw!=='string'||raw.length>4096||!/^0x[0-9a-f]+$/i.test(raw))throw Error('invalid source binding');
 const tx=ethers.Transaction.from(raw);
 if(!tx.isSigned()||![0,2].includes(tx.type))throw Error('supported signed source transaction required');
 return transaction(pool,async db=>{
  const swap=(await db.query('SELECT state FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(swap?.state!=='awaiting_settlement')throw Error('source swap no longer awaiting settlement');
  const row=(await db.query('SELECT plan FROM native_source_intents WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!row)throw Error('source intent missing');
  const expected=row.plan.steps[step];
  const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
  if(!same(tx.from,expected.from)||!same(tx.to,expected.to)||tx.chainId!==BigInt(expected.chainId)||tx.value!==BigInt(expected.value)||!same(tx.data,expected.data))throw Error('signed source transaction differs from intent');
  const saved=(await db.query('SELECT transaction_hash FROM native_source_transactions WHERE swap_id=$1 AND step=$2',[swapId,step])).rows[0];
  if(saved){if(saved.transaction_hash!==tx.hash)throw Error('conflicting source transaction');return {transactionHash:tx.hash,alreadyBound:true};}
  if(row.plan.expiresAt<=Date.now()/1000)throw Error('source intent expired');
  if(step>0){
   const prior=(await db.query('SELECT nonce FROM native_source_transactions WHERE swap_id=$1 AND step=$2',[swapId,step-1])).rows[0];
   if(!prior||tx.nonce<=Number(prior.nonce))throw Error('source steps must bind in nonce order');
  }
  await db.query('INSERT INTO native_source_transactions(swap_id,step,chain_id,sender,nonce,transaction_hash) VALUES($1,$2,$3,$4,$5,$6)',[swapId,step,expected.chainId,tx.from.toLowerCase(),tx.nonce,tx.hash]);
  return {transactionHash:tx.hash,alreadyBound:false};
 });
}
export async function recoverNativeSourceIntent(pool,provider,swapId,confirmations){
 const row=(await pool.query('SELECT plan FROM native_source_intents WHERE swap_id=$1',[swapId])).rows[0];
 if(!row)throw Error('source intent missing');
 const hashes=[null,null,null];
 for(const tx of (await pool.query('SELECT step,transaction_hash FROM native_source_transactions WHERE swap_id=$1 ORDER BY step',[swapId])).rows)hashes[tx.step]=tx.transaction_hash;
 return inspectNativeSourceProgress(provider,row.plan,hashes,confirmations);
}

// Backend for the SDK pre-send check. Policy/input come from the trusted registry
// and original intent, never wallet-supplied replacement route parameters.
export async function assertNativeSourceStepReady(pool,provider,swapId,step,policy,input,confirmations){
 if(!Number.isInteger(step)||step<0||step>2)throw Error('invalid source step');
 const fresh=await prepareNativeSourcePlan(provider,policy,input);
 const row=(await pool.query('SELECT i.plan,i.plan=$2::jsonb AS matches,s.state FROM native_source_intents i JOIN native_swaps s USING(swap_id) WHERE swap_id=$1',[swapId,fresh])).rows[0];
 if(!row?.matches||row.state!=='awaiting_settlement')throw Error('source intent no longer eligible');
 const hashes=[null,null,null];
 for(const tx of (await pool.query('SELECT step,transaction_hash FROM native_source_transactions WHERE swap_id=$1 AND step<$2',[swapId,step])).rows)hashes[tx.step]=tx.transaction_hash;
 const progress=await inspectNativeSourceProgress(provider,row.plan,hashes,confirmations);
 if(progress.state!=='wallet_reconciliation_required'||progress.step!==row.plan.steps[step].kind)throw Error('prior source step not finalized');
 for(const e of progress.evidence){
  if((await provider.getBlock(e.blockNumber))?.hash?.toLowerCase()!==e.blockHash.toLowerCase())throw Error('source preflight reorg');
 }
}
