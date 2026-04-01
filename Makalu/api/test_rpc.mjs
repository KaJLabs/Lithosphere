const result = await fetch('https://rpc.litho.ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: ['0xcad92bf009166ce43c5381ce4412c26f3c7403ced1426fac1bd256c82708eaf4']})
}).then(r => r.json());
console.log(result);
