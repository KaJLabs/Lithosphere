import { verifyAndRecordNativePayout } from './nativePayoutStore.js';

// Scan durable assignments, including broadcasts whose outcome was never saved.
// A cursor advances past pending/failed receipts so they cannot starve later swaps.
export async function reconcileNativePayoutBatch(pool, providers, { after = '', limit = 50, signal } = {}) {
  if (typeof after !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw Error('invalid reconciliation cursor or batch size');
  }
  const { rows } = await pool.query(`SELECT a.swap_id, a.chain_id
    FROM native_payout_assignments a JOIN native_swaps s USING (swap_id)
    WHERE s.state='payout_ready' AND a.state='assigned' AND a.swap_id > $1
    ORDER BY a.swap_id LIMIT $2`, [after, limit]);
  const results = [];
  let next = after;
  for (const row of rows) {
    if (signal?.aborted) return { results, next };
    const provider = providers.get(Number(row.chain_id));
    if (!provider) {
      results.push({ swapId: row.swap_id, state: 'provider_missing' });
    } else {
      try {
        await verifyAndRecordNativePayout(pool, provider, row.swap_id);
        results.push({ swapId: row.swap_id, state: 'completed' });
      } catch {
        // No completion on RPC failure, insufficient finality or invalid evidence.
        // Do not log arbitrary provider errors: they may contain credentialed URLs.
        results.push({ swapId: row.swap_id, state: 'unverified' });
      }
    }
    next = row.swap_id;
  }
  return { results, next: rows.length < limit ? '' : next };
}
