import { createHash } from 'node:crypto';
import { Contract, getAddress, toBeHex, ZeroAddress } from 'ethers';

const ABI = [
  'function deposits(bytes32) view returns(address depositor,address recipient,uint256 amount,uint256 targetChain,uint256 quotedOutput,uint64 quoteExpiry,address targetVault,uint64 finalityDelaySeconds,uint8 state)',
  'function releaseStates(bytes32) view returns(uint8)',
  'function supportedChains(uint256) view returns(bool)',
  'function sourceVaults(uint256) view returns(address)',
];
const operationId = value => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error('invalid operation ID');
  return value.toLowerCase();
};
const routeKey = route => `${route.sourceChainId}:${route.destinationChainId}`;
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`invalid ${label}`);
  return value;
};
const codeHash = code => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
const same = (left, right) => getAddress(left) === getAddress(right);

export function parseNativeVaultStatusRoutes(routes) {
  if (!Array.isArray(routes) || !routes.length) throw Error('approved native vault routes required');
  const approved = new Map();
  for (const input of routes) {
    const route = {
      sourceChainId: positive(input?.sourceChainId, 'source chain'),
      destinationChainId: positive(input?.destinationChainId, 'destination chain'),
      sourceVault: getAddress(input?.sourceVault),
      destinationVault: getAddress(input?.destinationVault),
      sourceConfirmations: positive(input?.sourceConfirmations, 'source confirmations'),
      destinationConfirmations: positive(input?.destinationConfirmations, 'destination confirmations'),
      sourceRuntimeSha256: input?.sourceRuntimeSha256?.toLowerCase(),
      destinationRuntimeSha256: input?.destinationRuntimeSha256?.toLowerCase(),
    };
    if (route.sourceChainId === route.destinationChainId ||
        route.sourceVault === ZeroAddress || route.destinationVault === ZeroAddress ||
        !/^[0-9a-f]{64}$/.test(route.sourceRuntimeSha256 ?? '') ||
        !/^[0-9a-f]{64}$/.test(route.destinationRuntimeSha256 ?? '') ||
        approved.has(routeKey(route))) throw Error('invalid or duplicate native vault route');
    approved.set(routeKey(route), Object.freeze(route));
  }
  return approved;
}

async function anchor(provider, chainId, confirmations) {
  if (Number(await provider.send('eth_chainId', [])) !== chainId) throw Error('native vault RPC chain mismatch');
  const height = await provider.getBlockNumber();
  const number = height - confirmations + 1;
  if (number < 1) throw Error('native vault finality anchor unavailable');
  const block = await provider.send('eth_getBlockByNumber', [toBeHex(number), false]);
  if (!block?.hash) throw Error('native vault block unavailable');
  return { number, hash: block.hash.toLowerCase() };
}

async function verifyAnchor(provider, chainId, initial) {
  if (Number(await provider.send('eth_chainId', [])) !== chainId) throw Error('native vault RPC chain mismatch');
  const current = await provider.send('eth_getBlockByNumber', [toBeHex(initial.number), false]);
  if (!current?.hash || current.hash.toLowerCase() !== initial.hash) throw Error('native vault anchor changed');
}

async function verifyVault(provider, vault, expectedSha256, blockTag) {
  const code = await provider.getCode(vault, blockTag);
  if (!/^0x[0-9a-f]+$/i.test(code) || code === '0x' || codeHash(code) !== expectedSha256) {
    throw Error('native vault runtime mismatch');
  }
}

// Read-only projection from finalized-policy anchors. An observed state is not
// permission to sign, relay, refund or activate a route.
export function createNativeVaultStatusReader({ routes, providers, contractFactory = (vault, provider) => new Contract(vault, ABI, provider) }) {
  const approved = parseNativeVaultStatusRoutes(routes);
  if (!(providers instanceof Map)) throw Error('native vault provider map required');
  return async function readNativeVaultStatus(sourceChainId, destinationChainId, id) {
    const route = approved.get(`${positive(sourceChainId, 'source chain')}:${positive(destinationChainId, 'destination chain')}`);
    if (!route) throw Error('native vault route not approved');
    const sourceProvider = providers.get(route.sourceChainId);
    const destinationProvider = providers.get(route.destinationChainId);
    if (!sourceProvider || !destinationProvider) throw Error('native vault RPC unavailable');
    const key = operationId(id);
    const [sourceAnchor, destinationAnchor] = await Promise.all([
      anchor(sourceProvider, route.sourceChainId, route.sourceConfirmations),
      anchor(destinationProvider, route.destinationChainId, route.destinationConfirmations),
    ]);
    await Promise.all([
      verifyVault(sourceProvider, route.sourceVault, route.sourceRuntimeSha256, sourceAnchor.number),
      verifyVault(destinationProvider, route.destinationVault, route.destinationRuntimeSha256, destinationAnchor.number),
    ]);
    const source = contractFactory(route.sourceVault, sourceProvider);
    const destination = contractFactory(route.destinationVault, destinationProvider);
    const [deposit, releaseState, sourceSupported, sourceTarget, destinationSupported, destinationTarget] = await Promise.all([
      source.deposits(key, { blockTag: sourceAnchor.number }),
      destination.releaseStates(key, { blockTag: destinationAnchor.number }),
      source.supportedChains(route.destinationChainId, { blockTag: sourceAnchor.number }),
      source.sourceVaults(route.destinationChainId, { blockTag: sourceAnchor.number }),
      destination.supportedChains(route.sourceChainId, { blockTag: destinationAnchor.number }),
      destination.sourceVaults(route.sourceChainId, { blockTag: destinationAnchor.number }),
    ]);
    if (!sourceSupported || !destinationSupported || !same(sourceTarget, route.destinationVault) ||
        !same(destinationTarget, route.sourceVault)) throw Error('native vault route changed');
    const depositState = Number(deposit.state ?? deposit[8]);
    const destinationState = Number(releaseState);
    if (depositState === 0) throw Error('native vault operation not found');
    if (!Number.isInteger(depositState) || depositState < 1 || depositState > 3 ||
        !Number.isInteger(destinationState) || destinationState < 0 || destinationState > 2 ||
        Number(deposit.targetChain ?? deposit[3]) !== route.destinationChainId ||
        !same(deposit.targetVault ?? deposit[6], route.destinationVault)) throw Error('native vault state mismatch');
    await Promise.all([
      verifyAnchor(sourceProvider, route.sourceChainId, sourceAnchor),
      verifyAnchor(destinationProvider, route.destinationChainId, destinationAnchor),
    ]);
    const status = depositState === 1
      ? ['awaiting_destination', 'payout_observed', 'cancellation_observed'][destinationState]
      : depositState === 2 && destinationState === 1 ? 'completed'
      : depositState === 3 && destinationState === 2 ? 'refunded'
      : 'inconsistent';
    if (status === 'inconsistent') throw Error('native vault terminal states conflict');
    return Object.freeze({
      operationId: key, sourceChainId: route.sourceChainId, destinationChainId: route.destinationChainId,
      sourceVault: route.sourceVault, destinationVault: route.destinationVault,
      depositor: getAddress(deposit.depositor ?? deposit[0]), recipient: getAddress(deposit.recipient ?? deposit[1]),
      inputAmountBaseUnits: String(deposit.amount ?? deposit[2]),
      quotedOutputBaseUnits: String(deposit.quotedOutput ?? deposit[4]),
      quoteExpiry: Number(deposit.quoteExpiry ?? deposit[5]),
      depositState, releaseState: destinationState, status,
      sourceAnchor, destinationAnchor,
    });
  };
}
