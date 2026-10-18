import { afterEach, describe, expect, it } from 'vitest';
import { ConnectorController, type Connector } from '@web3modal/core';
import { preferThanosConnectors } from '@/lib/thanos';

afterEach(() => {
  ConnectorController.state.connectors = [];
  ConnectorController.state.unMergedConnectors = [];
});

const wallet = (name: string, rdns: string): Connector => ({
  id: rdns, name, type: 'ANNOUNCED', chain: 'evm',
  info: { rdns, name, uuid: rdns, icon: 'data:image/svg+xml,<svg/>' },
});

describe('Thanos discovery with the real Web3Modal controller', () => {
  it('changes presentation order without registering connectors again', () => {
    ConnectorController.setConnectors([
      wallet('Other wallet', 'example.other'), wallet('Thanos Wallet', 'fi.thanos.wallet'),
    ]);
    preferThanosConnectors(ConnectorController);
    expect(ConnectorController.state.connectors.map(c => c.name)).toEqual(['Thanos Wallet', 'Other wallet']);
    expect(ConnectorController.state.unMergedConnectors).toHaveLength(2);
    const ordered = ConnectorController.state.connectors;
    preferThanosConnectors(ConnectorController);
    expect(ConnectorController.state.connectors).toBe(ordered);

    ConnectorController.addConnector(wallet('Late wallet', 'example.late'));
    preferThanosConnectors(ConnectorController);
    expect(ConnectorController.state.connectors.map(c => c.name)).toEqual(['Thanos Wallet', 'Other wallet', 'Late wallet']);
    expect(ConnectorController.state.unMergedConnectors).toHaveLength(3);
  });
});
