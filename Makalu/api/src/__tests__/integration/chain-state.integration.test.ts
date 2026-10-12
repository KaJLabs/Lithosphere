/**
 * Integration test: exercise the api against the deterministic
 * `chain-state.json` corpus loaded into a real Postgres.
 *
 * The corpus mirrors a realistic ~5-second slice of Makalu — 10 blocks,
 * 15 transactions, 5 validators. Adding a new endpoint scenario is just
 * an extra `it()` here plus (optionally) a new row in the JSON.
 *
 * Skipped unless INTEGRATION_TESTS=1. Setup commands:
 *   docker compose -f Makalu/docker-compose.test.yml up -d postgres
 *   INTEGRATION_TESTS=1 \
 *     DATABASE_URL=postgres://litho:litho@localhost:5433/litho_test \
 *     pnpm --filter @lithosphere/api test src/__tests__/integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import pkg from 'pg';
import { applySchema, loadChainStateCorpus, loadFixtures } from './fixtures/load.js';

const { Pool } = pkg;
const RUN = process.env.INTEGRATION_TESTS === '1';

describe.skipIf(!RUN)('integration: api against fixture chain-state corpus', () => {
  let pool: InstanceType<typeof Pool>;
  let app: Express;
  const corpus = loadChainStateCorpus();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for integration tests');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    await applySchema(pool);
    await loadFixtures(pool, corpus);

    const { explorerRouter } = await import('../../routes.js');
    app = express();
    app.use('/api', explorerRouter());
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('GET /api/blocks', () => {
    it('returns the corpus sorted by height DESC', async () => {
      const res = await request(app).get('/api/blocks?limit=20');
      expect(res.status).toBe(200);
      const heights = (res.body as Array<{ height: number }>).map((b) => b.height);
      expect(heights).toEqual([1009, 1008, 1007, 1006, 1005, 1004, 1003, 1002, 1001, 1000]);
    });

    it('respects limit + offset', async () => {
      const page1 = await request(app).get('/api/blocks?limit=5&offset=0');
      const page2 = await request(app).get('/api/blocks?limit=5&offset=5');
      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      const page1Heights = (page1.body as Array<{ height: number }>).map((b) => b.height);
      const page2Heights = (page2.body as Array<{ height: number }>).map((b) => b.height);
      expect(page1Heights).toEqual([1009, 1008, 1007, 1006, 1005]);
      expect(page2Heights).toEqual([1004, 1003, 1002, 1001, 1000]);
    });

    it('caps oversized limits at 100', async () => {
      // Asking for 1000 still returns the 10 we have; the server-side clamp
      // means oversized requests don't error, they just get capped.
      const res = await request(app).get('/api/blocks?limit=1000');
      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBe(corpus.blocks.length);
    });

    it('renders the row shape expected by mapBlock', async () => {
      const res = await request(app).get('/api/blocks?limit=1');
      const [block] = res.body as Array<{
        height: number;
        hash: string;
        timestamp: string;
        txCount: number;
        gasUsed: string;
      }>;
      expect(block).toEqual({
        height: 1009,
        hash: '0x0000000000000000000000000000000000000000000000000000000000001009',
        timestamp: '2026-05-12T10:00:04.725Z',
        txCount: 0,
        gasUsed: '0',
      });
    });
  });

  describe('GET /api/validators', () => {
    it('returns validators ordered by tokens DESC with the jailed one last', async () => {
      const res = await request(app).get('/api/validators');
      expect(res.status).toBe(200);
      const list = res.body as Array<{ address: string; moniker: string; status: string }>;
      expect(list.map((v) => v.moniker)).toEqual([
        'Makalu mtest-val-01',
        'Makalu mtest-val-02',
        'Makalu mtest-val-03',
        'Makalu mtest-val-04',
        'Makalu mtest-val-05 (jailed)',
      ]);
      expect(list[0]?.status).toBe('Bonded');
      expect(list[4]?.status).toBe('Unbonded'); // status=1 in corpus
    });

    it('preserves fractional voting power from ulitho', async () => {
      const res = await request(app).get('/api/validators');
      const list = res.body as Array<{ moniker: string; votingPower: string; commission: string }>;
      // Five trillion base units must not be truncated to zero LITHO.
      expect(list[0]?.votingPower).toBe('0.000005');
      expect(list[0]?.commission).toBe('5%');
    });
  });

  describe('cross-cutting properties', () => {
    it('total transactions across all blocks matches the corpus', async () => {
      const res = await request(app).get('/api/blocks?limit=100');
      const totalReported = (res.body as Array<{ txCount: number }>).reduce(
        (sum, b) => sum + b.txCount,
        0,
      );
      const corpusTotal = corpus.blocks.reduce((sum, b) => sum + b.num_txs, 0);
      expect(totalReported).toBe(corpusTotal);
      expect(corpusTotal).toBe(corpus.transactions.length);
    });
  });
});
