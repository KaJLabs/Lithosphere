# Pinned fallback amendment — unaccepted candidate

This candidate implements Autha G-01's five stated conditions. It is not an
approval, deployment plan or authorization to configure any Safe.

For chains 1, 56 and 8453 only, the plan may explicitly use:

```json
{
  "fallbackHandler": "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99",
  "fallbackHandlerRuntimeSha256": "8143b6ff3cf48028121244d88321907a1bddc24f1a6f12db01364511e816259a"
}
```

Both values are pinned in policy code. The verifier validates that policy,
checks the Safe's slot, and fetches and hashes the handler runtime at the same
verification block used for Safe state. Empty code is rejected. Modules remain
empty and guard remains zero. No other nonzero handler/chain/hash is allowed.

The zero-handler option remains valid on all otherwise supported chains. It
must omit fallbackHandlerRuntimeSha256. Existing deployment templates retain
that option; operators must explicitly choose and obtain approval for the final
configuration. No Base governance Safe is invented by this amendment.

The test fixture contains the 5637-byte runtime captured in the handler evidence
review and matched to Safe's registry at commit
7b1fb6d615ab2d2999550ec9166554b180e813e5. Its source is Safe v1.4.1
CompatibilityFallbackHandler (LGPL-3.0-only), commit
bf943f80fec5ac647159d26161446ac5d716a294; the licensed source archive accompanies
the review package. Runtime hashes refer to decoded bytes, not the hex text.

Regression tests run through validateGovernancePolicy and verifyGovernance,
including invalid chain/address/hash, missing hash, zero-handler metadata,
runtime absence/drift, slot drift, modules and guard. Mutation checks remove
individual checks and both policy call sites, plus the verifySafe call site.
G-04's full deployment-verifier threshold regression remains included.

G-02 shared custody and G-03/O-12 governance risk decisions remain open. In
particular EIP-1271 attestations can authorize third-party use at the Safe owner
threshold without the bridge Timelock delay. This amendment does not connect
Safe attestations to the bridge's ECDSA attestation mechanism.

The consolidated source includes all earlier developer candidates since accepted
v0.9.2. Consolidation provides one source identity, not inherited acceptance.
The LITHO-origin four-chain schema still requires a separately reviewed change
for the client's ETH/BNB/Base-first deployment. Deployment stays disabled.
