---
title: Makalu validator onboarding
description: Build, register, and operate a validator on the Makalu testnet.
---

# Makalu validator onboarding

Makalu is the Lithosphere testnet for rehearsing validator deployment,
staking, upgrades, monitoring, recovery, and incident response before operating
a LITHO mainnet validator. Makalu tokens have no production value. Use separate
wallet, consensus, P2P, and recovery keys for Makalu; never promote testnet key
material to mainnet.

## Network reference

| Item | Makalu value |
| --- | --- |
| Network status | Testnet |
| Cosmos chain ID | `lithosphere_700777-2` |
| EVM chain ID | `700777` (`0xab169`) |
| Native asset | `LITHO` |
| Base denomination | `ulitho` |
| Precision | 18 decimals (`1 LITHO = 10^18 ulitho`) |
| CometBFT and EVM RPC | `https://rpc.litho.ai` |
| REST/LCD | `https://api.litho.ai` |
| Explorer | `https://makalu.litho.ai` |
| Maximum active validators | 100 |
| Unbonding period | 21 days |
| Minimum validator commission | 5% |

Check the live chain identity and staking/slashing parameters before beginning:

```bash
curl -fsS https://api.litho.ai/cosmos/base/tendermint/v1beta1/node_info
curl -fsS https://api.litho.ai/cosmos/base/tendermint/v1beta1/syncing
curl -fsS https://api.litho.ai/cosmos/staking/v1beta1/params
curl -fsS https://api.litho.ai/cosmos/slashing/v1beta1/params
```

Stop if the node reports a chain other than `lithosphere_700777-2` or the EVM
RPC reports a chain ID other than `700777`.

```bash
curl -fsS https://rpc.litho.ai \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

## What the operator provides

Send the following public information to the KaJ Labs validator coordinator:

- organization, technical contact, and incident contact;
- validator moniker, website, identity, and security contact;
- operator account address and validator operator address;
- consensus public key and P2P node ID;
- hosting provider/region and sentry topology;
- intended testnet self-delegation and commission settings;
- monitoring, backup, restore, upgrade, and double-sign controls.

Never send a mnemonic, wallet private key, consensus private key, SSH
credential, recovery share, or backup decryption secret.

The coordinator returns the approved Makalu binary and checksum, genesis file
and checksum, persistent peers, test-token funding process, and an activation
window. Do not substitute an old `700777-1` genesis, binary, snapshot, or peer
list.

## Host requirements

| Resource | Minimum testnet baseline | Recommended rehearsal baseline |
| --- | ---: | ---: |
| Linux | Supported 64-bit release | Ubuntu LTS, x86-64 |
| CPU | 4 vCPU | 8 dedicated vCPU |
| RAM | 16 GB | 32 GB |
| Storage | 250 GB SSD | 500+ GB NVMe with growth alerts |
| Network | Stable 100 Mbps | Stable 1 Gbps |

Operators preparing for mainnet should test a private validator behind at least
two sentries. Expose only sentry P2P to the internet. Keep validator RPC, REST,
gRPC, EVM RPC/WebSocket, metrics, and SSH restricted to approved management and
monitoring networks.

## Install the approved binary

Use only the binary and SHA-256 supplied for the current Makalu release. The
placeholder values below must be replaced from the signed onboarding bundle.

```bash
export LITHOD=./lithod-makalu
export EXPECTED_BINARY_SHA256='<COORDINATOR_SUPPLIED_SHA256>'

printf '%s  %s\n' "$EXPECTED_BINARY_SHA256" "$LITHOD" | sha256sum --check
sudo install -o root -g root -m 0755 "$LITHOD" /usr/local/bin/lithod-makalu
/usr/local/bin/lithod-makalu version --long
```

Create an isolated service account and initialize the node:

```bash
sudo useradd --system --home-dir /var/lib/litho-makalu-val \
  --shell /usr/sbin/nologin litho
sudo install -d -o litho -g litho -m 0750 /var/lib/litho-makalu-val

sudo -u litho /usr/local/bin/lithod-makalu init '<MONIKER>' \
  --chain-id lithosphere_700777-2 \
  --home /var/lib/litho-makalu-val
```

## Install genesis and peers

Verify the coordinator-supplied genesis file before installing it:

```bash
export EXPECTED_GENESIS_SHA256='<COORDINATOR_SUPPLIED_SHA256>'
printf '%s  %s\n' "$EXPECTED_GENESIS_SHA256" ./genesis.json | sha256sum --check

sudo install -o litho -g litho -m 0640 ./genesis.json \
  /var/lib/litho-makalu-val/config/genesis.json
```

Confirm that `.chain_id` in the genesis file is `lithosphere_700777-2`. Set the
approved sentry peers in `config/config.toml`. For a private validator:

```toml
[rpc]
laddr = "tcp://127.0.0.1:26657"
unsafe = false

[p2p]
laddr = "tcp://0.0.0.0:26656"
pex = false
persistent_peers = "<COORDINATOR_SUPPLIED_SENTRIES>"

[instrumentation]
prometheus = true
prometheus_listen_addr = "127.0.0.1:26660"
```

Bind REST, gRPC, EVM RPC/WebSocket, and administrative interfaces to loopback
or a protected network. Set the chain's approved minimum gas price in
`config/app.toml`; query the coordinator if the onboarding bundle does not
specify it.

## Protect validator identity

- `node_key.json` is the P2P identity.
- `priv_validator_key.json` is the consensus signing identity.
- `priv_validator_state.json` prevents signing the same height twice.
- The operator wallet signs staking transactions and should remain off the
  validator host.

Keep at least two encrypted backups under independent custody. Preserve
`priv_validator_state.json` during every restore or migration. Never start the
same consensus key on two machines.

Record only public identities:

```bash
sudo -u litho /usr/local/bin/lithod-makalu tendermint show-node-id \
  --home /var/lib/litho-makalu-val
