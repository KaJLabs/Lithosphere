# Developer Setup Guide

Get a fully working Lithosphere development environment — chain, indexer, API, and block explorer — running on your machine with a single command. No prior blockchain experience required.

---

## Prerequisites

You only need two things installed:

| Tool                | Download                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| **Docker Desktop**  | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **VS Code**         | [code.visualstudio.com](https://code.visualstudio.com/)                  |

> **Windows users:** Docker Desktop will prompt you to enable WSL 2 during installation. Accept the defaults — everything works out of the box.

After installing VS Code, add the **Dev Containers** extension:

```
ext install ms-vscode-remote.remote-containers
```

That's it. Node.js, pnpm, Go, Solidity tooling, and all project dependencies are installed automatically inside the container.

---

## 1 — Open the DevContainer (The "Magic" Button)

1. Clone the repo and open it in VS Code:

   ```bash
   git clone https://github.com/KaJLabs/lithosphere.git
   code lithosphere
   ```

2. VS Code will detect the `.devcontainer` configuration and show a notification:

   > **Folder contains a Dev Container configuration file. Reopen folder to develop in a container?**

   Click **"Reopen in Container"**.

   *If you miss the notification, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:*

   ```
   Dev Containers: Reopen in Container
   ```

3. **Wait for the build.** The first launch pulls the base image, installs tooling, and runs `pnpm install` across the monorepo. This takes **10–15 minutes** on a typical connection. Subsequent opens are near-instant.

When the terminal shows `Done in …s`, your environment is ready.

### What You Get

The DevContainer pre-installs everything a Lithosphere contributor needs:

| Tool / Extension          | Purpose                              |
| ------------------------- | ------------------------------------ |
| Node.js 20 + pnpm         | Runtime & package manager            |
| Go 1.23                   | For chain-level tooling              |
| Docker CLI + Compose      | Run the local stack from inside VS Code |
| GitHub CLI                | PR workflows without leaving the terminal |
| ESLint + Prettier          | Auto-format on save                  |
| Hardhat Solidity extension | Syntax highlighting, go-to-definition for `.sol` files |

---

## 2 — Start the Network

Open the integrated terminal inside VS Code and run:

```bash
cd Makalu
make up
```

This builds and launches **six services** via Docker Compose:

| Service          | URL / Port                          | Description                        |
| ---------------- | ----------------------------------- | ---------------------------------- |
| **LithoVM (Anvil)** | `http://localhost:8545`          | Local EVM chain (Chain ID `700777`, 2 s block time) |
| **API (GraphQL)**    | `http://localhost:4000`          | Backend API with GraphQL playground |
| **Indexer**          | `http://localhost:3001`          | Blockchain indexer (→ Postgres)    |
| **Explorer**         | `http://localhost:3000`          | Block explorer UI                  |
| **PostgreSQL**       | `localhost:5432`                 | Indexed chain data                 |
| **Redis**            | `localhost:6379`                 | Caching layer                      |

Once `make up` finishes, open [http://localhost:3000](http://localhost:3000) in your browser to see the block explorer.

---

## 3 — Seed the Devnet

With the stack running, seed it with test data:

```bash
make seed
```

This executes a seed script that does four things:

1. **Funds 5 mock wallets** with 1 000 LITHO each.
2. **Deploys a LEP100 token contract** (the Lithosphere multi-token standard).
3. **Mints 1 000 LEP100 tokens** to each mock wallet.
4. **Generates transfer activity** between wallets so the explorer has data to display.

You'll see 16 confirmed transactions in the terminal output. Refresh the explorer to see them.

---

## 4 — Connect MetaMask

Add the local Lithosphere devnet to MetaMask so you can interact with it from your browser.

### Add the Network

Open MetaMask → **Settings → Networks → Add Network → Add a network manually** and enter:

| Field              | Value                        |
| ------------------ | ---------------------------- |
| Network Name       | `Lithosphere Devnet`         |
| RPC URL            | `http://localhost:8545`      |
| Chain ID           | `700777`                     |
| Currency Symbol    | `LITHO`                      |
| Block Explorer URL | `http://localhost:3000`      |

### Import a Funded Wallet

After seeding, five wallets are pre-funded with 1 000 LITHO and 1 000 LEP100 tokens. Import any of them into MetaMask via **Import Account → Private Key**:

| Wallet | Address | Private Key |
| ------ | ------- | ----------- |
| Mock 1 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |
| Mock 2 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` |
| Mock 3 | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` | `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356` |
| Mock 4 | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` | `0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97` |
| Mock 5 | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | `0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6` |

> **Warning:** These are deterministic Anvil keys. **Never send real funds to these addresses.** They are publicly known and used by every developer running this stack.

---

## 5 — Day-to-Day Commands

All Makefile targets run from the `Makalu/` directory:

| Command          | What It Does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `make up`        | Build and start all services (waits for health checks)            |
| `make down`      | Stop all services (volumes are preserved)                         |
| `make restart`   | Stop → Start                                                     |
| `make seed`      | Fund wallets + deploy LEP100 contract                             |
| `make logs`      | Tail live logs from all services (`Ctrl+C` to stop)               |
| `make status`    | Show container status                                             |
| `make clean`     | **Factory reset** — removes all containers, volumes, and build artifacts |
| `make help`      | Print the command reference                                       |

---

## Troubleshooting

### "The install is taking forever…"

The first `pnpm install` inside the DevContainer downloads ~1 300 packages for the entire monorepo. On a slower connection this can take **10–15 minutes**. This is normal — subsequent container starts reuse the cached `node_modules`.

### "Port 8545 (or 3000, 4000…) is already in use"

Another process is binding that port. Stop the stack and check:

```bash
make down

# On Linux / macOS / WSL:
lsof -i :8545

# On Windows (PowerShell):
netstat -ano | findstr :8545
```

Kill the conflicting process, then `make up` again.

### "Docker commands don't work inside the container"

The DevContainer mounts the host Docker socket. If you see permission errors:

```bash
# Verify the socket is mounted
ls -la /var/run/docker.sock

# Check your user is in the docker group
groups
```

If `docker` is missing from the groups list, restart the container via the Command Palette → **Dev Containers: Rebuild Container**.

### "make seed fails with 'connection refused'"

The chain isn't running yet. Start the stack first:

```bash
make up
# Wait for "Stack is up" message, then:
make seed
```

### "I want to start fresh"

```bash
make clean   # Wipes everything: containers, volumes, build artifacts
make up      # Rebuild from scratch
make seed    # Re-seed the devnet
```

---

## Next Steps

- [CLI Tools Reference](quickstart/cli-tools.md) — Explore the `lithod` binary and `create-litho-app` scaffolding tool.
- [Smart Contracts](developers/smart-contracts.md) — Write and deploy LEP100 contracts on Lithosphere.
- [Hardhat Example](developers/examples/hardhat-example.md) — A step-by-step Hardhat project targeting the local devnet.
- [Architecture Overview](introduction/architecture-overview.md) — Understand how the chain, indexer, and API fit together.
