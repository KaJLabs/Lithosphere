import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeVaultStatus } from './NativeVaultStatus';

const id = '0x' + '11'.repeat(32);
const sourceVault = '0x0000000000000000000000000000000000000011';
const destinationVault = '0x0000000000000000000000000000000000000056';
const route = { sourceChainId: 1, destinationChainId: 56, sourceVault, destinationVault };
const config = { enabled: true, baseUrl: 'http://127.0.0.1:9999', routes: [route] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('stays hidden without explicit enablement', () => {
  const { container } = render(<NativeVaultStatus config={{ ...config, enabled: false }} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows a verified operation status and never offers a signing action', async () => {
  const response = {
    operationId: id, ...route, depositor: sourceVault, recipient: destinationVault,
    inputAmountBaseUnits: '100', quotedOutputBaseUnits: '90', quoteExpiry: 1_800_000_000,
    depositState: 2, releaseState: 1, status: 'completed',
    sourceAnchor: { number: 100, hash: '0x' + 'aa'.repeat(32) },
    destinationAnchor: { number: 200, hash: '0x' + 'bb'.repeat(32) },
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
  render(<NativeVaultStatus config={config} />);
  fireEvent.change(screen.getByLabelText('Operation ID'), { target: { value: id } });
  fireEvent.click(screen.getByText('Check status'));
  expect(await screen.findByText('Payout and source finalization confirmed.')).toBeInTheDocument();
  expect(screen.queryByText(/sign|execute|release/i)).toBeNull();
});
