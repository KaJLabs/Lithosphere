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
