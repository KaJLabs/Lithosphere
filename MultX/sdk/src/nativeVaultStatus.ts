import { getAddress, ZeroAddress } from 'ethers';

export type NativeVaultOperationStatus = 'awaiting_destination' | 'payout_observed' |
  'cancellation_observed' | 'completed' | 'refunded';

export interface NativeVaultStatus {
  operationId: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceVault: string;
  destinationVault: string;
  depositor: string;
  recipient: string;
  inputAmountBaseUnits: string;
  quotedOutputBaseUnits: string;
  quoteExpiry: number;
  depositState: number;
  releaseState: number;
  status: NativeVaultOperationStatus;
  sourceAnchor: { number: number; hash: string };
  destinationAnchor: { number: number; hash: string };
}

export interface NativeVaultStatusRoute {
  sourceChainId: number;
  destinationChainId: number;
  sourceVault: string;
  destinationVault: string;
}

const bytes32 = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const amount = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const safePositive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const statuses = new Set<NativeVaultOperationStatus>([
  'awaiting_destination', 'payout_observed', 'cancellation_observed', 'completed', 'refunded',
]);

export function createNativeVaultStatusBackend(options: {
  baseUrl: string;
  routes: NativeVaultStatusRoute[];
  fetch?: typeof globalThis.fetch;
}) {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw Error('secure native vault status API required');
  }
  const approved = new Map<string, NativeVaultStatusRoute>();
  for (const route of options.routes) {
    if (!safePositive(route.sourceChainId) || !safePositive(route.destinationChainId) ||
        route.sourceChainId === route.destinationChainId) throw Error('invalid native vault route');
    const key = `${route.sourceChainId}:${route.destinationChainId}`;
    if (approved.has(key)) throw Error('duplicate native vault route');
    const sourceVault = getAddress(route.sourceVault);
    const destinationVault = getAddress(route.destinationVault);
    if (sourceVault === ZeroAddress || destinationVault === ZeroAddress) throw Error('invalid native vault route');
    approved.set(key, { ...route, sourceVault, destinationVault });
  }
  if (!approved.size) throw Error('native vault routes required');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async getOperation(sourceChainId: number, destinationChainId: number, operationId: string): Promise<NativeVaultStatus> {
      const route = approved.get(`${sourceChainId}:${destinationChainId}`);
      if (!route || !bytes32(operationId)) throw Error('invalid native vault operation lookup');
      const url = `${base.href.replace(/\/$/, '')}/native-vault/operations/${sourceChainId}/${destinationChainId}/${operationId}`;
      const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`native vault status unavailable (${response.status})`);
      const result = await response.json() as NativeVaultStatus;
      if (!bytes32(result?.operationId) || result.operationId.toLowerCase() !== operationId.toLowerCase() ||
          result.sourceChainId !== sourceChainId || result.destinationChainId !== destinationChainId ||
          getAddress(result.sourceVault) !== route.sourceVault || getAddress(result.destinationVault) !== route.destinationVault ||
          !safePositive(result.quoteExpiry) || !amount(result.inputAmountBaseUnits) || !amount(result.quotedOutputBaseUnits) ||
          !statuses.has(result.status) ||
          !((result.depositState === 1 && result.releaseState === 0 && result.status === 'awaiting_destination') ||
            (result.depositState === 1 && result.releaseState === 1 && result.status === 'payout_observed') ||
            (result.depositState === 1 && result.releaseState === 2 && result.status === 'cancellation_observed') ||
            (result.depositState === 2 && result.releaseState === 1 && result.status === 'completed') ||
            (result.depositState === 3 && result.releaseState === 2 && result.status === 'refunded')) ||
          !safePositive(result.sourceAnchor?.number) || !bytes32(result.sourceAnchor?.hash) ||
          !safePositive(result.destinationAnchor?.number) || !bytes32(result.destinationAnchor?.hash)) {
        throw Error('invalid native vault status response');
      }
      getAddress(result.depositor);
      getAddress(result.recipient);
      return result;
    },
  };
}
