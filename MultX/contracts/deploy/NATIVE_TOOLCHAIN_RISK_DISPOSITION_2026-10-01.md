# Native mesh build and deployment tool risk — 2026-10-01

The candidate was built and tested with the repository lockfile. A fresh
`npm audit --omit=dev --json` returned zero findings. The full toolchain audit
returned 34 findings: 16 low, 8 moderate, 10 high, and zero critical. These
findings are not present as JavaScript dependencies in deployed vault bytecode,
but the developer tools are used to compile, test, build evidence, and prepare
deployment calldata. Production risk acceptance is still required.

| Usage | Affected packages reported by the full audit | Required handling |
|---|---|---|
| Compile and test | Hardhat, solc, Mocha, chai matchers, coverage, and their transitive packages | Use an isolated, disposable build host, pinned lockfile and compiler; no production secrets or wallets in the build environment. Reproduce bytecode from the signed source commit and compare every artifact before deployment. |
| Deployment plan and read-only verification | ethers 5 and its transitive packages, including provider and big-number components | These scripts prepare calldata and read chain state only. Sign and broadcast the exact reviewed transaction through the separately controlled deployer; independently decode destination, value and calldata before signing. Verify canonical receipts and runtime after deployment. |
| Archive/network utilities in the development graph | adm-zip, ws, undici, tmp, brace-expansion, serialize-javascript and related transitive packages | Do not feed untrusted archives or URLs to the build/deployment ceremony. Use a fresh workspace, approved package source, fixed dependency versions and recorded install hashes. |

The default Hardhat configuration loads the coverage plugin only for the
`coverage` command; routine compilation and deployment-plan work do not need
it. `npm audit` findings must be rechecked at release time. Any remaining
finding on a tool that processes untrusted inputs or can access a signing key
needs an explicit owner disposition before a production ceremony. This file
records use and controls; it is not acceptance of the 34 findings.
