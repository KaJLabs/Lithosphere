const fs = require('fs');
const { identityType } = require('./verify-native-precompile');
const path = require('path');
const { ethers } = require('ethers');

const REQUIRED_CHAIN_IDS = [9005, 1, 56, 8453];
const PLACEHOLDER = /(REPLACE_WITH|PENDING|TBD|CHANGEME|DRAFT_DO_NOT_USE)/i;

const object = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
};

const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  if (PLACEHOLDER.test(value)) throw new Error(`${field} contains a placeholder`);
  return value.trim();
};

const url = (value, field) => {
  let parsed;
  try { parsed = new URL(text(value, field)); } catch { throw new Error(`${field} must be a valid URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${field} must use credential-free HTTPS`);
  return parsed.toString();
};

const address = (value, field) => {
  let parsed;
  try { parsed = ethers.utils.getAddress(text(value, field)); } catch { throw new Error(`${field} must be a valid EVM address`); }
  if (parsed === ethers.constants.AddressZero) throw new Error(`${field} must not be zero`);
  return parsed;
};

const hash = (value, bytes, field) => {
  const parsed = text(value, field);
  if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(parsed)) throw new Error(`${field} must be a ${bytes}-byte hex value`);
  return parsed.toLowerCase();
};

const sha256 = (value, field) => {
  const parsed = text(value, field);
  if (!/^[0-9a-f]{64}$/i.test(parsed)) throw new Error(`${field} must be SHA-256`);
  return parsed.toLowerCase();
};

const positiveInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive safe integer`);
  return parsed;
};

const baseUnits = (value, field) => {
  const parsed = text(value, field);
  if (!/^[0-9]+$/.test(parsed) || BigInt(parsed) <= 0n) throw new Error(`${field} must be a positive base-unit integer string`);
  return parsed;
};

const exactUtc = (value, field) => {
  const parsed = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${field} must be an exact UTC timestamp ending in Z`);
  }
  return parsed;
};

