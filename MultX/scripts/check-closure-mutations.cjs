// Isolated regression mutation gate. Never run concurrently with other tests/builds.
// Restores exact source bytes after every mutation, including failed test runs.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const group = process.argv[2];
const cases = {
  contracts: [
    ['plan digest', 'scripts/mainnet/verify-deployment-readonly.js', 'sha256Bytes(planBytes) !== manifest.release.deploymentPlanSha256.toLowerCase()', 'false'],
    ['evidence plan digest', 'scripts/mainnet/verify-deployment-readonly.js', 'sha256Bytes(evidenceBytes) !== plan.release.bytecodeEvidenceSha256.toLowerCase()', 'false'],
    ['evidence manifest digest', 'scripts/mainnet/verify-deployment-readonly.js', 'sha256Bytes(evidenceBytes) !== manifest.release.bytecodeEvidenceSha256.toLowerCase()', 'false'],
    ['precomputed bridge', 'scripts/mainnet/verify-deployment-readonly.js', '!equalAddress(chain.bridge.address, approvedChain.expectedBridgeAddress)', 'false'],
    ['receipt address', 'scripts/mainnet/verify-deployment-readonly.js', '!receipt.contractAddress || !equalAddress(receipt.contractAddress, address)', 'false'],
    ['undeclared role', 'scripts/mainnet/verify-governance.js', '!Object.values(ROLES).includes(role) && members.size', 'false'],
    ['role history/live', 'scripts/mainnet/verify-governance.js', 'await timelock.hasRole(role, account, { blockTag }) !== members.has(account)', 'false'],
    ['minimum delay', 'scripts/mainnet/verify-governance.js', '(await timelock.getMinDelay({ blockTag })).toString() !== String(approved.timelockDelaySeconds)', 'false'],
    ['removed role log', 'scripts/mainnet/verify-governance.js', 'if (log.removed)', 'if (false)'],
    ['token history/live', 'scripts/mainnet/verify-deployment-readonly.js', 'await bridge.supportedTokens(token, { blockTag }) !== enabled', 'false'],
    ['immutable source bytes', 'scripts/mainnet/generate-bytecode-evidence.js', '!local.equals(committed)', 'false'],
    ['stale compiler source', 'scripts/mainnet/generate-bytecode-evidence.js', "!local.equals(Buffer.from(input.content, 'utf8'))", 'false'],
  ],
  api: [
    ['live RPC chain', 'src/services/validatorPolicy.js', 'Number(network.chainId) !== Number(chain.chainId)', 'false'],
    ['live threshold', 'src/services/validatorPolicy.js', 'threshold !== 5', 'false'],
    ['live count', 'src/services/validatorPolicy.js', 'count !== 7', 'false'],
    ['live array length', 'src/services/validatorPolicy.js', 'live.length !== 7', 'false'],
    ['live addresses', 'src/services/validatorPolicy.js', 'live.some((item, index) => item.toLowerCase() !== expectedAddresses[index])', 'false'],
  ],
  signer: [
    ['on-load equivocation', 'src/journal.js', 'prior && prior !== record.hash', 'false'],
    ['journal symlink', 'src/journal.js', '!pathStat.isFile() || pathStat.isSymbolicLink()', 'false'],
    ['production identity required', 'src/stateIdentity.js', 'if (!file)', 'if (false)'],
  ],
};
if (!cases[group]) throw new Error('Usage: node scripts/check-closure-mutations.cjs contracts|api|signer');
if (group === 'signer' && process.platform === 'win32') throw new Error('Signer mutations require Linux; skipped permission tests cannot prove closure');
const cwd = path.join(root, group);
const args = group === 'contracts' ? ['node_modules/mocha/bin/mocha.js', 'test/MainnetApprovedBinding.test.js',
  'test/MainnetReadonlyVerifier.test.js', 'test/ClosureNegativeCoverage.test.js', 'test/BytecodeSourceIdentity.test.js']
  : ['--test', group === 'api' ? 'test/validatorPolicy.test.js' : 'test/stateIdentity.test.js'];
function test() {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60000 });
  if (result.error || result.signal || result.status === null) throw result.error || new Error('test process did not complete');
  return result;
}
const baseline = test();
if (baseline.status !== 0) throw new Error(`baseline tests failed: ${baseline.stdout}\n${baseline.stderr}`);
const results = [];
for (const [name, relative, from, to] of cases[group]) {
  const file = path.join(cwd, relative), original = fs.readFileSync(file), source = original.toString('utf8');
  if (source.split(from).length !== 2) throw new Error(`mutation anchor must be unique: ${name}`);
  let result;
  try {
    fs.writeFileSync(file, source.replace(from, to));
    result = test();
  } finally { fs.writeFileSync(file, original); }
  if (result.status === 0) throw new Error(`mutation survived: ${name}`);
  if (!/AssertionError|ERR_ASSERTION/.test(result.stdout + result.stderr)) throw new Error(`mutation failed without a negative assertion: ${name}`);
  results.push({ name, caught: true });
}
console.log(JSON.stringify({ group, baselinePassed: true, results }, null, 2));
