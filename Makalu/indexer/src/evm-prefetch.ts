export interface EvmDetails<T, R> {
  tx?: T | null;
  receipt?: R | null;
  error?: unknown;
}

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
): Promise<Map<string, EvmDetails<T, R>>> {
  const unique = [...new Set(hashes.filter(hash => typeof hash === 'string' && hash.length > 0))];
  const results = new Map<string, EvmDetails<T, R>>();
  const limit = Math.min(4, Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1));
  const blockTransactions = new Map<string, T>();
  if (unique.length > 1 && height !== undefined && Number.isSafeInteger(height) && height > 0) {
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
  const receiptOnly = unique.every(hash => blockTransactions.has(hash.toLowerCase()));
  const workerLimit = receiptOnly ? limit * 2 : limit;
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const hash = unique[next++];
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
