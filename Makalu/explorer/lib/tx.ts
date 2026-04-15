export function isCosmosTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^[a-fA-F0-9]{64}$/.test(hash.trim());
}

export function isEvmTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(hash.trim());
}

export function isValidTransactionHash(hash: string | null | undefined): hash is string {
  return isCosmosTxHash(hash) || isEvmTxHash(hash);
}

export function getPreferredTxHash(tx: {
  hash?: string | null;
  evmHash?: string | null;
}): string | null {
  const primary = typeof tx.hash === 'string' ? tx.hash.trim() : '';
  if (isValidTransactionHash(primary)) {
    return primary;
  }

  const fallback = typeof tx.evmHash === 'string' ? tx.evmHash.trim() : '';
  if (isEvmTxHash(fallback)) {
    return fallback;
  }

  return null;
}
