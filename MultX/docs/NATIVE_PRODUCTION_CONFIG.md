# Disabled multi-origin native application configuration

`nativeProductionConfig.js` validates the server-side provider/source-policy map
for native swaps independently of the historical single-origin bridge manifest.
It supports the client-approved `evm-initial` phase (Ethereum, BNB and Base in all
directions) and a later `evm-litho` phase that adds LITHO 9005. Every chain is a
source and destination; each source policy must list every other phase chain.

The file must declare `enabled:false`. Loading it cannot mount the native Express
application, insert route records, deploy contracts or enable a route. Production
assembly must instantiate bounded providers from the validated HTTPS endpoints,
retain each source policy as disabled until its separately approved route records
are installed, and pass the maps to `createNativeApplication` only after the
deployment/review gates are complete.

Each chain record requires its exact bridge/wrapper addresses and runtime hashes,
confirmation depth, expiry and HTTPS approval evidence. `evm-litho` also requires
a compatibility-evidence URL for the selected Litho binary/configuration. Exact
DEX, settlement/backing, fees, caps, finality, custody and recovery remain immutable
database route-policy inputs; this config does not invent or approve them.

The older deployment-plan/manifest schemas still describe canonical-to-wrapped
token topologies. They must not be used to claim native mesh approval. The native
deployment and route records need an independently reviewed manifest after the
settlement/backing model and real addresses are supplied.
