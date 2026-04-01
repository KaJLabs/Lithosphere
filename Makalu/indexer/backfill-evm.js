import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

const EVM_RPC_URL = process.env.EVM_RPC_URL || 'https://rpc.litho.ai';

async function main() {
  const { rows } = await pool.query(
    "SELECT hash, cosmos_tx_hash FROM evm_transactions WHERE value = '0'"
  );
  console.log(`Found ${rows.length} EVM transactions with value = 0`);

  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const resp = await fetch(EVM_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_getTransactionByHash',
          params: [row.hash],
        })
      });
      const data = await resp.json();
      const tx = data.result;
      if (tx && tx.value && tx.value !== '0x0') {
        const decValue = String(BigInt(tx.value));
        await pool.query(
          "UPDATE evm_transactions SET value = $1 WHERE hash = $2",
          [decValue, row.hash]
        );
        updated++;
        console.log(`Updated ${row.hash} -> ${decValue}`);
      }
    } catch (e) {
      console.error(`Failed ${row.hash}:`, e.message);
    }
  }

  console.log(`Completed. Updated ${updated} transactions.`);
  process.exit(0);
}

main();
