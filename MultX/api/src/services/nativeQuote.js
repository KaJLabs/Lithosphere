import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { prepareNativeSourcePlan } from './nativeSourcePlan.js';
import { outstandingNativeFunds } from './nativeFunding.js';
import { quoteV2Routes } from './v2RouteQuote.js';

const address = value => {
  const result = ethers.getAddress(value).toLowerCase();
  if (result === ethers.ZeroAddress) throw Error('zero address forbidden');
  return result;
};
const units = (value, name) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) throw Error(`invalid ${name}`);
  return value;
};

function terms(policy) {
  const value = policy.quoteTerms;
  if (!value || !['prefunded-fixed-fill','dex-wrapped-native'].includes(value.fundingMode) || value.atomic !== false ||
      typeof value.fundingRef !== 'string' || !value.fundingRef.trim() ||
      typeof value.recoveryRef !== 'string' || !value.recoveryRef.trim() ||
      value.automaticTimeoutRefund !== false || !Array.isArray(value.fees) || value.fees.length !== 4) throw Error('approved quote terms required');
  const kinds = new Set();
  for (const fee of value.fees) {
    if (!['source-gas', 'destination-gas', 'bridge', 'protocol'].includes(fee.kind) || kinds.has(fee.kind) ||
        typeof fee.amountBaseUnits !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(fee.amountBaseUnits) ||
        BigInt(fee.amountBaseUnits) >= 2n ** 256n ||
        fee.chainId !== (fee.kind === 'source-gas' ? policy.sourceChain : policy.chainId) ||
        fee.accounting !== (fee.kind === 'source-gas' || (fee.kind === 'destination-gas' && value.fundingMode === 'dex-wrapped-native') ? 'separate-estimate' : 'included-in-fixed-output')) throw Error('invalid approved fee terms');
    kinds.add(fee.kind);
  }
  return { ...value, payoutSender: address(policy.payoutSender), nativeOutputAmount: units(policy.minimumNativeOutputBaseUnits, 'approved output') };
}

async function nativeDestinationQuote(provider, policy) {
  const n=policy.nativeOutput,d=policy.destinationDex;
  if(!provider||n?.kind!=='wrapped-native-redemption'||!d||address(n.wrapper)!==address(d.venue.tokenOut)||
      n.wrapperCodeHash!==d.venue.tokenOutCodeHash||typeof n.approvalRef!=='string'||!n.approvalRef.trim()) throw Error('native DEX delivery policy required');
  units(n.maxGas,'redemption gas'); units(d.maxGas,'DEX gas'); units(d.maxApprovalGas,'approval gas');
  const result=await quoteV2Routes(provider,[d.venue],{tokenIn:d.venue.tokenIn,tokenOut:d.venue.tokenOut,amountIn:policy.settlementAmountBaseUnits,slippageBps:d.slippageBps});
  const quote=result.quotes[0];
  if(!quote||BigInt(quote.minimumOutput)<BigInt(policy.minimumNativeOutputBaseUnits)||BigInt(d.minimumOutput)<BigInt(policy.minimumNativeOutputBaseUnits)) throw Error('native DEX output unavailable');
  if(await provider.getBalance(n.wrapper)<BigInt(policy.minimumNativeOutputBaseUnits)) throw Error('native wrapper backing unavailable');
  return quote;
}

