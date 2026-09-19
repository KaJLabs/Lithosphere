import { ethers } from 'ethers';

// All providers and source policies come from reviewed server configuration.
// Database route approvals remain immutable; no wallet request supplies addresses.
export function createNativeRegistry({ pool, providers, sourcePolicies }) {
  if (!(providers instanceof Map) || !(sourcePolicies instanceof Map)) throw Error('native registry maps required');
  async function selected(policyId, policy) {
    const provider = providers.get(policy.sourceChain), destinationProvider = providers.get(policy.chainId);
    const sourceInputPolicy = sourcePolicies.get(policy.sourceChain);
    if (!provider || !destinationProvider || !sourceInputPolicy || sourceInputPolicy.chainId !== policy.sourceChain ||
        ethers.getAddress(sourceInputPolicy.bridge) !== ethers.getAddress(policy.sourceBridge) ||
        ethers.getAddress(sourceInputPolicy.wrapper) !== ethers.getAddress(policy.sourceToken) ||
        sourceInputPolicy.confirmations !== policy.sourceConfirmations ||
        !Number.isSafeInteger(policy.sourceConfirmations) || policy.sourceConfirmations < 1) throw Error('reviewed source registry unavailable');
    return { provider, destinationProvider, policyId, sourceInputPolicy, confirmations: policy.sourceConfirmations };
  }
  const quotes = { resolve: async (request, wallet, policyId) => {
    const rows = (await pool.query(`SELECT p.policy_id,p.policy FROM native_route_policies p
      WHERE p.enabled AND p.expires_at>clock_timestamp() AND p.policy->>'mode'='direct-native-payout'
       AND p.policy->>'sourceChain'=$1 AND p.policy->>'chainId'=$2 AND p.policy->>'sourceAmountBaseUnits'=$3
       AND ($4::text IS NULL OR p.policy_id=$4)
       AND NOT EXISTS(SELECT 1 FROM native_quotes q WHERE q.policy_id=p.policy_id AND q.accepted_at IS NOT NULL)
      ORDER BY p.policy_id`, [String(request.sourceChain), String(request.destinationChain), request.inputAmount, policyId ?? null])).rows;
    const eligible = rows.filter(row => ['prefunded-fixed-fill','dex-wrapped-native'].includes(row.policy.quoteTerms?.fundingMode) &&
      (row.policy.quoteTerms.fundingMode !== 'dex-wrapped-native' ||
        (typeof row.policy.settlementHolder === 'string' && row.policy.settlementHolder.toLowerCase() === wallet.toLowerCase())) &&
      /^[1-9][0-9]{0,77}$/.test(row.policy.minimumNativeOutputBaseUnits ?? '') &&
      /^[1-9][0-9]{0,77}$/.test(request.minimumOutput ?? '') &&
      BigInt(row.policy.minimumNativeOutputBaseUnits) >= BigInt(request.minimumOutput));
    eligible.sort((a,b) => BigInt(a.policy.minimumNativeOutputBaseUnits)>BigInt(b.policy.minimumNativeOutputBaseUnits)?-1:BigInt(a.policy.minimumNativeOutputBaseUnits)<BigInt(b.policy.minimumNativeOutputBaseUnits)?1:0);
    if (!eligible.length) throw Error('approved native fill unavailable');
    return selected(eligible[0].policy_id, eligible[0].policy);
  } };
  const source = { resolve: async swapId => {
    const row = (await pool.query(`SELECT q.request,q.policy_id,p.policy,i.plan,p.enabled,p.expires_at>clock_timestamp() AS current
      FROM native_quotes q JOIN native_route_policies p USING(policy_id)
      JOIN native_source_intents i ON i.swap_id=q.quote_id
      WHERE q.quote_id=$1 AND q.accepted_at IS NOT NULL`, [swapId])).rows[0];
    if (!row) throw Error('accepted native quote required');
    const config = await selected(row.policy_id, row.policy);
    return { provider: config.provider, policy: {...config.sourceInputPolicy,enabled:config.sourceInputPolicy.enabled&&row.enabled&&row.current}, confirmations: config.confirmations,
      input: {sender: row.plan.sender, amountBaseUnits: row.request.inputAmount, targetChain: row.request.destinationChain} };
  } };
  const destination = { resolve: async swapId => {
    const row=(await pool.query(`SELECT p.policy_id,p.policy FROM native_swaps s
      JOIN native_route_policies p ON p.policy_id=s.route_policy_ref WHERE s.swap_id=$1`,[swapId])).rows[0];
    if(!row)throw Error('verified destination route required');
    const config=await selected(row.policy_id,row.policy),p=row.policy;
    const sourcePolicy={chainId:p.sourceChain,bridgeAddress:p.sourceBridge,confirmations:p.sourceConfirmations};
    const sourceClient={provider:config.provider,contract:new ethers.Contract(p.sourceBridge,
      ['event TokensLocked(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 targetChain,uint256 nonce)'],config.provider)};
    return {provider:config.destinationProvider,sourcePolicy,sourceClient};
  } };
  return { quotes, source, destination };
}
