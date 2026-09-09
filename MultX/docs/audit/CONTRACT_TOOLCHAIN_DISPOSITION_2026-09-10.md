# MultX contract toolchain dependency disposition - 2026-09-10

## Decision

The deprecated Waffle/Ganache test path has been removed from the MultX
contract package. Tests now use the Hardhat Chai matcher package that is
compatible with the retained Hardhat 2 and ethers 5 interfaces.

The remaining audit findings are accepted only as a temporary development
toolchain constraint. This is not acceptance for a privileged or persistent
deployment runner, and it is not approval to deploy or activate MultX.

The contract toolchain must not be installed or executed on a long-lived
privileged runner, signer, validator, indexer, API host, or production
deployment host. Until a separately reviewed migration removes the residual
findings, it may run only in a clean, unprivileged, disposable build
environment with no production secrets, signing keys, or private production
network access. That environment must be destroyed after the job.

## Recorded audit results

The following results were produced from the committed lockfile after running
the non-breaking `npm audit fix` on 2026-09-10:

| Scope | Low | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Complete contract development tree | 16 | 8 | 9 | 0 | 33 |
| Production tree (`npm audit --omit=dev`) | 0 | 0 | 0 | 0 | 0 |

The nine high-severity package findings are in
`@nomicfoundation/hardhat-chai-matchers`, `@nomiclabs/hardhat-ethers`,
`adm-zip`, `hardhat`, `serialize-javascript`, `solidity-coverage`, `tmp`,
`undici`, and `ws`. They are reachable through the compiler/test dependency
tree, not through a deployed Node.js runtime. npm offers no compatible
non-breaking closure for the retained Hardhat 2 and ethers 5 stack.

This distinction limits exposure; it does not mark the findings remediated.
A Hardhat/ethers major migration requires its own review and must reproduce
the accepted compiler inputs and complete bytecode before it can replace this
toolchain.

## Verification

- All 153 Hardhat tests passed.
- All 12 contract closure mutations were rejected, with the baseline passing.
- A forced compile built all 34 Solidity files with solc 0.8.24.
- Creation and runtime bytecode, including metadata, matched the pre-change
  baseline for `GovTimelock`, `MultXBridge`, `MultXBridgeDest`, and
  `WrappedLEP100`.
- The production dependency audit reports zero findings.

The unchanged SHA-256 bytecode hashes are:

| Contract | Creation | Runtime |
| --- | --- | --- |
| `GovTimelock` | `bb4544bcedf529b9eefaaea9805a1e765e6c0a835cdb3029ca0abf7a70ba2586` | `2c90c8cf6d3425c7fbfd2ebcfc0389819178bbb42a2294bdd4b85ff1555deea5` |
| `MultXBridge` | `26cf1e21e5db4806fa5db4de3acfea1f3b8e005e458d6ec86bd220fdd641afe2` | `bbaa320d0ebb94fd39ba67d5d2a107e55cee3860bc92267dbe677438085030d0` |
| `MultXBridgeDest` | `4c9c310d36fa114e0d18f4d1897b498211a9ff342c8b2c8bd746adf10bd3c820` | `c3c5c878c0ebf3685c0364b86cdf8bf446422bea358490290ccaa9edac99b5aa` |
| `WrappedLEP100` | `78765cb9e76d04e25e8387e61a99a0b77964672f65ae45984970eec5743063b1` | `c1759ec6871308e53ce50bfce6328ccdb260fad71ffe7164587b9432207fc024` |

## Enforced gates

- Contract CI rejects any critical finding in the complete dependency tree.
- Contract CI rejects any high or critical finding in the production tree.
- Any deployment executor remains a separate security and operator approval
  gate; this change creates no deployment path and grants no credentials.
- MultX, Bridge signing, Swap, and Faucet remain disabled.
