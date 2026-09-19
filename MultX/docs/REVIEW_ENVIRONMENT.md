# Portable candidate verification environment

The candidate runner uses only repository lockfiles plus locally installed Node,
Python, PostgreSQL and Chromium system dependencies. It creates a new temporary
PostgreSQL data directory for every core run, starts loopback-only Hardhat nodes,
refuses occupied ports and shuts every service down in `finally`. It never reads
deployment keys and must not be pointed at production endpoints.

Candidate packaging must run from a checkout with no tracked changes and no
eligible untracked source files. The packager reads source blobs from `HEAD`, not
from mutable working-tree paths, and records each Git blob identity and SHA-256.

## Clean reviewer setup

Install Python 3, Node/npm, PostgreSQL (including `initdb` and `pg_ctl`) and the
system libraries required by Playwright Chromium. Then, from the extracted source:

```text
cd MultX/api && npm ci
cd ../sdk && npm ci
cd ../contracts && npm ci
cd ../signer && npm ci
cd ../web && npm ci
npx playwright install chromium
```

The API lockfile pins `solc` 0.8.24 for local DEX fixture compilation. The helper
also checks the loaded compiler version. No separately downloaded compiler path is
needed.

If `node`, `npm`, `initdb` and `pg_ctl` are on `PATH`, run:

```text
python3 MultX/scripts/verify-native-candidate.py --phase all --evidence ./review-evidence
```

For unpacked/custom installations, configure paths and choose free ports:

```text
python3 MultX/scripts/verify-native-candidate.py \
  --phase all --evidence ./review-evidence \
  --node-bin-dir /opt/node/bin \
  --postgres-bin-dir /opt/postgresql/bin \
  --postgres-library-dir /opt/postgresql/lib \
  --postgres-pkglib-dir /opt/postgresql/lib/postgresql \
  --postgres-port 55449 --destination-port 18556 --source-port 18557 \
  --web-port 4188 --db-user multx_review
```

The path options also accept these environment variables:

- `MULTX_REVIEW_NODE_BIN_DIR`
- `MULTX_REVIEW_POSTGRES_BIN_DIR`
- `MULTX_REVIEW_POSTGRES_LIBRARY_DIR`
- `MULTX_REVIEW_POSTGRES_PKGLIB_DIR`
- `MULTX_REVIEW_BROWSER_LIBRARY_DIR`

Ports and database identity accept `MULTX_REVIEW_PG_PORT`,
`MULTX_REVIEW_SOURCE_PORT`, `MULTX_REVIEW_DESTINATION_PORT`,
`MULTX_REVIEW_WEB_PORT`, `MULTX_REVIEW_PG_USER` and
`MULTX_REVIEW_PG_DATABASE`. The runner passes exact loopback RPC/DB values to the
tests. Browser library overrides are optional; standard Playwright installations
should omit them.

`--api-tests test/name.js ...` runs selected API files in the same disposable lab.
The runner rejects paths outside `MultX/api/test`. Test output, commands, timings
and exit codes are written under the chosen evidence directory. Local Hardhat node
logs can expose well-known disposable test keys and are excluded by the candidate
packager.
