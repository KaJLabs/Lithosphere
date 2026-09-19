import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// One transaction and advisory lock cover schema changes plus their ledger.
// Existing SQL files are immutable once recorded; corrections need a new file.
export async function runMigrations(pool,directory){
 const names=(await fs.readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
 const migrations=await Promise.all(names.map(async name=>{const sql=await fs.readFile(path.join(directory,name),'utf8');return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};}));
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='10s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('multx-schema-migrations-v1',0))");
  await db.query(`CREATE TABLE IF NOT EXISTS multx_schema_migrations (
   name TEXT PRIMARY KEY, checksum TEXT NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'), applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied=(await db.query('SELECT name,checksum FROM multx_schema_migrations ORDER BY name')).rows;
  const byName=new Map(migrations.map(m=>[m.name,m]));
  for(const saved of applied){if(byName.get(saved.name)?.checksum!==saved.checksum)throw Error('Applied migration missing or changed: '+saved.name);}
  const done=new Set(applied.map(m=>m.name)),pending=migrations.filter(m=>!done.has(m.name));
  if(applied.length&&pending.some(m=>m.name<applied[applied.length-1].name))throw Error('Cannot insert an earlier migration into applied history');
  for(const migration of pending){
   await db.query(migration.sql);
   await db.query('INSERT INTO multx_schema_migrations(name,checksum) VALUES($1,$2)',[migration.name,migration.checksum]);
  }
  await db.query('COMMIT');
  return {applied:pending.map(m=>m.name),alreadyApplied:applied.length};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
