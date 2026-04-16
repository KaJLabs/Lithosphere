# How to Consume Lithosphere Developer Preview Releases

Guide for developers pulling the public GitHub prerelease assets for the Lithosphere developer preview.

## What The Preview Ships

Each GitHub prerelease includes:

- `create-litho-app-<version>.tgz`
- `lithosphere-sdk-<version>.tgz`
- `lithosphere-contracts-v<version>.tar.gz`
- `lithosphere-contracts-v<version>.sha256`
- `checksums-v<version>.txt`
- `release-manifest-v<version>.json`

This preview does not yet ship a standalone Lithic compiler package or binary.

## Download Release Assets

```bash
gh release download --repo KaJLabs/lithosphere --pattern 'create-litho-app-*.tgz'
gh release download --repo KaJLabs/lithosphere --pattern 'lithosphere-sdk-*.tgz'
gh release download --repo KaJLabs/lithosphere --pattern 'lithosphere-contracts-*.tar.gz'
gh release download --repo KaJLabs/lithosphere --pattern 'checksums-v*.txt'
gh release download --repo KaJLabs/lithosphere --pattern 'release-manifest-v*.json'
```

## Verify Checksums

```bash
sha256sum -c checksums-v<version>.txt
```

The release manifest records the release version, commit SHA, Node.js version, pnpm version, and the generated asset names.

## Install The CLI

```bash
npm install -g ./create-litho-app-<version>.tgz
create-litho-app my-first-dapp --template contracts
```

## Install The SDK Tarball

```bash
mkdir lithosphere-sdk-consumer
cd lithosphere-sdk-consumer
pnpm init
pnpm add ../lithosphere-sdk-<version>.tgz
```

Use it with the published package name:

```typescript
import { createClient } from '@lithosphere/sdk';
```

## Contract Artifact Bundle

The contract bundle contains ABI, bytecode, metadata, and a small manifest:

```text
lithosphere-contracts-v<version>/
  manifest.json
  abi/
  bytecode/
  metadata/
```

Example usage:

```typescript
import Lep100ABI from './abi/Lep100.abi.json';
import { ethers } from 'ethers';

const contract = new ethers.Contract(address, Lep100ABI, provider);
```

## Versioning Notes

- GitHub prereleases are the supported distribution channel for the preview.
- Expect prerelease tags such as `v0.1.0-alpha.1`.
- Public npm publishing is deferred until after preview hardening.
