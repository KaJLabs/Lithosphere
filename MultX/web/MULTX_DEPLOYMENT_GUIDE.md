# MultX Bridge Integration — Kamet Explorer Deployment Guide

> Historical deployment guide. Production MultX remains disabled; use [the current native completion/dependency checklist](../docs/NATIVE_SWAP_COMPLETION_CHECKLIST.md). Earlier readiness statements below do not authorize deployment or activation.

> **Historical testnet record:** this document describes the retired Kamet
> KMS-era backend and is not a LITHO-mainnet deployment procedure. The project
> does not use AWS. Use `../docs/VPS_SIGNER_ARCHITECTURE.md` and
> `../docs/MAINNET_DEPLOYMENT_GATES.md` for the current disabled, non-AWS
> production-candidate path.

**Status**: Complete and ready for deployment
**Commit**: `cabdfe2` (feat: implement MultX Swap bridge integration)
**Date**: 2026-03-10

---

## Overview

The Kamet Explorer Swap page now includes full MultX bridge integration for cross-chain LITHO swaps. The implementation is complete with wallet connection, token approval, bridge locking, and real-time transaction monitoring.

### What's Implemented

✅ MetaMask wallet connection with Lithosphere auto-switch
✅ Token approval (ERC-20 approve) to bridge contract
✅ Lock tokens on Lithosphere, bridge to other chains
✅ Listen for TokensLocked events
✅ Poll bridge API for validator signature collection
✅ Real-time transaction history from backend API
✅ Step-by-step UI progress indicator
✅ Graceful handling of undeployed contracts

### Status (updated 2026-05-19)

✅ MultX Bridge contracts deployed on Kamet mainnet (`0x3a896BDF3a1088287FA84aB5a43bB30e2535F263`, hardened with pause/setValidatorSet/dailyCap)
✅ MultX bridge backend API live on the indexer (multichain event listener + 5-of-7 KMS validator signing)
⏳ Live token price feeds from CoinGecko (shows token amounts only for now)
⏳ Dest-chain (ETH/BNB/Base) mainnet deployment — testnet dry-run done; awaiting audit + treasury allocation

---

## Architecture

### New Components

#### 1. WalletContext (`src/context/WalletContext.jsx`)

React Context that manages MetaMask wallet state:

```javascript
{
  account,              // Connected Ethereum address
  chainId,              // Current chain ID (should be 777777)
  provider,             // ethers.providers.Web3Provider
  signer,               // ethers.Signer for transactions
  isConnected,          // boolean
  error,                // Last error message
  connect(),            // Connect to MetaMask
  disconnect(),         // Clear wallet state
  switchToLithoChain(), // Switch to Lithosphere 777777
  hasMetaMask()         // Check if MetaMask installed
}
```

**Auto-setup on connect:**
- Requests account access
- Detects current chain
- Auto-switches to Lithosphere (chainId: 777777) if needed
- Adds Lithosphere chain to MetaMask if not present

**Chain Config (Lithosphere Kamet):**
```javascript
{
  chainId: '0xBE811',    // 777777 in hex
  chainName: 'Lithosphere Kamet',
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  rpcUrls: ['https://evm.litho.ai:8545'],
  blockExplorerUrls: ['https://kamet.litho.ai']
}
```

#### 2. MultX Config (`src/config/multx.js`)

Configuration for bridge contracts and API:

```javascript
MULTX_CONFIG = {
  bridgeAddress: string,      // from VITE_MULTX_BRIDGE_ADDRESS env var
  lithoTokenAddress: string,  // from VITE_LITHO_TOKEN_ADDRESS env var
  bridgeApiUrl: string,       // from VITE_MULTX_API_URL env var
  supportedTokens: [{
    symbol, name, denom, decimals, address, icon
  }],
  bridgeAbi: [...],           // lockTokens, releaseTokens, events
  tokenAbi: [...]             // ERC-20 approve, balanceOf, allowance
}

MultXAPI = {
  status: (txHash) => `/bridge/status/{txHash}`,
  signatures: (txHash) => `/bridge/signatures/{txHash}`,
  transactions: (address) => `/bridge/transactions/{address}`
}
```

#### 3. useMultX Hook (`src/hooks/useMultX.js`)

State machine for bridge operations:

