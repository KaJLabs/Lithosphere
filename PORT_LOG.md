# Mainnet LithoVM port log (offline; nothing on chain)

**Goal:** a mainnet 9005 binary, built from rc3 (`litho-l1-security-20261021-rc3`, exe `c80f89bf…`), that adds the LithoVM native store, the `0x…f000` gateway and a store-adding upgrade handler. It must match the Makalu R4 LithoVM behaviour exactly.

**Client decision 2026-11-16:**
- Native (Lithic) LAX on mainnet.
- Autha reviews the compiler first; the rest proceeds after that review.
- This port and rehearsal is offline preparation only.

## Sources

### Base: rc3

- This repo was cloned from `client-work/L1_RC3_RELEASE_EXECUTION_2026-10-21/accepted-source.git`, branch `l1-security-rc3-20261021`, head `5226f43`.
- Work branch: `mainnet-lithovm-port`.
- Layout: `node/` (Evmos v20 fork, `module github.com/evmos/evmos/v20`), plus `comet` (0.38.24), `geth`, `sdk`, `memiavl`, `store` and `wal`.
- Go 1.26.10; build script `security/build.sh` (tags `netgo,ledger`, cgo on).
- Toolchain tarball: `/home/bachal/litho-l1-security-rc3-20261021/go1.26.10.linux-amd64.tar.gz` (WSL).

### LithoVM: Makalu R4

The pins come from `client-work/LAX_RELEASE_ENGINEERING_2026-10-16/NODE_R3_SOURCE_INVENTORY.json`:

| Repository | Pin | Local changes |
|---|---|---|
| `litho-native-chain-lab` | `3cadea9` (branch `feat/lithovm-disabled-gateway-lab`) | none |
| `litho-native-sdk-lab` | `f2e6295` | 6 tracked changes (patch recorded) |
| `lithic-toolchain` | `f7c259ae` | 6 tracked changes (patch `68187bf0…`) |

The R4 build record is `client-work/LAX_NATIVE_MIGRATION_REVIEW_2026-10-16/R4_BUILD_RECORD.json`. It used three overlays: `native-chain/bridge.go`, `cmd/config.go` and `utils/utils.go`. The resulting exe is `bff37723…`, with CGO rpath `$ORIGIN/../lib`.

## LithoVM delta (lab, Evmos v20 `eca13ef` → `3cadea9`, restricted to LithoVM)

**New files.** Twelve, all absent in rc3:
- `app/lithovm_store_{lab,disabled}.go` and tests
- `app/lithovm_upgrade_{lab,disabled}.go` and test
- `x/evm/keeper/lithovm_candidate_{lab,disabled}.go` and tests
- `x/evm/keeper/lithovm_candidate_apply_test.go`

**Hooks.**
- `app/app.go`: `SetLithoVMStoreKey`, the InitChainer `importLithoVMGenesis`, `registerLithoVMStoreUpgrade` and `configureLithoVMStoreLoader`.
- `app/keys.go`: append `lithovmLabStoreKeys()`.
- `app/export.go`: `exportLithoVMGenesis`.
- `x/evm/keeper/keeper.go`: the `lithovmStoreKey` field.
- `x/evm/keeper/state_transition.go`: `newEVMWithCandidate` and the call hook in `ApplyMessageWithConfig`.
- `x/evm/types/interfaces.go`: still to be checked.

**Module.** `lithic.local/native-chain-lab` is replaced by `lithic-toolchain/integration/native-chain`. It contains `bridge.go`, which does the cgo link to `liblithovm_ffi`; with `lithovm_release` it links `target/release`.

**Build tag.** `lithovm_chain_lab`, plus `lithovm_release` for the FFI library.

**Upgrade.**
- The lab name is `lithovm-native-store-lab-v1`. It uses `UpgradeStoreLoader(plan.Height, Added: ["lithovm"])` with a no-op `RunMigrations`.
- On mainnet, use a mainnet name, for example `lithovm-native-store-v1`.

