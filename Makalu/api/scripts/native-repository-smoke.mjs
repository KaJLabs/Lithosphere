// Run against a disposable loopback PostgreSQL instance, never an installed explorer DB.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { postgresNativeSources } from '../dist/native/repository.js';

const url = new URL(process.env.NATIVE_TEST_PG_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.username !== 'lithic_test' || url.pathname !== '/postgres') throw new Error('Disposable local test DB required');
if (process.argv.length !== 3) throw new Error('usage: NATIVE_TEST_PG_URL=... node native-repository-smoke.mjs REPORT.json');
const fixture = JSON.parse(await readFile(new URL('../src/__tests__/fixtures/native-factory.json', import.meta.url), 'utf8'));
const migration = await readFile(new URL('../migrations/20261106_native_source_matches.sql', import.meta.url), 'utf8');
const schema = `native_source_test_${randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url.toString(), max: 1 });
const pool = new pg.Pool({ connectionString: url.toString(), options: `-c search_path=${schema}`, max: 2 });
let version;
try {
  version = (await admin.query('SHOW server_version')).rows[0].server_version;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(migration);
  // Migration and insert replay are both idempotent.
  await pool.query(migration);
  const sources = postgresNativeSources(pool);
  const value = { registration: fixture.observation.deployments[0], result: fixture.verified, request: fixture.verification };
  await sources.put(value); await sources.put(value);
  assert.equal((await pool.query('SELECT count(*) AS count FROM native_source_matches')).rows[0].count, '1');
  assert.deepEqual(await sources.get(700777, fixture.contractAddress), value);
  assert.equal(await sources.get(9005, fixture.contractAddress), null);
  await sources.invalidate(700777, fixture.receipt.blockHash);
  assert.equal(await sources.get(700777, fixture.contractAddress), null);
  const replacement = structuredClone(value);
  replacement.registration.blockHash = `0x${'ee'.repeat(32)}`;
  replacement.registration.blockHeight = '43';
  replacement.registration.deploymentId = `700777:${replacement.registration.blockHash}:${fixture.receipt.transactionHash}:0`;
  await sources.put(replacement);
  assert.deepEqual(await sources.get(700777, fixture.contractAddress), replacement);
  assert.equal((await pool.query('SELECT count(*) AS count FROM native_source_matches WHERE canonical=false')).rows[0].count, '1');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
await writeFile(process.argv[2], JSON.stringify({ result: 'PASS', postgresVersion: version,
  scope: 'isolated local SQL migration/repository only; no chain or production DB',
  cases: ['migration replay', 'idempotent insert', 'exact source roundtrip', 'chain isolation', 'reorg invalidation and replacement'] }, null, 2) + '\n');
console.log('PASS: actual PostgreSQL migration and native source repository');