sudo -u litho /usr/local/bin/lithod-makalu tendermint show-validator \
  --home /var/lib/litho-makalu-val
```

## Synchronize before registration

Start the node with the reviewed systemd or Cosmovisor service. Do not submit a
validator transaction until the node has peers, reports `catching_up: false`,
and matches the public Makalu height.

```bash
curl -fsS http://127.0.0.1:26657/status
curl -fsS https://api.litho.ai/cosmos/base/tendermint/v1beta1/syncing
```

## Prepare and fund the operator wallet

Create or import the dedicated Makalu operator wallet on a secure signing
machine. Keep its mnemonic offline.

```bash
LITHOD=./lithod-makalu
KEY_NAME='<MAKALU_OPERATOR_KEY>'
KEYRING_BACKEND=file

"$LITHOD" keys add "$KEY_NAME" --keyring-backend "$KEYRING_BACKEND"
"$LITHOD" keys show "$KEY_NAME" -a --keyring-backend "$KEYRING_BACKEND"
"$LITHOD" keys show "$KEY_NAME" -a --bech val \
  --keyring-backend "$KEYRING_BACKEND"
```

Submit the public operator address through the approved onboarding channel.
Request test tokens only after the coordinator verifies the node ID, consensus
public key, operator address, and proposed staking terms.

## Create the validator

Create `validator.json` on the secure signing machine using approved values:

```json
{
  "pubkey": {
    "@type": "/cosmos.crypto.ed25519.PubKey",
    "key": "<BASE64_CONSENSUS_PUBLIC_KEY>"
  },
  "amount": "<APPROVED_SELF_DELEGATION_IN_ULITHO>ulitho",
  "moniker": "<MONIKER>",
  "identity": "<OPTIONAL_KEYBASE_ID>",
  "website": "<HTTPS_URL>",
  "security": "<SECURITY_EMAIL>",
  "details": "<SHORT_DESCRIPTION>",
  "commission-rate": "<RATE_AT_OR_ABOVE_0.05>",
  "commission-max-rate": "<APPROVED_MAX_RATE>",
  "commission-max-change-rate": "<APPROVED_DAILY_CHANGE_RATE>",
  "min-self-delegation": "<APPROVED_MINIMUM_IN_ULITHO>"
}
```

Generate an unsigned transaction, decode and review it, then sign once:

```bash
RPC=https://rpc.litho.ai
CHAIN_ID=lithosphere_700777-2

"$LITHOD" tx staking create-validator validator.json \
  --from "$KEY_NAME" \
  --keyring-backend "$KEYRING_BACKEND" \
  --chain-id "$CHAIN_ID" \
  --node "$RPC" \
  --gas auto --gas-adjustment 1.3 \
  --gas-prices '<COORDINATOR_APPROVED_GAS_PRICE>ulitho' \
  --generate-only > create-validator-unsigned.json

"$LITHOD" tx sign create-validator-unsigned.json \
  --from "$KEY_NAME" \
  --keyring-backend "$KEYRING_BACKEND" \
  --chain-id "$CHAIN_ID" \
  --node "$RPC" \
  --output-document create-validator-signed.json

ENCODED=$("$LITHOD" tx encode create-validator-signed.json)
"$LITHOD" tx decode "$ENCODED"
```

Verify the chain ID, operator/validator addresses, consensus key,
self-delegation, commission, gas, and fee. Broadcast during the approved window:

```bash
"$LITHOD" tx broadcast create-validator-signed.json \
  --node "$RPC" --broadcast-mode sync
```

Record the transaction hash. Do not retry blindly: first query the hash and
account sequence to determine whether the transaction committed.

## Verify activation

```bash
VALOPER='<LITHOVALOPER_ADDRESS>'

curl -fsS \
  "https://api.litho.ai/cosmos/staking/v1beta1/validators/$VALOPER"
"$LITHOD" query staking validator "$VALOPER" \
  --node https://rpc.litho.ai --output json
```

Confirm the moniker, operator address, consensus public key, commission,
self-delegation, jailed state, and validator status. A registered validator may
remain outside the active set if its bonded stake is below the active-set
threshold.

## Test before mainnet

Complete an agreed soak period and record evidence for:

- continuous block signing and missed-block alerts;
- sentry loss and peer recovery;
- disk, memory, clock, service, and RPC monitoring;
- binary upgrade and rollback rehearsal;
- encrypted identity backup and disposable-host restore;
- preservation of validator state during recovery;
- incident escalation and round-the-clock contact coverage;
- safe decommissioning without running duplicate consensus keys.

Mainnet onboarding is a separate approval. Build a clean mainnet host, generate
new wallet/consensus/P2P identities, verify the mainnet chain and genesis, and
submit a separate application. A successful Makalu test does not authorize a
mainnet transaction.

## Acceptance checklist

- Makalu chain IDs are `lithosphere_700777-2` and `700777`.
- Approved binary and genesis checksums match.
- Node is synchronized and connected through approved sentries.
- Validator and administrative RPC ports are not publicly exposed.
- Operator wallet is separate from the validator host.
- Consensus-key backup, restore, and double-sign controls are tested.
- Self-delegation, commission, gas, and funding are approved.
- Create-validator transaction succeeded and its hash is recorded.
- On-chain validator metadata and consensus public key match the application.
- Monitoring, alerts, incident contacts, and upgrade procedures are active.
- Makalu keys and data are not reused for mainnet.
