# API & SDK

This guide covers the Lithosphere API server, the blockchain-core SDK, and the indexer service. These three components form the backend infrastructure for querying blockchain data, interacting with smart contracts, and subscribing to real-time events.

---

## @lithosphere/api

The `@lithosphere/api` package is a GraphQL API server built with Express.js and Apollo Server. It provides the primary interface for applications to interact with the Lithosphere blockchain.

### Capabilities

- **Blockchain data querying** -- Query blocks, transactions, accounts, and token balances through a strongly-typed GraphQL schema.
- **Smart contract interactions** -- Read contract state and submit transactions through GraphQL mutations.
- **Real-time event subscriptions** -- Subscribe to on-chain events (transfers, contract calls, block production) via GraphQL subscriptions over WebSocket.

### Architecture

The API server sits between client applications and the blockchain, providing a structured query layer:

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Client App  │────>│  @lithosphere/   │────>│  Lithosphere     │
│  (Web, CLI)  │<────│  api             │<────│  Node (RPC)      │
└──────────────┘     │  (Express+Apollo)│     └──────────────────┘
                     └────────┬─────────┘
                              │
                     ┌────────▼─────────┐
                     │  PostgreSQL      │
                     │  (indexed data)  │
                     └──────────────────┘
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_PORT` | Port the API server listens on | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/lithosphere` |
| `LITHO_RPC_URL` | Lithosphere node RPC endpoint | `https://testnet-rpc.lithosphere.network` |
| `LITHO_CHAIN_ID` | Network chain identifier | `61` |

### Running the API Server

```bash
# From the monorepo root
pnpm dev:api

# Or from the api/ directory
cd api && pnpm dev
```

---

## @lithosphere/blockchain-core SDK

The `@lithosphere/blockchain-core` package is the core SDK for building applications on Lithosphere. It provides a TypeScript-first API for interacting with the blockchain at a low level.

### Components

| Component | Directory | Description |
|-----------|-----------|-------------|
| **Ledger Abstraction Layer** | `src/chain/` | Unified interface for reading and writing blockchain state, block structures, transaction handling, and state management |
| **Cryptographic Utilities** | `src/crypto/` | *Planned:* MDKM (Myriad Distributed Key Management), ring signatures, threshold signatures, and key pair generation. Not yet implemented in the current SDK release. |
| **Consensus Mechanism** | `src/consensus/` | Linear Communication BFT (LinBFT) implementation with per-block consensus, rotating leader, and dynamic participant sets |
| **Smart Contracts** | `src/contracts/` | Contract type definitions, ABI handling, and deployment utilities |
| **SDK** | `src/sdk/` | High-level developer tools for wallet integration, transaction builders, and blockchain client |

### Installation

> **Work in Progress** -- The SDK package is currently being implemented. The installation command below will be available once published to npm.

```bash
npm install @lithosphere/blockchain-core
```

### Basic Usage

> **Work in Progress** -- The following examples illustrate the intended API surface. The implementation is under active development.

```typescript
import { LithosphereClient, Wallet } from '@lithosphere/blockchain-core';

// Initialize client
const client = new LithosphereClient({
  rpcUrl: 'https://testnet-rpc.lithosphere.network',
  chainId: 61,
});

// Create or import a wallet
const wallet = Wallet.fromMnemonic('your mnemonic phrase here');

// Query block information
const block = await client.getBlock('latest');
console.log('Block height:', block.number);

// Query account balance
const balance = await client.getBalance(wallet.address);
console.log('Balance:', balance.toString());
```

---

## @lithosphere/indexer

The `@lithosphere/indexer` package is the blockchain event indexer that processes on-chain events and stores them in PostgreSQL for efficient querying.

### Capabilities

- Indexes on-chain events from the Lithosphere network in real time.
- Provides a GraphQL schema for efficient querying of indexed data.
- Powers the `@lithosphere/api` backend with pre-processed blockchain data.
- Tracks LEP100 token transfers, contract deployments, and block metadata.

### How It Works

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Lithosphere     │────>│  @lithosphere/   │────>│  PostgreSQL      │
│  Node (Events)   │     │  indexer         │     │  (Indexed Data)  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

The indexer listens for new blocks and events from the Lithosphere node, processes them, and stores the structured data in PostgreSQL. The database schema includes:

- **transfers** table for LEP100 token transfer events
- **blocks** table for block metadata
- Indexes for optimized query performance

### Running the Indexer

```bash
# From the monorepo root
pnpm dev:indexer

# Or from the indexer/ directory
cd indexer && pnpm dev
```

---

## REST API

For REST API endpoints and HTTP-based access, see the [REST API Reference](../api-reference/rest-api.md).

---

## Further Reading

- [Frontend Integration](frontend-integration.md) -- Connect the SDK to web applications
- [LEP100 Token Standard](lep100-standard.md) -- Understand the token standard the API exposes
- [Smart Contracts](smart-contracts.md) -- Learn about the contracts you can interact with through the API
- [GraphQL API Reference](../api-reference/graphql-api.md) -- Detailed GraphQL schema documentation
- [SDK Reference](../api-reference/sdk-reference.md) -- Full SDK API documentation