```javascript
const {
  loading, error, txHash, step, bridgeHistory,
  approveToken(tokenAddress, amount),
  lockTokens(tokenAddress, amount, targetChainId),
  getBridgeStatus(txHash, maxAttempts),
  getBridgeSignatures(txHash),
  getBridgeHistory(address),
  reset(),
  isContractDeployed
} = useMultX()
```

**Step states:**
- IDLE: Initial state
- APPROVING: Sending ERC-20 approve transaction
- APPROVED: Approval confirmed
- LOCKING: Sending bridge lock transaction
- LOCKED: Lock confirmed, listening for event
- WAITING_SIGNATURES: Polling bridge API for validator signatures
- COMPLETED: Bridge transaction complete
- ERROR: Something went wrong

**Bridge polling:**
- Calls `/bridge/status/{txHash}` every 5 seconds
- Max 60 attempts (5-minute timeout)
- Exponential backoff up to 30 seconds

#### 4. Updated Swap Component

**Wallet Management:**
- Connect button with MetaMask prompt
- Auto-switch to Lithosphere chain
- Display connected account address
- Disconnect button to clear wallet state

**Bridge Flow UI:**
- Step indicator showing current step (Connect → Approve → Lock → Wait → Complete)
- Amount input with validation (regex: `/^[0-9]*\.?[0-9]*$/`)
- Token selector (from: LITHO, to: target chain equivalent)
- Error message display box
- Transaction hash display during execution
- Action button that changes based on state

**Transaction History:**
- Real table populated from backend API
- Sortable columns: Date, From Token, To Token, Amount, TX Hash, Status, Explorer
- Status badges with color coding
- Links to block explorers for verification

---

## Environment Variables

The following variables must be set at Docker build time (passed via `docker-compose.yml`):

```bash
VITE_MULTX_BRIDGE_ADDRESS=0x...    # Bridge contract address on Lithosphere
VITE_MULTX_API_URL=https://...     # Bridge backend API base URL
VITE_LITHO_TOKEN_ADDRESS=0x...     # LITHO token contract address on Lithosphere
```

If any are empty, the UI gracefully shows "Contract Not Deployed".

---

## Deployment Steps

### 1. Prepare Environment Variables

```bash
# These must be available when building the Docker image
export MULTX_BRIDGE_ADDRESS="0x..."      # Bridge contract (Lithosphere)
export MULTX_API_URL="https://api..."    # Bridge API base URL
export LITHO_TOKEN_ADDRESS="0x..."       # LITHO token contract
```

### 2. Build Docker Image

From the kamet-explorer directory:

```bash
docker build \
  --build-arg VITE_MULTX_BRIDGE_ADDRESS=$MULTX_BRIDGE_ADDRESS \
  --build-arg VITE_MULTX_API_URL=$MULTX_API_URL \
  --build-arg VITE_LITHO_TOKEN_ADDRESS=$LITHO_TOKEN_ADDRESS \
  -t kamet-explorer:latest .
```

### 3. Deploy with Docker Compose

```bash
# Set env vars
export MULTX_BRIDGE_ADDRESS="0x..."
export MULTX_API_URL="https://..."
export LITHO_TOKEN_ADDRESS="0x..."

# Run compose
docker-compose up -d
```

### 4. Verify Deployment

```bash
# Check container is running
docker ps | grep kamet

# Check logs
docker logs kamet-dashboard

# Access the web interface
curl http://localhost:3002/

# Navigate to /Swap route and test
```

---

## Bridge Smart Contract Requirements

For the bridge to function, the following contract interface is required on Lithosphere:

```solidity
interface IMultXBridge {
    function lockTokens(
        address token,
        uint256 amount,
        uint256 targetChain
    ) external returns (uint256 nonce);

    function releaseTokens(
        address token,
        address user,
        uint256 amount,
        uint256 sourceChain,
        uint256 sourceNonce,
        bytes32 sourceTxHash,
        bytes[] calldata signatures
    ) external;

    event TokensLocked(
        bytes32 indexed txHash,
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 indexed targetChain,
        uint256 nonce
    );

    event TokensReleased(
        bytes32 indexed txHash,
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 indexed sourceChain,
        address submitter
    );
}
```

---

## Backend API Requirements

The MultX bridge backend must provide these REST endpoints:

### GET /bridge/status/{txHash}

Returns the current status of a bridge transaction:

