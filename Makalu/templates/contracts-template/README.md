# @lithosphere/contracts-template

Official smart contract starter used by `create-litho-app` for the Lithosphere developer preview.

## Requirements

- Node.js 20+
- pnpm 9+
- Foundry is optional unless you want to run the Forge-specific commands

## Quick Start

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm compile
pnpm test:hardhat
```

## Common Commands

```bash
pnpm compile
pnpm test:hardhat
pnpm test:forge
pnpm test:all
pnpm deploy:local
pnpm verify
```

## Included Tooling

- Hardhat compile, test, deploy, and verify scripts
- Foundry config and example Forge tests
- Solhint and Prettier Solidity formatting
- Slither config for security analysis

## Notes

- The CLI excludes local build artifacts when copying this template into a new project.
- `verify` depends on network-specific explorer credentials in `.env`.
