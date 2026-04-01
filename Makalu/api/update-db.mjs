import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  const res = await client.query("UPDATE contracts SET total_supply = '2100000000000000' WHERE symbol = 'LitBTC'");
  console.log('Updated DB rows:', res.rowCount);
  await client.end();
}
run().catch(console.error);
