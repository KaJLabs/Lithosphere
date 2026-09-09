import { getBytes } from 'ethers';
import { releaseMessageHash } from './policy.js';
import { verifySourceEvidence } from './sourceEvidence.js';

export function createReleaseDecision({ journal, signer }) {
  let queue = Promise.resolve();
  return (source, attestation, client) => {
    const run = queue.then(async () => {
      await verifySourceEvidence(source, attestation, client);
      const hash = releaseMessageHash(attestation);
      const key = `${attestation.sourceChain}:${attestation.sourceBridge.toLowerCase()}:${attestation.sourceNonce}`;
      // A durable decision precedes the signature; never discard it on failure.
      await journal.record(key, hash);
      await verifySourceEvidence(source, attestation, client);
      return signer.signMessage(getBytes(hash));
    });
    queue = run.catch(() => {});
    return run;
  };
}
