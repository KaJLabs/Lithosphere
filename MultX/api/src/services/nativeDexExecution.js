import { ethers } from 'ethers';
import { outstandingNativeFunds } from './nativeFunding.js';
import { requireNativeBridgeBinding } from './nativeBridgeBinding.js';
import { claimNativeDestinationMode } from './nativeDestinationMode.js';
import { quoteV2Routes } from './v2RouteQuote.js';
import { verifySourceEvidence } from './sourceEvidence.js';
import { verifyDestinationSettlement } from './destinationSettlement.js';
import { prepareV2Swap } from './v2SwapPlan.js';
const lower=v=>ethers.getAddress(v).toLowerCase();
async function transaction(pool,work){const db=await pool.connect();try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");const result=await work(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
async function context(db,swapId,active=true){
 const swap=(await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
 if(!swap||!['payout_ready','completed'].includes(swap.state))throw Error('DEX swap not eligible');
 const row=(await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE',[swap.route_policy_ref])).rows[0];
 if(!row?.policy?.destinationDex||(active&&(!row.enabled||!row.current||swap.state!=='payout_ready')))throw Error('approved destination DEX policy required');
 return {swap,row};
}
export async function prepareNativeDexExecution(pool,provider,swapId){
 return transaction(pool,db=>prepareNativeDexExecutionOnConnection(db,provider,swapId));
}
export async function prepareNativeDexExecutionOnConnection(db,provider,swapId){
  const {swap,row}=await context(db,swapId),p=row.policy,d=p.destinationDex;
  const saved=(await db.query('SELECT plan FROM native_dex_executions WHERE swap_id=$1',[swapId])).rows[0];
  if(saved)return saved.plan;
  if(!Number.isSafeInteger(d.confirmations)||d.confirmations<1||lower(d.venue.tokenIn)!==lower(p.token)||d.venue.chainId!==Number(swap.destination_chain))throw Error('DEX policy settlement mismatch');
  const plan=await bounded(()=>prepareV2Swap(provider,d.venue,{tokenIn:d.venue.tokenIn,tokenOut:d.venue.tokenOut,amountIn:p.settlementAmountBaseUnits,slippageBps:d.slippageBps,sender:p.settlementHolder,recipient:p.payoutSender,minimumOutput:d.minimumOutput}));
  await db.query('INSERT INTO native_dex_executions(swap_id,policy_id,chain_id,sender,plan) VALUES($1,$2,$3,$4,$5)',[swapId,row.policy_id,swap.destination_chain,lower(p.settlementHolder),plan]);
  return plan;
}
export async function bindSignedNativeDexExecution(pool,swapId,raw){
 return transaction(pool,db=>bindNativeDexOnConnection(db,swapId,raw,'raw'));
}
// Injected callers must first establish a durable reservation and independently
// fetch the exact chain-visible transaction; never expose this as a raw bind API.
export async function bindNativeDexOnConnection(db,swapId,raw,mode){
 if(typeof raw!=='string'||raw.length>8192||!/^0x[0-9a-f]+$/i.test(raw))throw Error('invalid DEX signed transaction');
 const tx=ethers.Transaction.from(raw);
 if(!tx.isSigned()||![0,2].includes(tx.type))throw Error('signed DEX transaction required');
  const {row}=await context(db,swapId,false);
  await claimNativeDestinationMode(db,swapId,mode);
  if(mode==='injected'&&!(await db.query('SELECT step FROM native_destination_wallet_steps WHERE swap_id=$1 AND step=1 AND attempt_id IS NOT NULL',[swapId])).rowCount)throw Error('destination injected reservation required');
  const saved=(await db.query('SELECT * FROM native_dex_executions WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!saved)throw Error('DEX intent missing');
  const t=saved.plan.transaction;
  if(lower(tx.from)!==saved.sender||!tx.to||lower(tx.to)!==lower(t.to)||tx.chainId!==BigInt(saved.chain_id)||tx.value!==0n||tx.data!==t.data)throw Error('signed DEX transaction differs from intent');
  if(saved.transaction_hash){if(saved.transaction_hash!==tx.hash)throw Error('conflicting DEX binding');return {transactionHash:tx.hash,alreadyBound:true};}
  if(mode==='raw'){
   await context(db,swapId);
   if(saved.plan.quote.expiresAt<=Date.now()/1000)throw Error('DEX intent expired');
  }
  if(row.policy.nativeOutput&&tx.gasLimit>BigInt(row.policy.destinationDex.maxGas))throw Error('DEX wallet gas exceeds policy');
  await db.query('UPDATE native_dex_executions SET transaction_hash=$2,nonce=$3 WHERE swap_id=$1',[swapId,tx.hash,tx.nonce]);
  return {transactionHash:tx.hash,alreadyBound:false};
}
export async function verifyNativeDexExecution(pool,provider,swapId){
 return transaction(pool,async db=>{
  const {row}=await context(db,swapId,false),p=row.policy;
  const saved=(await db.query('SELECT * FROM native_dex_executions WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(!saved?.transaction_hash)throw Error('bound DEX transaction required');
  if(saved.evidence)return {alreadyRecorded:true,evidence:saved.evidence};
  if(BigInt((await provider.getNetwork()).chainId)!==BigInt(saved.chain_id))throw Error('wrong DEX chain');
  const [tx,receipt]=await Promise.all([provider.getTransaction(saved.transaction_hash),provider.getTransactionReceipt(saved.transaction_hash)]);
  const h=v=>typeof v==='string'?v.toLowerCase():null;
  if(!tx||!receipt||receipt.status!==1||h(tx.hash)!==saved.transaction_hash||h(receipt.hash)!==saved.transaction_hash)throw Error('DEX transaction not successfully mined');
  const t=saved.plan.transaction;
  if(lower(tx.from)!==saved.sender||!tx.to||lower(tx.to)!==lower(t.to)||tx.nonce!==Number(saved.nonce)||tx.value!==0n||tx.data!==t.data)throw Error('DEX receipt intent mismatch');
  const height=receipt.blockNumber,tip=await provider.getBlockNumber();
  if(!Number.isSafeInteger(height)||height<1||!Number.isSafeInteger(tip)||tip-height+1<p.destinationDex.confirmations||tx.blockNumber!==height||h(tx.blockHash)!==h(receipt.blockHash))throw Error('DEX receipt not final');
  const block=await provider.getBlock(height);if(!block||h(block.hash)!==h(receipt.blockHash))throw Error('DEX receipt reorg');
  const token=new ethers.Contract(p.destinationDex.venue.tokenOut,['function balanceOf(address) view returns(uint256)'],provider);
  const [before,after]=await Promise.all([token.balanceOf(p.payoutSender,{blockTag:height-1}),token.balanceOf(p.payoutSender,{blockTag:height})]);
  if(after-before<BigInt(saved.plan.minimumOutput))throw Error('DEX output credit not established');
  if(h((await provider.getBlock(height))?.hash)!==h(block.hash))throw Error('DEX receipt reorg');
  const evidence={transactionHash:saved.transaction_hash,blockNumber:height,blockHash:block.hash,recipient:lower(p.payoutSender),token:lower(p.destinationDex.venue.tokenOut),amount: (after-before).toString()};
  await db.query('UPDATE native_dex_executions SET evidence=$2 WHERE swap_id=$1',[swapId,evidence]);
  return {alreadyRecorded:false,evidence};
 });
}
export async function requireNativeDexEvidence(db,swapId,policy,provider){
 if(!policy.destinationDex)return;
 const saved=(await db.query('SELECT evidence FROM native_dex_executions WHERE swap_id=$1',[swapId])).rows[0];
 if(!saved?.evidence)throw Error('verified destination DEX output required');
 if(provider){
  const e=saved.evidence,block=await provider.getBlock(e.blockNumber),tip=await provider.getBlockNumber();
  if(BigInt((await provider.getNetwork()).chainId)!==BigInt(policy.chainId)||block?.hash?.toLowerCase()!==e.blockHash.toLowerCase()||!Number.isSafeInteger(tip)||tip-e.blockNumber+1<policy.destinationDex.confirmations)throw Error('destination DEX evidence no longer canonical');
 }
}

const bounded=async work=>{let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DEX RPC deadline exceeded')),15000);})]);}finally{clearTimeout(timer);}};
// Custody retains the signed bytes. This function cannot produce replacements.
export async function submitBoundNativeDexExecution(pool,provider,swapId,raw,sourcePolicy,sourceClient){
 const bound=await bindSignedNativeDexExecution(pool,swapId,raw),tx=ethers.Transaction.from(raw);
 return transaction(pool,async db=>{
  const {row}=await context(db,swapId),p=row.policy;
  const saved=(await db.query('SELECT * FROM native_dex_executions WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
  if(BigInt((await bounded(()=>provider.getNetwork())).chainId)!==tx.chainId)throw Error('wrong DEX submission chain');
  const known=await bounded(()=>provider.getTransaction(bound.transactionHash));
  if(known){if(known.hash.toLowerCase()!==bound.transactionHash)throw Error('DEX RPC hash mismatch');return {state:'submitted',transactionHash:bound.transactionHash};}
  if(saved.plan.quote.expiresAt<=Date.now()/1000)throw Error('DEX execution deadline expired');
  const source=(await db.query('SELECT * FROM native_swap_sources WHERE swap_id=$1',[swapId])).rows[0];
  const dest=(await db.query('SELECT * FROM native_swap_destinations WHERE swap_id=$1',[swapId])).rows[0];
  if(!source?.verified_evidence||!dest?.verified_evidence||dest.policy_id!==row.policy_id)throw Error('DEX settlement evidence missing');
  requireNativeBridgeBinding(source.expectation,dest.expectation);
  await bounded(()=>verifySourceEvidence(sourcePolicy,source.expectation,sourceClient));
  await bounded(()=>verifyDestinationSettlement(provider,dest.expectation,p));
  const {quotes}=await bounded(()=>quoteV2Routes(provider,[p.destinationDex.venue],{tokenIn:p.destinationDex.venue.tokenIn,tokenOut:p.destinationDex.venue.tokenOut,amountIn:p.settlementAmountBaseUnits,slippageBps:p.destinationDex.slippageBps}));
  if(!quotes[0]||BigInt(quotes[0].amountOut)<BigInt(saved.plan.minimumOutput))throw Error('DEX minimum no longer available');
  if(await bounded(()=>provider.getTransactionCount(tx.from,'pending'))!==tx.nonce)throw Error('DEX nonce changed; reconcile without replacement');
  const token=new ethers.Contract(p.token,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],provider);
  if(await bounded(()=>token.balanceOf(tx.from))<BigInt(p.settlementAmountBaseUnits)||await bounded(()=>token.allowance(tx.from,tx.to))<BigInt(p.settlementAmountBaseUnits))throw Error('DEX input or approval missing');
  const fee=tx.type===0?tx.gasPrice:tx.maxFeePerGas;
  if(p.nativeOutput&&(!/^[1-9][0-9]{0,77}$/.test(p.destinationDex.maxGas??'')||tx.gasLimit>BigInt(p.destinationDex.maxGas)))throw Error('DEX signed gas exceeds native funding policy');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${tx.chainId}:${tx.from.toLowerCase()}`]);
  const reserved=await outstandingNativeFunds(db,Number(tx.chainId),tx.from,fee,swapId);
  const ownQuote=(await db.query('SELECT request FROM native_quotes WHERE quote_id=$1 AND accepted_at IS NOT NULL',[swapId])).rows[0];
  const ownFunds=ownQuote&&lower(p.payoutSender)===tx.from.toLowerCase() ? (ownQuote.request.terms.fundingMode==='dex-wrapped-native'
    ? (BigInt(p.maxPayoutGas)+BigInt(p.nativeOutput.maxGas))*fee
    : BigInt(ownQuote.request.terms.nativeOutputAmount)+BigInt(p.maxPayoutGas)*fee) : 0n;
  if(await bounded(()=>provider.getBalance(tx.from,'pending'))<reserved+ownFunds+tx.gasLimit*fee)throw Error('DEX gas funds unavailable');
  const request={from:tx.from,to:tx.to,data:tx.data,value:0n,nonce:tx.nonce,type:tx.type,...(tx.type===0?{gasPrice:tx.gasPrice}:{maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,accessList:tx.accessList})};
  if(await bounded(()=>provider.estimateGas(request))>tx.gasLimit)throw Error('DEX signed gas limit insufficient');
  if(saved.plan.quote.expiresAt<=Date.now()/1000||!(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[row.policy_id])).rows[0].current)throw Error('DEX approval or quote expired');
  try{
   const sent=await bounded(()=>provider.broadcastTransaction(raw));
   return {state:sent.hash?.toLowerCase()===bound.transactionHash?'submitted':'uncertain',transactionHash:bound.transactionHash};
  }catch{return {state:'uncertain',transactionHash:bound.transactionHash};}
 });
}
