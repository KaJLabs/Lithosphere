const LEGACY_AWS_OR_PROXY_SETTINGS = [
  'AWS_REGION',
  'SIGNER_KMS_KEY_ARN',
  'SIGNER_DYNAMODB_TABLE',
  'SIGNER_BEARER_TOKEN',
  'SIGNER_BEARER_TOKEN_FILE',
  'SIGNER_BEHIND_TLS_PROXY',
];

export const validateDeploymentMode = (env = process.env) => {
  const production = env.NODE_ENV === 'production';
  const transport = env.SIGNER_TRANSPORT || 'mtls';
  const journalBackend = env.SIGNER_JOURNAL_BACKEND || 'file';

  if (journalBackend !== 'file') {
    throw new Error('the non-AWS signer supports only SIGNER_JOURNAL_BACKEND=file');
  }
  if (production && transport !== 'mtls') {
    throw new Error('production signer requires direct mTLS transport');
  }
  if (production) {
    if (env.SIGNER_RELEASE_SIGNING_ENABLED === 'true') {
      throw new Error('native-only canary candidate excludes legacy release signing');
    }
    for (const name of LEGACY_AWS_OR_PROXY_SETTINGS) {
      if (env[name]) throw new Error(`${name} is forbidden in non-AWS production`);
    }
  }
  return { journalBackend, production, transport };
};
