# MultX O-01 owner input record

Status: incomplete; do not deploy or activate.

Complete this record through the private infrastructure repository or secret
manager. Public copies may contain opaque references and fingerprints only.

## Signer custody

For Hosts 1-5, record:

- custodian/entity and recovery owner;
- SSH public-key fingerprint and fixed management IP/CIDR reference;
- encrypted key/journal backup reference and recovery-drill result;
- signer image digest, policy digest, state-identity fingerprint and acceptance;
- proof that release signing remains disabled.

The confirmed host/address mapping is in
[`O01_OPERATOR_RESPONSIBILITIES.md`](../O01_OPERATOR_RESPONSIBILITIES.md).

## Coordinator and inventory

- coordinator owner, dedicated host fingerprint and source IP/CIDR reference;
- public mTLS client-CA fingerprint/reference and certificate expiry;
- isolated database identity, restore owner and retention reference;
- approved opaque RPC/WSS references for chains 1, 56 and 8453;
- immutable API, signer, contracts, SDK and web release identities;
- monitoring destinations, alert owners and escalation acknowledgement.

## Governance and route approvals

- durable authenticated reference for the 15 September route decision;
- independent acceptance of finite caps and exact three-confirmation policy;
- Base Safe evidence and verified Safe -> 48-hour Timelock -> Bridge plan;
- disposition for G-02, G-03 and O-12;
- exact DEX router/factory/pool/path and liquidity/backing commitments;
- independent acceptance of native settlement/DEX, SDK and web behavior.

## Paused-deployment authorization

Record the exact reviewed plan SHA-256, immutable release/bytecode identities,
UTC window, chains 1/56/8453, deployer, fee payer, pause guardian, operator,
independent reviewer, incident/rollback owner and evidence-store retention.

The authorization text must say **paused deployment only** and confirm that
MultX, bridge signing, release relaying and Swap remain disabled. Canary and
activation are explicitly excluded and require separate approvals.

## Acceptance result

- O-01 reviewer:
- Evidence package/reference:
- Review date/time UTC:
- Disposition: `PENDING`
- Open conditions:

No blank field may be treated as implicit approval.
