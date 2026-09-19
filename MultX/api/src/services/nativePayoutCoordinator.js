import { ethers } from 'ethers';
import { prepareNativePayout } from './nativePayoutDraft.js';
import { submitBoundNativePayout } from './nativePayoutSubmission.js';

// Internal entry point for an already verified, payout-ready swap.
// Custody supplies signed bytes for the immutable request; it never broadcasts.
export async function coordinateNativePayout({ pool, provider, swapId, custody, sourcePolicy, sourceClient, submit = false }) {
  const swap = (await pool.query('SELECT state FROM native_swaps WHERE swap_id=$1', [swapId])).rows[0];
  if (swap?.state === 'completed') return { state: 'completed' };
  const { transaction } = await prepareNativePayout(pool, provider, swapId);
  const draft = (await pool.query('SELECT policy_id,custody_ref FROM native_payout_drafts WHERE swap_id=$1', [swapId])).rows[0];
  const { from, ...unsigned } = transaction;
  const unsignedHash = ethers.Transaction.from(unsigned).unsignedHash;
  const requestId = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify([
    'multx-native-payout-v1', swapId, draft.policy_id, draft.custody_ref, from.toLowerCase(), unsignedHash,
  ])));
  const request = { requestId, swapId, policyId: draft.policy_id, custodyRef: draft.custody_ref, transaction };
  if (!submit) return { state: 'prepared', request };
  if (!custody || custody.custodyRef !== draft.custody_ref || typeof custody.getSignedTransaction !== 'function') {
    throw Error('matching custody adapter required');
  }
  // Adapter must retain exactly the same bytes for this request across restarts.
  // Timeout/rejection is safe: the adapter has no broadcast responsibility.
  let timer;
  const serialized = await Promise.race([
    Promise.resolve().then(() => custody.getSignedTransaction(request)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('custody deadline exceeded')), 15000); }),
  ]).finally(() => clearTimeout(timer));
  if (serialized == null) return { state: 'awaiting_custody', request };
  return submitBoundNativePayout(pool, provider, swapId, serialized, sourcePolicy, sourceClient);
}
