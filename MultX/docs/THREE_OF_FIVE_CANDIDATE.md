# 3-of-5 bridge candidate

Unreviewed candidate based on b0f9ca8140e601370fbb1f15105c088eddc3a0c6 (the source-evidence candidate). Accepted v0.9.2 baseline remains 5994f263b9d1fd40c531410d6b23884eade9f5b9 with 5-of-7 policy until review. No deployment or signing enablement is authorized by this branch.

This revision requires threshold 3, exactly five distinct bridge validators and five acceptance records in production plans/manifests. The API requires exactly signer indices 0–4, explicit threshold 3, mTLS credentials, and matching live topology. Additional/noncanonical indices are rejected, including indices beyond the loader's range. Read-only deployment verification requires live threshold 3 and exact manifest membership. Production templates use five signer slots.

Solidity contracts already support configurable quorum; their source is unchanged. New local Hardhat tests instantiate each bridge with five synthetic validators and threshold 3, proving insufficient signatures, duplicates, outsiders, message substitution and replay rejection. This is not evidence of real production signer custody or Safe-backed attestation support.

Governance Safe remains distinct from bridge signing. This revision does not connect a Safe contract as an ECDSA validator, change fallback policy, or mark the supplied five addresses custody-verified.

The four-chain/LITHO-origin validators and templates are retained for this isolated quorum revision. They still cannot represent the client's ETH/BNB/Base-first rollout. Route/deployment-schema redesign is a separate outstanding candidate, not permission to bypass the current checks. Historical testnet scripts and their 5-of-7 manifests remain historical.

Required next review: new candidate source/tag/hashes and negative coverage of the deployment plan, manifest, live verifier, API environment and live topology. No prior acceptance is carried forward automatically. The 48-hour Timelock delay approval does not approve this quorum candidate or production deployment.
