const cache = new Map<string, { memo: string; expiresAt: number }>();

/** Older indexer versions omitted TxBody.memo. Recover it from the same chain's LCD. */
export async function recoverTxMemo<T extends { memo?: string }>(
  tx: T, cosmosHash: string | null | undefined,
): Promise<T & { memoUnavailable?: boolean }> {
  if (tx.memo || !cosmosHash || !/^[a-f\d]{64}$/i.test(cosmosHash)) return tx;
  const rpc = process.env.RPC_URL || process.env.LITHO_RPC_URL || 'https://rpc.litho.ai';
  const lcd = (process.env.REST_URL || process.env.LCD_URL ||
    (process.env.NETWORK === 'mainnet' ? 'https://api-mainnet.litho.ai' : rpc.replace('://rpc.', '://api.'))).replace(/\/$/, '');
  const hash = cosmosHash.toUpperCase();
  const key = `${lcd}:${hash}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { ...tx, memo: hit.memo };
  try {
    const response = await fetch(`${lcd}/cosmos/tx/v1beta1/txs/${hash}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Transaction lookup unavailable');
    const data = await response.json() as {
      tx?: { body?: { memo?: unknown } };
      tx_response?: { txhash?: string };
    };
    if (data.tx_response?.txhash?.toUpperCase() !== hash || typeof data.tx?.body?.memo !== 'string') {
      throw new Error('Invalid transaction response');
    }
    const memo = data.tx.body.memo;
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { memo, expiresAt: Date.now() + 300_000 });
    return { ...tx, memo };
  } catch {
    // Failure is not evidence that the signed transaction has an empty memo.
    return { ...tx, memoUnavailable: true };
  }
}
