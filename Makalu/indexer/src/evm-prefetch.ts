export interface EvmDetails<T, R> {
  tx?: T | null;
  receipt?: R | null;
  error?: unknown;
}

const bulkReceiptRetryAt = new WeakMap<object, number>();

export function createSingleFlightTask(onError: (error: unknown) => void) {
  let running = false;
  return {
    run(task: () => unknown | Promise<unknown>): boolean {
      if (running) return false;
      running = true;
      void Promise.resolve().then(task).catch(onError).finally(() => { running = false; });
      return true;
    },
  };
}

/** Fetch immutable metadata before ordered writes, with at most eight RPC calls. */
export async function prefetchEvmTransactions<T extends { hash?: string; blockNumber?: string }, R>(
  hashes: string[],
  readRpc: <V>(method: string, params: unknown[]) => Promise<V | null>,
  concurrency = 4,
  height?: number,
  readBatch?: <V>(method: string, params: unknown[][]) => Promise<Array<V | null>>,
  receiptFromTransaction?: (transaction: T) => R | null,
): Promise<Map<string, EvmDetails<T, R>>> {
  let unique = [...new Set(hashes.filter(hash => typeof hash === 'string' && hash.length > 0))];
  const results = new Map<string, EvmDetails<T, R>>();
  const limit = Math.min(4, Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1));
  const blockTransactions = new Map<string, T>();
  if (unique.length > 0 && (unique.length > 1 || receiptFromTransaction) && height !== undefined && Number.isSafeInteger(height) && height > 0) {
    try {
      const block = await readRpc<{ number: string; transactions: T[] }>(
        'eth_getBlockByNumber', ['0x' + height.toString(16), true],
      );
      if (block && BigInt(block.number) === BigInt(height) && Array.isArray(block.transactions)) {
        for (const tx of block.transactions) {
          if (tx && typeof tx.hash === 'string' && tx.blockNumber && BigInt(tx.blockNumber) === BigInt(height)) {
            blockTransactions.set(tx.hash.toLowerCase(), tx);
          }
        }
      }
    } catch {
      blockTransactions.clear();
    }
  }
  if (receiptFromTransaction) {
    for (const hash of unique) {
      const tx = blockTransactions.get(hash.toLowerCase());
      const receipt = tx ? receiptFromTransaction(tx) : null;
      if (tx && receipt) results.set(hash, { tx, receipt });
    }
    unique = unique.filter(hash => !results.has(hash));
    if (unique.length === 0) return results;
  }
  const receiptOnly = unique.every(hash => blockTransactions.has(hash.toLowerCase()));
  if (receiptOnly && unique.length > 1 && height !== undefined
      && (bulkReceiptRetryAt.get(readRpc) ?? 0) <= Date.now()) {
    try {
      const receipts = await readRpc<Array<R & { transactionHash?: string; blockNumber?: string }>>(
        'eth_getBlockReceipts', ['0x' + height.toString(16)],
      );
      if (Array.isArray(receipts)) {
        const byHash = new Map(receipts.filter(r => r?.transactionHash && r.blockNumber
          && BigInt(r.blockNumber) === BigInt(height)).map(r => [r.transactionHash!.toLowerCase(), r]));
        if (unique.every(hash => byHash.has(hash.toLowerCase()))) {
          for (const hash of unique) results.set(hash, {
            tx: blockTransactions.get(hash.toLowerCase()), receipt: byHash.get(hash.toLowerCase()),
          });
          return results;
        }
      }
    } catch { /* Endpoint may not implement block receipts; use bounded fallback. */ }
    // Avoid probing an unsupported or incomplete method on every block.
    bulkReceiptRetryAt.set(readRpc, Date.now() + 600_000);
  }
  if (receiptOnly && unique.length > 1 && height !== undefined && readBatch) {
    try {
      const receipts = await readBatch<R & { transactionHash?: string; blockNumber?: string }>(
        'eth_getTransactionReceipt', unique.map(hash => [hash]),
      );
      for (const [i, hash] of unique.entries()) {
        const receipt = receipts[i];
        if (receipt?.transactionHash?.toLowerCase() === hash.toLowerCase() && receipt.blockNumber
            && BigInt(receipt.blockNumber) === BigInt(height)) {
          results.set(hash, { tx: blockTransactions.get(hash.toLowerCase()), receipt });
        }
      }
    } catch { /* Malformed/unsupported batch: bounded individual lookups below. */ }
  }
  const workerLimit = receiptOnly ? limit * 2 : limit;
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const hash = unique[next++];
      if (results.has(hash)) continue;
      try {
        const pair = await Promise.allSettled([
          blockTransactions.has(hash.toLowerCase())
            ? Promise.resolve(blockTransactions.get(hash.toLowerCase())!)
            : readRpc<T>('eth_getTransactionByHash', [hash]),
          readRpc<R>('eth_getTransactionReceipt', [hash]),
        ]);
        const [tx, receipt] = pair;
        if (tx.status === 'rejected') results.set(hash, { error: tx.reason });
        else if (receipt.status === 'rejected') results.set(hash, { error: receipt.reason });
        else results.set(hash, { tx: tx.value, receipt: receipt.value });
      } catch (error) {
        results.set(hash, { error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerLimit, unique.length) }, worker));
  return results;
}
