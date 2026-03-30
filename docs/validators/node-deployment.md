# Node Deployment Guide

## Overview

Validators are participants in the Lithosphere network that have **non-negative voting power**. They participate in consensus by broadcasting cryptographic signatures, or _votes_, to agree on the next block in the chain. Validators play a critical role in securing the network, proposing new blocks, and verifying transactions.

This guide covers everything needed to deploy and operate a Lithosphere validator node, from hardware requirements through initial startup and ongoing operations.

---

## Hardware Requirements

Lithosphere is built on the Cosmos SDK, so standard Cosmos SDK hardware requirements apply:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32 GB |
| Storage | 500 GB SSD | 1 TB+ NVMe SSD |
| Network | 100 Mbps | 1 Gbps |

> **Note:** Storage requirements grow over time as chain state accumulates. NVMe SSDs are strongly recommended for optimal performance during block sync and state queries.

---

## Architecture

| Component | Detail |
|-----------|--------|
| **Binary** | `lithod` |
| **Framework** | Cosmos SDK |
| **Consensus** | CometBFT |
| **Execution** | LithoVM (EVM-compatible) |
| **Source** | [github.com/KaJLabs/lithosphere/litho-chain](https://github.com/KaJLabs/lithosphere/litho-chain) |

---

## Installing the Binary

### Option A: Pre-built Binary (Linux x86_64)

Pre-built binaries for Linux x86_64 are available from the releases page:

```
https://github.com/lithosphere-network/litho-chain/releases/latest
```

Download the latest release, extract it, and place the `lithod` binary in your `$PATH`:

```bash
wget https://github.com/lithosphere-network/litho-chain/releases/latest/download/lithod-linux-amd64.tar.gz
tar -xzf lithod-linux-amd64.tar.gz
sudo mv lithod /usr/local/bin/
lithod version
```

### Option B: Build from Source

**Requirements:**

- Go >= 1.22
- GNU Make
- Linux x86_64

**Build steps:**

```bash
git clone https://github.com/KaJLabs/lithosphere/litho-chain.git
cd litho-chain
make install
```

This installs the `lithod` binary to `$GOPATH/bin/lithod`.

**Verify the installation:**

```bash
lithod version
```

---

## Node Directory Structure

By default, `lithod` stores all data under `~/.lithod/`. The directory is created automatically on first run and has the following structure:

```
~/.lithod/
  config/
    app.toml          # Application-level configuration
    config.toml       # CometBFT / node configuration
    genesis.json      # Chain genesis file
  data/               # Blockchain state and data
  keyring/            # Key storage
```

- **app.toml** -- Controls application settings such as minimum gas prices, pruning, API and gRPC listeners, and state sync options.
- **config.toml** -- Controls CometBFT settings including P2P networking, consensus timeouts, mempool configuration, and Prometheus metrics.
- **genesis.json** -- The chain genesis file that defines the initial state. This file is provided separately for each network (mainnet, testnet).

---

## Node Initialization and Startup

### Initialize the Node

```bash
lithod init <moniker> --chain-id lithosphere_700777-1
```

Replace `<moniker>` with a human-readable name for your node. This command creates the default directory structure under `~/.lithod/`.

### Configure Genesis and Peers

1. **Genesis file** -- Obtain the correct `genesis.json` for the target network and place it at `~/.lithod/config/genesis.json`. The genesis file is provided separately through official channels.

2. **Seed and persistent peers** -- Edit `~/.lithod/config/config.toml` to add seed nodes and persistent peers:

```toml
[p2p]
seeds = "seed-node-id@seed-host:26656"
persistent_peers = "peer-node-id@peer-host:26656"
```

### Start the Node

```bash
lithod start
```

The node will begin syncing from the genesis block (or from a snapshot if configured).

---

## Remote Signer and HSM Support

For production validators, it is strongly recommended to use a remote signer to protect your validator private key. CometBFT supports remote signing via:

- **tmkms** (Tendermint Key Management System)
- **KMS** (cloud-based key management services)
- **HSM** (Hardware Security Modules)

Configure remote signing in `config.toml` under the `[priv_validator]` section. Refer to the CometBFT documentation for detailed configuration of each signer type.

---

## Validator Tooling Compatibility

Lithosphere validators are compatible with standard Cosmos SDK tooling:

| Tool | Purpose |
|------|---------|
| **Cosmovisor** | Automated binary upgrades triggered by on-chain governance proposals. See [Upgrade Procedures](upgrade-procedures.md). |
| **Remote Signer** | tmkms / KMS / HSM integration for secure key management. |
| **Prometheus Metrics** | Built-in metrics endpoint for monitoring. See [Monitoring and Metrics](monitoring-and-metrics.md). |

---

## Verification Nodes

Verification nodes are a specialized class of nodes within the Lithosphere network responsible for validating transactions and maintaining network integrity.

### Staking Requirements

Verification nodes must meet staking requirements to participate in transaction validation. The staking mechanism ensures that validators have economic skin in the game, aligning their incentives with the health of the network.

### Key Share Distribution

Verification nodes participate in key share distribution as part of the network's cryptographic security model. This distributed approach ensures that no single node holds complete signing authority, enhancing the overall security posture of the network.

### Transaction Fee Incentives

Verification nodes earn transaction fees as an incentive for their validation work. Fees are distributed proportionally based on the node's participation and stake weight.

---

## General Nodes and Delegation

General (non-validator) nodes can participate in the Lithosphere network by **delegating stakes to validators**. Delegation allows token holders to earn rewards without operating validator infrastructure themselves.

- Delegators select one or more validators to delegate their tokens to.
- Rewards are distributed **proportionally** based on the amount of stake delegated.
- Delegators share in the validator's rewards but also share in any slashing penalties if the validator misbehaves.

---

## Incentive System

The Lithosphere incentive system is designed to reward honest participation and penalize misbehavior:

1. **Block rewards** -- Validators and their delegators earn block rewards for successfully proposing and attesting to new blocks.
2. **Transaction fees** -- Transaction fees are distributed among active validators proportional to their voting power.
3. **Slashing** -- Validators that exhibit malicious or negligent behavior (double signing, extended downtime) are subject to slashing, which burns a portion of their staked tokens.
4. **Commission** -- Validators set a commission rate that determines the percentage of delegator rewards they retain for operating the node.

This economic model ensures that validators are incentivized to remain online, behave honestly, and provide reliable infrastructure for the network.
