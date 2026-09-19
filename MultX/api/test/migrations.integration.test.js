import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { reviewPostgres } from './helpers/reviewLab.js';
import { runMigrations } from '../src/db/migrate.js';

test('PostgreSQL migrations serialize startup, survive restart and roll back failed batches',{skip:process.env.MULTX_PAYOUT_DB_TEST!=='1'},async()=>{
 const options=reviewPostgres();
 const admin=new pg.Pool(options),schema='migrations_'+Date.now(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'multx-migrations-'));let pool;
 try{
  const original=new URL('../src/db/migrations/',import.meta.url);
  const names=fs.readdirSync(original).filter(n=>n.endsWith('.sql'));
  for(const name of names)fs.copyFileSync(new URL(name,original),path.join(directory,name));
  await admin.query('CREATE SCHEMA '+schema);pool=new pg.Pool({...options,options:'-c search_path='+schema});
  const results=await Promise.all([runMigrations(pool,directory),runMigrations(pool,directory)]);
  assert.deepEqual(results.map(r=>r.applied.length).sort((a,b)=>a-b),[0,names.length]);
  await pool.end();pool=new pg.Pool({...options,options:'-c search_path='+schema});
  assert.equal((await runMigrations(pool,directory)).applied.length,0);
  const first=path.join(directory,names.sort()[0]),text=fs.readFileSync(first,'utf8');
  fs.appendFileSync(first,'\n-- changed after application\n');
  await assert.rejects(runMigrations(pool,directory),/missing or changed/);fs.writeFileSync(first,text);
  const bad=path.join(directory,'999-failed-test.sql');
  fs.writeFileSync(bad,'CREATE TABLE migration_rollback_probe(id INTEGER); SELECT missing_migration_function();');
  await assert.rejects(runMigrations(pool,directory),/missing_migration_function/);
  assert.equal((await pool.query("SELECT to_regclass('migration_rollback_probe') AS found")).rows[0].found,null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM multx_schema_migrations')).rows[0].n,names.length);
  fs.unlinkSync(bad);
  assert.equal((await runMigrations(pool,directory)).applied.length,0);
 }finally{
  if(pool)await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();
  for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);
 }
});
