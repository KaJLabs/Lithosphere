const crypto = require('crypto');
const { identityType, validateNativeEvidence, validateNativeCheckpoint, verifyNativePrecompile } = require('./verify-native-precompile');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { verifyGovernance } = require('./verify-governance');
const { validateDeploymentManifest } = require('./validate-deployment-manifest');
const { validateDeploymentPlan } = require('./validate-deployment-plan');

const BRIDGE_ABI = [
  'function owner() view returns (address)',
  'function pauseGuardian() view returns (address)',
  'function paused() view returns (bool)',
  'function signaturesRequired() view returns (uint256)',
  'function validators(uint256) view returns (address)',
  'function getValidators() view returns (address[])',
  'function getValidatorCount() view returns (uint256)',
  'function supportedTokens(address) view returns (bool)',
  'function supportedRoutes(address,uint256) view returns (bool)',
  'function dailyCap(address) view returns (uint256)',
  'function dailyVolume(address) view returns (uint256)',
  'function releaseVolume(address) view returns (uint256)',
  'function nonce() view returns (uint256)',
];

const WRAPPED_ABI = [
  'function originChainId() view returns (uint256)',
  'function originToken() view returns (address)',
  'function bridge() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const LOCKED_TOPIC = ethers.utils.id('TokensLocked(bytes32,address,address,uint256,uint256,uint256)');
const RELEASED_TOPIC = ethers.utils.id('TokensReleased(bytes32,address,address,uint256,uint256,address,address)');
const ROUTE_INTERFACE = new ethers.utils.Interface([
  'event SupportedRouteSet(address indexed token,uint256 indexed targetChain,bool supported)',
]);
const ROUTE_TOPIC = ROUTE_INTERFACE.getEventTopic('SupportedRouteSet');
const LOG_BLOCK_RANGE = 2_000;

const sha256Code = (code) => crypto.createHash('sha256')
  .update(Buffer.from(code.slice(2), 'hex'))
  .digest('hex');

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const equalAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

function validateBytecodeEvidence(evidenceBytes) {
  let evidence;
  try { evidence = JSON.parse(evidenceBytes.toString('utf8')); }
  catch { throw new Error('bytecode evidence must be a canonical JSON manifest'); }
  const sha = (value, label) => {
    if (!/^[0-9a-f]{64}$/i.test(value || '')) throw new Error(`${label} must be SHA-256`);
    return value.toLowerCase();
  };
  if (!evidence.contracts || !evidence.contracts.wrappedToken) throw new Error('bytecode evidence contract records are required');
  sha(evidence.contracts.govTimelock?.runtimeSha256, 'GovTimelock evidence hash');
  sha(evidence.contracts.sourceBridge?.runtimeSha256, 'source bridge evidence hash');
  sha(evidence.contracts.destinationBridge?.runtimeSha256, 'destination bridge evidence hash');
  sha(evidence.contracts.wrappedToken.normalizedRuntimeSha256, 'wrapped-token normalized evidence hash');
  for (const [name, record] of Object.entries(evidence.contracts)) {
    if (!/^0x[0-9a-f]+$/i.test(record.creationBytecode || '') ||
        sha256Code(record.creationBytecode) !== sha(record.creationSha256, `${name} creation hash`)) {
      throw new Error(`${name} creation bytecode does not match its evidence hash`);
    }
  }
  const refs = evidence.contracts.wrappedToken.immutableReferences;
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => (
    !Number.isSafeInteger(ref.start) || ref.start < 0 || !Number.isSafeInteger(ref.length) || ref.length <= 0
  ))) throw new Error('wrapped-token immutable references are invalid');
  return evidence;
}

function normalizedRuntimeSha256(code, immutableReferences) {
  const bytes = Buffer.from(code.slice(2), 'hex');
  for (const ref of immutableReferences) {
    if (ref.start + ref.length > bytes.length) throw new Error('immutable reference exceeds wrapped-token runtime bytecode');
    bytes.fill(0, ref.start, ref.start + ref.length);
  }
  return sha256Bytes(bytes);
}

