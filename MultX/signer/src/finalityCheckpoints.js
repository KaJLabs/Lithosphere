import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fsyncDirectory } from './stateIdentity.js';

const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const finalityCheckpointBinding = (policy, identity = null) => checksum({ policy, identity });
const sync = directory => { if (process.platform !== 'win32') fsyncDirectory(directory); };
function secureStat(stat, directory = false) {
  if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink() ||
      (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) {
    throw new Error('finality checkpoint requires owner-only regular storage');
  }
}
function read(file, binding) {
  secureStat(fs.lstatSync(path.dirname(file)), true);
  secureStat(fs.lstatSync(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    secureStat(fs.fstatSync(fd));
    const envelope = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const data = envelope.data;
    if (!data || data.version !== 1 || data.binding !== binding ||
        !Number.isSafeInteger(data.sequence) || data.sequence < 0 ||
        !data.chains || typeof data.chains !== 'object' || Array.isArray(data.chains) ||
        envelope.sha256 !== checksum(data)) throw new Error('finality checkpoint integrity mismatch');
    for (const [chain, pair] of Object.entries(data.chains)) {
      if (!/^[1-9][0-9]*$/.test(chain) || !Array.isArray(pair) || pair.length !== 2 ||
          pair.some(head => !Number.isSafeInteger(head?.number) || head.number <= 0 ||
            !/^0x[0-9a-f]{64}$/.test(head.hash || '') ||
            !Number.isSafeInteger(head.latest) || head.latest < head.number)) {
        throw new Error('invalid finality checkpoint');
      }
    }
    return data;
  } finally { fs.closeSync(fd); }
}
function write(file, data, exclusive = false) {
  const fd = fs.openSync(file, exclusive ? 'wx' : 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ data, sha256: checksum(data) }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

// OFFLINE only: never invoked by verifier startup. The operator must retain the
// approved binding and establish FIRST_USE or restore this file with journals.
export function initializeFinalityCheckpoints(file, binding) {
  if (!/^[a-f0-9]{64}$/.test(binding || '')) throw new Error('approved checkpoint binding required');
  secureStat(fs.lstatSync(path.dirname(file)), true);
  write(file, { version: 1, binding, sequence: 0, chains: {} }, true);
  sync(path.dirname(file));
}

export function createFinalityCheckpoints(file, binding) {
  if (!file || !binding) throw new Error('approved finality checkpoint file and binding required');
  let snapshot = read(file, binding); // Missing files NEVER initialise themselves.
  let tail = Promise.resolve();
  let held = false;
  return {
    // Serialise complete sampling as well as writes. A failed/late RPC cannot
    // commit stale observations after the caller has timed out.
    sample(chainId, observe) {
      const result = tail.then(async () => {
        if (held) throw new Error('finality checkpoint HOLD');
        try {
          const disk = read(file, binding);
          if (checksum(disk) !== checksum(snapshot)) throw new Error('finality checkpoint changed externally');
          const { heads, value } = await observe(disk.chains[String(chainId)]);
          const next = { ...disk, sequence: disk.sequence + 1,
            chains: { ...disk.chains, [String(chainId)]: heads } };
          const temp = `${file}.${randomBytes(16).toString('hex')}.tmp`;
          try {
            write(temp, next, true);
            // Recheck after awaited RPC work before replacing anything.
            if (checksum(read(file, binding)) !== checksum(snapshot)) throw new Error('finality checkpoint changed externally');
            fs.renameSync(temp, file);
            sync(path.dirname(file));
            snapshot = next;
          } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
          return value;
        } catch (error) { held = true; throw error; }
      });
      tail = result.catch(() => {});
      return result;
    },
  };
}
