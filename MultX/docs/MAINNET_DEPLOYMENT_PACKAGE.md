# v0.9.1 evidence additions

The approved plan and manifest now require `govTimelockRuntimeSha256`; independent
bytecode evidence must include GovTimelock. Each chain's manifest records
`governance.timelockDeploymentTxHash` and `timelockDeploymentBlock`. The plan's
`governance.timelock` binds its deployer, exact proposer/executor/canceller/admin
sets and zero constructor admin. The plan's `governance.safe` binds independently
reviewed Safe 1.4.1 proxy/implementation hashes, implementation address, owners,
threshold and acceptance URL. This release only permits no modules/guard/fallback.

Safe code hashes must come from independently retained reviewed implementation
and proxy artifacts, not from copying unknown live code. These remain external
approval inputs; do not treat example owners or test-fixture hashes as approved.

Both bridge bytecodes change to emit SupportedTokenSet. Regenerate evidence and
use new paused deployments following focused audit closure. The verifier rejects
old eventless token histories, incorrect Timelock constructors/roles and Safe
state drift. Production signers additionally require an independently retained
state-identity file and explicitly initialized journal (see signer runbook).

# MultX mainnet deployment package

Status: transaction-free preparation complete; deployment blocked.

This package prepares the audited LITHO 9005, Ethereum 1, BNB 56 and Base 8453
deployment without guessing governance, assets, caps, RPCs or custody inputs.
It does not authorize a transaction. MultX and signer release signing remain
disabled.

## Files

- `infra/mainnet-deployment-plan.template.json`: client/audit/governance intake
  record required before execution.
- `contracts/scripts/mainnet/validate-deployment-plan.js`: fail-closed plan
  validator; binds the plan to audited source/destination runtime hashes and
  rejects placeholders, wrong chains, non-5-of-7 signer sets,
  duplicate identities, missing approvals, unsafe governance separation and
  zero caps.
- `infra/mainnet-deployment-manifest.template.json`: sanitized post-deployment
  evidence record for addresses, transactions, blocks, runtime hashes, owners,
  guardians, exact signer sets, caps, assets and explicit token/target routes.
- `contracts/scripts/mainnet/validate-deployment-manifest.js`: rejects any
  incomplete, unpaused, unverified, unaudited-bytecode or
  cross-chain-inconsistent manifest.
- `contracts/scripts/mainnet/verify-deployment-readonly.js`: performs only RPC
  reads to independently bind the exact approved plan and bytecode-evidence
  files to the manifest, prove deployment transaction/creation-block provenance,
  chain IDs, runtime hashes, pause state, owners, guardians,
  an exact complete 5-of-7 signer set (including a live-count check), supported
  assets and routes, caps and wrapped-token origin/bridge roles. It refuses
  common signing-credential environment variables.
- `contracts/scripts/mainnet/generate-bytecode-evidence.js`: derives bridge and
  wrapped-token creation/runtime hashes, immutable-reference offsets, compiler
  version and settings directly from pinned Hardhat build information. The
  generated JSON is independently hashed and supplied to the verifier.
- `infra/network.mainnet.template.json`: API/indexer route manifest populated
  only from the validated deployment manifest.
- `infra/docker-compose.mainnet.template.yml`: non-runnable API/database
  template aligned with seven independent private VPS signer mTLS endpoints
  and an explicit trusted reverse-proxy hop for correct per-client rate limiting.

## Required sequence

1. Complete the independent contract and signer-protocol audit, remediation
   and fix review. Publish a new immutable audited release tag.
2. Obtain written approval for Safe/timelock/guardian/deployer/fee-payer
   addresses, seven bridge signer identities, 5-of-7 threshold, RPCs,
   confirmation depths, supported assets, base-unit caps and UTC window.
3. Copy `mainnet-deployment-plan.template.json` outside the public repository,
   complete it with evidence URLs only, and validate it:

   ```bash
   cd MultX/contracts
   node scripts/mainnet/validate-deployment-plan.js --plan /secure/path/plan.json
   ```

4. Independently review the plan and record its SHA-256. No deployer key may be
   loaded before this gate passes.
5. Use a separately reviewed audited-release deployment implementation during
   the approved window. The historical `deploy.js` and
   `03-deploy-dest-chain.js` scripts are testnet-only and must not be used for
   mainnet.
6. Deploy governance first and bridges paused. Deploy only approved wrapped
   assets, grant only the approved bridge role, set caps, explicitly enable
   only approved token/target routes, and keep everything paused.
7. Complete and validate `mainnet-deployment-manifest.template.json`:

   ```bash
   node scripts/mainnet/validate-deployment-manifest.js \
     --manifest /secure/path/deployment-manifest.json
   ```

8. Run the transaction-free RPC verification from an environment containing no
   mnemonic or private key:

   ```bash
   node scripts/mainnet/verify-deployment-readonly.js \
     --plan /secure/path/approved-plan.json \
     --manifest /secure/path/deployment-manifest.json \
     --bytecode-evidence /secure/path/audited-bytecode-evidence.json \
     --confirm-transaction-free
   ```

9. Commit only the sanitized validated manifest. Store private RPC credentials,
   custody data, TLS private keys and infrastructure inventory in the protected
   secret manager/private infrastructure repository.
10. Configure API routes and signer policies from that manifest, leave release
    signing disabled, and request a separate production-canary approval.

## Stop conditions

Stop immediately on any audit mismatch, placeholder, wrong chain ID, different
runtime hash, unpaused bridge, owner/guardian collision, signer-set drift,
unapproved asset, zero/different cap, missing source verification or window
mismatch. Do not repair evidence by hand after a transaction; pause, preserve
records and use the approved rollback/change-control process.