function verifyApprovedDeploymentBindings(planBytes, evidenceBytes, manifest) {
  if (!Buffer.isBuffer(planBytes) || !Buffer.isBuffer(evidenceBytes)) {
    throw new Error('approved plan and bytecode evidence must be independently supplied as raw files');
  }
  const plan = JSON.parse(planBytes.toString('utf8'));
  const evidence = validateBytecodeEvidence(evidenceBytes);
  validateDeploymentPlan(plan);
  validateDeploymentManifest(manifest);
  if (sha256Bytes(planBytes) !== manifest.release.deploymentPlanSha256.toLowerCase()) {
    throw new Error('approved deployment plan SHA-256 does not match manifest');
  }
  if (sha256Bytes(evidenceBytes) !== plan.release.bytecodeEvidenceSha256.toLowerCase() ||
      sha256Bytes(evidenceBytes) !== manifest.release.bytecodeEvidenceSha256.toLowerCase()) {
    throw new Error('independent bytecode evidence SHA-256 does not match plan and manifest');
  }
  for (const field of ['auditedTag', 'commit']) {
    if (String(plan.release[field]).toLowerCase() !== String(manifest.release[field]).toLowerCase()) {
      throw new Error(`release.${field} does not match approved plan`);
    }
  }
  if (String(evidence.auditedTag).toLowerCase() !== plan.release.auditedTag.toLowerCase() ||
      String(evidence.commit).toLowerCase() !== plan.release.commit.toLowerCase()) {
    throw new Error('bytecode evidence source identity does not match approved plan');
  }
  const evidenceHashes = {
    govTimelockRuntimeSha256: evidence.contracts.govTimelock.runtimeSha256,
    sourceBridgeRuntimeSha256: evidence.contracts.sourceBridge.runtimeSha256,
    destinationBridgeRuntimeSha256: evidence.contracts.destinationBridge.runtimeSha256,
    wrappedTokenNormalizedRuntimeSha256: evidence.contracts.wrappedToken.normalizedRuntimeSha256,
  };
  for (const [field, value] of Object.entries(evidenceHashes)) {
    if (value.toLowerCase() !== plan.release[field].toLowerCase() ||
        value.toLowerCase() !== manifest.release[field].toLowerCase()) {
      throw new Error(`${field} is not bound to independent bytecode evidence`);
    }
  }
  const approvedValidators = plan.bridgeSignerSet.addresses.map((item) => item.toLowerCase());
  for (const chain of manifest.chains) {
    const approvedChain = plan.chains.find((item) => item.chainId === chain.chainId);
    if (!approvedChain) throw new Error(`${chain.name} is absent from approved plan`);
    if (chain.name !== approvedChain.name || chain.bridgeKind !== approvedChain.bridgeKind ||
        new URL(chain.rpcHttps).toString() !== new URL(approvedChain.rpcHttps).toString()) {
      throw new Error(`${chain.name} identity or RPC does not match approved plan`);
    }
    if (!equalAddress(chain.bridge.address, approvedChain.expectedBridgeAddress)) {
      throw new Error(`${chain.name} bridge address does not match approved plan`);
    }
    if (!equalAddress(chain.bridge.owner, approvedChain.timelock) ||
        !equalAddress(chain.bridge.governanceSafe, approvedChain.safe) ||
        !equalAddress(chain.bridge.pauseGuardian, approvedChain.pauseGuardian)) {
      throw new Error(`${chain.name} governance does not match approved plan`);
    }
    if (chain.bridge.signaturesRequired !== plan.bridgeSignerSet.threshold ||
        chain.bridge.validators.some((item, index) => item.toLowerCase() !== approvedValidators[index])) {
      throw new Error(`${chain.name} signer policy does not match approved plan`);
    }
    if (chain.assets.length !== plan.assets.length) {
      throw new Error(`${chain.name} asset set does not exactly match approved plan`);
    }
    for (const approvedAsset of plan.assets) {
      const asset = chain.assets.find((item) => item.symbol.toLowerCase() === approvedAsset.symbol.toLowerCase());
      if (!asset) throw new Error(`${chain.name} is missing approved asset ${approvedAsset.symbol}`);
      const expectedTargets = chain.chainId === 9005 ? approvedAsset.destinationChainIds : [9005];
      if (asset.targetChainIds.map(Number).sort().join(',') !== [...expectedTargets].map(Number).sort().join(',') ||
          asset.dailyCapBaseUnits !== approvedAsset.dailyCapBaseUnits[String(chain.chainId)]) {
        throw new Error(`${chain.name} ${asset.symbol} routes or cap do not match approved plan`);
      }
      if (chain.chainId === 9005) {
        if (identityType(asset, 9005, asset.address) !== identityType(approvedAsset, 9005, approvedAsset.originToken)) {
          throw new Error('asset identity type does not match approved plan');
        }
        if (!equalAddress(asset.address, approvedAsset.originToken)) {
          throw new Error(`${chain.name} ${asset.symbol} origin token does not match approved plan`);
        }
      } else {
        if (asset.originChainId !== approvedAsset.originChainId ||
            !equalAddress(asset.originToken, approvedAsset.originToken)) {
          throw new Error(`${chain.name} ${asset.symbol} origin mapping does not match approved plan`);
        }
        if (!equalAddress(asset.address, approvedAsset.destinationTokenAddresses[String(chain.chainId)])) {
          throw new Error(`${chain.name} ${asset.symbol} wrapped address does not match approved plan`);
        }
      }
    }
  }
  return { plan, evidence };
}

