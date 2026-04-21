# Lithosphere Network – Node Chain Binary

## GitHub Repository

- **Repo URL:** [https://github.com/KaJLabs/lithosphere](https://github.com/KaJLabs/lithosphere/)
- **Branch:** `main`

---

## Binary Name

`lithod`

## Chain Framework

- **Framework:** Cosmos-SDK–based chain
- **Consensus:** CometBFT (Tendermint Core)
- **Execution:** LithoVM (EVM-compatible runtime)

## Source Repository

[https://github.com/KaJLabs/lithosphere/litho-chain](https://github.com/KaJLabs/lithosphere/litho-chain)

---

## Pre-built Binary

- **Platform:** Linux x86_64
- **Binary:** `lithod`

**Latest release binary:**  
[https://github.com/lithosphere-network/litho-chain/releases/latest](https://github.com/lithosphere-network/litho-chain/releases/latest)

> If no release binary is provided, you can build from source (see below).

---

## Build Instructions (From Source)

### Requirements

- Go ≥ 1.22
- GNU Make
- Linux x86_64

### Steps

```bash
git clone https://github.com/lithosphere-network/litho-chain
cd litho-chain
make install
```

### This installs:

$GOPATH/bin/lithod

### Verify:

lithod version

## Default Node Directories

```bash
~/.lithod/
├── config/
│   ├── app.toml
│   ├── config.toml
│   ├── genesis.json
├── data/
└── keyring/
```

## Node Startup

```bash
lithod init <moniker> --chain-id lithosphere_700777-2
lithod start
```

## Genesis & Config

genesis.json provided separately (chain launch package)  
Seed & persistent peers injected via config.toml  
Remote signer / HSM supported via CometBFT signer

## Validator Compatibility

Cosmovisor supported  
Remote signer (tmkms / KMS / HSM) supported  
Prometheus metrics enabled

This keeps **all your content in one Markdown file** and uses proper code formatting for commands and paths.  
If you want, I can make an **even cleaner single README.md** that’s ready for GitHub with headings, bolds, and copyable commands. Do you want me to do that?
