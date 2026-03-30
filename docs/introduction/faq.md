# Frequently Asked Questions

> **Work in Progress** -- This FAQ is being expanded. If you have questions not covered here, please open an issue on the [GitHub repository](https://github.com/KaJLabs/lithosphere).

## General

### What is Lithosphere?

Lithosphere is a next-generation Layer 1 blockchain platform designed for cross-chain interoperability, powered by AI and deep learning. It enables different blockchains to communicate and transact with each other in a decentralized way, providing complete DeFi financial functionality across multiple token ecosystems.

### What makes Lithosphere different from other blockchains?

- **Cross-chain interoperability**: Lithosphere connects blockchains through Myriad Distributed Key Management (MDKM), enabling tokens from supported chains to interact *(MDKM is on the roadmap; Makalu testnet uses standard Ethermint cross-chain primitives)*
- **Intelligent smart contracts**: Integration of Deep Neural Networks (DNNs) into smart contracts *(planned — not yet available on Makalu)*
- **High throughput**: LinBFT consensus targets up to 1,000,000 TPS at full protocol maturity *(current Makalu testnet throughput is determined by the active validator set and block parameters)*
- **Multi-token standard**: LEP100 supports both fungible and non-fungible tokens in a single contract with cross-chain compatibility

### What is the LITHO token?

LITHO is the native token of the Lithosphere network. It is used for:
- Paying transaction fees across the network
- Staking by validators to secure the network
- Governance participation
- Fueling all LEP100 token operations

Total supply is fixed at 1 billion LITHO tokens.

## Development

### What programming languages does Lithosphere support?

Lithosphere is EVM-compatible and initially uses Solidity for smart contract development. Future releases will add compilers for additional languages. The SDK and tooling are built with TypeScript.

### How do I set up a local development environment?

See the [Developer Setup](../quickstart/dev-setup.md) guide. You'll need Node.js >= 20.0.0 and pnpm >= 9.0.0, then run:

```bash
pnpm install
pnpm dev
```

### Can I migrate my Ethereum smart contracts to Lithosphere?

Yes. Lithosphere is fully compatible with the Ethereum Virtual Machine (EVM). Existing Ethereum smart contracts can be deployed directly on Lithosphere without modification.

## Token Standard

### What is LEP100?

LEP100 (Lithosphere Evolution Proposal 100) is the token standard for the Lithosphere network. It extends ERC-20, ERC-1155, and BEP-20 with additional features like time slicing, cross-chain compatibility, and batch operations.

### How do LEP100 tokens differ from ERC-20?

- LEP100 supports both fungible and non-fungible tokens in a single contract
- Built-in cross-chain compatibility with ERC-20, ERC-721, ERC-1155, BEP-2, and BEP-20
- Time slicing for time-limited token utility
- Batch transfers for reduced gas costs
- Atomic swaps in two steps

## Validators

### How do I become a validator?

You need a sufficient stake in the Lithosphere network to run a verification node. See the [Validator Setup](../quickstart/validator-setup.md) and [Node Deployment](../validators/node-deployment.md) guides for detailed instructions.

### What are the hardware requirements?

See the [Node Deployment](../validators/node-deployment.md) guide for current hardware requirements. Lithosphere uses Cosmos SDK with CometBFT consensus, so requirements are similar to other Cosmos-based chains.

### What happens if my validator goes offline?

Lithosphere's threshold signature technique handles departing nodes. If your validator goes offline, you may lose your stake rewards and, in severe cases, face slashing penalties. The network maintains stability through the threshold key sharing mechanism.

## Network

### What consensus mechanism does Lithosphere use?

Lithosphere uses LinBFT (Linear-communication BFT), a Proof of Stake consensus algorithm proposed by Dr. David Yang. It features per-block consensus, rotating leaders, and dynamic participant sets.

### What is the block time?

Lithosphere achieves approximately 3-second average block times.

### Is Lithosphere compatible with other blockchains?

Yes. Lithosphere supports cross-chain interoperability with any blockchain that uses BFT consensus, as well as EVM-compatible chains, BSC, and others through the Litho Bridge.
