import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function validateStateIdentity(value) {
  if (!value || value.schemaVersion !== 1 || !/^0x[0-9a-f]{40}$/i.test(value.signerAddress || '') ||
      /^0x0{40}$/i.test(value.signerAddress) || !/^[0-9a-f]{64}$/i.test(value.deploymentPlanSha256 || '') ||
      !/^[0-9a-f]{32}$/i.test(value.generation || '') ||
      !Number.isSafeInteger(value.activationEpoch) || value.activationEpoch < 1) {
    throw new Error('invalid approved signer state identity');
  }
  return { schemaVersion: 1, signerAddress: value.signerAddress.toLowerCase(),
    deploymentPlanSha256: value.deploymentPlanSha256.toLowerCase(),
    generation: value.generation.toLowerCase(), activationEpoch: value.activationEpoch };
}
export const identityDigest = value => crypto.createHash('sha256')
  .update(JSON.stringify(validateStateIdentity(value))).digest('hex');

export function loadStateIdentity(file, signerAddress) {
  if (!file) throw new Error('SIGNER_STATE_IDENTITY_FILE is required in production');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) {
      throw new Error('state identity must be an owner-only regular file');
    }
    const identity = validateStateIdentity(JSON.parse(fs.readFileSync(fd, 'utf8')));
    if (identity.signerAddress !== signerAddress.toLowerCase()) throw new Error('state identity signer mismatch');
    return identity;
  } finally { fs.closeSync(fd); }
}

export function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Explicit offline ceremony only. Startup never calls this. Refuses any existing path.
export function initializeJournal(stateFile, identity) {
  const approved = validateStateIdentity(identity);
  const directory = path.dirname(stateFile);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('secure existing journal directory required');
  const fd = fs.openSync(stateFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ stateIdentity: approved }) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fsyncDirectory(directory);
}
