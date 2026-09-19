import { ethers } from 'ethers';
import { requireNativeDexEvidence } from './nativeDexExecution.js';
import { outstandingNativeFunds } from './nativeFunding.js';

const lower = value => ethers.getAddress(value).toLowerCase();
const abi = new ethers.Interface(['function withdraw(uint256)', 'function balanceOf(address) view returns(uint256)']);
const positive = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const bounded = async work => {
  let timer;
  try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('redemption RPC deadline exceeded')), 15000); })]); }
  finally { clearTimeout(timer); }
};
async function transaction(pool, work) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await db.query("SET LOCAL lock_timeout='5s'"); const result = await work(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function context(db, swapId, active = true) {
  const swap = (await db.query('SELECT * FROM native_swaps WHERE swap_id=$1 FOR UPDATE', [swapId])).rows[0];
  const row = (await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR SHARE', [swap?.route_policy_ref])).rows[0];
  const p = row?.policy, n = p?.nativeOutput;
  if (!swap || !['payout_ready','completed'].includes(swap.state) || !n || n.kind !== 'wrapped-native-redemption' ||
      !Number.isSafeInteger(n.confirmations) || n.confirmations < 1 || !positive(n.maxGas) ||
      typeof n.approvalRef !== 'string' || !n.approvalRef.trim() ||
      !p.destinationDex || lower(n.wrapper) !== lower(p.destinationDex.venue.tokenOut) ||
      n.wrapperCodeHash !== p.destinationDex.venue.tokenOutCodeHash ||
      !/^0x[0-9a-f]{64}$/i.test(n.wrapperCodeHash) ||
      (active && (!row.enabled || !row.current || swap.state !== 'payout_ready'))) throw Error('approved native redemption policy required');
  return { swap, row, p, n };
}
async function wrapper(provider, p, n, blockTag) {
  if (BigInt((await bounded(() => provider.getNetwork())).chainId) !== BigInt(p.chainId)) throw Error('wrong redemption chain');
  const code = await bounded(() => provider.getCode(n.wrapper, blockTag));
  if (code === '0x' || ethers.keccak256(code) !== n.wrapperCodeHash) throw Error('redemption wrapper runtime mismatch');
  return new ethers.Contract(n.wrapper, abi, provider);
}

export async function prepareNativeRedemption(pool, provider, swapId) {
  return transaction(pool, async db => {
    const {swap,row,p,n} = await context(db,swapId);
    await bounded(() => requireNativeDexEvidence(db,swapId,p,provider));
    const sender=lower(p.payoutSender), chainId=Number(swap.destination_chain);
    const token=await wrapper(provider,p,n);
    if (await bounded(() => provider.getCode(sender))!=='0x') throw Error('redemption EOA custody required');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${chainId}:${sender}`]);
    const saved=(await db.query('SELECT plan FROM native_redemptions WHERE swap_id=$1',[swapId])).rows[0];
    if(saved) return saved.plan;
    const dex=(await db.query('SELECT evidence FROM native_dex_executions WHERE swap_id=$1',[swapId])).rows[0].evidence;
    const amount=BigInt(swap.minimum_output);
    if(lower(dex.recipient)!==sender||lower(dex.token)!==lower(n.wrapper)||BigInt(dex.amount)<amount) throw Error('DEX native output insufficient');
    const reserved=(await db.query(`SELECT COALESCE(sum((plan->>'amount')::numeric),0)::text AS amount FROM native_redemptions
      WHERE chain_id=$1 AND sender=$2 AND evidence IS NULL`,[chainId,sender])).rows[0].amount;
    if(await bounded(() => token.balanceOf(sender))<BigInt(reserved)+amount) throw Error('redemption token funds reserved or unavailable');
    const nonce=await bounded(() => provider.getTransactionCount(sender,'pending'));
    if((await db.query("SELECT swap_id FROM native_redemptions WHERE chain_id=$1 AND sender=$2 AND plan->'transaction'->>'nonce'=$3 UNION ALL SELECT swap_id FROM native_payout_drafts WHERE chain_id=$1 AND sender=$2 AND nonce=$4",[chainId,sender,String(nonce),nonce])).rowCount) throw Error('redemption nonce reserved');
    const gasPrice=(await bounded(() => provider.getFeeData())).gasPrice;
    if(!gasPrice||gasPrice<=0n) throw Error('redemption fee unavailable');
    const tx={from:sender,to:lower(n.wrapper),chainId,nonce,type:0,value:'0',data:abi.encodeFunctionData('withdraw',[amount]),gasPrice:gasPrice.toString()};
    const gas=await bounded(() => provider.estimateGas(tx)), gasLimit=(gas*120n+99n)/100n;
    if(gas<=0n||gasLimit>BigInt(n.maxGas)) throw Error('redemption gas exceeds policy');
    const otherFunds=await outstandingNativeFunds(db,chainId,sender,gasPrice,swapId);
    if(await bounded(() => provider.getBalance(sender,'pending'))<otherFunds+(gasLimit+BigInt(p.maxPayoutGas))*gasPrice) throw Error('redemption gas funds unavailable');
    const plan={amount:amount.toString(),wrapper:lower(n.wrapper),dexTransactionHash:dex.transactionHash,transaction:{...tx,gasLimit:gasLimit.toString()}};
    await db.query('INSERT INTO native_redemptions(swap_id,policy_id,chain_id,sender,plan) VALUES($1,$2,$3,$4,$5)',[swapId,row.policy_id,chainId,sender,plan]);
    return plan;
  });
}

export async function bindSignedNativeRedemption(pool,swapId,raw) {
  if(typeof raw!=='string'||raw.length>8192||!/^0x[0-9a-f]+$/i.test(raw)) throw Error('invalid redemption bytes');
  const tx=ethers.Transaction.from(raw);
  if(!tx.isSigned()||tx.type!==0) throw Error('signed legacy redemption required');
  return transaction(pool,async db=>{
    await context(db,swapId);
    const saved=(await db.query('SELECT * FROM native_redemptions WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0], expected=saved?.plan.transaction;
    if(!expected||lower(tx.from)!==saved.sender||!tx.to||lower(tx.to)!==expected.to||tx.chainId!==BigInt(saved.chain_id)||tx.nonce!==expected.nonce||tx.value!==0n||tx.data!==expected.data||tx.gasLimit!==BigInt(expected.gasLimit)||tx.gasPrice!==BigInt(expected.gasPrice)) throw Error('redemption differs from original plan');
    if(saved.transaction_hash){if(saved.transaction_hash!==tx.hash) throw Error('conflicting redemption bytes'); return {transactionHash:tx.hash,alreadyBound:true};}
    await db.query('UPDATE native_redemptions SET transaction_hash=$2,nonce=$3 WHERE swap_id=$1',[swapId,tx.hash,tx.nonce]);
    return {transactionHash:tx.hash,alreadyBound:false};
  });
}

export async function submitBoundNativeRedemption(pool,provider,swapId,raw) {
  const bound=await bindSignedNativeRedemption(pool,swapId,raw), tx=ethers.Transaction.from(raw);
  return transaction(pool,async db=>{
    const {row,p,n}=await context(db,swapId);
    const token=await wrapper(provider,p,n);
    const known=await bounded(() => provider.getTransaction(bound.transactionHash));
    if(known){if(known.hash.toLowerCase()!==bound.transactionHash) throw Error('redemption RPC hash mismatch'); return {state:'submitted',transactionHash:bound.transactionHash};}
    await bounded(() => requireNativeDexEvidence(db,swapId,p,provider));
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${tx.chainId}:${tx.from.toLowerCase()}`]);
    if(await bounded(() => provider.getTransactionCount(tx.from,'pending'))!==tx.nonce) throw Error('redemption nonce changed');
    const amount=(await db.query('SELECT plan->>\'amount\' AS amount FROM native_redemptions WHERE swap_id=$1',[swapId])).rows[0].amount;
    const wrappedReserved=(await db.query(`SELECT COALESCE(sum((plan->>'amount')::numeric),0)::text AS amount FROM native_redemptions
      WHERE chain_id=$1 AND sender=$2 AND evidence IS NULL AND swap_id<>$3`,[Number(tx.chainId),tx.from.toLowerCase(),swapId])).rows[0].amount;
    if(await bounded(() => token.balanceOf(tx.from))<BigInt(amount)+BigInt(wrappedReserved)) throw Error('redemption wrapped funds unavailable');
    // Current fill's output is about to be supplied by withdrawal, so protect
    // other fills while requiring independent native gas funds for this call.
    const reserved=await outstandingNativeFunds(db,Number(tx.chainId),tx.from,tx.gasPrice,swapId);
    if(await bounded(() => provider.getBalance(tx.from,'pending'))<reserved+(tx.gasLimit+BigInt(p.maxPayoutGas))*tx.gasPrice) throw Error('redemption native gas funds reserved');
    if(await bounded(() => provider.estimateGas({from:tx.from,to:tx.to,data:tx.data,value:0n,nonce:tx.nonce,gasPrice:tx.gasPrice,type:0}))>tx.gasLimit) throw Error('redemption signed gas insufficient');
    if(!(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1',[row.policy_id])).rows[0].current) throw Error('redemption policy expired');
    try {const sent=await bounded(() => provider.broadcastTransaction(raw)); return {state:sent.hash?.toLowerCase()===bound.transactionHash?'submitted':'uncertain',transactionHash:bound.transactionHash};}
    catch {return {state:'uncertain',transactionHash:bound.transactionHash};}
  });
}

export async function verifyNativeRedemption(pool,provider,swapId) {
  return transaction(pool,async db=>{
    const {row,p,n}=await context(db,swapId,false);
    const saved=(await db.query('SELECT * FROM native_redemptions WHERE swap_id=$1 FOR UPDATE',[swapId])).rows[0];
    if(!saved?.transaction_hash) throw Error('bound redemption required');
    const [tx,receipt]=await bounded(() => Promise.all([provider.getTransaction(saved.transaction_hash),provider.getTransactionReceipt(saved.transaction_hash)]));
    if(!tx||!receipt||receipt.status!==1||tx.hash.toLowerCase()!==saved.transaction_hash||receipt.hash.toLowerCase()!==saved.transaction_hash) throw Error('redemption not mined successfully');
    const height=receipt.blockNumber, tip=await bounded(() => provider.getBlockNumber());
    if(!Number.isSafeInteger(height)||height<1||!Number.isSafeInteger(tip)||tip-height+1<n.confirmations||tx.blockNumber!==height||tx.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase()) throw Error('redemption not final');
    const block=await bounded(() => provider.getBlock(height));
    if(!block||block.hash.toLowerCase()!==receipt.blockHash.toLowerCase()) throw Error('redemption reorg');
    const token=await wrapper(provider,p,n,height), sender=saved.sender, amount=BigInt(saved.plan.amount), expected=saved.plan.transaction;
    if(lower(tx.from)!==sender||!tx.to||lower(tx.to)!==saved.plan.wrapper||tx.nonce!==Number(saved.nonce)||tx.chainId!==BigInt(saved.chain_id)||tx.value!==0n||tx.data!==expected.data) throw Error('redemption receipt plan mismatch');
    await bounded(() => requireNativeDexEvidence(db,swapId,p,provider));
    const [tokensBefore,tokensAfter,nativeBefore,nativeAfter]=await bounded(() => Promise.all([token.balanceOf(sender,{blockTag:height-1}),token.balanceOf(sender,{blockTag:height}),provider.getBalance(sender,height-1),provider.getBalance(sender,height)]));
    if(tokensBefore-tokensAfter<amount||nativeAfter-nativeBefore+receipt.gasUsed*receipt.gasPrice<amount) throw Error('wrapped debit/native credit not established');
    if((await bounded(() => provider.getBlock(height)))?.hash?.toLowerCase()!==block.hash.toLowerCase()) throw Error('redemption reorg during verification');
    const evidence={transactionHash:saved.transaction_hash,blockNumber:height,blockHash:block.hash,wrapper:saved.plan.wrapper,sender,amount:amount.toString(),dexTransactionHash:saved.plan.dexTransactionHash,policyId:row.policy_id};
    if(saved.evidence){if(saved.evidence.blockHash.toLowerCase()!==block.hash.toLowerCase()||saved.evidence.blockNumber!==height) throw Error('recorded redemption reorganized'); return {alreadyRecorded:true,evidence:saved.evidence};}
    await db.query('UPDATE native_redemptions SET evidence=$2 WHERE swap_id=$1',[swapId,evidence]);
    return {alreadyRecorded:false,evidence};
  });
}

export async function requireNativeRedemptionEvidence(db,provider,swapId,policy) {
  if(!policy.nativeOutput) return;
  const row=(await db.query('SELECT evidence FROM native_redemptions WHERE swap_id=$1',[swapId])).rows[0];
  if(!row?.evidence) throw Error('verified native redemption required');
  const e=row.evidence, [block,tip,network]=await bounded(() => Promise.all([provider.getBlock(e.blockNumber),provider.getBlockNumber(),provider.getNetwork()]));
  if(BigInt(network.chainId)!==BigInt(policy.chainId)||block?.hash?.toLowerCase()!==e.blockHash.toLowerCase()||!Number.isSafeInteger(tip)||!Number.isSafeInteger(e.blockNumber)||tip-e.blockNumber+1<policy.nativeOutput.confirmations||lower(e.wrapper)!==lower(policy.nativeOutput.wrapper)||lower(e.sender)!==lower(policy.payoutSender)) throw Error('native redemption evidence no longer canonical');
}
