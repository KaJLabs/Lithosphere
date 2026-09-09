const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');


const contracts = [
  ['GovTimelock', 'artifacts/contracts/governance/GovTimelock.sol/GovTimelock.json'],
  ['MultXBridge', 'artifacts/contracts/MultXBridge.sol/MultXBridge.json'],
  ['MultXBridgeDest', 'artifacts/contracts/MultXBridgeDest.sol/MultXBridgeDest.json'],
  ['WrappedLEP100', 'artifacts/contracts/WrappedLEP100.sol/WrappedLEP100.json'],
];


const summarize = (hexValue, field) => {
  if (typeof hexValue !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hexValue)) {
    throw new Error(`${field} is missing from the compiled artifact`);
  }
  const bytes = Buffer.from(hexValue.slice(2), 'hex');
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    keccak256: ethers.utils.keccak256(hexValue),
  };
};


const result = {
  compiler: 'solc 0.8.24',
  optimizer: { enabled: true, runs: 200 },
  contracts: {},
};

for (const [name, relativePath] of contracts) {
  const artifactPath = path.resolve(__dirname, '..', relativePath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  result.contracts[name] = {
    creation: summarize(artifact.bytecode, `${name}.bytecode`),
    runtime: summarize(artifact.deployedBytecode, `${name}.deployedBytecode`),
  };
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
