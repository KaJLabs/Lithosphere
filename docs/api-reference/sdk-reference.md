# SDK Reference

> **Work in Progress** -- This document is under active development. API surfaces may change before the stable release.

## Overview

The `@lithosphere/blockchain-core` package provides a TypeScript-first API for interacting with the Lithosphere blockchain. It includes a ledger abstraction layer, cryptographic utilities, and consensus mechanism implementation.

## Features

- **Ledger abstraction layer** -- Unified interface for reading and writing blockchain state.
- **Cryptographic utilities** -- *Planned:* MDKM (Multi-Dimensional Key Management), ring signatures, and additional crypto primitives. These modules are on the development roadmap and not yet available.
- **Consensus mechanism implementation** -- Pluggable consensus support built into the core SDK.
- **TypeScript-first API** -- Full type definitions and IntelliSense support out of the box.

## Installation

```bash
# Using npm
npm install @lithosphere/blockchain-core

# Using pnpm
pnpm add @lithosphere/blockchain-core
```

## Basic Usage

```typescript
import { LithosphereClient } from '@lithosphere/blockchain-core';

// Initialize the client
const client = new LithosphereClient({
  chainId: 61,
  rpcUrl: 'https://your-rpc-endpoint.example.com',
});

// Example: Query chain information
const chainInfo = await client.chain.getInfo();
console.log(chainInfo);

// Example: Interact with a smart contract
const contract = client.contracts.connect('0xContractAddress');
const result = await contract.read('balanceOf', ['0xAccountAddress']);
console.log(result);
```

> **Note:** The code above is a placeholder. The actual API will be documented once the SDK reaches a stable release.

## Available Modules

| Module      | Description |
|-------------|-------------|
| `contracts` | Smart contract deployment, interaction, and ABI management. |
| `sdk`       | High-level SDK utilities and client configuration. |
| `chain`     | Chain state queries, block and transaction retrieval. |
| `consensus` | Consensus mechanism interfaces and validation logic. |
| `crypto`    | Cryptographic primitives including MDKM and ring signatures. *(Planned — not yet implemented)* |

## Project Scaffolding

Use the `create-litho-app` CLI to quickly scaffold a new Lithosphere project:

```bash
npx create-litho-app my-litho-project
```

This sets up a project structure with the SDK pre-configured, sample contracts, and development tooling.

## API Documentation

Comprehensive API documentation with full method signatures, parameter types, and return values is coming soon.
