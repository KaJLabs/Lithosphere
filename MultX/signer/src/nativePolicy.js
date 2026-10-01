import { ZeroAddress, getAddress } from 'ethers';

const positiveInteger = (value, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive safe integer`);
  return number;
};
const address = (value, label) => {
  const normalized = getAddress(value || '');
  if (normalized === ZeroAddress) throw new Error(`${label} must be non-zero`);
  return normalized;
};
const bytes32 = (value, label) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value || '')) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase();
};
const rpcUrl = (value, label) => {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`${label} must use HTTPS or loopback HTTP`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} must not embed credentials or parameters`);
  return url.toString();
};

export function parseNativeSignerPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('native signer policy must be an object');
  if (!Array.isArray(input.chains) || input.chains.length < 2) throw new Error('native signer policy requires at least two chains');
  const seen = new Set();
  const chains = input.chains.map((item, index) => {
    const label = `chains[${index}]`;
    const chainId = positiveInteger(item?.chainId, `${label}.chainId`);
    if (seen.has(chainId)) throw new Error(`${label}.chainId duplicates another chain`);
    seen.add(chainId);
    return {
      chainId,
      rpcUrl: rpcUrl(item?.rpcUrl, `${label}.rpcUrl`),
      vault: address(item?.vault, `${label}.vault`),
      confirmations: positiveInteger(item?.confirmations, `${label}.confirmations`),
      finalityDelaySeconds: positiveInteger(item?.finalityDelaySeconds, `${label}.finalityDelaySeconds`),
    };
  });
  return {
    signerAddress: input.signerAddress ? address(input.signerAddress, 'signerAddress') : undefined,
    quoteSigner: address(input.quoteSigner, 'quoteSigner'),
    authorityEpoch: bytes32(input.authorityEpoch, 'authorityEpoch'),
    chains,
  };
}

export function resolveNativeChain(policy, chainId, vault) {
  const id = positiveInteger(chainId, 'chainId');
  const chain = policy.chains.find(item => item.chainId === id);
  if (!chain) throw new Error(`native chain ${id} is not approved`);
  if (vault && getAddress(vault) !== chain.vault) throw new Error(`native vault for chain ${id} is not approved`);
  return chain;
}
