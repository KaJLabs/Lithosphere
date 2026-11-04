import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
vi.mock('../db.js', () => ({ query: vi.fn(), slowQuery: vi.fn(), getPool: vi.fn() }));
const { query } = await import('../db.js');
const { explorerRouter } = await import('../routes.js');
const contract = '0x' + 'ab'.repeat(20);
let app: express.Express;
beforeEach(() => { vi.mocked(query).mockReset(); app = express().use(express.json()).use('/api', explorerRouter()); });
async function session(wallet: Pick<Wallet, 'address' | 'signMessage'>) {
  const nonce = (await request(app).get('/api/auth/nonce').query({ address: wallet.address })).text;
  const message = `Verify token deployer\nChain ID: 700777\nNonce: ${nonce}`;
  const result = await request(app).post('/api/auth/verify').send({ address: wallet.address, message, signature: await wallet.signMessage(message) });
  expect(result.status).toBe(200);
  return result.body.sessionToken;
}
it('rejects unauthenticated and forged badge claims without touching the database', async () => {
  for (const token of ['', 'forged.token']) {
    const result = await request(app).post(`/api/tokens/${contract}/verify-deployer`).set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(401);
  }
  expect(query).not.toHaveBeenCalled();
});
it('binds wallet ownership to the recorded contract deployer', async () => {
  const wallet = Wallet.createRandom();
  const auth = await session(wallet);
  vi.mocked(query).mockResolvedValueOnce([]);
  const result = await request(app).post(`/api/tokens/${contract}/verify-deployer`).set('Authorization', `Bearer ${auth}`);
  expect(result.status).toBe(403);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('LOWER(creator) = $2'), [contract, wallet.address.toLowerCase()]);
});
it('wallet proof alone does not grant a source-verified token badge', async () => {
  const auth = await session(Wallet.createRandom());
  vi.mocked(query).mockResolvedValueOnce([{ verified: false }]);
  const result = await request(app).post(`/api/tokens/${contract}/verify-deployer`).set('Authorization', `Bearer ${auth}`);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ deployerVerified: true, verifiedBadge: false });
});
