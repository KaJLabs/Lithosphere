import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverTxMemo } from '../tx-memo.js';

afterEach(() => { vi.unstubAllGlobals(); });
describe('historical transaction memo recovery', () => {
  it('recovers and caches the exact memo from the matching signed transaction', async () => {
    const hash = '85D2021E9996402CB31F04B6953753F91B8BDC28AF3B6C25168E7FFEE1F1C378';
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tx: { body: { memo: '123456' } }, tx_response: { txhash: hash },
    })));
    vi.stubGlobal('fetch', fetcher);
    expect(await recoverTxMemo({ memo: '' }, hash)).toEqual({ memo: '123456' });
    expect(await recoverTxMemo({ memo: '' }, hash)).toEqual({ memo: '123456' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never overwrites a stored memo', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await recoverTxMemo({ memo: '  reference\nمذكرة  ' }, 'a'.repeat(64))).toEqual({ memo: '  reference\nمذكرة  ' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not mistake a failed lookup or a different transaction for an empty memo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tx: { body: { memo: 'wrong' } }, tx_response: { txhash: 'c'.repeat(64) },
    }))));
    expect(await recoverTxMemo({ memo: '' }, 'b'.repeat(64))).toEqual({ memo: '', memoUnavailable: true });
  });
});
