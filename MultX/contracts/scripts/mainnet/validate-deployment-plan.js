const fs = require('fs');
const { validateNativePolicy } = require('./verify-native-precompile');
const path = require('path');
const { ethers } = require('ethers');
const { validateGovernancePolicy } = require('./governance-policy');

const REQUIRED_CHAIN_IDS = [9005, 1, 56, 8453];
const DESTINATION_CHAIN_IDS = [1, 56, 8453];
const PLACEHOLDER = /(REPLACE_WITH|PENDING|TBD|CHANGEME|DRAFT_DO_NOT_EXECUTE)/i;

const requiredObject = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
};

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  if (PLACEHOLDER.test(value)) throw new Error(`${field} contains a placeholder`);
  return value.trim();
};

const exactHttpsUrl = (value, field) => {
  const text = requiredText(value, field);
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`${field} must be a valid URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${field} must use credential-free HTTPS`);
  }
  return parsed.toString();
};

const wssUrl = (value, field) => {
  const text = requiredText(value, field);
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`${field} must be a valid URL`); }
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password) {
    throw new Error(`${field} must use credential-free WSS`);
  }
  return parsed.toString();
};

const address = (value, field) => {
  const text = requiredText(value, field);
  let parsed;
  try { parsed = ethers.utils.getAddress(text); } catch { throw new Error(`${field} must be a valid EVM address`); }
  if (parsed === ethers.constants.AddressZero) throw new Error(`${field} must not be zero`);
  return parsed;
};

const positiveInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive safe integer`);
  return parsed;
};

const isoUtc = (value, field) => {
  const text = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${field} must be an exact UTC timestamp ending in Z`);
  }
  return text;
};

const positiveBaseUnits = (value, field) => {
  const text = requiredText(value, field);
  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) {
    throw new Error(`${field} must be a positive base-unit integer string`);
  }
  return text;
};

const assertNoPlaceholders = (value, field = 'plan') => {
  if (typeof value === 'string' && PLACEHOLDER.test(value)) {
    throw new Error(`${field} contains a placeholder`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => assertNoPlaceholders(item, `${field}[${index}]`));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => assertNoPlaceholders(item, `${field}.${key}`));
  }
};

