# Validator setup

The Makalu testnet validator onboarding guide is maintained at
[docs.litho.ai](https://docs.litho.ai/docs/testnet/validators). Its source is
[`content/docs/testnet/validators.mdx`](../../content/docs/testnet/validators.mdx)
in this repository, with the Docsify publication mirror at
[`docs/testnet/validators.md`](../testnet/validators.md). It covers isolated testnet identities, node setup,
registration, verification, monitoring, and the rehearsal evidence expected
before a separate mainnet application.

The repository-hosted companion guide for applications, approval stages,
commission/stake planning, and the September 2026 cohort is
[LITHO mainnet validator onboarding](../validators/onboarding.md).

Use the network table in the relevant guide before running any command. Makalu
uses Cosmos chain ID `lithosphere_700777-2` and EVM chain ID `700777`. LITHO
Mainnet uses `lithosphere_9005-1` and `9005`. Never reuse Makalu keys, genesis,
snapshots, peers, or transaction inputs on mainnet.
