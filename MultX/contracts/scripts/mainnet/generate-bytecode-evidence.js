const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACTS = {
  govTimelock: ['contracts/governance/GovTimelock.sol', 'GovTimelock'],
  sourceBridge: ['contracts/MultXBridge.sol', 'MultXBridge'],
  destinationBridge: ['contracts/MultXBridgeDest.sol', 'MultXBridgeDest'],
  wrappedToken: ['contracts/WrappedLEP100.sol', 'WrappedLEP100'],
};

const sha256Hex = (hex) => crypto.createHash('sha256').update(Buffer.from(hex.replace(/^0x/, ''), 'hex')).digest('hex');

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function assertBuildSources(buildInfo, root, commit) {
  if (buildInfo.solcLongVersion !== '0.8.24+commit.e11b9ed9') throw new Error('unexpected evidence compiler');
  const prefix = commit ? execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' }).trim() : null;
  for (const [source, input] of Object.entries(buildInfo.input.sources)) {
    const dependency = source.startsWith('@');
    const local = fs.readFileSync(path.join(root, dependency ? 'node_modules' : '', source));
    if (!local.equals(Buffer.from(input.content, 'utf8'))) throw new Error(`stale compiler input: ${source}`);
    if (commit && !dependency) {
      const committed = execFileSync('git', ['show', `${commit}:${prefix}${source}`], { cwd: root });
      if (!local.equals(committed)) throw new Error(`source bytes differ from immutable commit: ${source}`);
    }
  }
}

function loadBuildRecord(source, name, commit) {
  const directory = path.join(ROOT, 'artifacts', source);
  const artifact = JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'));
  const debug = JSON.parse(fs.readFileSync(path.join(directory, `${name}.dbg.json`), 'utf8'));
  const buildInfo = JSON.parse(fs.readFileSync(path.resolve(directory, debug.buildInfo), 'utf8'));
  assertBuildSources(buildInfo, ROOT, commit);
  const output = buildInfo.output.contracts[source][name].evm;
  const references = Object.values(output.deployedBytecode.immutableReferences || {})
    .flat().map(({ start, length }) => ({ start, length }))
    .sort((left, right) => left.start - right.start || left.length - right.length);
  const runtime = Buffer.from(output.deployedBytecode.object, 'hex');
  const normalized = Buffer.from(runtime);
  references.forEach(({ start, length }) => normalized.fill(0, start, start + length));
  if (artifact.deployedBytecode.replace(/^0x/, '') !== output.deployedBytecode.object ||
      artifact.bytecode.replace(/^0x/, '') !== output.bytecode.object) {
    throw new Error(`${name} artifact and pinned build-info bytecode differ`);
  }
  return {
    source,
    contract: name,
    creationBytecode: `0x${output.bytecode.object}`,
    creationSha256: sha256Hex(output.bytecode.object),
    runtimeSha256: sha256Hex(output.deployedBytecode.object),
    normalizedRuntimeSha256: crypto.createHash('sha256').update(normalized).digest('hex'),
    immutableReferences: references,
    solcVersion: buildInfo.solcLongVersion,
    settings: buildInfo.input.settings,
    compilerInputSha256: crypto.createHash('sha256').update(JSON.stringify(buildInfo.input)).digest('hex'),
  };
}

function main() {
  const auditedTag = argument('--audited-tag');
  const commit = argument('--commit');
  const output = argument('--out');
  if (!/^multx-[a-z0-9.-]+$/i.test(auditedTag || '') || !/^[0-9a-f]{40}$/i.test(commit || '') || !output) {
    throw new Error('Usage: node generate-bytecode-evidence.js --audited-tag multx-... --commit 40_HEX --out /path/evidence.json');
  }
  const records = Object.fromEntries(Object.entries(CONTRACTS).map(([key, spec]) => [key, loadBuildRecord(...spec, commit)]));
  const document = {
    schemaVersion: 1,
    auditedTag,
    commit: commit.toLowerCase(),
    generatedFrom: 'pinned Hardhat build-info and compiler output',
    contracts: records,
  };
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
  console.log(`Wrote immutable bytecode evidence: ${path.resolve(output)}`);
}

if (require.main === module) main();

module.exports = { loadBuildRecord, sha256Hex, assertBuildSources, CONTRACTS };