async function verifyCreationProvenance(provider, address, txHash, deploymentBlock, label, expectedDeployer, expectedCreationBytecode) {
  const [receipt, transaction] = await Promise.all([
    provider.getTransactionReceipt(txHash), provider.getTransaction(txHash),
  ]);
  if (!receipt || Number(receipt.status) !== 1 || Number(receipt.blockNumber) !== deploymentBlock) {
    throw new Error(`${label} deployment receipt does not prove the declared creation block`);
  }
  if (!receipt.contractAddress || !equalAddress(receipt.contractAddress, address)) {
    throw new Error(`${label} deployment receipt contract address mismatch`);
  }
  if (!transaction || transaction.hash.toLowerCase() !== txHash.toLowerCase() ||
      (expectedDeployer && !equalAddress(transaction.from, expectedDeployer))) {
    throw new Error(`${label} deployment transaction provenance mismatch`);
  }
  if (!expectedCreationBytecode || !String(transaction.data || '').toLowerCase().startsWith(expectedCreationBytecode.toLowerCase())) {
    throw new Error(`${label} deployment transaction does not contain audited creation bytecode`);
  }
  const [before, created] = await Promise.all([
    provider.getCode(address, deploymentBlock - 1),
    provider.getCode(address, deploymentBlock),
  ]);
  if (before !== '0x' || created === '0x') {
    throw new Error(`${label} bytecode boundary does not prove creation at declared block`);
  }
  return deploymentBlock;
}

async function verifyExactValidatorSet(bridge, expected, chainName, blockTag) {
  const [countValue, completeSet] = await Promise.all([
    bridge.getValidatorCount({ blockTag }),
    bridge.getValidators({ blockTag }),
  ]);
  const count = Number(countValue.toString());
  if (count !== expected.length || completeSet.length !== expected.length) {
    throw new Error(`${chainName} live validator count ${count} does not equal manifest count ${expected.length}`);
  }
  if (completeSet.some((item, index) => item.toLowerCase() !== expected[index].toLowerCase())) {
    throw new Error(`${chainName} bridge validator set mismatch`);
  }
  return completeSet;
}

async function getLogsByTopics(provider, address, fromBlock, toBlock, topics) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_BLOCK_RANGE) {
    const end = Math.min(toBlock, start + LOG_BLOCK_RANGE - 1);
    logs.push(...await provider.getLogs({
      address,
      fromBlock: start,
      toBlock: end,
      topics,
    }));
  }
  return logs;
}

async function getBridgeActivityLogs(provider, address, fromBlock, toBlock) {
  return getLogsByTopics(provider, address, fromBlock, toBlock, [[LOCKED_TOPIC, RELEASED_TOPIC]]);
}

