import fs from 'node:fs';
import path from 'node:path';
import { fsyncDirectory } from './stateIdentity.js';

// A single attempt per approved canary journal, including failures. Keep this
// directory after submission/hold. Creating another journal requires a separate
// operator-reviewed action after reconciliation, not an automated retry.
export function createNativeRelayJournal(directory) {
  let claimed = false;
  const syncDirectory = dir => { if (process.platform !== 'win32') fsyncDirectory(dir); };
  return {
    claim(identity) {
      const parent = path.dirname(directory);
      const stat = fs.lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('relay journal parent must be a real directory');
      if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) {
        throw new Error('relay journal parent requires owner-only permissions');
      }
      fs.mkdirSync(directory, { mode: 0o700 }); // exclusive; existing means stop
      syncDirectory(parent);
      const fd = fs.openSync(path.join(directory, 'identity.json'), 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(identity) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      syncDirectory(directory);
      claimed = true;
    },
    record(status) {
      if (!claimed || !['BROADCAST_ATTEMPT', 'SUBMITTED', 'HOLD'].includes(status)) throw new Error('invalid relay journal state');
      const fd = fs.openSync(path.join(directory, status), 'wx', 0o600);
      try { fs.writeFileSync(fd, new Date().toISOString() + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      syncDirectory(directory);
    },
  };
}
