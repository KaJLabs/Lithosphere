# Faucet Setup Instructions — Validator Team

**Priority:** Required for Makalu testnet faucet to function  
**Component:** `litho-faucet` Docker container on EC2 indexer  
**Status:** Faucet UI is live at https://makalu.litho.ai/faucet but claims fail with "Could not send tokens" because no faucet wallet is configured.

---

## Problem

The faucet service (`litho-faucet`) needs a funded EVM wallet to send test LITHO to users. The `FAUCET_PRIVATE_KEY` environment variable is currently empty, so all faucet claims fail with a 500 error.

---

## Step-by-Step Setup

### 1. Generate a new faucet wallet

On any machine with `cast` (Foundry) or `node`:

**Option A — Using Foundry (`cast`):**
```bash
cast wallet new
```
This outputs an address and private key. Save both.

**Option B — Using Node.js:**
```bash
node -e "const w = require('ethers').Wallet.createRandom(); console.log('Address:', w.address); console.log('Private Key:', w.privateKey);"
```

**Option C — Using any EVM wallet (MetaMask, etc.):**  
Create a new account and export the private key.

> **Save the output — you need both:**
> - **Address**: `0x...` (the faucet's public address)
> - **Private Key**: `0x...` (64 hex chars after `0x`)

---

### 2. Fund the faucet wallet

Send LITHO to the faucet address from a funded account (e.g., a genesis account or validator account).

**Recommended initial funding:** 100,000 LITHO (enough for 10,000 claims at 10 LITHO each)

**Using `litho` CLI (Cosmos SDK):**
```bash
lithod tx bank send <funded-account> <faucet-0x-address> 100000000000000000000000ulitho \
  --chain-id lithosphere_700777-1 \
  --gas auto --gas-adjustment 1.5 \
  --fees 1000ulitho \
  --node https://rpc.litho.ai:26657
```

**Or using cast (EVM):**
```bash
cast send <faucet-address> --value 100000ether \
  --private-key <funded-wallet-private-key> \
  --rpc-url http://localhost:8545
```

> Note: `100000ether` = 100,000 LITHO (both use 18 decimals)

---

### 3. Configure the environment variable

SSH to the EC2 indexer via bastion:
```bash
ssh -o ProxyJump="ec2-user@44.218.142.100" ec2-user@10.0.10.16
```

Edit the `.env` file in the Makalu directory:
```bash
cd /opt/lithosphere/Makalu
sudo nano .env
```

Add or update these lines:
```env
# Faucet wallet (REQUIRED - private key of the funded wallet from Step 1)
FAUCET_PRIVATE_KEY=0x<your-64-char-hex-private-key>

# EVM JSON-RPC endpoint the faucet uses to send transactions
# Use localhost if the Ethermint node runs on this machine, otherwise use the NLB
FAUCET_RPC_URL=http://localhost:8545

# Optional overrides (defaults are fine)
# FAUCET_DRIP_AMOUNT=10        # LITHO per claim (default: 1)
# FAUCET_COOLDOWN_HOURS=24     # Hours between claims per address (default: 24)
# FAUCET_CHAIN_ID=700777       # EVM chain ID (default: 700777)
```

**Important:** Set `FAUCET_DRIP_AMOUNT=10` if you want the default claim to be 10 LITHO (matching the UI options of 10/25/50). The current default is 1 LITHO.

---

### 4. Restart the faucet container

```bash
cd /opt/lithosphere/Makalu
sudo docker compose up -d faucet
```

---

### 5. Verify it's working

**Check the container is running:**
```bash
sudo docker ps | grep faucet
```

**Check the faucet logs for startup confirmation:**
```bash
sudo docker logs litho-faucet --tail 20
```

You should see:
```
[faucet] Listening on http://0.0.0.0:8081
[faucet] RPC: http://localhost:8545 | Chain: 700777
[faucet] Drip: 10 LITHO | Cooldown: 24h
```

**Check the health endpoint:**
```bash
curl http://localhost:8081/health
```

**Test a drip manually:**
```bash
curl -X POST http://localhost:8081/drip \
  -H "Content-Type: application/json" \
  -d '{"address": "0xba2b6fA3758296c5237235b2aF3Ba2a96D36A860", "amount": "10"}'
```

Expected success response:
```json
{
  "success": true,
  "txHash": "0x...",
  "amount": "10 LITHO",
  "recipient": "0xba2b6fA3758296c5237235b2aF3Ba2a96D36A860",
  "cooldownHours": 24
}
```

**Test from the public API:**
```bash
curl -X POST https://makalu.litho.ai/api/faucet/claim \
  -H "Content-Type: application/json" \
  -d '{"address": "0xba2b6fA3758296c5237235b2aF3Ba2a96D36A860", "walletType": "WEB3", "amount": "10 LITHO"}'
```

---

### 6. Verify via the UI

1. Open https://makalu.litho.ai/faucet
2. Connect a wallet (MetaMask / WalletConnect)
3. Click "Add Makalu Network" if prompted
4. Enter an address or use the connected wallet address
5. Select amount and click "Claim Testnet LITHO"
6. Should see a success message with a transaction hash

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `FAUCET_PRIVATE_KEY not set` in logs | Missing env var | Add to `.env` and restart |
| `insufficient funds` in logs | Faucet wallet has no LITHO | Fund the address from Step 2 |
| `connection refused` or timeout | Wrong RPC URL | Check `FAUCET_RPC_URL` — try `http://localhost:8545` or the NLB URL |
| `chain ID mismatch` | Wrong chain ID | Ensure `FAUCET_CHAIN_ID=700777` |
| Container not starting | Redis not running | Check `sudo docker ps \| grep redis` — faucet depends on Redis for rate limiting |
| 502 from API | Faucet container not reachable | Check container is on `litho-network` Docker network |

---

## Security Notes

- The faucet private key should **only** exist in the `.env` file on the server — never commit it to git
- The faucet wallet should **only** hold test tokens — never use a wallet that holds real assets
- Rate limiting is enforced: 1 claim per address per 24 hours (configurable via `FAUCET_COOLDOWN_HOURS`)
- The faucet only accepts EVM (`0x...`) addresses

---

## Architecture Reference

```
User Browser
    |
    | POST /api/faucet/claim
    v
litho-api (Express, port 3010)
    |
    | POST /drip (internal Docker network)
    v
litho-faucet (Fastify, port 8081)
    |
    | sendTransaction via viem
    v
Lithosphere EVM (port 8545)
```

**Docker service name:** `faucet` (aliased as `litho-faucet`)  
**Internal URL used by API:** `http://faucet:8081`  
**Env file location:** `/opt/lithosphere/Makalu/.env`  
**Docker compose file:** `/opt/lithosphere/Makalu/docker-compose.yaml`
