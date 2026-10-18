export const THANOS_RDNS = 'fi.thanos.wallet';
export const THANOS_INSTALL_URL = 'https://thanos.fi/';

type ConnectorIdentity = {
  name?: string | null;
  info?: { rdns?: string | null } | null;
};

export function isThanosIdentity(rdns?: string | null, name?: string | null): boolean {
  const normalizedRdns = rdns?.trim().toLowerCase() || '';
  const normalizedName = name?.trim().toLowerCase() || '';

  return normalizedRdns === THANOS_RDNS
    || normalizedRdns.includes('thanos')
    || normalizedName.includes('thanos');
}

export function isThanosConnector(connector: ConnectorIdentity): boolean {
  return isThanosIdentity(connector.info?.rdns, connector.name);
}

export function prioritizeThanosConnectors<T extends ConnectorIdentity>(
  connectors: T[],
): T[] {
  return connectors
    .map((connector, index) => ({ connector, index }))
    .sort((left, right) => {
      const leftPreferred = isThanosConnector(left.connector) ? 0 : 1;
      const rightPreferred = isThanosConnector(right.connector) ? 0 : 1;
      return leftPreferred - rightPreferred || left.index - right.index;
    })
    .map(({ connector }) => connector);
}

export function preferThanosConnectors<T extends ConnectorIdentity>(controller: {
  state: { connectors: T[] };
}): void {
  const connectors = controller.state.connectors;
  const prioritized = prioritizeThanosConnectors(connectors);
  if (prioritized.every((connector, index) => connector === connectors[index])) return;
  // setConnectors registers additional connectors and preserves announcement order.
  // Calling it from its own subscription repeatedly appends the same wallets.
  controller.state.connectors = prioritized;
}
