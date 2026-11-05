import { expect, it } from 'vitest';
import { createNativeVaultStatusBackend } from '../src/nativeVaultStatus.js';

const id = '0x' + '11'.repeat(32);
const sourceVault = '0x0000000000000000000000000000000000000011';
const destinationVault = '0x0000000000000000000000000000000000000056';
const route = { sourceChainId: 1, destinationChainId: 56, sourceVault, destinationVault };
const status = {
  operationId: id, ...route, depositor: sourceVault, recipient: destinationVault,
  inputAmountBaseUnits: '100', quotedOutputBaseUnits: '90', quoteExpiry: 1_800_000_000,
  depositState: 1, releaseState: 0, status: 'awaiting_destination',
  sourceAnchor: { number: 100, hash: '0x' + 'aa'.repeat(32) },
  destinationAnchor: { number: 200, hash: '0x' + 'bb'.repeat(32) },
};

it('accepts a pinned vault operation and rejects identity or terminal-state changes', async () => {
  let received = '';
  let response = status;
  const backend = createNativeVaultStatusBackend({ baseUrl: 'https://status.example', routes: [route],
    fetch: (async (url: string | URL | Request) => {
      received = String(url);
      return new Response(JSON.stringify(response), { status: 200 });
    }) as typeof fetch });
  expect((await backend.getOperation(1, 56, id)).status).toBe('awaiting_destination');
  expect(received).toBe(`https://status.example/native-vault/operations/1/56/${id}`);
  response = { ...status, destinationVault: sourceVault };
  await expect(backend.getOperation(1, 56, id)).rejects.toThrow('invalid native vault status response');
  response = { ...status, depositState: 3, releaseState: 0, status: 'refunded' };
  await expect(backend.getOperation(1, 56, id)).rejects.toThrow('invalid native vault status response');
  await expect(backend.getOperation(56, 1, id)).rejects.toThrow('invalid native vault operation lookup');
});
