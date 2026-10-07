import fs from 'node:fs';
import path from 'node:path';
import { fsyncDirectory } from './stateIdentity.js';

// Conservative canary circuit breaker: any evidence failure stops all native
// signing on this host, survives restart, and never clears itself on a retry.
export function createNativeFinalityGuard(verifier, holdFile) {
  let held = false;
  const assertClear = () => {
    if (held || fs.existsSync(holdFile)) throw new Error('native finality HOLD requires manual reconciliation');
  };
  const guarded = {};
  for (const name of ['verifyRelease', 'verifyCancellation', 'verifyFinalization', 'verifyRefund']) {
    guarded[name] = async (...args) => {
      assertClear();
      try {
        const result = await verifier[name](...args);
        assertClear();
        return result;
      } catch {
        held = true;
        // Directory is the already validated native-journal directory. No raw
        // RPC errors, credentials or attacker-supplied payloads are persisted.
        if (!fs.existsSync(holdFile)) {
          const fd = fs.openSync(holdFile, 'wx', 0o600);
          try { fs.writeFileSync(fd, JSON.stringify({ status: 'HOLD', method: name,
            utc: new Date().toISOString() }) + '\n'); fs.fsyncSync(fd); }
          finally { fs.closeSync(fd); }
          if (process.platform !== 'win32') fsyncDirectory(path.dirname(holdFile));
        }
        throw new Error('native finality HOLD requires manual reconciliation');
      }
    };
  }
  return { verifier: guarded, assertClear };
}
