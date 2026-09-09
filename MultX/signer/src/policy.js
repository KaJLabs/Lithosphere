import { ethers } from 'ethers';

const positiveIntegerString = (value, label) => {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${label} must be a positive integer`);
  return text;
};

const safePositiveInteger = (value, label) => {
  const text = positiveIntegerString(value, label);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} exceeds JavaScript's safe integer range`);
  return number;
};

const nonZeroAddress = (value, label) => {
  const address = ethers.getAddress(value || '');
  if (address === ethers.ZeroAddress) throw new Error(`${label} must be non-zero`);
  return address;
};

const rpcUrl = (value, label) => {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${label} must use HTTPS (HTTP is allowed only for loopback rehearsal)`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or a fragment`);
  }
  return url.toString();
};

export const parseSignerPolicy = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('signer policy must be an object');
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error('signer policy must contain at least one source');
  }

  const chainIds = new Set();
  const sources = input.sources.map((rawSource, sourceIndex) => {
    const label = `sources[${sourceIndex}]`;
    const chainId = safePositiveInteger(rawSource?.chainId, `${label}.chainId`);
    if (chainIds.has(chainId)) throw new Error(`${label}.chainId duplicates an earlier source`);
    chainIds.add(chainId);
    if (!Array.isArray(rawSource.routes) || rawSource.routes.length === 0) {
      throw new Error(`${label}.routes must contain at least one route`);
    }

    const routeKeys = new Set();
    const routes = rawSource.routes.map((rawRoute, routeIndex) => {
      const routeLabel = `${label}.routes[${routeIndex}]`;
      const route = {
        sourceToken: nonZeroAddress(rawRoute?.sourceToken, `${routeLabel}.sourceToken`),
        targetChain: safePositiveInteger(rawRoute?.targetChain, `${routeLabel}.targetChain`),
        releaseToken: nonZeroAddress(rawRoute?.releaseToken, `${routeLabel}.releaseToken`),
        releaseBridge: nonZeroAddress(rawRoute?.releaseBridge, `${routeLabel}.releaseBridge`),
      };
      // A source lock binds only sourceToken + targetChain. That pair must map
      // to exactly one release token/bridge or a requester could choose between
      // multiple policy-approved release outcomes for the same lock event.
      const key = [route.sourceToken, route.targetChain]
        .map(String)
        .join(':')
        .toLowerCase();
      if (routeKeys.has(key)) throw new Error(`${routeLabel} duplicates an earlier route`);
      routeKeys.add(key);
      return route;
    });

    return {
      chainId,
      rpcUrl: rpcUrl(rawSource.rpcUrl, `${label}.rpcUrl`),
      bridgeAddress: nonZeroAddress(rawSource.bridgeAddress, `${label}.bridgeAddress`),
      confirmations: safePositiveInteger(rawSource.confirmations, `${label}.confirmations`),
      routes,
    };
  });

  return {
    ...(input.signerAddress
      ? { signerAddress: nonZeroAddress(input.signerAddress, 'signerAddress') }
      : {}),
    sources,
  };
};

export const validateAttestation = (input) => ({
  version: Number(input?.version),
  sourceTxHash: /^0x[0-9a-fA-F]{64}$/.test(input?.sourceTxHash || '')
    ? input.sourceTxHash
    : (() => { throw new Error('sourceTxHash must be bytes32'); })(),
  sourceChain: safePositiveInteger(input?.sourceChain, 'sourceChain'),
  sourceNonce: positiveIntegerString(input?.sourceNonce, 'sourceNonce'),
  sourceBlock: safePositiveInteger(input?.sourceBlock, 'sourceBlock'),
  sourceBlockHash: input?.sourceBlockHash,
  sourceBridge: nonZeroAddress(input?.sourceBridge, 'sourceBridge'),
  sourceToken: nonZeroAddress(input?.sourceToken, 'sourceToken'),
  releaseToken: nonZeroAddress(input?.releaseToken, 'releaseToken'),
  releaseBridge: nonZeroAddress(input?.releaseBridge, 'releaseBridge'),
  user: nonZeroAddress(input?.user, 'user'),
  amount: positiveIntegerString(input?.amount, 'amount'),
  targetChain: safePositiveInteger(input?.targetChain, 'targetChain'),
});

export const releaseMessageHash = (attestation) => ethers.solidityPackedKeccak256(
  ['bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'address'],
  [
    attestation.sourceTxHash,
    attestation.sourceBridge,
    attestation.releaseToken,
    attestation.user,
    attestation.amount,
    attestation.sourceChain,
    attestation.sourceNonce,
    attestation.targetChain,
    attestation.releaseBridge,
  ],
);

export const resolvePolicy = (policy, attestation) => {
  if (attestation.version !== 1) throw new Error('unsupported attestation version');
  const source = policy.sources?.find((item) => Number(item.chainId) === attestation.sourceChain);
  if (!source) throw new Error(`source chain ${attestation.sourceChain} is not allowed`);
  if (ethers.getAddress(source.bridgeAddress) !== attestation.sourceBridge) {
    throw new Error('source bridge does not match policy');
  }
  const route = source.routes?.find((item) =>
    ethers.getAddress(item.sourceToken) === attestation.sourceToken &&
    Number(item.targetChain) === attestation.targetChain &&
    ethers.getAddress(item.releaseToken) === attestation.releaseToken &&
    ethers.getAddress(item.releaseBridge) === attestation.releaseBridge
  );
  if (!route) throw new Error('token route is not allowed');
  return { source, route };
};

export const assertLockEvent = (event, attestation) => {
  const args = event?.args;
  if (!args) throw new Error('lock event is missing');
  if (event.removed) throw new Error('lock event is removed');
  const matches =
    String(args.txHash).toLowerCase() === attestation.sourceTxHash.toLowerCase() &&
    ethers.getAddress(args.token) === attestation.sourceToken &&
    ethers.getAddress(args.user) === attestation.user &&
    args.amount.toString() === attestation.amount &&
    args.targetChain.toString() === String(attestation.targetChain) &&
    args.nonce.toString() === attestation.sourceNonce;
  if (!matches) throw new Error('source lock event does not match attestation');
};
