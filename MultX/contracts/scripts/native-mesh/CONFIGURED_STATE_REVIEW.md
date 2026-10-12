# O-27 configured-state verifier — review before live use

This tool is read-only. It does not replace the pristine deployment verifier or
change the accepted vault/signer application source. It must be independently
reviewed before running against production. A PASS is a configuration snapshot,
not authorization to execute ready Timelock operations or start signing/canary.

Inputs are the exact deployment plan, bytecode evidence and a separately hashed
expectations file. The expectations list the two deployment transaction hashes,
configuration transaction, caps, funding transactions/funders/amounts, and known
Timelock operation IDs with schedule/execution transaction hashes for each chain.
Expectations must be derived from retained records and reviewed approvals, not
generated from whatever state is currently returned by an RPC.

After review, with private `MULTX_RPC_1`, `MULTX_RPC_56`, and `MULTX_RPC_8453` in the
execution environment, from `MultX/contracts`:

```text
node scripts/native-mesh/verify-configured-state.cjs PLAN_JSON PLAN_SHA256 EXPECTATIONS_JSON EXPECTATIONS_SHA256 BYTECODE_JSON BYTECODE_SHA256
```

Retain stdout as a private artifact and compute its SHA-256. Return only that
sanitized JSON, checksum and opaque evidence reference. Do not include endpoint
URLs or environment dumps. CLI failure output deliberately suppresses exceptions
that might include credential-bearing RPC URLs.

## Checks

- Requires an RPC `finalized` anchor. Current code/storage/balance/call reads use
  EIP-1898 block-hash pinning with `requireCanonical`; no depth/latest fallback.
- Binds factory, vault, Timelock, Safe proxy/singleton/fallback runtime hashes and
  original factory deployment calls. Reuses reviewed Safe/role verification.
- Verifies 48-hour delay, exact governance roles, vault owner, five validators,
  quorum three, guardian, paused state, exact two routes, 3,600-second route delay,
  expected caps, zero escrow and zero deposit/payout volumes.
- Enumerates vault logs from deployment, checks canonical receipts, rejects
  duplicates/missing receipt logs, and requires exactly the recorded constructor,
  configuration and funding events. All deposit/release/refund/withdrawal and
  additional configuration events fail. Balance must equal recorded funding.
- Reconstructs every Timelock schedule/cancellation/execution lifecycle, derives
  operation IDs from targets/values/calldata/predecessor/salt, verifies storage,
  and lists each call and its keccak256 hash. Known execution/schedule transactions
  must match. Unrecognized operations produce HOLD with details, not PASS.
- Rechecks anchor canonicality after collection. RPC methods are allowlisted as
  read-only; no signing or transaction RPC is available.

## Limitations and decisions still required

The RPC must support historical code/logs/receipts and EIP-1898. Log enumeration
assumes the RPC provides complete history; receipt cross-checks cannot prove the
absence of a transaction omitted entirely by a dishonest provider. This snapshot
is not the separate dual-provider settlement finality or 72-hour diagnostic gate.

The code accepts a recorded unpause operation in WAITING/READY/CANCELLED state,
but rejects its execution. A ready operation remains a governance risk. Holding
or cancelling it is a separate governance decision; this tool does neither.
Original authorization evidence and the provenance of executing review-candidate
plans remain separate review inputs. Historical records are not current state.
