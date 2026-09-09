import { identityDigest, fsyncDirectory } from './stateIdentity.js';
import fs from 'fs';
import path from 'path';

const DECISION_KEY = /^[1-9][0-9]*:0x[0-9a-fA-F]{40}:[1-9][0-9]*$/;

export function createDecisionJournal(stateFile, {
  strictPermissions = false,
  expectedIdentity = null,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  const directory = path.dirname(stateFile);
  if (!strictPermissions) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('signing journal directory must not be a symlink');
  }
  if (strictPermissions && expectedUid !== null && directoryStat.uid !== expectedUid) {
    throw new Error('signing journal directory must be owned by the signer process UID');
  }
  if (strictPermissions && (directoryStat.mode & 0o077) !== 0) {
    throw new Error('signing journal directory must use owner-only permissions');
  }

  if (strictPermissions && (!expectedIdentity || !fs.existsSync(stateFile))) {
    throw new Error('production journal/approved identity missing; restore state or perform explicit first-use ceremony');
  }
  const decisions = new Map();
  let expectedSize = 0;
  let expectedInode;
  let expectedDevice;
  if (fs.existsSync(stateFile)) {
    const pathStat = fs.lstatSync(stateFile);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new Error('signing journal must be a regular file, not a symlink');
    }
    const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    const readFd = fs.openSync(stateFile, readFlags);
    let contents;
    try {
      const stat = fs.fstatSync(readFd);
      if (!stat.isFile()) throw new Error('signing journal must remain a regular file');
      if (strictPermissions && expectedUid !== null && stat.uid !== expectedUid) {
        throw new Error('signing journal must be owned by the signer process UID');
      }
      if (strictPermissions && (stat.mode & 0o077) !== 0) {
        throw new Error('signing journal must use owner-only permissions');
      }
      contents = fs.readFileSync(readFd, 'utf8');
      expectedSize = stat.size; expectedInode = stat.ino; expectedDevice = stat.dev;
    } finally {
      fs.closeSync(readFd);
    }
    if (strictPermissions) {
      const boundary = contents.indexOf('\n');
      if (boundary < 0 || !contents.endsWith('\n')) throw new Error('journal identity/trailing record incomplete');
      let header;
      try { header = JSON.parse(contents.slice(0, boundary)); } catch { throw new Error('invalid journal state identity'); }
      if (identityDigest(header.stateIdentity) !== identityDigest(expectedIdentity)) throw new Error('journal state identity mismatch');
      contents = contents.slice(boundary + 1);
    }
    for (const [index, line] of contents.split('\n').filter(Boolean).entries()) {
      let record;
      try { record = JSON.parse(line); }
      catch { throw new Error(`invalid JSON in signing journal line ${index + 1}`); }
      if (!DECISION_KEY.test(record?.key || '') ||
          !/^0x[0-9a-fA-F]{64}$/.test(record?.hash || '')) {
        throw new Error(`invalid signing journal record at line ${index + 1}`);
      }
      const prior = decisions.get(record.key);
      if (prior && prior !== record.hash) throw new Error(`equivocation detected in state for ${record.key}`);
      decisions.set(record.key, record.hash);
    }
  }

  return {
    record(key, hash) {
      if (!DECISION_KEY.test(key) || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new Error('invalid signing journal decision');
      }
      if (strictPermissions) {
        const current = fs.lstatSync(stateFile);
        if (!current.isFile() || current.isSymbolicLink() || current.ino !== expectedInode || current.dev !== expectedDevice || current.size !== expectedSize || (current.mode & 0o077) !== 0 || (expectedUid !== null && current.uid !== expectedUid)) {
          throw new Error('journal replaced, lost or truncated while running');
        }
      }
      const prior = decisions.get(key);
      if (prior && prior !== hash) throw new Error(`refusing equivocation for ${key}`);
      if (prior) return false;

      const flags = fs.constants.O_APPEND | (strictPermissions ? 0 : fs.constants.O_CREAT) | fs.constants.O_WRONLY |
        (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(stateFile, flags, 0o600);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw new Error('signing journal must remain a regular file');
        if (strictPermissions && expectedUid !== null && stat.uid !== expectedUid) {
          throw new Error('signing journal must remain owned by the signer process UID');
        }
        if (strictPermissions && (stat.mode & 0o077) !== 0) {
          throw new Error('signing journal must retain owner-only permissions');
        }
        if (strictPermissions && (stat.ino !== expectedInode || stat.dev !== expectedDevice || stat.size !== expectedSize)) throw new Error('journal changed before append');
        fs.writeFileSync(fd, `${JSON.stringify({ key, hash, at: new Date().toISOString() })}\n`);
        fs.fsyncSync(fd);
        expectedSize = fs.fstatSync(fd).size;
      } finally {
        fs.closeSync(fd);
      }
      if (!strictPermissions && process.platform !== 'win32') fsyncDirectory(directory);
      decisions.set(key, hash);
      return true;
    },
  };
}
