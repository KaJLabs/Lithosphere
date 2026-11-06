import { describe, expect, it, vi } from 'vitest';
import { cometNativeRecordReader } from '../native/reader.js';
import fixture from './fixtures/native-factory.json' with { type: 'json' };

const block = { block: { header: { height: '42' } }, block_id: { hash: fixture.receipt.blockHash.slice(2).toUpperCase() } };
const response = { code: 0, height: '42', key: Buffer.from('lithovm/v1/contracts/' + fixture.contractAddress.slice(2)).toString('base64'),
  value: Buffer.from(fixture.nativeRecord.slice(2), 'hex').toString('base64') };
function setup(change?: (value: typeof response) => void) {
  const query = structuredClone(response); change?.(query);
  const transport = vi.fn(async (_url, options) => {
    const input = JSON.parse(options.body);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: input.method === 'block' ? block : { response: query } }));
  });
  return { transport, read: cometNativeRecordReader('https://owner-node.invalid', transport as unknown as typeof fetch) };
}
describe('height-bound native KV reader', () => {
  it('queries exact key/height, bounds to the same Comet and EVM block and returns the actual FFI record', async () => {
    const s = setup(); const result = await s.read(fixture.contractAddress, '42', fixture.receipt.blockHash);
    expect(Buffer.from(result).toString('hex')).toBe(fixture.nativeRecord.slice(2));
    expect(s.transport).toHaveBeenCalledTimes(3);
    const query = JSON.parse(s.transport.mock.calls[1]![1].body);
    expect(query.params).toMatchObject({ path: '/store/lithovm/key', height: '42', prove: false });
  });
  it.each(['key', 'height', 'code', 'empty', 'encoding'])('rejects wrong/pruned %s records', async (failure) => {
    const s = setup((answer) => {
      if (failure === 'key') answer.key = Buffer.from('other').toString('base64');
      if (failure === 'height') answer.height = '43';
      if (failure === 'code') answer.code = 1;
      if (failure === 'empty') answer.value = '';
      if (failure === 'encoding') answer.value += '\n';
    });
    await expect(s.read(fixture.contractAddress, '42', fixture.receipt.blockHash)).rejects.toThrow();
  });
  it('rejects a Comet block that differs from the observed EVM block before fetching code', async () => {
    const s = setup(); await expect(s.read(fixture.contractAddress, '42', `0x${'ff'.repeat(32)}`)).rejects.toThrow('identity');
    expect(s.transport).toHaveBeenCalledTimes(1);
  });
});