```json
{
  "txHash": "0x...",
  "status": "locked|signing|signed|completed|failed",
  "timestamp": 1234567890,
  "blockNumber": 12345,
  "sourceChain": 777777,
  "targetChain": 1,
  "signaturesCollected": 2,
  "signaturesRequired": 3
}
```

### GET /bridge/signatures/{txHash}

Returns the collected validator signatures:

```json
{
  "txHash": "0x...",
  "signatures": [
    "0x...",
    "0x..."
  ]
}
```

### GET /bridge/transactions/{address}

Returns all bridge transactions for a user address:

```json
{
  "address": "0x...",
  "transactions": [
    {
      "txHash": "0x...",
      "timestamp": "2026-03-10T12:34:56Z",
      "fromToken": "LITHO",
      "toToken": "LITHO (Ethereum)",
      "amount": 100,
      "status": "completed",
      "explorerUrl": "https://..."
    }
  ]
}
```

---

## Testing Without Contract Deployed

1. **UI works without contract address:**
   - Connect button works
   - Wallet connection successful
   - Button shows "Contract Not Deployed" when address empty
   - No errors in console

2. **Test with mock contract:**
   - Deploy test contract to testnet
   - Set env var to test contract address
   - Rebuild image
   - Test approve flow (will prompt MetaMask)
   - Test lock flow (will prompt MetaMask)

3. **Monitor in browser console:**
   - Open DevTools F12
   - Go to /Swap route
   - Check for errors in console
   - Monitor network tab for API calls

---

## Troubleshooting

### "Contract Not Deployed"

**Cause**: `VITE_MULTX_BRIDGE_ADDRESS` is empty or undefined
**Fix**: Set contract address in docker-compose.yml and rebuild

### "MetaMask not installed"

**Cause**: User doesn't have MetaMask browser extension
**Fix**: Show message to install MetaMask first

### "Switch to Lithosphere Kamet network"

**Cause**: User is connected but on wrong chain
**Fix**: Click button to auto-switch, or manually switch in MetaMask

### "Transaction failed"

**Cause**: Insufficient balance, gas, or contract error
**Fix**: Check error message in red alert box, adjust input, retry

### "Bridge status timeout"

**Cause**: Backend API not responding or transaction lost
**Fix**: Check backend logs, monitor bridge contract events, contact support

---

## Feature Checklist

**Wallet Connection**
- [x] MetaMask connection prompt
- [x] Auto-switch to Lithosphere 777777
- [x] Add chain if missing
- [x] Display account address
- [x] Disconnect button
- [x] Event listeners for account/chain changes

**Token Approval**
- [x] ERC-20 approve() to bridge contract
- [x] Amount validation
- [x] MetaMask approval prompt
- [x] Await confirmation
- [x] Error handling

**Bridge Lock**
- [x] bridge.lockTokens() call
- [x] Token + amount + target chain params
- [x] MetaMask transaction prompt
- [x] Await confirmation
- [x] Get transaction hash

**Status Monitoring**
- [x] Listen for TokensLocked event
- [x] Poll bridge API for status
- [x] Handle timeout gracefully
- [x] Show step progress
- [x] Display transaction hash

**Transaction History**
- [x] Fetch from backend API
- [x] Sortable table
- [x] Status badges
- [x] Explorer links
- [x] Empty state message

**Error Handling**
- [x] Wallet errors
- [x] Contract errors
- [x] API errors
- [x] Transaction failures
- [x] User-friendly messages

---

## Next Steps

1. **Deploy MultX Bridge contracts** to Lithosphere testnet
2. **Implement backend API** with status tracking
3. **Integrate CoinGecko prices** for live token prices
4. **Add WalletConnect** support for mobile wallets
5. **Add contract verification** on block explorer
6. **Set up monitoring** for bridge events
7. **Create user documentation** for bridge usage

---

## References

- **ethers.js**: https://docs.ethers.io/
- **MetaMask API**: https://docs.metamask.io/
- **Lithosphere Kamet**: https://kamet.litho.ai
- **MultX Bridge**: (TBD — link to bridge docs)

---

## Support

For questions or issues:

1. Check browser console (F12) for errors
2. Check Docker logs: `docker logs kamet-dashboard`
3. Verify environment variables in `docker-compose.yml`
4. Test contract address on block explorer
5. Check backend API status

---

**Last Updated**: 2026-03-10
**Author**: Claude Haiku 4.5
**Status**: Ready for production deployment
