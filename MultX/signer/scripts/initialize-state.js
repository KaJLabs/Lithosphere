import fs from 'node:fs';
import { initializeJournal, loadStateIdentity } from '../src/stateIdentity.js';

const [identityFile, stateFile, signerAddress, confirmation] = process.argv.slice(2);
if (!identityFile || !stateFile || !signerAddress || confirmation !== '--confirm-first-use-new-identity') {
  throw new Error('Usage: node scripts/initialize-state.js IDENTITY_FILE JOURNAL_FILE PUBLIC_SIGNER_ADDRESS --confirm-first-use-new-identity');
}
if (process.env.SIGNER_RELEASE_SIGNING_ENABLED === 'true') throw new Error('initialization requires signing disabled');
// No key is loaded, no signature is produced. An existing identity must instead
// restore its latest state; this command is never a recovery/empty-history reset.
if (fs.existsSync(stateFile)) throw new Error('journal already exists; initialization refused');
initializeJournal(stateFile, loadStateIdentity(identityFile, signerAddress));
console.log('Initialized first-use journal. Retain approved identity independently; no signing or activation performed.');
