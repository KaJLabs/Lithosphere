// Run alone: temporary source mutations are always restored byte-for-byte.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cwd = path.resolve(__dirname, '../signer');
const run = () => spawnSync(process.execPath, ['--test', 'test/nativeEvidence.test.js',
  'test/nativeFinalityGuard.test.js'], { cwd, encoding: 'utf8', timeout: 60000 });
const baseline = run();
if (baseline.status !== 0) throw new Error(`baseline failed: ${baseline.stdout}\n${baseline.stderr}`);
const mutations = [
  ['provider regression', 'nativeEvidence.js', 'head.number < prior.number', 'false'],
  ['same-height identity', 'nativeEvidence.js', 'head.number === prior.number && head.hash !== prior.hash', 'false'],
  ['continuity', 'nativeEvidence.js', 'historical.number !== prior.number || historical.hash !== prior.hash', 'false'],
  ['ordering', 'nativeEvidence.js', 'latest[role] < heads[role].number', 'false'],
  ['content agreement', 'nativeEvidence.js', 'canonical(results[0]) !== canonical(results[1])', 'false'],
  ['receipt agreement', 'nativeEvidence.js', 'canonical(fields(results[0])) !== canonical(fields(results[1]))', 'false'],
  ['finalized evidence bound', 'nativeEvidence.js', 'Number(number) > anchor.number', 'false'],
  ['M01 signing race', 'nativeFinalityGuard.js', '      assertClear();\n      return signature;', '      return signature;'],
];
const results = [];
for (const [name, filename, from, to] of mutations) {
  const file = path.join(cwd, 'src', filename), original = fs.readFileSync(file);
  const source = original.toString().replace(/\r\n/g, '\n');
  if (source.split(from).length !== 2) throw new Error(`non-unique mutation: ${name}`);
  let result;
  try { fs.writeFileSync(file, source.replace(from, to)); result = run(); }
  finally { fs.writeFileSync(file, original); }
  if (result.error || result.signal || result.status === null || result.status === 0 ||
      !/ERR_ASSERTION|AssertionError/.test(result.stdout + result.stderr)) {
    throw new Error(`mutation not killed by assertion: ${name}`);
  }
  results.push({ name, killed: true });
}
console.log(JSON.stringify({ baseline: 'PASS', results }, null, 2));
