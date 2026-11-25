type Event = { type: string; attributes: Array<{ key: string; value: string }> };
type Transfer = { hash?: string; blockNumber?: string; to?: string | null; input?: string; gasPrice?: string };

/** Evmos emits txGasUsed, ethereumTxFailed (on failure), and an explicit tx_log
 * event, even when there are no logs. See v20 x/evm/keeper/msg_server.go.
 * Only the unambiguous successful 21000-gas, empty-input case is handled here.
 * Calls, deployments, legacy/base64 events and unknown shapes use normal RPC. */
export function nativeTransferReceipt(tx: Transfer, result: { code?: number; events?: Event[] } | undefined, height: number) {
  if (!result || result.code !== 0 || tx.input !== '0x' || !/^0x[0-9a-f]{40}$/i.test(tx.to ?? '')
      || !/^0x[0-9a-f]{64}$/i.test(tx.hash ?? '') || !/^0x[0-9a-f]+$/i.test(tx.gasPrice ?? '')) return null;
  try { if (BigInt(tx.blockNumber ?? '0') !== BigInt(height)) return null; } catch { return null; }
  const events = result.events ?? [];
  const executions = events.filter(event => event.type === 'ethereum_tx'
    && event.attributes.some(a => a.key === 'txGasUsed'));
  const logs = events.filter(event => event.type === 'tx_log');
  if (executions.length !== 1 || logs.length !== 1
      || logs[0].attributes.some(a => a.key !== 'msg_index')) return null;
  const attributes = executions[0].attributes;
  if (attributes.filter(a => a.key === 'ethereumTxHash').length !== 1
      || attributes.find(a => a.key === 'ethereumTxHash')?.value.toLowerCase() !== tx.hash!.toLowerCase()
      || attributes.find(a => a.key === 'txGasUsed')?.value !== '21000'
      || events.some(event => event.type === 'ethereum_tx' && event.attributes.some(a => a.key === 'ethereumTxFailed'))) return null;
  return {
    transactionHash: tx.hash!, blockNumber: tx.blockNumber!, status: '0x1',
    gasUsed: '0x5208', effectiveGasPrice: tx.gasPrice!, contractAddress: null, logs: [],
  };
}