function validateDeploymentPlan(input) {
  requiredObject(input, 'plan');
  assertNoPlaceholders(input);
  if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (input.status !== 'approved-for-deployment') throw new Error('status must be approved-for-deployment');

  const release = requiredObject(input.release, 'release');
  const auditedTag = requiredText(release.auditedTag, 'release.auditedTag');
  if (!/^multx-[a-z0-9.-]+$/i.test(auditedTag)) throw new Error('release.auditedTag is invalid');
  const commit = requiredText(release.commit, 'release.commit');
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('release.commit must be a 40-character Git SHA');
  const evidenceHash = requiredText(release.bytecodeEvidenceSha256, 'release.bytecodeEvidenceSha256');
  if (!/^[0-9a-f]{64}$/i.test(evidenceHash)) throw new Error('release.bytecodeEvidenceSha256 must be SHA-256');
  const sourceRuntimeHash = requiredText(release.sourceBridgeRuntimeSha256, 'release.sourceBridgeRuntimeSha256');
  if (!/^[0-9a-f]{64}$/i.test(sourceRuntimeHash)) throw new Error('release.sourceBridgeRuntimeSha256 must be SHA-256');
  const destinationRuntimeHash = requiredText(release.destinationBridgeRuntimeSha256, 'release.destinationBridgeRuntimeSha256');
  if (!/^[0-9a-f]{64}$/i.test(destinationRuntimeHash)) throw new Error('release.destinationBridgeRuntimeSha256 must be SHA-256');
  const wrappedRuntimeHash = requiredText(release.wrappedTokenNormalizedRuntimeSha256, 'release.wrappedTokenNormalizedRuntimeSha256');
  if (!/^[0-9a-f]{64}$/i.test(wrappedRuntimeHash)) throw new Error('release.wrappedTokenNormalizedRuntimeSha256 must be SHA-256');
  if (!/^[0-9a-f]{64}$/i.test(release.govTimelockRuntimeSha256 || '')) throw new Error('release.govTimelockRuntimeSha256 must be SHA-256');
  exactHttpsUrl(release.auditReportUrl, 'release.auditReportUrl');
  exactHttpsUrl(release.fixReviewUrl, 'release.fixReviewUrl');

  const window = requiredObject(input.changeWindow, 'changeWindow');
  const start = isoUtc(window.startUtc, 'changeWindow.startUtc');
  const end = isoUtc(window.endUtc, 'changeWindow.endUtc');
  if (Date.parse(end) <= Date.parse(start)) throw new Error('changeWindow.endUtc must be after startUtc');
  exactHttpsUrl(window.approvalRecordUrl, 'changeWindow.approvalRecordUrl');

  const signerSet = requiredObject(input.bridgeSignerSet, 'bridgeSignerSet');
  if (signerSet.threshold !== 5) throw new Error('bridgeSignerSet.threshold must be 5');
  if (!Array.isArray(signerSet.addresses) || signerSet.addresses.length !== 7) {
    throw new Error('bridgeSignerSet.addresses must contain exactly seven addresses');
  }
  const signerAddresses = signerSet.addresses.map((item, index) => address(item, `bridgeSignerSet.addresses[${index}]`));
  if (new Set(signerAddresses.map((item) => item.toLowerCase())).size !== 7) {
    throw new Error('bridgeSignerSet.addresses must be unique');
  }
  if (!Array.isArray(signerSet.acceptanceRecords) || signerSet.acceptanceRecords.length !== 7) {
    throw new Error('bridgeSignerSet.acceptanceRecords must contain exactly seven URLs');
  }
  signerSet.acceptanceRecords.forEach((item, index) => exactHttpsUrl(item, `bridgeSignerSet.acceptanceRecords[${index}]`));

  if (!Array.isArray(input.chains) || input.chains.length !== 4) {
    throw new Error('chains must contain LITHO, Ethereum, BNB and Base exactly once');
  }
  const chains = new Map();
  for (const [index, chain] of input.chains.entries()) {
    const prefix = `chains[${index}]`;
    requiredObject(chain, prefix);
    const chainId = positiveInteger(chain.chainId, `${prefix}.chainId`);
    if (!REQUIRED_CHAIN_IDS.includes(chainId) || chains.has(chainId)) throw new Error(`${prefix}.chainId is unsupported or duplicated`);
    const expectedKind = chainId === 9005 ? 'source' : 'destination';
    if (chain.bridgeKind !== expectedKind) throw new Error(`${prefix}.bridgeKind must be ${expectedKind}`);
    requiredText(chain.name, `${prefix}.name`);
    address(chain.expectedBridgeAddress, `${prefix}.expectedBridgeAddress`);
    exactHttpsUrl(chain.rpcHttps, `${prefix}.rpcHttps`);
    wssUrl(chain.rpcWss, `${prefix}.rpcWss`);
    positiveInteger(chain.confirmations, `${prefix}.confirmations`);
    const safe = address(chain.safe, `${prefix}.safe`);
    const timelock = address(chain.timelock, `${prefix}.timelock`);
    const guardian = address(chain.pauseGuardian, `${prefix}.pauseGuardian`);
    address(chain.deployer, `${prefix}.deployer`);
    address(chain.feePayer, `${prefix}.feePayer`);
    if (new Set([safe, timelock, guardian].map((item) => item.toLowerCase())).size !== 3) {
      throw new Error(`${prefix} Safe, timelock and pause guardian must be distinct`);
    }
    if (positiveInteger(chain.timelockDelaySeconds, `${prefix}.timelockDelaySeconds`) < 172800) {
      throw new Error(`${prefix}.timelockDelaySeconds must be at least 172800`);
    }
    validateGovernancePolicy(chain);
    chains.set(chainId, chain);
  }
  REQUIRED_CHAIN_IDS.forEach((chainId) => {
    if (!chains.has(chainId)) throw new Error(`chains is missing required chain ${chainId}`);
  });

  if (!Array.isArray(input.assets) || input.assets.length === 0) throw new Error('assets must be non-empty');
  const assetKeys = new Set();
  input.assets.forEach((asset, index) => {
    const prefix = `assets[${index}]`;
    requiredObject(asset, prefix);
    const symbol = requiredText(asset.symbol, `${prefix}.symbol`);
    requiredText(asset.name, `${prefix}.name`);
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) {
      throw new Error(`${prefix}.decimals must be an integer from 0 to 255`);
    }
    if (asset.originChainId !== 9005) throw new Error(`${prefix}.originChainId must be 9005`);
    const originToken = address(asset.originToken, `${prefix}.originToken`);
    validateNativePolicy(asset);
    const key = `${symbol.toLowerCase()}:${originToken.toLowerCase()}`;
    if (assetKeys.has(key)) throw new Error(`${prefix} duplicates an approved asset`);
    assetKeys.add(key);
    if (!Array.isArray(asset.destinationChainIds) ||
        asset.destinationChainIds.length !== 3 ||
        !DESTINATION_CHAIN_IDS.every((chainId) => asset.destinationChainIds.includes(chainId))) {
      throw new Error(`${prefix}.destinationChainIds must contain 1, 56 and 8453 exactly once`);
    }
    if (new Set(asset.destinationChainIds).size !== 3) throw new Error(`${prefix}.destinationChainIds contains duplicates`);
    const caps = requiredObject(asset.dailyCapBaseUnits, `${prefix}.dailyCapBaseUnits`);
    REQUIRED_CHAIN_IDS.forEach((chainId) => positiveBaseUnits(caps[String(chainId)], `${prefix}.dailyCapBaseUnits.${chainId}`));
    const destinationTokens = requiredObject(asset.destinationTokenAddresses, `${prefix}.destinationTokenAddresses`);
    DESTINATION_CHAIN_IDS.forEach((chainId) => address(destinationTokens[String(chainId)], `${prefix}.destinationTokenAddresses.${chainId}`));
    exactHttpsUrl(asset.approvalRecordUrl, `${prefix}.approvalRecordUrl`);
  });

  return input;
}

if (require.main === module) {
  const planIndex = process.argv.indexOf('--plan');
  if (planIndex === -1 || !process.argv[planIndex + 1]) {
    console.error('Usage: node validate-deployment-plan.js --plan /absolute/path/to/plan.json');
    process.exit(2);
  }
  const file = path.resolve(process.argv[planIndex + 1]);
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateDeploymentPlan(plan);
  console.log(`Validated transaction-free MultX deployment plan: ${file}`);
}

module.exports = { validateDeploymentPlan };
