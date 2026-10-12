import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../db.js', () => ({ query: vi.fn(), slowQuery: vi.fn(), getPool: vi.fn() }));
const { query } = await import('../db.js');
const { explorerRouter } = await import('../routes.js');
const mockQuery = vi.mocked(query);
const app = () => express().use('/api', explorerRouter());
beforeEach(() => { mockQuery.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('client-reported explorer regressions', () => {
  it('preserves sub-LITHO validator voting power', async () => {
    mockQuery.mockResolvedValueOnce([{ operator_address: 'lithovaloper1example', moniker: 'validator1',
      tokens: '990000000000000000', commission_rate: '0.1', status: 2 }]);
    const response = await request(app()).get('/api/validators');
    expect(response.body[0].votingPower).toBe('0.99');
  });
  it.each(['tokens', 'uptime', 'commission', 'missed'])('sort=%s treats stake as numeric and places missing stake last', async (sort) => {
    mockQuery.mockResolvedValue([]);
    const response = await request(app()).get(`/api/validators?sort=${sort}`);
    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tokens::numeric DESC NULLS LAST'), []);
    if (sort === 'commission') expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('commission_rate::numeric ASC NULLS LAST'), []);
  });
  it('returns the signed body memo for the reported historical MsgSend', async () => {
    const hash = '85D2021E9996402CB31F04B6953753F91B8BDC28AF3B6C25168E7FFEE1F1C378';
    mockQuery.mockResolvedValueOnce([{
      hash, block_height: '12050204', sender: 'litho1sender', receiver: 'litho1receiver',
      amount: '10000000000000000', denom: 'ulitho', fee: '1500000', gas_used: '116180',
      gas_wanted: '150000', success: true, tx_type: 'MsgSend', memo: '',
      timestamp: new Date('2026-10-12T07:50:08.683Z'), evm_hash: null,
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tx: { body: { memo: '123456' } }, tx_response: { txhash: hash },
    }))));
    const response = await request(app()).get(`/api/txs/${hash}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ hash, memo: '123456', value: '10000000000000000', feePaid: '1500000' });
  });
});