const rejectPlaceholders = (value, field = 'manifest') => {
  if (typeof value === 'string' && PLACEHOLDER.test(value)) throw new Error(`${field} contains a placeholder`);
  if (Array.isArray(value)) value.forEach((item, index) => rejectPlaceholders(item, `${field}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => rejectPlaceholders(item, `${field}.${key}`));
};

function validateDeploymentManifest(input) {
  object(input, 'manifest');
  rejectPlaceholders(input);
  if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (input.status !== 'deployed-paused-verified') throw new Error('status must be deployed-paused-verified');

  const release = object(input.release, 'release');
  text(release.auditedTag, 'release.auditedTag');
  if (!/^[0-9a-f]{40}$/i.test(text(release.commit, 'release.commit'))) throw new Error('release.commit must be a 40-character Git SHA');
  sha256(release.deploymentPlanSha256, 'release.deploymentPlanSha256');
  sha256(release.bytecodeEvidenceSha256, 'release.bytecodeEvidenceSha256');
  const sourceRuntimeHash = sha256(release.sourceBridgeRuntimeSha256, 'release.sourceBridgeRuntimeSha256');
  const destinationRuntimeHash = sha256(release.destinationBridgeRuntimeSha256, 'release.destinationBridgeRuntimeSha256');
  sha256(release.wrappedTokenNormalizedRuntimeSha256, 'release.wrappedTokenNormalizedRuntimeSha256');
  sha256(release.govTimelockRuntimeSha256, 'release.govTimelockRuntimeSha256');
  url(release.deploymentApprovalUrl, 'release.deploymentApprovalUrl');
  exactUtc(release.deployedAtUtc, 'release.deployedAtUtc');

  if (!Array.isArray(input.chains) || input.chains.length !== 4) throw new Error('chains must contain exactly four mainnets');
  const chains = new Map();
  let expectedValidators = null;
  let expectedSymbols = null;
  for (const [index, chain] of input.chains.entries()) {
    const prefix = `chains[${index}]`;
    object(chain, prefix);
    const chainId = positiveInteger(chain.chainId, `${prefix}.chainId`);
    if (!REQUIRED_CHAIN_IDS.includes(chainId) || chains.has(chainId)) throw new Error(`${prefix}.chainId is unsupported or duplicated`);
    const expectedKind = chainId === 9005 ? 'source' : 'destination';
    if (chain.bridgeKind !== expectedKind) throw new Error(`${prefix}.bridgeKind must be ${expectedKind}`);
    text(chain.name, `${prefix}.name`);
    url(chain.rpcHttps, `${prefix}.rpcHttps`);

    const governance = object(chain.governance, `${prefix}.governance`);
    hash(governance.timelockDeploymentTxHash, 32, `${prefix}.governance.timelockDeploymentTxHash`);
    positiveInteger(governance.timelockDeploymentBlock, `${prefix}.governance.timelockDeploymentBlock`);
    const bridge = object(chain.bridge, `${prefix}.bridge`);
    address(bridge.address, `${prefix}.bridge.address`);
    hash(bridge.deploymentTxHash, 32, `${prefix}.bridge.deploymentTxHash`);
    positiveInteger(bridge.deploymentBlock, `${prefix}.bridge.deploymentBlock`);
    const bridgeRuntimeHash = sha256(bridge.runtimeSha256, `${prefix}.bridge.runtimeSha256`);
    const auditedRuntimeHash = chainId === 9005 ? sourceRuntimeHash : destinationRuntimeHash;
    if (bridgeRuntimeHash !== auditedRuntimeHash) throw new Error(`${prefix}.bridge.runtimeSha256 does not match the audited release`);
    const owner = address(bridge.owner, `${prefix}.bridge.owner`);
    const governanceSafe = address(bridge.governanceSafe, `${prefix}.bridge.governanceSafe`);
    const guardian = address(bridge.pauseGuardian, `${prefix}.bridge.pauseGuardian`);
    if (new Set([owner, governanceSafe, guardian].map((item) => item.toLowerCase())).size !== 3) {
      throw new Error(`${prefix}.bridge owner, governance Safe and pause guardian must be distinct`);
    }
    if (bridge.paused !== true) throw new Error(`${prefix}.bridge.paused must be true`);
    if (bridge.signaturesRequired !== 5) throw new Error(`${prefix}.bridge.signaturesRequired must be 5`);
    if (!Array.isArray(bridge.validators) || bridge.validators.length !== 7) throw new Error(`${prefix}.bridge.validators must contain seven addresses`);
    const validators = bridge.validators.map((item, signerIndex) => address(item, `${prefix}.bridge.validators[${signerIndex}]`).toLowerCase());
    if (new Set(validators).size !== 7) throw new Error(`${prefix}.bridge.validators must be unique`);
    if (expectedValidators && JSON.stringify(validators) !== JSON.stringify(expectedValidators)) throw new Error(`${prefix}.bridge.validators does not match the approved cross-chain set`);
    expectedValidators ||= validators;
    url(bridge.explorerUrl, `${prefix}.bridge.explorerUrl`);
    if (bridge.sourceVerified !== true) throw new Error(`${prefix}.bridge.sourceVerified must be true`);

    if (!Array.isArray(chain.assets) || chain.assets.length === 0) throw new Error(`${prefix}.assets must be non-empty`);
    const symbols = new Set();
    chain.assets.forEach((asset, assetIndex) => {
      const assetPrefix = `${prefix}.assets[${assetIndex}]`;
      object(asset, assetPrefix);
      const symbol = text(asset.symbol, `${assetPrefix}.symbol`).toLowerCase();
      if (symbols.has(symbol)) throw new Error(`${assetPrefix}.symbol is duplicated`);
      symbols.add(symbol);
      address(asset.address, `${assetPrefix}.address`);
      const expectedTargets = chainId === 9005 ? [1, 56, 8453] : [9005];
      if (!Array.isArray(asset.targetChainIds) ||
          asset.targetChainIds.length !== expectedTargets.length ||
          !expectedTargets.every((target) => asset.targetChainIds.includes(target)) ||
          new Set(asset.targetChainIds).size !== asset.targetChainIds.length) {
        throw new Error(`${assetPrefix}.targetChainIds must contain exactly ${expectedTargets.join(', ')}`);
      }
      baseUnits(asset.dailyCapBaseUnits, `${assetPrefix}.dailyCapBaseUnits`);
      const native = identityType(asset, chainId, asset.address) === 'native-precompile';
      if (!native) sha256(asset.runtimeSha256, `${assetPrefix}.runtimeSha256`);
      if (native && asset.nativePrecompile !== undefined) throw new Error('native policy belongs in independently approved plan only');
      if (chainId === 9005) {
        if (asset.kind !== 'canonical') throw new Error(`${assetPrefix}.kind must be canonical`);
      } else {
        if (asset.kind !== 'wrapped') throw new Error(`${assetPrefix}.kind must be wrapped`);
        if (asset.originChainId !== 9005) throw new Error(`${assetPrefix}.originChainId must be 9005`);
        address(asset.originToken, `${assetPrefix}.originToken`);
        hash(asset.deploymentTxHash, 32, `${assetPrefix}.deploymentTxHash`);
        positiveInteger(asset.deploymentBlock, `${assetPrefix}.deploymentBlock`);
        url(asset.explorerUrl, `${assetPrefix}.explorerUrl`);
        if (asset.sourceVerified !== true) throw new Error(`${assetPrefix}.sourceVerified must be true`);
      }
    });
    const sortedSymbols = [...symbols].sort();
    if (expectedSymbols && JSON.stringify(sortedSymbols) !== JSON.stringify(expectedSymbols)) throw new Error(`${prefix}.assets does not match the approved cross-chain symbol set`);
    expectedSymbols ||= sortedSymbols;
    chains.set(chainId, chain);
  }
  REQUIRED_CHAIN_IDS.forEach((chainId) => {
    if (!chains.has(chainId)) throw new Error(`chains is missing required chain ${chainId}`);
  });
  return input;
}

if (require.main === module) {
  const index = process.argv.indexOf('--manifest');
  if (index === -1 || !process.argv[index + 1]) {
    console.error('Usage: node validate-deployment-manifest.js --manifest /absolute/path/to/manifest.json');
    process.exit(2);
  }
  const file = path.resolve(process.argv[index + 1]);
  validateDeploymentManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Validated paused MultX deployment manifest: ${file}`);
}

module.exports = { validateDeploymentManifest };
