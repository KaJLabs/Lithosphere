import { identityDigest, fsyncDirectory } from './stateIdentity.js';
import fs from 'fs';
import path from 'path';

const KEY = /^native:0x[0-9a-fA-F]{64}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const STATES = new Set([
  'RELEASE_AUTHORIZED',
  'CANCELLATION_AUTHORIZED',
  'PAYOUT_PROOF_PENDING',
  'PAYOUT_FINALIZED',
  'REFUND_AUTHORIZED',
]);
const ALLOWED = {
  NONE: new Set(['RELEASE_AUTHORIZED', 'CANCELLATION_AUTHORIZED', 'PAYOUT_PROOF_PENDING', 'REFUND_AUTHORIZED']),
  RELEASE_AUTHORIZED: new Set(['CANCELLATION_AUTHORIZED', 'PAYOUT_PROOF_PENDING', 'REFUND_AUTHORIZED']),
  CANCELLATION_AUTHORIZED: new Set(['CANCELLATION_AUTHORIZED', 'PAYOUT_PROOF_PENDING', 'REFUND_AUTHORIZED']),
  PAYOUT_PROOF_PENDING: new Set(['PAYOUT_PROOF_PENDING', 'PAYOUT_FINALIZED', 'CANCELLATION_AUTHORIZED', 'REFUND_AUTHORIZED']),
  PAYOUT_FINALIZED: new Set(),
  REFUND_AUTHORIZED: new Set(['REFUND_AUTHORIZED', 'PAYOUT_PROOF_PENDING']),
};
const RENEWABLE = new Set(['CANCELLATION_AUTHORIZED', 'REFUND_AUTHORIZED']);

const validRecord = record =>
  KEY.test(record?.key || '') && STATES.has(record?.state) &&
  HASH.test(record?.operationHash || '') && HASH.test(record?.decisionHash || '') &&
  HASH.test(record?.authorityEpoch || '') && Number.isSafeInteger(record?.sequence) && record.sequence > 0 &&
  Number.isSafeInteger(record?.authorizationExpiry) && record.authorizationExpiry >= 0 &&
  (record.renewedAt === undefined || (Number.isSafeInteger(record.renewedAt) && record.renewedAt > 0));

const validRenewal = (prior, record) => RENEWABLE.has(record.state) &&
  prior?.state === record.state && record.decisionHash !== prior.decisionHash &&
  Number.isSafeInteger(record.renewedAt) && record.renewedAt > prior.authorizationExpiry &&
  record.authorizationExpiry > record.renewedAt &&
  record.authorizationExpiry > prior.authorizationExpiry;
const validPendingReplacement = (prior, record) => prior?.state === 'PAYOUT_PROOF_PENDING' &&
  record.state === prior.state && record.decisionHash !== prior.decisionHash &&
  record.authorizationExpiry === 0 && record.renewedAt === undefined;

