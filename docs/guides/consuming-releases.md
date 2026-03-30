# How to Consume Lithosphere Releases

> Guide for developers and operators pulling artifacts from Lithosphere's release pipeline.

## Artifact Overview

| Artifact | Registry | Format | Signed |
|----------|----------|--------|--------|
| Docker images (api, indexer, explorer) | `ghcr.io/kajlabs/lithosphere-*` | OCI | Cosign (keyless) |
| `@lithosphere/sdk` | npmjs.org | ESM + CJS | npm provenance |
| `create-litho-app` | npmjs.org | CJS CLI | npm provenance |
| Contract ABIs + bytecode | GitHub Releases | `.tar.gz` | SHA256 checksums |
| SBOM (per image) | GitHub Actions artifacts | SPDX JSON | Cosign attestation |
| SLSA provenance | OCI registry (attached) | in-toto | Cosign attestation |

## Docker Images

### Pull

```bash
# Latest from main branch
docker pull ghcr.io/kajlabs/lithosphere-api:latest
docker pull ghcr.io/kajlabs/lithosphere-indexer:latest
docker pull ghcr.io/kajlabs/lithosphere-explorer:latest

# Pinned by semver (recommended for production)
docker pull ghcr.io/kajlabs/lithosphere-api:1.2.3

# Pinned by commit SHA (immutable)
docker pull ghcr.io/kajlabs/lithosphere-api:sha-abc1234
```

### Verify with Cosign

```bash
# Install cosign: https://docs.sigstore.dev/cosign/installation/
cosign verify ghcr.io/kajlabs/lithosphere-api:latest \
  --certificate-identity-regexp='https://github.com/KaJLabs/lithosphere' \
  --certificate-oidc-issuer='https://token.actions.githubusercontent.com'
```

### Check SBOM

SBOMs are uploaded as workflow artifacts on every image publish. Download from the GitHub Actions run, or for release images, they are attached to the SLSA provenance.

## NPM Packages

### Install SDK

```bash
npm install @lithosphere/sdk
# or
pnpm add @lithosphere/sdk
```

### Scaffold a new project

```bash
npx create-litho-app my-dapp
# or
pnpm create litho-app my-dapp
```

### Verify npm package integrity

```bash
npm audit signatures
```

## Contract Artifacts

### Download from GitHub Releases

Each release includes a tarball of compiled contract artifacts:

```bash
# Download latest release artifacts
gh release download --repo KaJLabs/lithosphere --pattern 'lithosphere-contracts-*.tar.gz'
gh release download --repo KaJLabs/lithosphere --pattern '*.sha256'

# Verify checksum
sha256sum -c lithosphere-contracts-v1.2.3.sha256
```

### Bundle contents

```
lithosphere-contracts-v1.2.3/
  manifest.json          # version, chain, compiler, commit
  abi/
    Lep100.abi.json      # ABI-only JSON (for SDK/frontend)
    WLITHO.abi.json
    ...
  bytecode/
    Lep100.bin           # Deployment bytecode
    ...
  metadata/
    Lep100.json          # Full Hardhat artifact (ABI + bytecode + metadata)
    ...
```

### Use in a project

```typescript
import Lep100ABI from './abi/Lep100.abi.json';
import { ethers } from 'ethers';

const contract = new ethers.Contract(address, Lep100ABI, provider);
```

## Tag Conventions

| Tag pattern | Example | Mutability | Use case |
|-------------|---------|------------|----------|
| `latest` | `latest` | Mutable (tracks main) | Dev/CI |
| `mainnet` | `mainnet` | Mutable (tracks deploy) | Production default |
| `{major}.{minor}.{patch}` | `1.2.3` | Immutable | Production pinned |
| `{major}.{minor}` | `1.2` | Mutable (tracks patch) | Production rolling |
| `sha-{short}` | `sha-abc1234` | Immutable | Debugging/audit |

## Retention Policy

| Artifact | Retention | Location |
|----------|-----------|----------|
| Docker images (tagged releases) | Indefinite | GHCR |
| Docker images (`latest`) | Overwritten on each push to main | GHCR |
| NPM packages | Indefinite (npm policy) | npmjs.org |
| Contract tarballs | Indefinite (GitHub Release) | GitHub Releases |
| CI workflow artifacts (SBOM, gas reports) | 90 days | GitHub Actions |
| Turbo cache / build summaries | 7 days | GitHub Actions |

## Reproducible Build Verification

To verify a release was built from a specific commit:

```bash
# 1. Check image provenance
cosign verify-attestation \
  --type https://slsa.dev/provenance/v1.0?draft \
  ghcr.io/kajlabs/lithosphere-api:1.2.3

# 2. Check contract artifact commit
tar xzf lithosphere-contracts-v1.2.3.tar.gz
cat lithosphere-contracts-v1.2.3/manifest.json
# Shows: {"version":"1.2.3","commit":"abc123...","chain":"lithosphere_700777-1"}

# 3. Verify checksum
sha256sum -c lithosphere-contracts-v1.2.3.sha256
```
