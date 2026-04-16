# create-litho-app

Official CLI for scaffolding Lithosphere developer-preview projects.

The package bundles the supported starter templates inside the release artifact, so it works both from the monorepo and from a packed GitHub release tarball.

## Requirements

- Node.js 20+
- pnpm 9+ for generated projects

## Usage

```bash
npx create-litho-app my-litho-app
```

You can also install a release tarball directly:

```bash
npm install -g ./create-litho-app-<version>.tgz
create-litho-app my-litho-app
```

## Templates

- `contracts`: Hardhat + Foundry smart contract starter
- `service`: Fastify + Docker service starter
- `sdk`: TypeScript SDK starter

## Common Commands

```bash
create-litho-app my-litho-app --template contracts
create-litho-app my-service --template service
create-litho-app my-sdk --template sdk
```

Each generated project prints its next-step commands after scaffolding.

## Development

```bash
pnpm install
pnpm build
node dist/index.cjs --help
```
