export function isCosmosTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^[a-fA-F0-9]{64}$/.test(hash.trim());
}

export function normalizeEvmTxHash(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string') {
    return null;
  }

  const trimmed = hash.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    return `0x${trimmed.slice(2).toLowerCase()}`;
  }

  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return `0x${trimmed.toLowerCase()}`;
  }

  return null;
}

export function isEvmTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(hash.trim());
}

export function isValidTransactionHash(hash: string | null | undefined): hash is string {
  return isCosmosTxHash(hash) || normalizeEvmTxHash(hash) !== null;
}

export function pickValidTxHash(
  primary?: string | null,
  secondary?: string | null,
): string | undefined {
  const first = typeof primary === 'string' ? primary.trim() : '';
  if (isCosmosTxHash(first)) {
    return first;
  }
  const normalizedFirst = normalizeEvmTxHash(first);
  if (normalizedFirst) {
    return normalizedFirst;
  }

  const second = typeof secondary === 'string' ? secondary.trim() : '';
  if (isCosmosTxHash(second)) {
    return second;
  }
  const normalizedSecond = normalizeEvmTxHash(second);
  if (normalizedSecond) {
    return normalizedSecond;
  }

  return undefined;
}

export function sanitizeUpstreamMessage(message: unknown, fallback: string): string {
  if (typeof message !== 'string') {
    return fallback;
  }

  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 180) {
    return fallback;
  }

  if (
    /missing or invalid parameters/i.test(trimmed) ||
    /invalid params/i.test(trimmed) ||
    /json-rpc/i.test(trimmed) ||
    /rpc error/i.test(trimmed) ||
    /internal json-rpc error/i.test(trimmed) ||
    /^\{.*\}$/.test(trimmed) ||
    trimmed === '[object Object]'
  ) {
    return fallback;
  }

  return trimmed;
}