// Registry chooses both policies. The wallet may choose amounts and recipient,
// but they must exactly fit the already-approved, funded fixed route snapshot.
export async function createNativeQuote(pool, sourceProvider, policyId, sourceInputPolicy, request, destinationProvider) {
  const wallet = address(request.wallet), recipient = address(request.recipient);
  const inputAmount = units(request.inputAmount, 'input amount');
  const minimumOutput = units(request.minimumOutput, 'minimum output');
  if (!Number.isSafeInteger(request.sourceChain) || !Number.isSafeInteger(request.destinationChain) || request.sourceChain <= 0 || request.destinationChain <= 0 || request.sourceChain === request.destinationChain) throw Error('invalid quote chains');
  const row = (await pool.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1', [policyId])).rows[0];
  const p = row?.policy;
  const quoteTerms = terms(p ?? {});
  if (!row?.enabled || !row.current || p?.mode !== 'direct-native-payout' ||
      p.sourceChain !== request.sourceChain || p.chainId !== request.destinationChain ||
      p.sourceAmountBaseUnits !== inputAmount || BigInt(p.minimumNativeOutputBaseUnits) < BigInt(minimumOutput)) throw Error('approved funded quote route unavailable');
  const plan = await prepareNativeSourcePlan(sourceProvider, sourceInputPolicy, { sender: wallet, amountBaseUnits: inputAmount, targetChain: request.destinationChain });
  if(quoteTerms.fundingMode==='dex-wrapped-native' &&
     (address(p.settlementHolder)!==wallet || p.settlementAmountBaseUnits!==inputAmount)) throw Error('native bridge requires original wallet and unchanged settlement amount');
  const destinationQuote=quoteTerms.fundingMode==='dex-wrapped-native'?await nativeDestinationQuote(destinationProvider,p):null;
  if (sourceInputPolicy.chainId !== request.sourceChain || address(sourceInputPolicy.bridge) !== address(p.sourceBridge) || address(sourceInputPolicy.wrapper) !== address(p.sourceToken)) throw Error('quote source policy mismatch');
  const now = Date.now(), expires = Math.min(new Date(row.expires_at).getTime(), plan.expiresAt * 1000, now + 60_000, destinationQuote?destinationQuote.expiresAt*1000:Infinity);
  if (expires <= now + 5_000) throw Error('quote lifetime too short');
  const quoteId = '0x' + randomBytes(32).toString('hex');
  if (recipient === quoteTerms.payoutSender || !Array.isArray(p.excludedRecipients) || p.excludedRecipients.map(address).includes(recipient)) throw Error('quote recipient excluded');
  const normalized = { sourceChain: request.sourceChain, destinationChain: request.destinationChain, wallet, recipient, inputAmount, minimumOutput, terms: { ...quoteTerms, claimant: wallet, ...(destinationQuote?{destinationQuote}:{}) } };
  await pool.query('INSERT INTO native_quotes(quote_id,wallet,policy_id,request,source_plan,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [quoteId, wallet, policyId, normalized, plan, new Date(expires)]);
  return { quoteId, policyId, ...normalized, expiresAt: expires, sourcePlan: plan };
}

export async function acceptNativeQuote(pool, quoteId, wallet, registry) {
  if (!/^0x[0-9a-f]{64}$/.test(quoteId ?? '')) throw Error('invalid quote id');
  const owner = address(wallet), db = await pool.connect();
  try {
    await db.query('BEGIN'); await db.query("SET LOCAL lock_timeout='5s'");
    const quote = (await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_quotes WHERE quote_id=$1 FOR UPDATE', [quoteId])).rows[0];
    if (!quote || quote.wallet !== owner) throw Error('quote not owned');
    if (quote.accepted_at) { await db.query('COMMIT'); return { swapId: quoteId, alreadyAccepted: true }; }
    const policy = (await db.query('SELECT *,expires_at>clock_timestamp() AS current FROM native_route_policies WHERE policy_id=$1 FOR UPDATE', [quote.policy_id])).rows[0];
    if (!quote.current || !policy?.enabled || !policy.current) throw Error('quote expired or route disabled');
    const r = quote.request;
    if ((await db.query('SELECT quote_id FROM native_quotes WHERE policy_id=$1 AND accepted_at IS NOT NULL', [quote.policy_id])).rowCount) throw Error('fixed fill already reserved');
    const selected = await registry.resolve(r, owner, quote.policy_id);
    if (selected.policyId !== quote.policy_id || !selected.destinationProvider) throw Error('quote registry changed');
    const fresh = await prepareNativeSourcePlan(selected.provider, selected.sourceInputPolicy, { sender: owner, amountBaseUnits: r.inputAmount, targetChain: r.destinationChain });
    if (JSON.stringify(fresh) !== JSON.stringify(quote.source_plan)) {
      // JSONB key ordering differs from JS. Compare structurally in PostgreSQL.
      if (!(await db.query('SELECT $1::jsonb=$2::jsonb AS matches', [fresh, quote.source_plan])).rows[0].matches) throw Error('quote source changed');
    }
    const payout = terms(policy.policy), provider = selected.destinationProvider;
    if(payout.fundingMode==='dex-wrapped-native') await nativeDestinationQuote(provider,policy.policy);
    if (BigInt((await provider.getNetwork()).chainId) !== BigInt(r.destinationChain)) throw Error('wrong funding chain');
    if (await provider.getCode(payout.payoutSender) !== '0x' || await provider.getCode(r.recipient) !== '0x') throw Error('unsupported payout parties');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${r.destinationChain}:${payout.payoutSender}`]);
    const feeData = await provider.getFeeData(), gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!gasPrice || gasPrice <= 0n) throw Error('funding fee unavailable');
    const reserved = await outstandingNativeFunds(db,r.destinationChain,payout.payoutSender,gasPrice);
    const gasLimit = BigInt(units(policy.policy.maxPayoutGas, 'payout gas'));
    const market=payout.fundingMode==='dex-wrapped-native';
    const userGas=market?BigInt(units(policy.policy.destinationDex.maxGas,'DEX gas'))+BigInt(units(policy.policy.destinationDex.maxApprovalGas,'approval gas')):0n;
    const gasBudget=gasLimit+(market?BigInt(policy.policy.nativeOutput.maxGas)+(owner===payout.payoutSender?userGas:0n):0n);
    if (await provider.getBalance(payout.payoutSender, 'pending') < reserved + (market?0n:BigInt(payout.nativeOutputAmount)) + gasBudget * gasPrice) throw Error('unreserved native funds unavailable');
    if(market && owner!==payout.payoutSender){
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${r.destinationChain}:${owner}`]);
      const userReserved=await outstandingNativeFunds(db,r.destinationChain,owner,gasPrice);
      if(await provider.getCode(owner)!=='0x'||await provider.getBalance(owner,'pending')<userReserved+userGas*gasPrice)throw Error('destination wallet gas unavailable');
    }
    if (!(await db.query('SELECT expires_at>clock_timestamp() AS current FROM native_quotes WHERE quote_id=$1', [quoteId])).rows[0].current) throw Error('quote expired during acceptance');
    // Pay the approved fixed output, even when the user's tolerance is lower.
    await db.query('INSERT INTO native_swaps(swap_id,destination_chain,recipient,minimum_output) VALUES($1,$2,$3,$4)', [quoteId, r.destinationChain, r.recipient, payout.nativeOutputAmount]);
    await db.query('INSERT INTO native_source_intents(swap_id,plan) VALUES($1,$2)', [quoteId, quote.source_plan]);
    await db.query('UPDATE native_quotes SET accepted_at=now() WHERE quote_id=$1', [quoteId]);
    await db.query('COMMIT'); return { swapId: quoteId, alreadyAccepted: false };
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
