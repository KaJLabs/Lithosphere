# MultX v0.9.1 remediation candidate

Status: implemented for focused independent review; **not accepted for activation**.
Supersedes v0.9.0 only after Autha accepts the new immutable candidate identity.
The prior report is `Autha Audits — MultX v0.9.0 Independent Security Review`;
its target was commit `cb1a0e993f5224a04d712f6dbac8a7accdb57517`.

## H-01: authenticate governance

- `GovTimelock` creation/runtime bytecode and compiler identity are included in
  independently generated evidence. Its runtime hash is required in plan and
  deployment manifest and bound to the supplied evidence bytes.
- Each chain now records the Timelock creation transaction and block. The
  verifier proves successful creation at the declared address and block by the
  plan's approved Timelock deployer, with empty-code-before/code-after boundary.
- The whole creation transaction input must equal the audited creation code plus
  the ABI encoding of the approved delay, proposers, executors and zero external
  administrator. Extra constructor arguments or trailing data fail verification.
- RoleGranted/RoleRevoked history is reconstructed from the proven creation block
  through the fixed verification block. Exact proposer, executor, canceller and
  admin universes are compared to approved policy and checked against live views;
  undeclared active roles fail. The policy permits the Safe as sole proposer and
  canceller, the Timelock as sole admin, and either Safe-only or explicitly
  approved zero-address open execution.
- Safe verification binds independently approved proxy/runtime hashes and slot-0
  implementation address, exact owner set, threshold, version, module state,
  guard and fallback storage. This candidate supports **Safe 1.4.1 with no
  modules, no guard and no fallback handler**, at least two owners and threshold
  at least two. Other Safe configurations fail closed and require separate
  review/support; no production Safe configuration has been selected here.
- The Safe hashes and acceptance URL are independent governance inputs in the
  approved plan, not copied from an untrusted deployment manifest. An operator
  must retain independently reviewed Safe code/build evidence and owner approval.
  A URL alone is not an independent audit, and the verifier does not authenticate
  the human approval system. It assumes the separately retained plan/evidence
  files are the approved roots.
- The verification block hash is rechecked at completion to detect a reorg
  during the sequence of block-pinned RPC reads.

Regression coverage includes genuine OpenZeppelin Timelock role grants/revokes,
hidden holders of all four roles, runtime/constructor/deployer mismatch, real
Safe 1.4.1 proxy integration, and Safe implementation/owners/threshold/modules/
guard/fallback drift. The Safe artifacts are test-only fixtures with retained
upstream package integrity and license, not production approvals.

## M-01: exact supported-token universe

Both bridges emit `SupportedTokenSet` on every add/remove. The verifier replays
all token-support events from proven creation, compares the entire active set
to the approved assets, then checks every historically touched token against
current mapping state. An undeclared supported token is rejected even if it has
no route. Existing per-asset complete route checks remain in place.

This changes both bridge bytecodes. Existing v0.8.2/v0.9.0 deployments without
these events cannot pass the new verifier. Rebuild evidence and deploy the
reviewed replacement paused; do not relabel old contracts as this candidate.

## M-02: API dependency closure

The API overrides the vulnerable transitive `qs` tree to exactly **6.16.0** and
regenerates the npm lockfile. Express 4 and body-parser continue to use their
existing API with the patched parser. Production npm audit reports zero
vulnerabilities in the retained run. A regression verifies both dependency paths
and hostile constructor/isBuffer round trips. CI rejects moderate-or-higher
production API findings. The API image now uses the same pinned Node 22 Alpine
base as the signer, replacing the mutable Node 18 base. Build context excludes
host node_modules, test files, environment files and local evidence logs.

Advisories:
- https://github.com/advisories/GHSA-4mjr-xmp4-gh2g
- https://github.com/advisories/GHSA-x5fp-wj9c-mxmx

## O-01: production journal identity and missing-state refusal

Production requires a read-only, separately retained `SIGNER_STATE_IDENTITY_FILE`
containing schema, public signer identity, approved deployment-plan SHA-256,
activation epoch and generation. The journal begins with the matching identity.
Missing files, empty journals, headerless old journals, identity mismatch and
partial trailing records refuse startup **before the local verification challenge
is signed**. A production append never uses O_CREAT; inode/device/size checks
reject journal disappearance, replacement or truncation while running, including
before cached decision reuse. File writes and initial parent directory are fsynced.

`signer/scripts/initialize-state.js` is a separate, explicit first-use ceremony
tool, not called by startup. It requires an existing secure directory, a protected
approved identity file and an exclusive new journal path. It never loads a
signer key, signs, enables the service or overwrites an existing journal.

An existing production identity must recover its latest journal, never run
initialization to erase history. Retain the approved identity outside the journal
volume. Restrict access to the initialization tool through operator procedures.
**Residual operational limit:** a local file alone cannot detect a coordinated
rollback of a valid header and entire old journal to an earlier backup, nor an
operator deliberately reinitializing a lost journal. Independent backup freshness
and recovery acceptance, single active instance per identity, recent-decision
reconciliation and external custody controls remain mandatory. This change
enforces missing-state refusal, not a claim of rollback-proof storage.

## O-02 and release boundary

Seven independent operators/accounts/hosts/custody records, finality/RPC policy,
Safe identities, staging, backup/restore, monitoring, paused four-chain deployment,
canary and activation evidence remain outstanding. Existing operator PR #24 is
pinned to v0.9.0 and must be revised after the replacement candidate is accepted;
its old runtime/identity mounts cannot certify this release.

Do not fund, unpause, enable release signing or expose production bridging.
Autha must perform the focused closure review against the final new tag, full
commit, source SHA-256 and bytecode evidence. Test success is remediation evidence,
not independent closure or deployment authorization.

Safe layout references:
- https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxy.sol
- https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/GuardManager.sol
- https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/FallbackManager.sol
