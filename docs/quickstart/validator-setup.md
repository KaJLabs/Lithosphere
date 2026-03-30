# Validator Setup

This guide covers everything you need to run a Lithosphere validator node, from building the binary to configuring your node for consensus participation.

---

## Overview

In the Lithosphere network, **validators** are nodes with non-negative voting power that actively participate in the consensus process. Voting power is determined either at genesis or dynamically through staking. Validators contribute to block production by broadcasting cryptographic signatures (votes) for each proposed block.

A well-functioning validator is critical to network security and liveness. Operators should ensure high uptime, secure key management, and timely software upgrades.

---

## Prerequisites

| Requirement    | Minimum Version | Notes                                      |
|----------------|----------------:|---------------------------------------------|
| **Go**         | >= 1.22         | Required to compile `lithod` from source.   |
| **GNU Make**   | any             | Used by the build system.                   |
| **OS / Arch**  | Linux x86_64    | The primary supported platform.             |
| **git**        | any             | To clone the source repository.             |

> **Note:** Pre-built binaries are available for Linux x86_64. If you use a pre-built binary you can skip the build step, but Go is still recommended for tooling and debugging.

---

## Building lithod from Source

Clone the repository and build the `lithod` binary:

```bash
git clone https://github.com/KaJLabs/lithosphere.git
cd lithosphere/litho-chain
make install
```

After a successful build, the `lithod` binary is placed in your `$GOPATH/bin` directory. Verify the installation:

```bash
lithod version
```

> **Tip:** Ensure `$GOPATH/bin` is in your `$PATH` so that `lithod` is accessible from any directory.

---

## Node Initialization

Initialize a new node with a chosen moniker (human-readable node name) and the target chain ID:

```bash
lithod init <moniker> --chain-id lithosphere_700777-1
```

Replace `<moniker>` with a name that identifies your node (e.g., `my-validator-01`).

Start the node:

```bash
lithod start
```

On first start, the node will begin syncing with the network from the genesis block or from a snapshot if configured.

---

## Default Directory Structure

After initialization, `lithod` creates the following structure in your home directory:

```
~/.lithod/
  config/
    app.toml          # Application-level configuration (min gas prices, pruning, etc.)
    config.toml       # CometBFT configuration (P2P, RPC, consensus timeouts, etc.)
    genesis.json      # Genesis state of the chain
  data/               # Blockchain data (blocks, state, snapshots)
  keyring/            # Key storage for validator and operator keys
```

| File / Directory   | Purpose                                                                   |
|--------------------|---------------------------------------------------------------------------|
| `config/app.toml`  | Cosmos SDK application settings such as minimum gas prices, API enablement, pruning strategy, and telemetry. |
| `config/config.toml` | CometBFT (Tendermint) settings including P2P networking, RPC server configuration, consensus parameters, and mempool tuning. |
| `config/genesis.json` | The genesis file defining the initial state of the blockchain network. This file must match the canonical genesis for the target chain. |
| `data/`            | Persistent storage for block data, application state, and state-sync snapshots. |
| `keyring/`         | Encrypted key storage for validator operator keys and account keys.       |

---

## Genesis and Configuration

### Genesis File

The `genesis.json` file is provided separately for each Lithosphere network (mainnet, testnet, etc.). Download the correct genesis file and place it at:

```
~/.lithod/config/genesis.json
```

### Seed and Persistent Peers

Configure seed nodes and persistent peers in `config.toml` to ensure your node can discover and maintain connections with the network:

```toml
# ~/.lithod/config/config.toml

[p2p]
seeds = "seed-node-id@seed-host:26656"
persistent_peers = "peer-id-1@peer-host-1:26656,peer-id-2@peer-host-2:26656"
```

Refer to the official Lithosphere network documentation or community channels for current seed and peer lists.

### Remote Signer and HSM Support

For production validators, it is strongly recommended to use a remote signer or hardware security module (HSM) to protect your validator private key:

- **tmkms** -- Tendermint Key Management System, a popular open-source remote signer.
- **KMS / HSM** -- Hardware security modules provide the highest level of key protection and are recommended for high-value validators.

Using a remote signer keeps the validator key off the node machine entirely, significantly reducing the risk of key compromise.

---

## Validator Compatibility

### Cosmovisor

Lithosphere supports **Cosmovisor**, the Cosmos SDK process manager for automatic binary upgrades. Cosmovisor watches for on-chain governance upgrade proposals and swaps the `lithod` binary at the correct block height.

Setup overview:

```bash
# Install Cosmovisor
go install cosmossdk.io/tools/cosmovisor/cmd/cosmovisor@latest

# Initialize directory structure
cosmovisor init $(which lithod)

# Start the node via Cosmovisor
cosmovisor run start
```

### Remote Signer

As mentioned above, remote signers such as **tmkms** are fully compatible with Lithosphere. This allows you to run the signing process on a separate, hardened machine.

### Prometheus Metrics

`lithod` exposes Prometheus-compatible metrics for monitoring validator performance. Enable metrics in `config.toml`:

```toml
# ~/.lithod/config/config.toml

[instrumentation]
prometheus = true
prometheus_listen_addr = ":26660"
```

Metrics are then available at `http://localhost:26660/metrics` for scraping by Prometheus or other monitoring tools.

---

## Verification Nodes

Verification nodes are a specialized class of nodes in the Lithosphere network that perform additional validation duties beyond standard consensus.

### Staking Requirements

To operate a verification node, operators must meet the staking threshold defined by the network. Staked tokens serve as collateral, aligning the financial incentives of node operators with honest network participation. Validators who act maliciously or go offline risk having their stake slashed.

### Transaction Fee Rewards

Verification nodes earn a share of transaction fees proportional to their voting power. These rewards are distributed automatically on-chain at the end of each block or epoch, depending on the network configuration.

### Key Share Incentive System

Lithosphere implements a key share incentive system in which verification nodes hold shares of a distributed key. This mechanism:

- Distributes trust across multiple validators, preventing any single point of failure.
- Rewards participants for correctly contributing their key share during threshold signing rounds.
- Penalizes nodes that fail to provide their share in a timely manner.

### Delegation from General Nodes

General (non-validating) nodes can delegate their staking tokens to verification nodes. Delegation allows token holders to participate in network security and earn a portion of staking rewards without running validator infrastructure themselves. Delegators should carefully evaluate validators based on:

- **Uptime and reliability** -- Historical performance and slashing history.
- **Commission rate** -- The percentage of rewards retained by the validator.
- **Community participation** -- Governance voting record and ecosystem contributions.

---

## Next Steps

- [Developer Setup](quickstart/dev-setup.md) -- Set up the full development environment.
- [CLI Tools Reference](quickstart/cli-tools.md) -- Learn the `lithod` commands and `create-litho-app` scaffolding tool.
