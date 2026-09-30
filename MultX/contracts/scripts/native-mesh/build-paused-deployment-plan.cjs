const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hre = require('hardhat');
const { ethers } = hre;

const FACTORY = '0xce0042B868300000d44A59004Da54A005ffdcf9f';
const TIMELOCK_SALT = ethers.utils.id('MULTX_NATIVE_TIMELOCK_V1');
const VAULT_SALT = ethers.utils.id('MULTX_NATIVE_LIQUIDITY_VAULT_V1');
const ZERO = ethers.constants.AddressZero;

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}
function sha256Hex(hex) {
  return crypto.createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');
}
function create2(initCode, salt) {
  return ethers.utils.getCreate2Address(FACTORY, salt, ethers.utils.keccak256(initCode));
}
function checkInputs(input) {
  if (input.schemaVersion !== 1 || input.profile !== 'multx-native-evm-initial' || input.enabled !== false) throw Error('invalid disabled profile');
  if (input.deploymentStatus !== 'READY_FOR_REVIEW') throw Error(`deployment status is ${input.deploymentStatus || 'missing'}; READY_FOR_REVIEW required`);
  for (const field of ['governanceSafe', 'pauseGuardian', 'feePayer']) ethers.utils.getAddress(input[field]);
  const unavailable = new Set((input.knownUnavailableAddresses || []).map(address => ethers.utils.getAddress(address).toLowerCase()));
  if (!input.governanceSafePolicy || input.governanceSafePolicy.version !== '1.4.1' || input.governanceSafePolicy.threshold !== 2) throw Error('approved Safe 1.4.1 2-of-3 policy required');
  if (!Array.isArray(input.governanceSafePolicy.owners) || input.governanceSafePolicy.owners.length !== 3) throw Error('exact three-owner Safe policy required');
  if (!Array.isArray(input.governanceSafePolicy.modules) || input.governanceSafePolicy.modules.length !== 0) throw Error('Safe modules must be empty');
  for (const field of ['implementation', 'guard', 'fallbackHandler']) ethers.utils.getAddress(input.governanceSafePolicy[field]);
  const assigned = [input.feePayer, input.pauseGuardian, ...input.validators, ...input.governanceSafePolicy.owners]
    .map(address => ethers.utils.getAddress(address).toLowerCase());
  const conflicts = [...new Set(assigned.filter(address => unavailable.has(address)))];
  if (conflicts.length) throw Error(`unavailable address remains assigned: ${conflicts.join(',')}`);
  if (input.timelockDelaySeconds !== 172800) throw Error('timelock must be 48 hours');
  if (!Array.isArray(input.validators) || input.validators.length !== 5 || new Set(input.validators.map(x => x.toLowerCase())).size !== 5) throw Error('exact unique five-validator set required');
  if (!Array.isArray(input.chains) || input.chains.map(x => x.chainId).sort((a,b)=>a-b).join(',') !== '1,56,8453') throw Error('exact EVM initial chains required');
  for (const chain of input.chains) {
    if (chain.confirmations !== 3) throw Error(`chain ${chain.chainId} confirmations must be 3`);
    for (const value of ['dailyDepositCapWei','dailyPayoutCapWei','reserveMinimumWei','reserveTargetWei']) if (!/^\d+$/.test(chain[value]) || BigInt(chain[value]) <= 0n) throw Error(`invalid ${value}`);
    if (BigInt(chain.reserveTargetWei) < BigInt(chain.reserveMinimumWei)) throw Error('reserve target below minimum');
    if (!chain.rpcSecretRef.startsWith('aws-secretsmanager:')) throw Error('opaque RPC reference required');
    for (const value of ['factory','router','pool']) ethers.utils.getAddress(chain.dex[value]);
  }
}

async function main() {
  const inputPath = arg('--inputs');
  const outputPath = arg('--output');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  checkInputs(input);

  const timelockFactory = await ethers.getContractFactory('GovTimelock');
  const timelockArtifact = await hre.artifacts.readArtifact('GovTimelock');
  const timelockInitCode = timelockFactory.getDeployTransaction(
    input.timelockDelaySeconds, [input.governanceSafe], [input.governanceSafe], ZERO,
  ).data;
  const timelockAddress = create2(timelockInitCode, TIMELOCK_SALT);

  const vaultFactory = await ethers.getContractFactory('NativeLiquidityVault');
  const vaultArtifact = await hre.artifacts.readArtifact('NativeLiquidityVault');
  const vaultInitCode = vaultFactory.getDeployTransaction(timelockAddress, input.validators).data;
  const vaultAddress = create2(vaultInitCode, VAULT_SALT);
  const deployInterface = new ethers.utils.Interface(['function deploy(bytes _initCode,bytes32 _salt) returns(address payable createdContract)']);
  const release = {
    commit: process.env.RELEASE_COMMIT || 'UNCOMMITTED_REVIEW_CANDIDATE',
    compiler: '0.8.24', optimizerRuns: 200, evmVersion: 'paris',
    timelockCreationSha256: sha256Hex(timelockInitCode),
    timelockRuntimeSha256: sha256Hex(timelockArtifact.deployedBytecode),
    vaultCreationSha256: sha256Hex(vaultInitCode),
    vaultRuntimeSha256: sha256Hex(vaultArtifact.deployedBytecode),
  };
  const plan = {
    schemaVersion: 1,
    status: 'REVIEW_CANDIDATE_DO_NOT_EXECUTE',
    profile: input.profile,
    enabled: false,
    release,
    governance: {
      safe: ethers.utils.getAddress(input.governanceSafe),
      safePolicy: {
        ...input.governanceSafePolicy,
        implementation: ethers.utils.getAddress(input.governanceSafePolicy.implementation),
        owners: input.governanceSafePolicy.owners.map(ethers.utils.getAddress),
        guard: ethers.utils.getAddress(input.governanceSafePolicy.guard),
        fallbackHandler: ethers.utils.getAddress(input.governanceSafePolicy.fallbackHandler),
      },
      timelock: timelockAddress,
      delaySeconds: input.timelockDelaySeconds,
      pauseGuardian: ethers.utils.getAddress(input.pauseGuardian),
    },
    bridgeSignerSet: { threshold: 3, addresses: input.validators.map(ethers.utils.getAddress) },
    deterministicDeployment: {
      factory: FACTORY,
      timelockSalt: TIMELOCK_SALT,
      vaultSalt: VAULT_SALT,
      timelockAddress,
      vaultAddress,
      transactions: [
        { label:'GovTimelock', to:FACTORY, value:'0', data:deployInterface.encodeFunctionData('deploy',[timelockInitCode,TIMELOCK_SALT]) },
        { label:'NativeLiquidityVault', to:FACTORY, value:'0', data:deployInterface.encodeFunctionData('deploy',[vaultInitCode,VAULT_SALT]) },
      ],
    },
    chains: input.chains.map(chain => ({
      ...chain,
      expectedTimelock: timelockAddress,
      expectedVault: vaultAddress,
      initialState: { paused:true, routesEnabled:0, depositCap:'0', payoutCap:'0', fundedReserve:'0' },
    })),
    evidence: input.evidence,
    restrictions: [
      'All contracts remain paused after deployment.',
      'No route, signing, relaying, Swap, canary or activation is authorized.',
      'Configuration requires separate 48-hour Timelock operations after deployment verification.',
    ],
  };
  const bytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(outputPath, bytes);
  console.log(JSON.stringify({ output:outputPath, sha256:crypto.createHash('sha256').update(bytes).digest('hex'), timelockAddress, vaultAddress }, null, 2));
}

main().catch(error => { console.error(error.message); process.exit(1); });
