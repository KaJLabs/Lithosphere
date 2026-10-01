const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSafety(plan) {
  invariant(plan.status === 'REVIEW_CANDIDATE_DO_NOT_EXECUTE', 'invalid review-only status');
  invariant(plan.enabled === false, 'plan must remain disabled');
  invariant(plan.release.commit && !plan.release.commit.startsWith('UNCOMMITTED'), 'immutable release commit required');
  invariant(plan.governance.delaySeconds === 172800, '48-hour Timelock required');
  invariant(plan.bridgeSignerSet.threshold === 3, '3-of-5 threshold required');
  invariant(plan.bridgeSignerSet.addresses.length === 5, 'exactly five signers required');
  invariant(new Set(plan.bridgeSignerSet.addresses.map(value => value.toLowerCase())).size === 5, 'signers must be unique');
  invariant(plan.deterministicDeployment.transactions.length === 2, 'exactly two deployment transactions required');
  for (const transaction of plan.deterministicDeployment.transactions) {
    invariant(transaction.to.toLowerCase() === plan.deterministicDeployment.factory.toLowerCase(), 'unexpected deployment target');
    invariant(transaction.value === '0', 'deployment transaction must send zero value');
    invariant(/^0x[0-9a-f]+$/i.test(transaction.data), 'invalid deployment calldata');
  }
  invariant(plan.chains.map(chain => chain.chainId).sort((a, b) => a - b).join(',') === '1,56,8453', 'unexpected chain set');
  for (const chain of plan.chains) {
    invariant(chain.confirmations === 3, `chain ${chain.chainId} must use three confirmations`);
    invariant(chain.initialState.paused === true, `chain ${chain.chainId} must start paused`);
    invariant(chain.initialState.routesEnabled === 0, `chain ${chain.chainId} routes must start disabled`);
    invariant(chain.initialState.depositCap === '0' && chain.initialState.payoutCap === '0', `chain ${chain.chainId} caps must start at zero`);
    invariant(chain.initialState.fundedReserve === '0', `chain ${chain.chainId} reserve must start empty`);
  }
}

function main() {
  const inputsPath = arg('--inputs');
  const planPath = arg('--plan');
  const expectedSha256 = process.argv[process.argv.indexOf('--expected-sha256') + 1];
  invariant(/^[0-9a-f]{64}$/i.test(expectedSha256 || ''), '--expected-sha256 must be a 64-character hex digest');

  const reviewedBytes = fs.readFileSync(planPath);
  const actualSha256 = sha256(reviewedBytes);
  invariant(actualSha256 === expectedSha256.toLowerCase(), `plan SHA-256 mismatch: ${actualSha256}`);
  const reviewedPlan = JSON.parse(reviewedBytes);
  validateSafety(reviewedPlan);

  const temporaryPath = path.join(os.tmpdir(), `multx-native-plan-${process.pid}-${Date.now()}.json`);
  const builder = path.join(__dirname, 'build-paused-deployment-plan.cjs');
  const result = spawnSync(process.execPath, [builder, '--inputs', inputsPath, '--output', temporaryPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, RELEASE_COMMIT: reviewedPlan.release.commit },
    encoding: 'utf8',
  });
  try {
    invariant(result.status === 0, `plan rebuild failed: ${(result.stderr || result.stdout).trim()}`);
    const rebuiltBytes = fs.readFileSync(temporaryPath);
    invariant(reviewedBytes.equals(rebuiltBytes), 'reviewed plan is not reproducible from inputs and compiled artifacts');
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
  }

  console.log(JSON.stringify({ result: 'PASS', plan: planPath, sha256: actualSha256 }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