async function verifyPristineBridgeHistory(provider, bridge, chain, verificationBlock) {
  const nonce = await bridge.nonce({ blockTag: verificationBlock });
  if (!nonce.isZero()) throw new Error(`${chain.name} bridge nonce is not zero before canary`);
  const activity = await getBridgeActivityLogs(
    provider,
    chain.bridge.address,
    chain.bridge.deploymentBlock,
    verificationBlock,
  );
  if (activity.length !== 0) {
    throw new Error(`${chain.name} bridge has historical lock/release activity before canary`);
  }
}

async function verifyRouteUniverse(provider, bridge, asset, manifest, chain, blockTag) {
  const configuredLogs = await getLogsByTopics(
    provider,
    chain.bridge.address,
    chain.bridge.deploymentBlock,
    blockTag,
    [ROUTE_TOPIC],
  );
  const configuredTargets = configuredLogs
    .map((log) => ROUTE_INTERFACE.parseLog(log))
    .filter((event) => event.args.token.toLowerCase() === asset.address.toLowerCase())
    .map((event) => event.args.targetChain.toString());
  const routeTargets = [...new Set(manifest.chains
    .map((candidate) => String(candidate.chainId))
    .filter((target) => target !== String(chain.chainId))
    .concat(configuredTargets))];
  const states = await Promise.all(routeTargets.map(async (targetChain) => ({
    targetChain,
    enabled: await bridge.supportedRoutes(asset.address, targetChain, { blockTag }),
    expected: asset.targetChainIds.map(String).includes(targetChain),
  })));
  if (states.some(({ enabled, expected }) => enabled !== expected)) {
    throw new Error(`${chain.name} ${asset.symbol} on-chain routes do not exactly match the approved production universe`);
  }
}

const TOKEN_INTERFACE = new ethers.utils.Interface([
  'event SupportedTokenSet(address indexed token,bool supported)',
]);
async function verifyTokenUniverse(provider, bridge, chain, blockTag) {
  const logs = await getLogsByTopics(provider, chain.bridge.address, chain.bridge.deploymentBlock,
    blockTag, [TOKEN_INTERFACE.getEventTopic('SupportedTokenSet')]);
  const state = new Map();
  for (const log of [...logs].sort((a,b) => a.blockNumber-b.blockNumber || a.transactionIndex-b.transactionIndex || a.logIndex-b.logIndex)) {
    if (log.removed) throw new Error('removed supported-token log');
    const event = TOKEN_INTERFACE.parseLog(log);
    state.set(event.args.token.toLowerCase(), event.args.supported);
  }
  const expected = chain.assets.map(a => a.address.toLowerCase()).sort();
  const active = [...state].filter(([, enabled]) => enabled).map(([token]) => token).sort();
  if (new Set(expected).size !== expected.length || active.join(',') !== expected.join(',')) {
    throw new Error(`${chain.name} exact supported-token universe mismatch`);
  }
  for (const [token, enabled] of state) {
    if (await bridge.supportedTokens(token, { blockTag }) !== enabled) throw new Error('supported-token history/state mismatch');
  }
}

