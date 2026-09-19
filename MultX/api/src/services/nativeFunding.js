// Caller holds the per-chain/sender advisory lock. Reserve all outstanding quote
// outputs and payout gas, plus non-quote drafts, across cooperating writers.
export async function outstandingNativeFunds(db, chainId, sender, gasPrice, excludeSwap = '') {
  const row = (await db.query(`SELECT COALESCE(sum(amount),0)::text AS amount FROM (
    SELECT CASE WHEN q.request->'terms'->>'fundingMode'='dex-wrapped-native' AND r.evidence IS NULL
      THEN 0 ELSE (q.request->'terms'->>'nativeOutputAmount')::numeric END +
      ((p.policy->>'maxPayoutGas')::numeric + CASE WHEN q.request->'terms'->>'fundingMode'='dex-wrapped-native' AND r.evidence IS NULL
        THEN (p.policy->'nativeOutput'->>'maxGas')::numeric+CASE WHEN lower(p.policy->>'settlementHolder')=$2
          THEN (p.policy->'destinationDex'->>'maxGas')::numeric+(p.policy->'destinationDex'->>'maxApprovalGas')::numeric ELSE 0 END ELSE 0 END) * $3::numeric AS amount
    FROM native_quotes q JOIN native_swaps s ON s.swap_id=q.quote_id
    JOIN native_route_policies p USING(policy_id)
    LEFT JOIN native_redemptions r ON r.swap_id=s.swap_id
    WHERE q.accepted_at IS NOT NULL AND s.state<>'completed' AND s.destination_chain=$1
      AND q.request->'terms'->>'payoutSender'=$2 AND s.swap_id<>$4
    UNION ALL
    SELECT ((p.policy->'destinationDex'->>'maxGas')::numeric+
      (p.policy->'destinationDex'->>'maxApprovalGas')::numeric)*$3::numeric AS amount
    FROM native_quotes q JOIN native_swaps s ON s.swap_id=q.quote_id
    JOIN native_route_policies p USING(policy_id)
    LEFT JOIN native_dex_executions x ON x.swap_id=s.swap_id
    WHERE q.accepted_at IS NOT NULL AND s.state<>'completed' AND s.destination_chain=$1 AND s.swap_id<>$4
      AND q.request->'terms'->>'fundingMode'='dex-wrapped-native' AND x.evidence IS NULL
      AND lower(p.policy->>'settlementHolder')=$2 AND q.request->'terms'->>'payoutSender'<>$2
    UNION ALL
    SELECT (d.transaction->>'value')::numeric + (d.transaction->>'gasLimit')::numeric *
      (d.transaction->>'gasPrice')::numeric AS amount
    FROM native_payout_drafts d JOIN native_swaps s USING(swap_id)
    WHERE d.chain_id=$1 AND d.sender=$2 AND s.state<>'completed' AND s.swap_id<>$4
      AND NOT EXISTS(SELECT 1 FROM native_quotes q WHERE q.quote_id=s.swap_id AND q.accepted_at IS NOT NULL)
  ) commitments`, [chainId, sender.toLowerCase(), gasPrice.toString(), excludeSwap])).rows[0];
  return BigInt(row.amount);
}
