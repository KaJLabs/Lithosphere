const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgres://makalu:makalupassword123@localhost:5432/makalu' });
  await client.connect();
  const res = await client.query("SELECT hash, value, input_data FROM evm_transactions WHERE input_data IS NOT NULL ORDER BY block_height DESC LIMIT 10");
  for (const row of res.rows) {
    const rx = await fetch('https://rpc.litho.ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [row.hash] })
    }).then(r => r.json());
    console.log(`Hash: ${row.hash}`);
    console.log(`DB Value: ${row.value}, RPC Value: ${rx.result ? parseInt(rx.result.value, 16) : 'null'}`);
    console.log(`Input length: ${row.input_data ? row.input_data.length : 0}`);
    console.log('---');
  }
  await client.end();
}
main().catch(console.error);
