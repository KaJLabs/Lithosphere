import fs from 'node:fs';
import { parseSignerPolicy } from './policy.js';
import { parseNativeSignerPolicy } from './nativePolicy.js';

const readRequiredFile = (file, envName) => {
  const value = fs.readFileSync(file);
  if (value.length === 0) throw new Error(`${envName} is empty`);
  return value;
};

export const loadSignerPolicy = ({
  signingEnabled,
  production = process.env.NODE_ENV === 'production',
  policyFile = process.env.SIGNER_POLICY_FILE,
  policyJson = process.env.SIGNER_POLICY_JSON,
} = {}) => {
  if (policyFile && policyJson) {
    throw new Error('configure signer policy file or JSON, never both');
  }
  if (!policyFile && !policyJson) {
    if (!signingEnabled) return null;
    throw new Error('SIGNER_POLICY_FILE or SIGNER_POLICY_JSON is required when signing is enabled');
  }
  if (production && policyJson) {
    throw new Error('production signer policy must be mounted through SIGNER_POLICY_FILE');
  }

  const serialized = policyFile
    ? readRequiredFile(policyFile, 'SIGNER_POLICY_FILE').toString('utf8')
    : policyJson;
  return parseSignerPolicy(JSON.parse(serialized));
};

export const loadNativeSignerPolicy = ({
  signingEnabled,
  production = process.env.NODE_ENV === 'production',
  policyFile = process.env.SIGNER_NATIVE_POLICY_FILE,
  policyJson = process.env.SIGNER_NATIVE_POLICY_JSON,
} = {}) => {
  if (policyFile && policyJson) throw new Error('configure native signer policy file or JSON, never both');
  if (!policyFile && !policyJson) {
    if (!signingEnabled) return null;
    throw new Error('SIGNER_NATIVE_POLICY_FILE or SIGNER_NATIVE_POLICY_JSON is required when native signing is enabled');
  }
  if (production && policyJson) throw new Error('production native signer policy must be mounted through SIGNER_NATIVE_POLICY_FILE');
  const serialized = policyFile
    ? readRequiredFile(policyFile, 'SIGNER_NATIVE_POLICY_FILE').toString('utf8')
    : policyJson;
  return parseNativeSignerPolicy(JSON.parse(serialized));
};
