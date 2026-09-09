const crypto = require('crypto');
const { ethers } = require('ethers');

const ADDRESS = '0xD4949664cD82660AaE99bEdc034a0deA8A0bd517';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const requireThat = (ok, message) => { if (!ok) throw new Error(`native precompile: ${message}`); };
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const ABI = ['function name() view returns(string)', 'function symbol() view returns(string)',
  'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)'];

function identityType(asset, chainId, address) {
  const type = asset.identityType === undefined ? 'runtime-bytecode' : asset.identityType;
  requireThat(['runtime-bytecode', 'native-precompile'].includes(type), 'unknown identity type');
  if (type === 'native-precompile') {
    requireThat(chainId === 9005 && same(address, ADDRESS), 'chain/address outside approved native scope');
    requireThat(asset.runtimeSha256 === undefined, 'native asset must not claim a runtime hash');
  } else {
    requireThat(asset.nativePrecompile === undefined, 'native policy on ordinary asset');
  }
  return type;
}

function validateNativePolicy(asset) {
  if (identityType(asset, asset.originChainId, asset.originToken) !== 'native-precompile') return;
  requireThat(asset.decimals === 18 && asset.symbol === 'LITHO' && asset.name === 'Lithosphere', 'asset metadata mismatch');
  const p = asset.nativePrecompile;
  requireThat(p && typeof p === 'object' && !Array.isArray(p), 'reviewed policy required');
  requireThat(Object.keys(p).sort().join(',') === 'denom,evidenceSha256,implementationSha256,operatorApprovalUrl,securityApprovalUrl', 'unexpected policy fields');
  requireThat(p.denom === 'ulitho' && hash(p.evidenceSha256) && hash(p.implementationSha256), 'invalid evidence/implementation identity');
  for (const field of ['securityApprovalUrl', 'operatorApprovalUrl']) {
    let url;
    try { url = new URL(p[field]); } catch { throw new Error(`native precompile: ${field} required`); }
    requireThat(url.protocol === 'https:' && !url.username && !url.password, 'credential-free approval URL required');
  }
}

// This file is an independently reviewed snapshot, authenticated by its exact hash
// in the approved plan. It is NOT a self-authenticating consensus proof.
function validateNativeEvidence(asset, bytes) {
  validateNativePolicy(asset);
  requireThat(Buffer.isBuffer(bytes) && bytes.length <= 1024 * 1024, 'independent bounded evidence file required');
  requireThat(digest(bytes) === asset.nativePrecompile.evidenceSha256, 'evidence digest mismatch');
  const e = JSON.parse(bytes.toString('utf8'));
  requireThat(e.schemaVersion === 1 && e.chainId === 9005 && e.cosmosChainId === 'lithosphere_9005-1' && same(e.address, ADDRESS), 'evidence network identity mismatch');
  requireThat(e.nodeBinarySha256 === asset.nativePrecompile.implementationSha256, 'implementation mismatch');
  requireThat(Number.isSafeInteger(e.verificationBlock) && e.verificationBlock > 0 && /^0x[0-9a-fA-F]{64}$/.test(e.verificationBlockHash), 'invalid checkpoint');
  requireThat(e.moduleStateHeight === e.verificationBlock && same(e.moduleStateBlockHash, e.verificationBlockHash), 'module checkpoint mismatch');
  const p = e.erc20Params;
  requireThat(p?.enable_erc20 === true && Array.isArray(p.native_precompiles) && p.native_precompiles.length === 1 && same(p.native_precompiles[0], ADDRESS), 'native module disabled or mismatched');
  requireThat(Array.isArray(p.dynamic_precompiles) && p.dynamic_precompiles.length === 0, 'unexpected dynamic precompiles');
  requireThat(Array.isArray(e.tokenPairs) && e.tokenPairs.length === 1, 'ambiguous token-pair universe');
  const pair = e.tokenPairs[0];
  requireThat(same(pair.erc20_address, ADDRESS) && pair.denom === 'ulitho' && pair.enabled === true && pair.contract_owner === 'OWNER_MODULE', 'token pair mismatch');
  requireThat(e.bankBalance?.denom === 'ulitho' && e.bankBalance.amount === '0' && ethers.utils.isAddress(e.bankBalance.address), 'pristine bank balance evidence required');
  return e;
}

function validateNativeCheckpoint(evidence, latestBlock, header, now = Date.now() / 1000) {
  requireThat(Number.isSafeInteger(latestBlock) && latestBlock >= evidence.verificationBlock &&
    latestBlock - evidence.verificationBlock <= 32, 'checkpoint outside latest 32 blocks');
  requireThat(header && same(header.hash, evidence.verificationBlockHash), 'checkpoint header mismatch');
  requireThat(Number.isSafeInteger(header.timestamp) && now - header.timestamp <= 300 &&
    header.timestamp <= now + 5, 'checkpoint timestamp stale or future');
}

async function verifyNativePrecompile(provider, asset, bytes, bridgeAddress, block, header,
  contractFactory = (address, abi, rpc) => new ethers.Contract(address, abi, rpc)) {
  const e = validateNativeEvidence(asset, bytes);
  requireThat(e.verificationBlock === block && same(e.verificationBlockHash, header.hash), 'EVM checkpoint mismatch');
  requireThat(same(e.bankBalance.address, bridgeAddress), 'bank balance belongs to another bridge');
  requireThat(Number((await provider.getNetwork()).chainId) === 9005, 'RPC chain mismatch');
  requireThat(await provider.getCode(ADDRESS, block) === '0x', 'unexpected native runtime code');
  const token = contractFactory(ADDRESS, ABI, provider);
  const options = { blockTag: block };
  const [name, symbol, decimals, balance, native] = await Promise.all([
    token.name(options), token.symbol(options), token.decimals(options),
    token.balanceOf(bridgeAddress, options), provider.getBalance(bridgeAddress, block),
  ]);
  requireThat(name === 'Lithosphere' && symbol === 'LITHO' && Number(decimals) === 18, 'RPC metadata mismatch');
  requireThat(balance.toString() === '0' && native.toString() === e.bankBalance.amount, 'bank/EVM/ERC20 pristine balance mismatch');
  requireThat(same((await provider.getBlock(block))?.hash, header.hash), 'checkpoint changed during native verification');
  return { identityType: 'native-precompile', address: ADDRESS, evidenceSha256: digest(bytes),
    implementationSha256: e.nodeBinarySha256, verificationBlock: block, verificationBlockHash: header.hash };
}

module.exports = { ADDRESS, identityType, validateNativePolicy, validateNativeEvidence, validateNativeCheckpoint, verifyNativePrecompile };