export function createNativeStateJournal(stateFile, {
  strictPermissions = false,
  expectedIdentity = null,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const directory = path.dirname(stateFile);
  if (!strictPermissions) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('native journal directory must be a real directory');
  }
  if (strictPermissions && expectedUid !== null && directoryStat.uid !== expectedUid) {
    throw new Error('native journal directory must be owned by the signer process UID');
  }
  if (strictPermissions && (directoryStat.mode & 0o077) !== 0) {
    throw new Error('native journal directory must use owner-only permissions');
  }
  if (strictPermissions && (!expectedIdentity || !fs.existsSync(stateFile))) {
    throw new Error('production native journal/approved identity missing; restore state or perform explicit first-use ceremony');
  }

  const states = new Map();
  let expectedSize = 0;
  let expectedInode;
  let expectedDevice;
  if (fs.existsSync(stateFile)) {
    const pathStat = fs.lstatSync(stateFile);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('native journal must be a regular file');
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(stateFile, flags);
    let contents;
    try {
      const stat = fs.fstatSync(fd);
      if (strictPermissions && expectedUid !== null && stat.uid !== expectedUid) throw new Error('native journal owner mismatch');
      if (strictPermissions && (stat.mode & 0o077) !== 0) throw new Error('native journal must use owner-only permissions');
      contents = fs.readFileSync(fd, 'utf8');
      expectedSize = stat.size; expectedInode = stat.ino; expectedDevice = stat.dev;
    } finally { fs.closeSync(fd); }
    if (strictPermissions) {
      const boundary = contents.indexOf('\n');
      if (boundary < 0 || !contents.endsWith('\n')) throw new Error('native journal identity/trailing record incomplete');
      let header;
      try { header = JSON.parse(contents.slice(0, boundary)); } catch { throw new Error('invalid native journal state identity'); }
      if (identityDigest(header.stateIdentity) !== identityDigest(expectedIdentity)) throw new Error('native journal state identity mismatch');
      contents = contents.slice(boundary + 1);
    }
    for (const [index, line] of contents.split('\n').filter(Boolean).entries()) {
      let record;
      try { record = JSON.parse(line); } catch { throw new Error(`invalid JSON in native journal line ${index + 1}`); }
      if (!validRecord(record)) throw new Error(`invalid native journal record at line ${index + 1}`);
      const prior = states.get(record.key);
      const from = prior?.state || 'NONE';
      if (record.sequence !== (prior?.sequence || 0) + 1 || !ALLOWED[from].has(record.state)) {
        throw new Error(`invalid native settlement transition ${from} -> ${record.state}`);
      }
      if (prior && (prior.operationHash !== record.operationHash || prior.authorityEpoch !== record.authorityEpoch)) {
        throw new Error(`native operation identity changed for ${record.key}`);
      }
      if (prior?.state === record.state && !validRenewal(prior, record) &&
          !validPendingReplacement(prior, record)) {
        throw new Error(`invalid native certificate renewal for ${record.key}`);
      }
      if (prior?.state !== record.state && record.renewedAt !== undefined) {
        throw new Error(`unexpected native certificate renewal for ${record.key}`);
      }
      states.set(record.key, record);
    }
  }

  const assertUnchanged = () => {
    if (!strictPermissions) return;
    const current = fs.lstatSync(stateFile);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== expectedInode ||
        current.dev !== expectedDevice || current.size !== expectedSize ||
        (current.mode & 0o077) !== 0 || (expectedUid !== null && current.uid !== expectedUid)) {
      throw new Error('native journal replaced, lost or truncated while running');
    }
  };

  return {
    get(key) {
      if (!KEY.test(key || '')) throw new Error('invalid native journal key');
      const value = states.get(key);
      return value ? { ...value } : null;
    },
    transition({ key, state, operationHash, decisionHash, authorityEpoch, authorizationExpiry = 0,
      renewedAt }) {
      if (!validRecord({ key, state, operationHash, decisionHash, authorityEpoch, authorizationExpiry, sequence: 1 })) {
        throw new Error('invalid native settlement decision');
      }
      assertUnchanged();
      const prior = states.get(key);
      if (prior?.state === state) {
        if (prior.operationHash === operationHash && prior.decisionHash === decisionHash &&
            prior.authorityEpoch === authorityEpoch && prior.authorizationExpiry === authorizationExpiry) {
          return false;
        }
        if (!validRenewal(prior, { state, decisionHash, authorizationExpiry, renewedAt }) &&
            !validPendingReplacement(prior, { state, decisionHash, authorizationExpiry, renewedAt })) {
          throw new Error(`refusing native certificate renewal for ${key}`);
        }
      }
      const from = prior?.state || 'NONE';
      if (!ALLOWED[from].has(state)) throw new Error(`refusing native transition ${from} -> ${state}`);
      if (prior && (prior.operationHash !== operationHash || prior.authorityEpoch !== authorityEpoch)) {
        throw new Error(`refusing native operation/epoch drift for ${key}`);
      }
      const record = {
        key, sequence: (prior?.sequence || 0) + 1, state, operationHash,
        decisionHash, authorityEpoch, authorizationExpiry,
        at: new Date().toISOString(),
      };
      if (prior?.state === state) record.renewedAt = renewedAt;
      const flags = fs.constants.O_APPEND | (strictPermissions ? 0 : fs.constants.O_CREAT) |
        fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(stateFile, flags, 0o600);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw new Error('native journal must remain a regular file');
        if (strictPermissions && (stat.ino !== expectedInode || stat.dev !== expectedDevice || stat.size !== expectedSize)) {
          throw new Error('native journal changed before append');
        }
        fs.writeFileSync(fd, `${JSON.stringify(record)}\n`);
        fs.fsyncSync(fd);
        expectedSize = fs.fstatSync(fd).size;
      } finally { fs.closeSync(fd); }
      if (!strictPermissions && process.platform !== 'win32') fsyncDirectory(directory);
      states.set(key, record);
      return true;
    },
  };
}
