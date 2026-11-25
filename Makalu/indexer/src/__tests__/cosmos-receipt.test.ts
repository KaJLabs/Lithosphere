import { describe, expect, it, vi } from 'vitest';
import { nativeTransferReceipt } from '../cosmos-receipt.js';
import { prefetchEvmTransactions } from '../evm-prefetch.js';

const hash = '0x' + '12'.repeat(32);
const tx = { hash, blockNumber: '0x64', to: '0x' + '34'.repeat(20), input: '0x', gasPrice: '0x1def744ed' };
const result = { code: 0, events: [
  { type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: hash }, { key: 'txGasUsed', value: '21000' }] },
  { type: 'tx_log', attributes: [{ key: 'msg_index', value: '0' }] },
] };

describe('confirmed native transfer execution', () => {
  it('uses the finalized execution event and explicit empty logs for a successful 21000-gas transfer', () => {
    expect(nativeTransferReceipt(tx, result, 100)).toEqual({ transactionHash: hash, blockNumber: '0x64',
      status: '0x1', gasUsed: '0x5208', effectiveGasPrice: tx.gasPrice, contractAddress: null, logs: [] });
  });
  it('falls back for contracts, failures, logs, ambiguous results and identity mismatches', () => {
    for (const changed of [{ ...tx, to: null }, { ...tx, input: '0xaabb' }, { ...tx, blockNumber: '0x65' }, { ...tx, gasPrice: undefined }]) {
      expect(nativeTransferReceipt(changed, result, 100)).toBeNull();
    }
    for (const changed of [
      { ...result, code: 1 }, { ...result, events: [] },
      { ...result, events: [...result.events, result.events[1]] },
      { ...result, events: [result.events[0], { type: 'tx_log', attributes: [{ key: 'txLog', value: '{}' }] }] },
      { ...result, events: [{ ...result.events[0], attributes: [...result.events[0].attributes, { key: 'ethereumTxFailed', value: 'execution reverted' }] }, result.events[1]] },
      { ...result, events: [{ ...result.events[0], attributes: [{ key: 'ethereumTxHash', value: '0x'+'56'.repeat(32) }, { key: 'txGasUsed', value: '21000' }] }, result.events[1]] },
      { ...result, events: [{ ...result.events[0], attributes: [{ key: 'ethereumTxHash', value: hash }, { key: 'txGasUsed', value: '22000' }] }, result.events[1]] },
    ]) expect(nativeTransferReceipt(tx, changed, 100)).toBeNull();
  });

  it('prepares a 231-transfer burst with one block read and no per-transaction receipt requests', async () => {
    const hashes = Array.from({ length: 231 }, (_, i) => '0x' + i.toString(16).padStart(64, '0'));
    const rpc = vi.fn(async (method: string) => method === 'eth_getBlockByNumber'
      ? { number: '0x64', transactions: hashes.map(hash => ({ ...tx, hash })) } : null);
    const batch = vi.fn(async () => { throw new Error('expensive receipt batch must not run'); });
    const details = await prefetchEvmTransactions(hashes, rpc as never, 4, 100, batch, transaction => nativeTransferReceipt(transaction as typeof tx, {
      ...result, events: [{ ...result.events[0], attributes: [{ key: 'ethereumTxHash', value: transaction.hash! }, { key: 'txGasUsed', value: '21000' }] }, result.events[1]],
    }, 100));
    expect(details.size).toBe(231);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
    expect(details.get(hashes[230])?.receipt).toMatchObject({ gasUsed: '0x5208', status: '0x1' });
  });

  it('still fetches the complete receipt and logs for a contract call in a mixed block', async () => {
    const contractHash = '0x'+'56'.repeat(32);
    const contract = { ...tx, hash: contractHash, input: '0xaabb' };
    const receipt = { transactionHash: contractHash, blockNumber: '0x64', logs: [{ data: '0xaabb' }] };
    const rpc = vi.fn(async (method: string) => method === 'eth_getBlockByNumber'
      ? { number: '0x64', transactions: [tx, contract] } : receipt);
    const details = await prefetchEvmTransactions([hash, contractHash], rpc as never, 4, 100, undefined,
      transaction => nativeTransferReceipt(transaction as typeof tx, result, 100));
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['eth_getBlockByNumber', 'eth_getTransactionReceipt']);
    expect(details.get(contractHash)?.receipt).toBe(receipt);
    expect(details.get(hash)?.receipt).toMatchObject({ logs: [], status: '0x1' });
  });
});
