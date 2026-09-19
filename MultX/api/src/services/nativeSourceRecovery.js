import { ethers } from 'ethers';

// Read-only recovery of a trusted persisted plan and its wallet transaction hashes.
// Never returns a transaction to broadcast, or infers that a missing hash was unsent.
export async function inspectNativeSourceProgress(provider, plan, hashes, confirmations) {
  if (!Array.isArray(plan?.steps) || plan.steps.length !== 3 ||
      plan.steps.map(s => s.kind).join(',') !== 'wrap,approve,lock' ||
      !Array.isArray(hashes) || hashes.length !== 3 ||
      !Number.isSafeInteger(confirmations) || confirmations < 1) throw Error('trusted source recovery inputs required');
  const seen = new Set();
  for (const hash of hashes) {
    if (hash == null) continue;
    if (!/^0x[0-9a-f]{64}$/i.test(hash) || seen.has(hash.toLowerCase())) throw Error('invalid or duplicate source hash');
    seen.add(hash.toLowerCase());
  }
  const chainId = BigInt((await provider.getNetwork()).chainId);
  if (plan.steps.some(s => BigInt(s.chainId) !== chainId)) throw Error('wrong source chain');
  const evidence = [];
  for (let i = 0; i < 3; i++) {
    const step = plan.steps[i], hash = hashes[i];
    if (hash == null) return { state: 'wallet_reconciliation_required', step: step.kind, evidence };
    const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
    if (!tx || !receipt) return { state: 'pending_or_unknown', step: step.kind, evidence };
    const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
    if (!same(tx.hash, hash) || !same(receipt.hash, hash) || !same(tx.from, step.from) ||
        !same(tx.to, step.to) || tx.value !== BigInt(step.value) || !same(tx.data, step.data) ||
        tx.chainId !== chainId) throw Error('source transaction does not match plan');
    if (receipt.status !== 1) return { state: 'transaction_failed', step: step.kind, evidence };
    const height = receipt.blockNumber;
    if (!Number.isSafeInteger(height) || height < 1 || tx.blockNumber !== height ||
        !same(tx.blockHash, receipt.blockHash)) throw Error('invalid source receipt block');
    const tip = await provider.getBlockNumber();
    if (!Number.isSafeInteger(tip) || tip < height) throw Error('invalid source tip');
    if (tip - height + 1 < confirmations) return { state: 'awaiting_finality', step: step.kind, evidence };
    const block = await provider.getBlock(height);
    if (!block || !same(block.hash, receipt.blockHash)) throw Error('source recovery reorg');
    evidence.push({ step: step.kind, transactionHash: hash.toLowerCase(), blockNumber: height, blockHash: block.hash });
  }
  // Recheck earlier blocks after all reads so a reorg during inspection fails closed.
  for (const e of evidence) {
    if ((await provider.getBlock(e.blockNumber))?.hash?.toLowerCase() !== e.blockHash.toLowerCase()) throw Error('source recovery reorg');
  }
  return { state: 'source_locked', evidence };
}
