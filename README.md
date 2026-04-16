# Lithosphere

Developer-preview toolchain for building on Lithosphere.

This repository is the source for the current GitHub release that external developers can use to start building. The public preview ships the starter CLI, the TypeScript SDK package, versioned contract artifacts, and the supporting docs needed to bootstrap projects against the Makalu network stack.

Lithosphere development in this repo is Solidity-first today. There is no standalone `lithic-compiler` package or binary in this workspace yet; existing "Lithic" references are verifier and language branding around the broader Lithosphere ecosystem.

## What Ships In The Preview

- `create-litho-app`: CLI that scaffolds official starter projects
- `@lithosphere/sdk`: TypeScript SDK package distributed as a GitHub release tarball
- Versioned contract artifacts from `Makalu/contracts`
- Developer docs and release-consumption guidance

## Start Building

### From The Monorepo

```bash
git clone https://github.com/KaJLabs/lithosphere.git
cd lithosphere/Makalu
pnpm install --frozen-lockfile
pnpm --filter create-litho-app build
node packages/create-litho-app/dist/index.cjs my-first-dapp --template contracts
```

### From A GitHub Prerelease

Download the latest prerelease assets from GitHub Releases, then install the packaged CLI or SDK tarball locally. The release guide documents the exact asset names and verification flow:

- `docs/guides/consuming-releases.md`

## Repository Layout

- `Makalu/`: developer workspace containing the CLI, SDK, contracts, templates, API, and explorer
- `docs/`: project and release documentation
- `.github/workflows/`: CI and GitHub release automation

## Documentation

- `docs/quickstart/dev-setup.md`
- `docs/developers/overview.md`
- `docs/guides/consuming-releases.md`
- `docs/guides/contributing.md`

## Requirements

- Node.js 20.x
- pnpm 9.x

## License

MIT. See `LICENSE`.
