import fs from 'node:fs/promises';
import path from 'node:path';

// Operator handoff adapter: each file contains one externally signed transaction.
// No signing key, network calls or broadcast capability. Files must be immutable
// and retained by custody until reconciliation completes.
export function createFilePayoutCustody(directory, custodyRef) {
  if (!path.isAbsolute(directory) || typeof custodyRef !== 'string' || !custodyRef.trim()) {
    throw Error('absolute custody directory and custody reference required');
  }
  return {
    custodyRef,
    async getSignedTransaction(request) {
      if (request.custodyRef !== custodyRef || !/^0x[0-9a-f]{64}$/.test(request.requestId)) {
        throw Error('invalid custody request');
      }
      let file;
      try {
        file = await fs.open(path.join(directory, request.requestId + '.signed'), 'r');
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 2050) throw Error('invalid custody artifact');
        const raw = (await file.readFile('utf8')).trim();
        if (!/^0x[0-9a-f]+$/i.test(raw) || raw.length > 2048) throw Error('invalid custody artifact');
        return raw;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      } finally {
        await file?.close();
      }
    },
  };
}
