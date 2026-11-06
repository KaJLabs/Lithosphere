import { JsonRpcProvider } from 'ethers';

/** Fixed operator RPC; never accepts a URL, chain ID or raw receipt from an HTTP form. */
export function evmNativeReceiptReader(provider: JsonRpcProvider, chainId: number) {
  const checked = async () => {
    if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error('Native RPC chain mismatch');
  };
  return {
    async receipt(hash: string) {
      await checked();
      const receipt = await provider.getTransactionReceipt(hash);
      if (!receipt) return null;
      const transaction = await provider.getTransaction(hash);
      if (!transaction || transaction.hash.toLowerCase() !== hash || transaction.chainId !== BigInt(chainId)
        || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber)
        throw new Error('Native outer transaction identity mismatch');
      return {
        schemaVersion: 'lithovm-evm-receipt-v1', chainId: chainId.toString(),
        transactionHash: receipt.hash.toLowerCase(), from: transaction.from.toLowerCase(),
        nonce: transaction.nonce.toString(), blockHash: receipt.blockHash.toLowerCase(),
        blockHeight: receipt.blockNumber.toString(), transactionGasUsed: receipt.gasUsed.toString(),
        status: receipt.status === 1 ? 'success' : receipt.status === 0 ? 'reverted' : 'unknown',
        logs: receipt.logs.map((log) => ({ address: log.address.toLowerCase(),
          topics: log.topics.map((topic) => topic.toLowerCase()), data: log.data.toLowerCase(), logIndex: log.index.toString() })),
      };
    },
    async canonicalBlockHash(height: string) {
      await checked();
      const block = await provider.getBlock('0x' + BigInt(height).toString(16));
      if (!block?.hash) throw new Error('Native block is unavailable');
      return block.hash.toLowerCase();
    },
  };
}

/** Standard Comet ABCI query. This is a trusted-RPC observation, not an ICS23 proof. */
export function cometNativeRecordReader(endpoint: string, transport: typeof fetch = fetch) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid operator Comet endpoint');
  async function rpc(method: string, params: object) {
    const response = await transport(url, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok || !response.body) throw new Error('Native ABCI reader unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const value = await reader.read(); if (value.done) break;
        total += value.value.length;
        if (total > 4 * 1024 * 1024) throw new Error('Native ABCI response exceeds limit');
        chunks.push(value.value);
      }
    } finally { await reader.cancel(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.error || result.id !== 1 || !result.result) throw new Error('Native ABCI query failed');
    return result.result;
  }
  async function block(height: string, expectedHash: string) {
    const result = await rpc('block', { height });
    if (result.block?.header?.height !== height || `0x${result.block_id?.hash?.toLowerCase()}` !== expectedHash)
      throw new Error('Comet/EVM block identity mismatch');
  }
  return async (contract: string, height: string, blockHash: string): Promise<Uint8Array> => {
    if (!/^0x[0-9a-f]{40}$/.test(contract) || !/^[1-9][0-9]{0,19}$/.test(height)
      || !/^0x[0-9a-f]{64}$/.test(blockHash)) throw new Error('Invalid native record context');
    await block(height, blockHash);
    const key = Buffer.from('lithovm/v1/contracts/' + contract.slice(2));
    const result = await rpc('abci_query', { path: '/store/lithovm/key', data: '0x' + key.toString('hex'), height, prove: false });
    const answer = result.response;
    if (!answer || answer.code !== 0 || answer.height !== height || answer.key !== key.toString('base64')
      || typeof answer.value !== 'string' || !answer.value) throw new Error('Native record is absent or not at requested height');
    const bytes = Buffer.from(answer.value, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== answer.value)
      throw new Error('Invalid native record encoding');
    await block(height, blockHash);
    return bytes;
  };
}
