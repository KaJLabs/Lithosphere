import { ethers } from 'ethers';

export function positiveSafeInteger(value, label) {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds JavaScript's safe integer range`);
  return parsed;
}

export function validateValidatorSet(validators, signaturesRequired) {
  const required = positiveSafeInteger(signaturesRequired, 'SIGNATURES_REQUIRED');
  if (!Array.isArray(validators) || validators.length === 0) {
    throw new Error('No validator signers are configured');
  }
  const addresses = validators.map((validator, index) => {
    try {
      const address = ethers.getAddress(validator.address);
      if (address === ethers.ZeroAddress) throw new Error('zero address');
      return address.toLowerCase();
    }
    catch { throw new Error(`validator ${index} has an invalid address`); }
  });
  if (new Set(addresses).size !== addresses.length) {
    throw new Error('validator signer addresses must be unique');
  }
  if (addresses.length < required) {
    throw new Error(`Loaded ${addresses.length} signer(s), below configured threshold ${required}`);
  }
  return { required, addresses };
}

export function validateProductionSignerEnvironment(env = process.env) {
  for (const key of Object.keys(env)) {
    const match = /^VALIDATOR_SIGNER_(?:URL|ADDRESS|CA_FILE|CERT_FILE|KEY_FILE|TOKEN_FILE)_(.+)$/.exec(key);
    if (match && env[key] && !/^[0-4]$/.test(match[1])) {
      throw new Error('production requires exactly signer indices 0 through 4');
    }
  }
  for (const name of ['AWS_REGION', 'VALIDATOR_KMS_KEY_ARN', 'SIGNER_KMS_KEY_ARN']) {
    if (env[name]) throw new Error(`${name} is not supported by the non-AWS production signer path`);
  }
  if (String(env.SIGNATURES_REQUIRED) !== '3') {
    throw new Error('production SIGNATURES_REQUIRED must be exactly 3');
  }
  const configured = [];
  for (let index = 0; index < 10; index += 1) {
    const url = env[`VALIDATOR_SIGNER_URL_${index}`];
    const signerAddress = env[`VALIDATOR_SIGNER_ADDRESS_${index}`];
    const signerFields = [
      url,
      signerAddress,
      env[`VALIDATOR_SIGNER_CA_FILE_${index}`],
      env[`VALIDATOR_SIGNER_CERT_FILE_${index}`],
      env[`VALIDATOR_SIGNER_KEY_FILE_${index}`],
      env[`VALIDATOR_SIGNER_TOKEN_FILE_${index}`],
    ];
    if (index < 5 && (!url || !signerAddress)) {
      throw new Error(`production validator signer ${index} URL and address are required`);
    }
    if (index >= 5 && signerFields.some(Boolean)) {
      throw new Error('production requires exactly signer indices 0 through 4');
    }
    if (index < 5) configured.push({ index, url, address: signerAddress });
    if (index < 5) {
      if (env[`VALIDATOR_SIGNER_TOKEN_FILE_${index}`]) {
        throw new Error(`production validator signer ${index} must use mTLS, not bearer authentication`);
      }
      for (const suffix of ['CA_FILE', 'CERT_FILE', 'KEY_FILE']) {
        if (!env[`VALIDATOR_SIGNER_${suffix}_${index}`]) {
          throw new Error(`production validator signer ${index} mTLS ${suffix.toLowerCase()} is required`);
        }
      }
    }
  }
  validateValidatorSet(configured, 3);
  return configured;
}

export async function verifyLiveValidatorTopology(chains, expectedAddresses, providerFactory) {
  if (!Array.isArray(expectedAddresses) || expectedAddresses.length !== 5) {
    throw new Error('expected exactly five production validator addresses');
  }
  expectedAddresses = validateValidatorSet(expectedAddresses.map(address => ({ address })), 3).addresses;
  const abi = [
    'function signaturesRequired() view returns (uint256)',
    'function getValidatorCount() view returns (uint256)',
    'function getValidators() view returns (address[])',
  ];
  for (const chain of chains) {
    const provider = providerFactory(chain.rpc, chain.chainId);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== Number(chain.chainId)) {
      throw new Error(`${chain.name} RPC chain identity mismatch`);
    }
    const bridge = new ethers.Contract(chain.bridge, abi, provider);
    const [thresholdValue, countValue, live] = await Promise.all([
      bridge.signaturesRequired(), bridge.getValidatorCount(), bridge.getValidators(),
    ]);
    const threshold = Number(thresholdValue.toString());
    const count = Number(countValue.toString());
    if (threshold !== 3 || count !== 5 || live.length !== 5) {
      throw new Error(`${chain.name} live bridge topology is not exact 3-of-5`);
    }
    if (live.some((item, index) => item.toLowerCase() !== expectedAddresses[index])) {
      throw new Error(`${chain.name} live validator set does not match configured signers`);
    }
  }
}