**Not LithoVM.** The other lab hunks are LITHO base features that rc3 already carries in its own form: supply cap, inflation minting restriction, the StateDB `SetBalance` guards and the gas-adjustment default. Do not re-apply them; check that each is present in rc3.

## Steps

1. Copy the 12 new files. Apply the hook hunks to `node/`. Copy `native-chain` into the repo at the pinned `f7c259ae` plus its patch. Add the `go.mod` require and replace. Rename the upgrade.
2. Build `liblithovm_ffi` (release) from `lithic-toolchain` `f7c259ae` plus its patch, with the pinned Rust toolchain. Check that the library hash matches the one installed on the Makalu hosts.
3. Build `lithod` with Go 1.26.10, tags `netgo,ledger,lithovm_chain_lab,lithovm_release`, and rpath `$ORIGIN/../lib`.
4. Run the tests: rc3's `security/check.sh` gates, the lab LithoVM tests and the native-chain tests.
5. Rehearse on a copy of mainnet state: export, or an in-place testnet. Upgrade at height H, then confirm blocks, an unchanged app hash path, the `lithovm` store added, a LAX v12 deploy with `INITIAL_HOLDER` = `0x8FDb…`, `totalSupply` and a transfer.
6. Write the review package. Autha reviews the compiler/runtime first, per the client.

## Status

| Date | Status |
|---|---|
| 2026-11-16 | Steps 0 (sourcing and delta analysis) done. Step 1 next. |
| 2026-11-16 | **Step 1 done**, commit `26df1f6`: the 12 LithoVM files copied, hooks applied, upgrade renamed `lithovm-native-store-v1`. Details below. |
| 2026-11-16 | **Step 2 done**, reproducible. In the WSL clean LF checkout `/home/bachal/litho-mainnet-lithovm-20261116` (cloned from a bundle), `liblithovm_ffi.so` from `lithic-toolchain` `f7c259ae` built in 38 s with Rust 1.96.0. SHA-256 `b96a9028219b2abc8c4557bdf7cd74e2ffb096ed3b1ce962e17e4a40f9ad473c` is identical to Makalu R4 `makalu-native-r4/lib/liblithovm_ffi.so`. |
| 2026-11-16 | **Step 3 running**: `mainnet-build/02_build_lithod.sh` (Go 1.26.10; tags `netgo,ledger,lithovm_chain_lab,lithovm_release`; rpath `$ORIGIN/../lib`; version `litho-l1-security-20261021-rc3-lithovm1`). |

| 2026-11-16 | **Step 3 done**, build 655 s. Binary `dist-lithovm/litho-l1-security-20261021-rc3-lithovm1`, SHA-256 `661b607bd5717fd42a0fe37829efe26f19b3c54fc2204807e8e896e80451ba36`. NEEDED `liblithovm_ffi.so` and `libc.so.6`; RUNPATH `$ORIGIN/../lib`. `lib/liblithovm_ffi.so` `b96a9028…`. Built `-mod=readonly`, so the existing `go.sum` covered the native-chain dependencies. |
| 2026-11-16 | **Step 4 done, PASS.** `go vet` is clean on the tagged `app` and `x/evm/keeper`. Tagged `app` tests pass: `TestLithoVMLabStoreGenesisIsMountedAndEmptyRoundTrips`, `TestLithoVMLabStoreNonemptyExportImport` and `TestLithoVMStoreUpgradeIsHeightAndPlanGated` (with the mainnet plan name). The tagged keeper test `TestLithoVMCandidateHookIsTaggedAndReregisters` passes. The suite (`04_suite_tests.sh`) passes `TestLithoVMCandidateApplyMessageHook` and `TestLithoVMCandidateSignedDeploySimulationAndCommit`, a real FFI deploy through `0x…f000`. Untagged rc3 guards pass: `TestOrdinaryBuildHasNoLithoVMStoreAndRejectsItsGenesis` and `TestLithoVMCandidateNotRegisteredByDefault`. The only finding was gofmt import order in `app/lithovm_upgrade_lab_test.go` (copied verbatim from the lab); fixed. |

