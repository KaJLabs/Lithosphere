// Version 1 retains the accepted LITHO-origin topology. Version 2 is a new,
// explicit ETH/BNB/Base escrow-origin profile; never infer the origin.
function rolloutPolicy(input) {
  if (input.schemaVersion === 1) {
    if (input.sourceChainId !== undefined && input.sourceChainId !== 9005) throw new Error('legacy sourceChainId must be 9005');
    return {source:9005, chains:[9005,1,56,8453], destinations:[1,56,8453]};
  }
  if (input.schemaVersion !== 2) throw new Error('schemaVersion must be 1 or 2');
  if (input.rollout !== 'evm-first') throw new Error('schemaVersion 2 requires evm-first rollout');
  const chains = [1,56,8453];
  if (!chains.includes(input.sourceChainId)) throw new Error('explicit origin must be 1, 56 or 8453');
  return {source:input.sourceChainId, chains, destinations:chains.filter(id=>id!==input.sourceChainId)};
}
module.exports = {rolloutPolicy};
