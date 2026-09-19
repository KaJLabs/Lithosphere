const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CONTRACTS, loadBuildRecord } = require('./mainnet/generate-bytecode-evidence');

const output = process.argv[2];
if (!output) throw Error('Output path required');
const specs = { ...CONTRACTS, localNativeWrapperFixture: ['contracts/MockNativeWrapper.sol', 'MockNativeWrapper'] };
const records = Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, loadBuildRecord(...spec, null)]));
const sourceHashes = {};
for (const record of Object.values(records)) {
  const filename = path.resolve(__dirname, '..', record.source);
  sourceHashes[record.source] = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
fs.writeFileSync(path.resolve(output), JSON.stringify({
  kind: 'local-build-evidence-not-independent-acceptance',
  generatedFrom: 'pinned Hardhat compiler input and artifacts, verified against current source bytes',
  sourceHashes,
  contracts: records,
}, null, 2) + '\n', { flag: 'wx' });
console.log('Candidate bytecode evidence written');