### Step 5 rehearsal design (in-place testnet on a copy of mainnet state, memiavl)

The SDK `server.InPlaceTestnetCreator` exists in rc3's `sdk/server/start.go:634`, with the `--trigger-testnet-upgrade` flag. The app does not wire it up, so add a **rehearsal-only** `InitAppForTestnet` under a build tag `rehearsal`, never in the release binary. It must:
- replace the validator set with one local validator (staking, slashing and distribution, as Gaia and Osmosis do);
- set the upgrade plan at `LastBlockHeight + N` when the trigger is set.

Then:
1. Get a mainnet state copy with memiavl. State-sync a local rc3 node in WSL from the mainnet sentries' snapshots. RPC for the light client goes through SSH tunnels to the sentries' `127.0.0.1:27057`, because the public `rpc-mainnet` blocks `commit`.
2. Run `in-place-testnet` with the old (rc3 + rehearsal) binary and `--trigger-testnet-upgrade lithovm-native-store-v1`. Produce blocks until it halts with UPGRADE NEEDED at H.
3. Swap to the new binary (`lithovm1` + rehearsal). The `lithovm` store must be added under memiavl and blocks must continue.
4. Restart after H and replay.
5. Deploy LAX v12, recompiled with `INITIAL_HOLDER` = `0x8FDb…`, from a funded local account through `0x…f000`. Check `totalSupply` = 10^28, the holder balance and a transfer.

### Step 1 details

- Copied the 12 LithoVM files from `3cadea9`.
- Applied the hunks to `x/evm/keeper/keeper.go` and `state_transition.go`; both applied cleanly. The `interfaces.go` hunk was not needed because rc3 already has `BlockedAddr`.
- `app.go` hooks:
  - `SetLithoVMStoreKey`
  - InitChainer `importLithoVMGenesis`, placed after rc3's `validateLITHOGenesisSupply`
  - `registerLithoVMStoreUpgrade`
  - `configureLithoVMStoreLoader`
- `keys.go` and `export.go` hooks added.
- Added `lithic-toolchain` `f7c259ae` via `git archive`. Its tracked patch `68187bf0` touches docs only, so the code is exact.
- `bridge.go` equals the Makalu R4 overlay byte for byte (only the build-tree rpath is removed).
- `go.mod` gains the require and replace for `lithic.local/native-chain-lab`.

Overlays not applied:
- **`cmd/config.go`:** rc3 differs from the Makalu overlay only in `DisplayDenom` (CLI display, not consensus). Kept rc3's value.
- **`utils.go`:** rc3 already equals the overlay.

### Notes

- **Don't run `wsl -- bash -c '...$VAR...'` from Git Bash.** The outer shell expands `$VAR` first, and MSYS rewrites `/mnt/...` paths. Run scripts with PowerShell: `wsl -d Ubuntu -- bash /mnt/d/.../script.sh`.
- **Store loader under memiavl.** Mainnet rc3 runs memiavl (`memiavlstore.SetupMemIAVL`). The rehearsal must show that `UpgradeStoreLoader` adding `lithovm` works with memiavl. Makalu's lab chain may not have used memiavl, so check what Makalu runs.
  - **Checked 2026-11-16:** Makalu `amir-val-01` runs with `[memiavl] enable = false` (plain IAVL, `application.db`). Mainnet runs memiavl: val-09 logs show memiavl snapshot rewrites.
  - So the store-addition upgrade has **never been exercised on memiavl**. Cronos memiavl supports `StoreUpgrades.Added` through its `LoadVersionAndUpgrade`, but that is unproven here.
  - This is the **primary rehearsal gate**. Rehearse on a copy of a memiavl mainnet node home and confirm: the upgrade at H, `lithovm` added, an app hash identical to a reference node for the first blocks after H, and restart/replay after H.
