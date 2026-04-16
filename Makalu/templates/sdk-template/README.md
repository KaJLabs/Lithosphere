# @lithosphere/sdk

Official TypeScript SDK for the Lithosphere developer preview.

## Installation

The first public release is distributed as a GitHub release tarball:

```bash
pnpm add ./lithosphere-sdk-<version>.tgz
```

Once npm publishing is enabled, the package name remains the same:

```bash
pnpm add @lithosphere/sdk
```

## Quick Start

```typescript
import { createClient } from '@lithosphere/sdk';

const client = await createClient('mainnet');

const balance = await client.getBalance('0x742d35Cc6634C0532925a3b844Bc9e7595f6E234');
console.log(`${balance.formatted} ${balance.symbol}`);
```

## API

### `LithoClient`

```typescript
import { LithoClient } from '@lithosphere/sdk';

const client = new LithoClient('mainnet');
```

### `createClient(rpcUrlOrNetwork, config?)`

Factory function that returns a `Promise<LithoClient>`.

### `NETWORKS`

Predefined network configurations:

| Network | Chain ID | RPC |
|---------|----------|-----|
| `mainnet` | 999 | `https://mainnet.lithosphere.network/rpc` |
| `staging` | 1001 | `https://staging.lithosphere.network/rpc` |
| `devnet` | 1000 | `https://devnet.lithosphere.network/rpc` |
| `local` | 31337 | `http://localhost:8545` |

## Development

Tested in the monorepo with Node.js 20.x.

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm typecheck
```
