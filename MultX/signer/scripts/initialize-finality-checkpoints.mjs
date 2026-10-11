import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initializeFinalityCheckpoints, finalityCheckpointBinding } from '../src/finalityCheckpoints.js';
import { parseNativeSignerPolicy } from '../src/nativePolicy.js';
import { loadStateIdentity } from '../src/stateIdentity.js';

// Offline first-use ceremony. Never called by container startup. Approval must
// cover this exact policy, identity and checkpoint path. Existing history must
// be restored, not reinitialized through this tool.
try {
  const [approvalFile, approvalSha256, policyFile, identityFile] = process.argv.slice(2);
  if (process.argv.length !== 6 || !/^[a-f0-9]{64}$/.test(approvalSha256 || '')) throw new Error('usage');
  const sha = data => createHash('sha256').update(data).digest('hex');
  const bytes = fs.readFileSync(approvalFile);
  if (sha(bytes) !== approvalSha256) throw new Error('approval mismatch');
  const approval = JSON.parse(bytes);
  const policyBytes = fs.readFileSync(policyFile);
  if (approval.firstUse !== true || approval.policySha256 !== sha(policyBytes) ||
      !path.isAbsolute(approval.checkpointFile || '')) throw new Error('approved first use required');
  const policy = parseNativeSignerPolicy(JSON.parse(policyBytes));
  const identity = identityFile === 'relay' ? null : loadStateIdentity(identityFile, policy.signerAddress);
  const binding = finalityCheckpointBinding(policy, identity);
  if (approval.binding !== binding) throw new Error('binding mismatch');
  initializeFinalityCheckpoints(approval.checkpointFile, binding);
  process.stdout.write('Finality checkpoint FIRST_USE initialized; signing remains separately gated.\n');
} catch {
  process.stderr.write('Checkpoint initialization refused; inspect private approval and restore records.\n');
  process.exitCode = 1;
}
