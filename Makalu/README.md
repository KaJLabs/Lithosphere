# Lithosphere Makalu Workspace

Makalu contains the developer-facing workspace used for Lithosphere GitHub developer-preview releases.

The preview release surface is intentionally small:

- `packages/create-litho-app`: official scaffolding CLI
- `templates/sdk-template`: packaged and released as `@lithosphere/sdk`
- `contracts/`: canonical contract artifacts bundled into GitHub prereleases

The rest of the workspace remains product and infrastructure source for the wider Lithosphere stack.

## Requirements

- Node.js 20.x
- pnpm 9.x

## Local Development

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## Developer Preview Packaging

```bash
pnpm --filter create-litho-app build
pnpm --filter @lithosphere/sdk build
pnpm --filter @lithosphere/sdk test
pnpm --dir contracts compile
```

## Packages And Templates

- `packages/create-litho-app`: scaffolds contracts, service, and SDK starter projects
- `templates/contracts-template`: Hardhat + Foundry starter with deploy and verification scripts
- `templates/sdk-template`: TypeScript SDK library template released as the preview SDK package
- `templates/service-template`: Fastify service starter used by the CLI

## Notes

- The workspace does not currently contain a standalone Lithic compiler package.
- GitHub prereleases are the supported external distribution channel for this preview. Public npm publishing can follow after the preview hardening phase.

## License

MIT. See `../LICENSE`.
