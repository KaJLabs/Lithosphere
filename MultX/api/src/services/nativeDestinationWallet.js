import { ethers } from 'ethers';
import { requireNativeBridgeBinding } from './nativeBridgeBinding.js';
import { verifySourceEvidence } from './sourceEvidence.js';
import { verifyDestinationSettlement } from './destinationSettlement.js';
import { quoteV2Routes } from './v2RouteQuote.js';
import { outstandingNativeFunds } from './nativeFunding.js';
import { claimNativeDestinationMode } from './nativeDestinationMode.js';
import { prepareNativeDexExecutionOnConnection, bindNativeDexOnConnection, requireNativeDexEvidence } from './nativeDexExecution.js';

const lower=value=>ethers.getAddress(value).toLowerCase();
const tokenAbi=new ethers.Interface(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)&&BigInt(value)<2n**256n;
const bounded=async work=>{let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('destination RPC deadline exceeded')),15000);})]);}finally{clearTimeout(timer);}};
async function transaction(pool,work){
 const db=await pool.connect();
 try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");const result=await work(db);await db.query('COMMIT');return result;}
 catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function context(db,swapId,active=true){
 const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
 const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[swap?.route_policy_ref])).rows[0];
 const source=(await db.query('SELECT plan FROM native_source_intents WHERE swap_id=$1',[swapId])).rows[0];
 const p=row?.policy,d=p?.destinationDex;
 if(!swap||!source||!d||!positive(d.maxGas)||!Number.isSafeInteger(d.confirmations)||d.confirmations<1||
    lower(p.settlementHolder)!==lower(source.plan.sender)||p.chainId!==Number(swap.destination_chain)||
    (active&&(!row.enabled||!row.current||swap.state!=='payout_ready')))throw Error('approved wallet-owned destination route required');
 return {swap,row,p,d,sender:lower(source.plan.sender)};
}
async function authorize(db,swapId,selected,ctx){
 const {provider,sourcePolicy,sourceClient}=selected,{row,p,d,sender}=ctx;
 if(BigInt((await bounded(()=>provider.getNetwork())).chainId)!==BigInt(p.chainId)||await bounded(()=>provider.getCode(sender))!=='0x')throw Error('destination wallet identity mismatch');
 const source=(await db.query('SELECT * FROM native_swap_sources WHERE swap_id=$1',[swapId])).rows[0];
 const dest=(await db.query('SELECT * FROM native_swap_destinations WHERE swap_id=$1',[swapId])).rows[0];
 if(!source?.verified_evidence||!dest?.verified_evidence||dest.policy_id!==row.policy_id)throw Error('destination settlement evidence required');
 requireNativeBridgeBinding(source.expectation,dest.expectation);
 await bounded(()=>verifySourceEvidence(sourcePolicy,source.expectation,sourceClient));
 await bounded(()=>verifyDestinationSettlement(provider,dest.expectation,p));
 const {quotes}=await bounded(()=>quoteV2Routes(provider,[d.venue],{tokenIn:d.venue.tokenIn,tokenOut:d.venue.tokenOut,amountIn:p.settlementAmountBaseUnits,slippageBps:d.slippageBps}));
 if(!quotes[0]||BigInt(quotes[0].minimumOutput)<BigInt(d.minimumOutput)||BigInt(quotes[0].minimumOutput)<BigInt(p.minimumNativeOutputBaseUnits))throw Error('destination native output unavailable');
 const token=new ethers.Contract(d.venue.tokenIn,tokenAbi,provider);
 if(lower(d.venue.tokenIn)!==lower(p.token))throw Error('destination input token mismatch');
 const reserved=(await db.query(`SELECT COALESCE(sum((plan->'quote'->>'amountIn')::numeric),0)::text AS amount FROM native_dex_executions
  WHERE chain_id=$1 AND sender=$2 AND evidence IS NULL AND swap_id<>$3 AND lower(plan->'quote'->'path'->>0)=$4`,[p.chainId,sender,swapId,lower(p.token)])).rows[0].amount;
 if(await bounded(()=>token.balanceOf(sender))<BigInt(p.settlementAmountBaseUnits)+BigInt(reserved))throw Error('destination input reserved or unavailable');
 return {token,allowance:await bounded(()=>token.allowance(sender,d.venue.router))};
}
async function inspect(provider,record,confirmations){
 if(!record?.transaction_hash)return {state:record?.attempt_id?'wallet_reconciliation_required':'not_submitted'};
 const [tx,receipt,network]=await bounded(()=>Promise.all([provider.getTransaction(record.transaction_hash),provider.getTransactionReceipt(record.transaction_hash),provider.getNetwork()]));
 if(BigInt(network.chainId)!==BigInt(record.chain_id))throw Error('wrong destination observation chain');
 if(!tx||!receipt)return {state:'pending_or_unknown',transactionHash:record.transaction_hash};
 const plan=record.plan;
 if(tx.hash.toLowerCase()!==record.transaction_hash||receipt.hash.toLowerCase()!==record.transaction_hash||lower(tx.from)!==record.sender||
    !tx.to||lower(tx.to)!==lower(plan.to)||tx.data!==plan.data||tx.value!==0n||tx.nonce!==Number(record.nonce)||tx.chainId!==BigInt(record.chain_id))throw Error('destination receipt differs from binding');
 const height=receipt.blockNumber,[block,tip]=await bounded(()=>Promise.all([provider.getBlock(height),provider.getBlockNumber()]));
 if(!Number.isSafeInteger(height)||height<1||!Number.isSafeInteger(tip)||block?.hash?.toLowerCase()!==receipt.blockHash?.toLowerCase()||
    tx.blockNumber!==height||tx.blockHash?.toLowerCase()!==receipt.blockHash?.toLowerCase())return {state:'recovery_required',transactionHash:record.transaction_hash};
 if(receipt.status!==1)return {state:'transaction_failed',transactionHash:record.transaction_hash};
 return {state:tip-height+1>=confirmations?'confirmed':'awaiting_finality',transactionHash:record.transaction_hash};
}
async function prepare(db,selected,swapId,step){
 if(![0,1].includes(step))throw Error('invalid destination step');
 const ctx=await context(db,swapId),{p,d,sender,row}=ctx,{provider}=selected;
 const mode=(await db.query('SELECT mode FROM native_destination_wallet_modes WHERE swap_id=$1',[swapId])).rows[0];
 if(mode?.mode==='raw')throw Error('destination uses externally signed mode');
 const dex=(await db.query('SELECT * FROM native_dex_executions WHERE swap_id=$1',[swapId])).rows[0];
 if(dex?.transaction_hash)throw Error('destination trade already bound');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${p.chainId}:${sender}`]);
 const {allowance}=await authorize(db,swapId,selected,ctx);
 const approval=(await db.query('SELECT * FROM native_destination_wallet_steps WHERE swap_id=$1 AND step=0',[swapId])).rows[0];
 if(step===1&&approval?.attempt_id&&(await inspect(provider,approval,d.confirmations)).state!=='confirmed')throw Error('destination approval not final');
 if((step===0&&allowance>=BigInt(p.settlementAmountBaseUnits))||(step===1&&allowance<BigInt(p.settlementAmountBaseUnits)))throw Error('destination approval state changed');
 const saved=(await db.query('SELECT * FROM native_destination_wallet_steps WHERE swap_id=$1 AND step=$2',[swapId,step])).rows[0];
 if(saved?.transaction_hash)throw Error('destination step already bound');
 let plan;
 if(step===0){
  if(!positive(d.maxApprovalGas))throw Error('approved destination approval gas limit required');
  plan={kind:'approve',from:sender,chainId:p.chainId,to:lower(p.token),value:'0',data:tokenAbi.encodeFunctionData('approve',[d.venue.router,p.settlementAmountBaseUnits])};
 }else{
  const dexPlan=await prepareNativeDexExecutionOnConnection(db,provider,swapId);
  if(dexPlan.approval||dexPlan.quote.expiresAt<=Date.now()/1000)throw Error('destination trade plan expired or unapproved');
  plan={kind:'trade',...dexPlan.transaction,from:sender,expiresAt:dexPlan.quote.expiresAt};
 }
 const estimate=await bounded(()=>provider.estimateGas({from:plan.from,to:plan.to,value:0n,data:plan.data}));
 const gasLimit=(estimate*120n+99n)/100n,maxGas=BigInt(step===0?d.maxApprovalGas:d.maxGas);
 if(estimate<=0n||gasLimit>maxGas)throw Error('destination gas exceeds policy');
 if(saved){
  // Fees and gas estimates may change, but the durable executable plan cannot.
  plan=saved.plan;
  if(estimate>BigInt(plan.gasLimit)||(step===1&&plan.expiresAt<=Date.now()/1000))throw Error('destination original plan no longer executable');
 }else plan={...plan,gasLimit:gasLimit.toString()};
 const fees=await bounded(()=>provider.getFeeData()),fee=fees.maxFeePerGas??fees.gasPrice;
 if(!fee||fee<=0n)throw Error('destination fee unavailable');
 const reserved=await outstandingNativeFunds(db,p.chainId,sender,fee,swapId);
 const ownDelivery=lower(p.payoutSender)===sender?(BigInt(p.maxPayoutGas)+BigInt(p.nativeOutput?.maxGas??'0'))*fee:0n;
 if(await bounded(()=>provider.getBalance(sender,'pending'))<reserved+ownDelivery+BigInt(plan.gasLimit)*fee)throw Error('destination wallet gas unavailable');
 if(!(await db.query('SELECT enabled AND expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[row.policy_id])).rows[0].current)throw Error('destination route expired');
 if(step===1&&plan.expiresAt<=Date.now()/1000)throw Error('destination trade expired during preparation');
 if(!saved)await db.query('INSERT INTO native_destination_wallet_steps(swap_id,step,policy_id,chain_id,sender,plan) VALUES($1,$2,$3,$4,$5,$6)',[swapId,step,row.policy_id,p.chainId,sender,plan]);
 return plan;
}
export async function prepareNativeDestinationStep(pool,selected,swapId,step){return transaction(pool,db=>prepare(db,selected,swapId,step));}
export async function reserveNativeDestinationAttempt(pool,selected,swapId,step,attemptId){
 if(!/^0x[0-9a-f]{64}$/.test(attemptId))throw Error('invalid destination attempt');
 return transaction(pool,async db=>{
  await prepare(db,selected,swapId,step);
  await claimNativeDestinationMode(db,swapId,'injected');
  const result=await db.query('UPDATE native_destination_wallet_steps SET attempt_id=$3 WHERE swap_id=$1 AND step=$2 AND attempt_id IS NULL AND transaction_hash IS NULL RETURNING step',[swapId,step,attemptId]);
  return {granted:result.rowCount===1};
 });
}
export async function observeNativeDestinationTransaction(pool,provider,swapId,step,hash){
 if(![0,1].includes(step)||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('invalid destination observation');
 hash=hash.toLowerCase();
 return transaction(pool,async db=>{
  const ctx=await context(db,swapId,false);
  await claimNativeDestinationMode(db,swapId,'injected');
  const saved=(await db.query('SELECT * FROM native_destination_wallet_steps WHERE swap_id=$1 AND step=$2 FOR UPDATE',[swapId,step])).rows[0];
  if(!saved?.attempt_id)throw Error('destination reservation required');
  if(saved.transaction_hash&&saved.transaction_hash!==hash)throw Error('conflicting destination observation');
  const [tx,network]=await bounded(()=>Promise.all([provider.getTransaction(hash),provider.getNetwork()])),plan=saved.plan;
  if(!tx||tx.hash.toLowerCase()!==hash||BigInt(network.chainId)!==BigInt(saved.chain_id)||!tx.signature||![0,2].includes(tx.type)||
     lower(tx.from)!==saved.sender||!tx.to||lower(tx.to)!==lower(plan.to)||tx.chainId!==BigInt(saved.chain_id)||tx.value!==0n||tx.data!==plan.data||
     tx.gasLimit!==BigInt(plan.gasLimit))throw Error('destination transaction not visible or differs from plan');
  if(step===1){
   const raw=ethers.Transaction.from({type:tx.type,to:tx.to,nonce:tx.nonce,gasLimit:tx.gasLimit,gasPrice:tx.gasPrice,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,maxFeePerGas:tx.maxFeePerGas,data:tx.data,value:tx.value,chainId:tx.chainId,signature:tx.signature,accessList:tx.accessList}).serialized;
   await bindNativeDexOnConnection(db,swapId,raw,'injected');
  }else if(tx.gasLimit>BigInt(ctx.d.maxApprovalGas))throw Error('approval observed gas exceeds policy');
  if(!saved.transaction_hash)await db.query('UPDATE native_destination_wallet_steps SET transaction_hash=$3,nonce=$4 WHERE swap_id=$1 AND step=$2',[swapId,step,hash,tx.nonce]);
  return {transactionHash:hash};
 });
}
export async function inspectNativeDestinationProgress(pool,selected,swapId){
 return transaction(pool,async db=>{
  const ctx=await context(db,swapId,false),{swap,p,d}=ctx,{provider}=selected;
  const common={swapId,chainId:p.chainId};
  if(swap.state==='completed')return {...common,state:'completed'};
  const dex=(await db.query('SELECT * FROM native_dex_executions WHERE swap_id=$1',[swapId])).rows[0];
  if(dex?.evidence){await bounded(()=>requireNativeDexEvidence(db,swapId,p,provider));return {...common,state:'dex_confirmed',transactionHash:dex.transaction_hash};}
  const records=(await db.query('SELECT * FROM native_destination_wallet_steps WHERE swap_id=$1 ORDER BY step',[swapId])).rows;
  const trade=records.find(record=>record.step===1),approval=records.find(record=>record.step===0);
  if(trade?.attempt_id){
   const result=await inspect(provider,trade,d.confirmations);
   return {...common,...result,state:result.state==='confirmed'?'awaiting_verification':result.state,step:1,submissionReserved:!trade.transaction_hash};
  }
  if(dex?.transaction_hash)return {...common,state:'operator_managed',transactionHash:dex.transaction_hash};
  if(approval?.attempt_id){
   const result=await inspect(provider,approval,d.confirmations);
   if(result.state!=='confirmed')return {...common,...result,step:0,submissionReserved:!approval.transaction_hash};
  }
  if(!ctx.row.enabled||!ctx.row.current)return {...common,state:'route_disabled'};
  const mode=(await db.query('SELECT mode FROM native_destination_wallet_modes WHERE swap_id=$1',[swapId])).rows[0];
  if(mode?.mode==='raw')return {...common,state:'operator_managed'};
  const token=new ethers.Contract(p.token,tokenAbi,provider);
  if(BigInt((await bounded(()=>provider.getNetwork())).chainId)!==BigInt(p.chainId))throw Error('wrong destination status chain');
  const allowance=await bounded(()=>token.allowance(ctx.sender,d.venue.router));
  if(dex?.plan.quote.expiresAt<=Date.now()/1000)return {...common,state:'recovery_required'};
  return {...common,state:'wallet_action_required',step:allowance<BigInt(p.settlementAmountBaseUnits)?0:1};
 });
}