async function verifyDeploymentReadonly(manifest, approvedInputs, providerFactory = (rpc) => new ethers.providers.JsonRpcProvider(rpc)) {
  const { plan, evidence } = verifyApprovedDeploymentBindings(approvedInputs?.planBytes, approvedInputs?.evidenceBytes, manifest);
  const results = [];
  for (const chain of manifest.chains) {
    const provider = providerFactory(chain.rpcHttps, chain.chainId);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== chain.chainId) throw new Error(`${chain.name} RPC reports chain ${network.chainId}`);
    const latestBlock = await provider.getBlockNumber();
    const nativeAsset = chain.chainId === 9005 ? plan.assets.find((asset) => asset.identityType === 'native-precompile') : undefined;
    const nativeEvidence = nativeAsset ? validateNativeEvidence(nativeAsset, approvedInputs.nativeEvidenceBytes) : undefined;
    const verificationBlock = nativeEvidence ? nativeEvidence.verificationBlock : latestBlock;
    const verificationHeader = await provider.getBlock(verificationBlock);
    if (!verificationHeader?.hash) throw new Error(`${chain.name} verification block hash is unavailable`);
    if (nativeEvidence) validateNativeCheckpoint(nativeEvidence, latestBlock, verificationHeader);

    const provenBridgeBlock = await verifyCreationProvenance(
      provider, chain.bridge.address, chain.bridge.deploymentTxHash,
      chain.bridge.deploymentBlock, `${chain.name} bridge`,
      plan.chains.find((item) => item.chainId === chain.chainId).deployer,
      chain.chainId === 9005 ? evidence.contracts.sourceBridge.creationBytecode : evidence.contracts.destinationBridge.creationBytecode,
    );
    const bridgeCode = await provider.getCode(chain.bridge.address, verificationBlock);
    if (bridgeCode === '0x') throw new Error(`${chain.name} bridge has no bytecode`);
    if (sha256Code(bridgeCode) !== chain.bridge.runtimeSha256.toLowerCase()) {
      throw new Error(`${chain.name} bridge runtime SHA-256 mismatch`);
    }
    const bridge = new ethers.Contract(chain.bridge.address, BRIDGE_ABI, provider);
    const approvedChain = plan.chains.find((item) => item.chainId === chain.chainId);

    const [owner, guardian, paused, threshold] = await Promise.all([
      bridge.owner({ blockTag: verificationBlock }),
      bridge.pauseGuardian({ blockTag: verificationBlock }),
      bridge.paused({ blockTag: verificationBlock }),
      bridge.signaturesRequired({ blockTag: verificationBlock }),
    ]);
    if (owner.toLowerCase() !== chain.bridge.owner.toLowerCase()) throw new Error(`${chain.name} bridge owner mismatch`);
    if (guardian.toLowerCase() !== chain.bridge.pauseGuardian.toLowerCase()) throw new Error(`${chain.name} pause guardian mismatch`);
    if (paused !== true) throw new Error(`${chain.name} bridge is not paused`);
    if (threshold.toNumber() !== 5) throw new Error(`${chain.name} threshold is not 5`);
    await verifyGovernance(provider, chain, approvedChain, evidence, verificationBlock,
      { verifyCreationProvenance, sha256Code, getLogsByTopics });
    await verifyTokenUniverse(provider, bridge, chain, verificationBlock);

    await verifyExactValidatorSet(bridge, chain.bridge.validators, chain.name, verificationBlock);
    await verifyPristineBridgeHistory(
      provider, bridge, { ...chain, bridge: { ...chain.bridge, deploymentBlock: provenBridgeBlock } }, verificationBlock,
    );

    for (const asset of chain.assets) {
      const [supported, cap, locked, released, code] = await Promise.all([
        bridge.supportedTokens(asset.address, { blockTag: verificationBlock }),
        bridge.dailyCap(asset.address, { blockTag: verificationBlock }),
        bridge.dailyVolume(asset.address, { blockTag: verificationBlock }),
        bridge.releaseVolume(asset.address, { blockTag: verificationBlock }),
        provider.getCode(asset.address, verificationBlock),
      ]);
      if (!supported) throw new Error(`${chain.name} ${asset.symbol} is not supported by the bridge`);
      await verifyRouteUniverse(provider, bridge, asset, manifest, chain, verificationBlock);
      if (cap.toString() !== asset.dailyCapBaseUnits) throw new Error(`${chain.name} ${asset.symbol} daily cap mismatch`);
      if (!locked.isZero()) throw new Error(`${chain.name} ${asset.symbol} lock volume is not zero at deployment verification`);
      if (!released.isZero()) throw new Error(`${chain.name} ${asset.symbol} release volume is not zero at deployment verification`);
      if (asset.identityType === 'native-precompile') {
        await verifyNativePrecompile(provider, nativeAsset, approvedInputs.nativeEvidenceBytes,
          chain.bridge.address, verificationBlock, verificationHeader);
      } else if (code === '0x' || sha256Code(code) !== asset.runtimeSha256.toLowerCase()) {
        throw new Error(`${chain.name} ${asset.symbol} runtime SHA-256 mismatch`);
      }

      if (asset.kind === 'wrapped') {
        await verifyCreationProvenance(
          provider, asset.address, asset.deploymentTxHash,
          asset.deploymentBlock, `${chain.name} ${asset.symbol}`,
          plan.chains.find((item) => item.chainId === chain.chainId).deployer,
          evidence.contracts.wrappedToken.creationBytecode,
        );
        const token = new ethers.Contract(asset.address, WRAPPED_ABI, provider);
        if (normalizedRuntimeSha256(code, evidence.contracts.wrappedToken.immutableReferences) !==
            plan.release.wrappedTokenNormalizedRuntimeSha256.toLowerCase()) {
          throw new Error(`${chain.name} ${asset.symbol} normalized audited runtime SHA-256 mismatch`);
        }
        const [originChainId, originToken, immutableBridge, totalSupply] = await Promise.all([
          token.originChainId({ blockTag: verificationBlock }),
          token.originToken({ blockTag: verificationBlock }),
          token.bridge({ blockTag: verificationBlock }),
          token.totalSupply({ blockTag: verificationBlock }),
        ]);
        if (originChainId.toNumber() !== 9005) throw new Error(`${chain.name} ${asset.symbol} origin chain mismatch`);
        if (originToken.toLowerCase() !== asset.originToken.toLowerCase()) throw new Error(`${chain.name} ${asset.symbol} origin token mismatch`);
        if (immutableBridge.toLowerCase() !== chain.bridge.address.toLowerCase()) {
          throw new Error(`${chain.name} ${asset.symbol} immutable bridge mismatch`);
        }
        if (!totalSupply.isZero()) throw new Error(`${chain.name} ${asset.symbol} wrapped supply is not zero before canary`);
      }
    }

    const finalHeader = await provider.getBlock(verificationBlock);
    if (finalHeader?.hash !== verificationHeader.hash) throw new Error(`${chain.name} verification block reorganized`);
    results.push({
      chainId: chain.chainId,
      bridge: chain.bridge.address,
      assets: chain.assets.length,
      verificationBlock,
      verificationBlockHash: verificationHeader.hash,
      ...(nativeEvidence ? { nativePrecompileEvidenceSha256: nativeAsset.nativePrecompile.evidenceSha256, nativeImplementationSha256: nativeAsset.nativePrecompile.implementationSha256 } : {}),
      status: 'verified-paused-pristine',
    });
  }
  return results;
}

