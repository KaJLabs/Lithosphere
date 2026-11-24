import { describe, expect, it, vi } from 'vitest';
import { prefetchEvmTransactions } from '../evm-prefetch.js';

describe('busy block prefetch', () => {
  it('loads all 24 transactions and receipts with two block RPC calls', async () => {
    const hashes = Array.from({ length: 24 }, (_, i) => '0x' + i.toString(16).padStart(64, '0'));
    const rpc = vi.fn(async (method: string) => method === 'eth_getBlockByNumber'
      ? { number: '0x64', transactions: hashes.map(hash => ({ hash, blockNumber: '0x64' })) }
      : method === 'eth_getBlockReceipts' ? hashes.map(transactionHash => ({ transactionHash, blockNumber: '0x64' })) : null);
    const result = await prefetchEvmTransactions(hashes, rpc as never, 4, 100);
    expect(result.size).toBe(24);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.get(hashes[23])?.receipt).toMatchObject({ transactionHash: hashes[23] });
  });
  it('uses one receipt batch when the endpoint lacks block receipts and retries only missing entries', async () => {
    const hashes = ['0x' + '12'.repeat(32), '0x' + '34'.repeat(32)];
    const rpc = vi.fn(async (method: string, params: unknown[]) => method === 'eth_getBlockByNumber'
      ? { number: '0x64', transactions: hashes.map(hash => ({ hash, blockNumber: '0x64' })) }
      : method === 'eth_getTransactionReceipt' ? { transactionHash: params[0], blockNumber: '0x64' } : null);
    const batch = vi.fn(async () => [{ transactionHash: hashes[0], blockNumber: '0x64' }, null]);
    const result = await prefetchEvmTransactions(hashes, rpc as never, 4, 100, batch as never);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([method]) => method === 'eth_getTransactionReceipt')).toEqual([['eth_getTransactionReceipt', [hashes[1]]]]);
    expect(result.size).toBe(2);
    expect(result.get(hashes[1])?.receipt).toMatchObject({ transactionHash: hashes[1] });
  });
});
