import { ethers } from 'ethers';

const fail = message => { throw new Error(message); };
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : fail('invalid transaction/block hash');
const address = value => {
  const normalized = ethers.getAddress(value);
  if (normalized === ethers.ZeroAddress) fail('zero address');
  return normalized.toLowerCase();
};
const units = value => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) fail('invalid native amount');
  return BigInt(value);
};

// Read-only direct native payout verification. expected must come from the durable,
// trusted payout assignment, never a client-supplied quote. No completion is persisted.
export async function verifyDirectNativePayout(provider, expected) {
  if (expected?.mode !== 'direct-native' || typeof expected.swapId !== 'string' || !expected.swapId.trim()) fail('trusted payout assignment required');
  if (!Number.isSafeInteger(expected.chainId) || expected.chainId <= 0) fail('invalid chain');
  if (!Number.isSafeInteger(expected.confirmations) || expected.confirmations < 1) fail('approved confirmations required');
  if (!Number.isSafeInteger(expected.nonce) || expected.nonce < 0) fail('assigned nonce required');
  const txHash = hash(expected.transactionHash);
  const recipient = address(expected.recipient), sender = address(expected.sender);
  if (recipient === sender) fail('self payout forbidden');
  const minimum = units(expected.minimumOutputBaseUnits);
  if (BigInt((await provider.getNetwork()).chainId) !== BigInt(expected.chainId)) fail('wrong destination chain');
  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
  if (!tx || !receipt) fail('payout not mined');
  if (hash(tx.hash) !== txHash || hash(receipt.hash) !== txHash || receipt.status !== 1) fail('failed or mismatched payout');
  if (address(tx.from) !== sender || address(tx.to) !== recipient || tx.nonce !== expected.nonce) fail('payout assignment mismatch');
  if (tx.data !== '0x' || BigInt(tx.value) < minimum) fail('not qualifying direct native payout');
  const height = receipt.blockNumber;
  if (!Number.isSafeInteger(height) || height < 1 || tx.blockNumber !== height || hash(tx.blockHash) !== hash(receipt.blockHash)) fail('invalid mined block');
  const tip = await provider.getBlockNumber();
  if (tip - height + 1 < expected.confirmations) fail('payout not final enough');
  const block = await provider.getBlock(height);
  if (!block || hash(block.hash) !== hash(receipt.blockHash)) fail('payout reorged');
  // Contract recipients need execution traces/accounting specific to their adapter.
  if (await provider.getCode(recipient, height) !== '0x') fail('contract recipient unsupported');
  const [before, after] = await Promise.all([
    provider.getBalance(recipient, height - 1), provider.getBalance(recipient, height),
  ]);
  if (BigInt(after) - BigInt(before) < BigInt(tx.value)) fail('native credit not established');
  const checked = await provider.getBlock(height);
  if (!checked || hash(checked.hash) !== hash(block.hash)) fail('payout reorged during verification');
  return Object.freeze({ swapId: expected.swapId, chainId: expected.chainId,
    transactionHash: txHash, blockNumber: height, blockHash: hash(block.hash),
    recipient, amountBaseUnits: BigInt(tx.value).toString(),
    evidenceKey: `${expected.chainId}:${txHash}`, verification: 'direct-native-credit',
  });
}