if (require.main === module) {
  const index = process.argv.indexOf('--manifest');
  const planIndex = process.argv.indexOf('--plan');
  const evidenceIndex = process.argv.indexOf('--bytecode-evidence');
  if (index === -1 || !process.argv[index + 1] || planIndex === -1 || !process.argv[planIndex + 1] ||
      evidenceIndex === -1 || !process.argv[evidenceIndex + 1] || !process.argv.includes('--confirm-transaction-free')) {
    console.error('Usage: node verify-deployment-readonly.js --plan /path/approved-plan.json --manifest /path/manifest.json --bytecode-evidence /path/evidence.json --confirm-transaction-free');
    process.exit(2);
  }
  if (process.env.DEPLOYER_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY || process.env.MNEMONIC) {
    throw new Error('transaction-free verifier refuses signing credentials');
  }
  const file = path.resolve(process.argv[index + 1]);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nativeIndex = process.argv.indexOf('--native-precompile-evidence');
  if (nativeIndex !== -1 && !process.argv[nativeIndex + 1]) throw new Error('native evidence path required');
  const approvedInputs = {
    ...(nativeIndex !== -1 ? { nativeEvidenceBytes: fs.readFileSync(path.resolve(process.argv[nativeIndex + 1])) } : {}),
    planBytes: fs.readFileSync(path.resolve(process.argv[planIndex + 1])),
    evidenceBytes: fs.readFileSync(path.resolve(process.argv[evidenceIndex + 1])),
  };
  verifyDeploymentReadonly(manifest, approvedInputs).then((results) => {
    console.log(JSON.stringify({ transactionFree: true, results }, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  getBridgeActivityLogs,
  getLogsByTopics,
  sha256Code,
  sha256Bytes,
  normalizedRuntimeSha256,
  validateBytecodeEvidence,
  verifyApprovedDeploymentBindings,
  verifyCreationProvenance,
  verifyDeploymentReadonly,
  verifyExactValidatorSet,
  verifyPristineBridgeHistory,
  verifyRouteUniverse,
  verifyTokenUniverse,
};
