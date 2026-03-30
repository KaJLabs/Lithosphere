# Chain Parameters

## Consensus Overview

Lithosphere is a **Proof of Stake** blockchain network designed to serve as cross-chain DeFi infrastructure. The network enables seamless interoperability between heterogeneous blockchains while maintaining high throughput and security guarantees through its novel consensus protocol.

## LinBFT Consensus Protocol

Lithosphere employs the **LinBFT** (Linear Communication Byzantine Fault Tolerant) consensus protocol, designed by Dr. David Yang. LinBFT builds upon the foundations of classic PBFT (Practical Byzantine Fault Tolerance) and introduces four key improvements:

### 1. Per-Block Consensus

Unlike traditional BFT protocols where a leader may propose multiple blocks in sequence, LinBFT achieves consensus on a **per-block basis**. This limits the power of any individual block proposer and mitigates the risk of selfish mining attacks, where a proposer could withhold blocks for personal advantage.

### 2. Rotating Leader

The block proposer **changes with every block**. By rotating leadership each round, LinBFT significantly reduces the risk of Denial-of-Service (DoS) attacks targeting a single known leader. An attacker cannot predict and target the next proposer far in advance.

### 3. Changing Honesty

LinBFT operates under a realistic threat model where participants can behave **honestly or maliciously on a per-block basis**. A node that is honest in one round may act maliciously in the next, and vice versa. The protocol remains secure as long as **more than two-thirds of participants behave honestly in any given block**.

### 4. Dynamic Participant Set

Nodes are permitted to **join and leave the validator set at epoch boundaries**. This dynamic membership allows the network to scale and adapt over time without requiring a hard-coded or static set of validators.

### Communication Efficiency

LinBFT requires only a **single round of voting** compared to the two rounds used in classic PBFT. This reduction in voting rounds lowers communication overhead and decreases block confirmation time, enabling faster finality.

### Proof of Stake Rewards

The PoS mechanism in Lithosphere **rewards all participants** who contribute to consensus, not just the block proposer. This inclusive reward model incentivizes broad participation and strengthens network security.

## Chain Framework

Lithosphere is built on the following technology stack:

| Component | Technology |
|---|---|
| **Framework** | Cosmos-SDK |
| **Consensus Engine** | CometBFT |
| **Virtual Machine** | LithoVM (EVM-compatible) |
| **Chain ID** | `lithosphere_700777-1` |
| **EVM Chain ID** | `700777` |
| **Block Time** | ~3 seconds |

The Cosmos-SDK foundation provides modular architecture and proven interoperability primitives, while CometBFT handles networking and consensus. LithoVM delivers full EVM compatibility, allowing developers to deploy Solidity smart contracts and use familiar Ethereum tooling.

## Cross-Chain Integration

Lithosphere implements cross-chain asset transfers through a **Lock-in/Lock-out** mechanism combined with **distributed control management**. This architecture enables assets from one blockchain to be represented and used on another without requiring centralized custodians.

![Cross-Chain Transactions](../diagrams/Figure_2.png)

### How Cross-Chain Transactions Work

1. **Lock-in**: Assets on the source chain are locked in a smart contract, and a corresponding proof is generated.
2. **Verification**: Lithosphere validators verify the lock-in transaction across chains using the distributed control management layer.
3. **Lock-out**: Once verified, equivalent assets are released or minted on the destination chain.

### Asset Registration

Lithosphere handles cross-chain assets through an automated registration process:

- **Unregistered assets**: When an asset from another chain is bridged to Lithosphere for the first time, a new smart contract is deployed automatically to represent that asset on the Lithosphere network.
- **Registered assets**: For assets that have already been registered, equal tokens are issued within the existing smart contract, maintaining a consistent token address and contract interface.

This approach ensures that each external asset has a single canonical representation on Lithosphere, simplifying DeFi integrations and preventing token fragmentation.

## Canonical Network Parameters

A machine-readable JSON configuration bundle is available at [`network-parameters.json`](./network-parameters.json) for wallets, operators, and tooling to consume.

| Parameter | Value |
|-----------|-------|
| Cosmos Chain ID | `lithosphere_700777-1` |
| EVM Chain ID | `700777` (hex: `0xab169`) |
| Bech32 Prefix | `litho` |
| Native Denom | `ulitho` (display: `LITHO`, 18 decimals) |
| Block Time | ~3 seconds |
| Max Block Size | 21 MB |
| Max Gas per Block | 100,000,000 |
| Consensus | CometBFT (LinBFT) |
| Framework | Cosmos-SDK (Ethermint fork) |

## Rate Limits and Anti-Spam Controls

### Public RPC Endpoints

Public RPC endpoints (`rpc.litho.ai`, `api.litho.ai`) are rate-limited via Nginx/Cloudflare:

- Rate-limited per IP
- WebSocket connections are limited per client

### Mempool and Transaction Parameters

- **Minimum gas price**: Validators enforce a minimum gas price to prevent spam transactions
- **Gas limit per block**: 100,000,000 gas units
- **Max block size**: 21 MB
- **Pruning**: Sentry nodes prune historical state; archive node guidance is available upon request

### Faucet Rate Limits (Testnet)

- 1 claim per wallet address per 24 hours
- Maximum 10 requests per IP per 15 minutes
- Claim amounts: 100 / 250 / 500 LITHO

> **Note**: For archive node setup, seed node lists, and detailed sentry topology guidance, contact the Lithosphere validator team or consult the [validator documentation](../validators/node-deployment.md).
