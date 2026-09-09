// Run after a clean compile of the extracted published source archive.
const fs = require('fs');
const assert = require('assert/strict');
const { CONTRACTS, loadBuildRecord } = require('./generate-bytecode-evidence');

function compare(file) {
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = {};
  for (const [key, spec] of Object.entries(CONTRACTS)) {
    const actual = loadBuildRecord(...spec);
    for (const field of ['creationBytecode', 'creationSha256', 'runtimeSha256', 'normalizedRuntimeSha256', 'immutableReferences', 'solcVersion', 'settings']) {
      assert.deepEqual(actual[field], expected.contracts[key][field], `${key}.${field} is not reproducible`);
    }
    results[key] = { creationSha256: actual.creationSha256, runtimeSha256: actual.runtimeSha256, matched: true };
  }
  return results;
}
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Usage: node compare-bytecode-evidence.js /path/evidence.json');
  console.log(JSON.stringify({ fullBytecodeIncludingMetadata: true, contracts: compare(process.argv[2]) }, null, 2));
}
module.exports = { compare };
