# Developer Overview

Lithosphere is a next-generation Layer 1 blockchain platform designed for cross-chain decentralized applications, privacy-preserving smart contracts, and the LEP100 multi-chain token standard. This overview covers the project structure, packages, design philosophy, and a reading guide for different audiences.

---

## Monorepo Structure

The Lithosphere codebase is organized as a monorepo managed with pnpm workspaces and Turborepo. The top-level layout is as follows:

```
lithosphere/
├── api/                        # GraphQL API server
├── indexer/                    # Blockchain event indexer
├── contracts/                  # Smart contracts (Solidity)
├── web/                        # Next.js frontend application
├── packages/
│   ├── blockchain-core/        # Core blockchain SDK & utilities
│   ├── create-litho-app/       # CLI tool for scaffolding projects
│   └── docs/                   # Documentation & technical specs
├── clusters/                   # Kubernetes configs (devnet, staging, mainnet)
├── infra/                      # Infrastructure as Code & monitoring
├── scripts/                    # Deployment & utility scripts
└── templates/                  # Project templates for developers
```

Each directory serves a distinct role in the development lifecycle, from smart contract authoring through deployment and monitoring.

---

## Packages and Applications

### Applications

| Package | Description | Key Technologies |
|---------|-------------|-----------------|
| **@lithosphere/api** | GraphQL API server for blockchain data querying, smart contract interactions, and real-time event subscriptions | Express.js, Apollo Server |
| **@lithosphere/indexer** | Blockchain event indexer that processes on-chain events and exposes a GraphQL schema for efficient querying; powers the API backend | GraphQL, PostgreSQL |
| **@lithosphere/contracts** | Smart contracts including LITHO (native token), LEP100 (multi-chain token standard), WLITHO (wrapped token), and Lep100Access (access control) | Hardhat, Solidity 0.8.20+ |
| **@lithosphere/web** | Frontend application with server-side rendering, real-time blockchain data integration, and responsive design | Next.js 14, React 18 |

### Shared Packages

| Package | Description | Key Technologies |
|---------|-------------|-----------------|
| **@lithosphere/blockchain-core** | Core SDK providing a ledger abstraction layer and consensus mechanism implementation. *Cryptographic utilities (MDKM, ring signatures) are planned but not yet implemented.* | TypeScript-first API |
| **create-litho-app** | CLI tool for scaffolding new Lithosphere projects with template selection and automatic dependency setup | tsup |
| **@lithosphere/docs** | Comprehensive documentation including the whitepaper, LEP100 token standard guide, architecture docs, and smart contract development guides | Markdown |

---

## Design Objectives

Lithosphere was built around three core design objectives derived from research on cross-chain technology, AI, machine learning, and decentralization:

### Cross-chain Asset Transfer

- Connect major digital currency networks (such as Bitcoin and Ethereum) and complete asset transactions without altering the original chains' mechanisms.
- Integrate Lithosphere with consortium chains, handling asset transfers in both directions and enabling asset trading on Lithosphere itself.
- Guarantee that cross-chain transactions are secure and that cross-chain transaction services are stable.

### Transaction Privacy Protection

- Allow trading parties to choose whether or not to execute transactions privately.
- Provide privacy protection for digital asset transfers and exchanges.
- Provide holders of digital assets with anonymous protection through ring signatures and one-time accounts. *(Planned — ring signature and one-time account modules are on the development roadmap.)*

### Functional Extensibility

- Serve as a decentralized platform for trading non-fungible assets and digital currencies.
- Operate deposit and lending services for multiple digital currencies.
- Enable the creation and exchange of novel digital financial assets.

---

## Reading Guide

### For Developers

The recommended reading path for developers building on the Lithosphere platform:

1. **Whitepaper** -- Understand the vision and high-level design of the Lithosphere network.
2. **[LEP100 Token Standard](developers/lep100-standard.md)** -- Learn the multi-chain token standard that underpins all Lithosphere tokens.
3. **Architecture Overview** -- Study the architectural decisions, consensus model (LinBFT), and cryptographic primitives (MDKM).
4. **[Smart Contracts](developers/smart-contracts.md)** -- Dive into smart contract development, multi-triggering mechanisms, and DeFi patterns.
5. **[API & SDK](developers/api-and-sdk.md)** -- Integrate with the GraphQL API and blockchain-core SDK.
6. **[CI/CD Guide](developers/ci-cd-guide.md)** -- Configure deployment pipelines across Local, Devnet, Staging, and Mainnet environments.

### For Researchers

- Begin with the **Whitepaper** and the **LEP100 Yellowpaper** for formal specifications.
- Study **Linear Communication BFT (LinBFT)** consensus and its improvements over PBFT.
- Review **Myriad Distributed Key Management (MDKM)** and elliptic curve cryptography primitives.
- Explore **Cross-Chain Integration** for the Lock-in/Lock-out asset mapping model.

### For Investors

- Start with the **Abstract** for the project's mission and positioning.
- Read **Tokenomics** and **Roadmap** sections for network economics and milestones.
- Review **Lithosphere Products** and the **LEP100 Token Standard** for ecosystem understanding.
- Study **Governance** for on-chain decision-making processes.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **LEP100 Token Standard** | Multi-chain compatible token standard supporting fungible and non-fungible tokens, time slicing, batch operations, and cross-chain exchange |
| **Privacy-Preserving** | Ring signatures and locked account generation scheme provide transaction anonymity |
| **DeFi Ready** | Built-in smart contracts for decentralized finance with multi-role, multi-token, and usufruct separation |
| **High Performance LinBFT** | Linear Communication BFT consensus with per-block consensus, rotating leader, changing honesty model, and dynamic participant sets |
| **Developer Friendly** | Comprehensive SDK, CLI scaffolding tools, GraphQL API, Ethereum compatibility, and full-stack TypeScript tooling |
| **MDKM Secure** | Myriad Distributed Key Management based on distributed key generation and elliptic curve cryptography for decentralized control |

---

## Quick Start

```bash
# Prerequisites: Node.js >= 20.0.0, pnpm >= 9.0.0

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode (all services)
pnpm dev
```

For more detailed setup, see the [Developer Setup](../quickstart/dev-setup.md) guide.
