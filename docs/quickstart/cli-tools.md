# CLI Tools Reference

This page documents the command-line tools available in the Lithosphere ecosystem: the `lithod` node binary and the `create-litho-app` project scaffolding tool.

---

## lithod

`lithod` is the core binary for running a Lithosphere blockchain node. It is built on top of the following frameworks:

| Framework       | Role                                                                 |
|-----------------|----------------------------------------------------------------------|
| **Cosmos SDK**  | Application framework providing modules for staking, governance, bank, auth, and more. |
| **CometBFT**    | Byzantine Fault Tolerant consensus engine (formerly Tendermint Core). |
| **LithoVM**     | EVM-compatible virtual machine enabling Solidity smart contract execution on Lithosphere. |

**Source repository:** [github.com/KaJLabs/lithosphere/litho-chain](https://github.com/KaJLabs/lithosphere/tree/main/litho-chain)

A **pre-built binary** is available for **Linux x86_64**. For other platforms, build from source using the instructions below.

---

### Building from Source

#### Requirements

| Tool      | Minimum Version | Notes                        |
|-----------|----------------:|------------------------------|
| **Go**    | >= 1.22         | Required for compilation.    |
| **git**   | any             | To clone the repository.     |
| **make**  | any             | GNU Make for the build system.|

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/KaJLabs/lithosphere.git
cd lithosphere/litho-chain

# Build the binary
./build.sh

# Generate checksums for verification
./checksums.sh
```

After a successful build, the following outputs are produced:

| Output             | Description                                                      |
|--------------------|------------------------------------------------------------------|
| `lithod`           | The compiled node binary, ready to run.                          |
| `checksums.txt`    | SHA-256 checksums for verifying binary integrity.                |

You can also use `make install` to place the binary directly in `$GOPATH/bin`:

```bash
make install
```

Verify the installation:

```bash
lithod version
```

---

### Key Commands

Below are the essential `lithod` commands for node operation.

#### `lithod init`

Initialize a new node with a moniker and chain ID:

```bash
lithod init <moniker> --chain-id <chain-id>
```

| Parameter      | Description                                                    |
|----------------|----------------------------------------------------------------|
| `<moniker>`    | A human-readable name for your node (e.g., `my-node-01`).     |
| `--chain-id`   | The identifier of the target chain (e.g., `lithosphere_700777-1`).   |

This command creates the default directory structure at `~/.lithod/`, including configuration files (`app.toml`, `config.toml`, `genesis.json`), the data directory, and the keyring.

#### `lithod start`

Start the node and begin syncing with the network:

```bash
lithod start
```

The node connects to peers, replays blocks from genesis (or a snapshot), and begins participating in consensus once fully synced.

Common flags:

| Flag                     | Description                                              |
|--------------------------|----------------------------------------------------------|
| `--home <path>`          | Override the default home directory (`~/.lithod/`).      |
| `--log_level <level>`    | Set log verbosity (`info`, `debug`, `warn`, `error`).    |
| `--p2p.seeds <seeds>`    | Comma-separated list of seed node addresses.             |
| `--rpc.laddr <addr>`     | RPC listen address (default: `tcp://127.0.0.1:26657`).   |

#### `lithod version`

Print the current version and build information:

```bash
lithod version
```

Example output:

```
v1.0.0
```

Use `lithod version --long` for detailed build metadata including Go version, commit hash, and build tags.

---

## create-litho-app

`create-litho-app` is a CLI scaffolding tool for bootstrapping new Lithosphere projects. It provides an interactive setup experience that lets you choose a project template, configures dependencies automatically, and gets you to a working project in seconds.

**Built with:** [tsup](https://github.com/egoist/tsup) (a TypeScript bundler powered by esbuild).

---

### Features

- **Project template selection** -- Choose from available Lithosphere project templates (e.g., full-stack dApp, smart contract workspace, API integration).
- **Automatic dependency setup** -- Installs all required dependencies after scaffolding.
- **Sensible defaults** -- Pre-configured TypeScript, linting, formatting, and testing out of the box.
- **Monorepo-aware** -- Generated projects integrate seamlessly with the Lithosphere monorepo structure.

---

### Usage

Run the tool directly with `npx` -- no global installation required:

```bash
npx create-litho-app
```

The interactive CLI will guide you through the following steps:

1. **Project name** -- Enter a name for your new project.
2. **Template selection** -- Choose a project template from the available options.
3. **Configuration** -- Answer any template-specific prompts (e.g., chain ID, RPC endpoint).
4. **Dependency installation** -- Dependencies are installed automatically via `pnpm`.

Once complete, navigate into the new project directory and start developing:

```bash
cd <project-name>
pnpm dev
```

---

### Example

```bash
$ npx create-litho-app

  Welcome to create-litho-app!

  ? Project name: my-litho-dapp
  ? Select a template: Full-Stack dApp
  ? Chain ID: 61

  Scaffolding project in ./my-litho-dapp ...
  Installing dependencies ...

  Done! Next steps:

    cd my-litho-dapp
    pnpm dev
```

---

## Next Steps

- [Developer Setup](quickstart/dev-setup.md) -- Set up the full monorepo development environment.
- [Validator Setup](quickstart/validator-setup.md) -- Configure and run a validator node.
