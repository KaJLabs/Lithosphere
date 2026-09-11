# Changelog

## [1.29.1](https://github.com/KaJLabs/Lithosphere/compare/v1.29.0...v1.29.1) (2026-09-11)


### Bug Fixes

* **multx:** harden contract toolchain dependencies ([8d7b403](https://github.com/KaJLabs/Lithosphere/commit/8d7b40355714dad3de29afecf0cdc600c2a31037))
* **multx:** harden contract toolchain dependencies ([2fed638](https://github.com/KaJLabs/Lithosphere/commit/2fed638c9f3bff26d19c1c46c8f4b9a61011bf29))

## [1.29.0](https://github.com/KaJLabs/Lithosphere/compare/v1.28.2...v1.29.0) (2026-09-09)


### Features

* **multx:** verify reviewed native LITHO precompile identity ([33f8808](https://github.com/KaJLabs/Lithosphere/commit/33f8808220d36d1e0c39bdb696e332c550f2dbf1))


### Bug Fixes

* **l1:** harden M03 release controls ([#165](https://github.com/KaJLabs/Lithosphere/issues/165)) ([ccdbc7c](https://github.com/KaJLabs/Lithosphere/commit/ccdbc7ccc0486bd9cdb57578e136f05266e6c5da))
* **multx:** bypass provider cache for reorg checkpoints ([152bad6](https://github.com/KaJLabs/Lithosphere/commit/152bad62199803035bfc2f7509189428d96fa06f))
* **multx:** enforce non-aws signer architecture ([#162](https://github.com/KaJLabs/Lithosphere/issues/162)) ([cb1a0e9](https://github.com/KaJLabs/Lithosphere/commit/cb1a0e993f5224a04d712f6dbac8a7accdb57517))
* **multx:** land reviewed stack on main with accepted lineage ([b54cb55](https://github.com/KaJLabs/Lithosphere/commit/b54cb55e62e8be92b8842a8b6485872ec7c9f015))
* **multx:** patch js-yaml audit finding in web lockfile ([f7556d3](https://github.com/KaJLabs/Lithosphere/commit/f7556d3dbf8e095f75b0238bf97e8da38b43d51c))
* **multx:** preserve accepted v0.9.2 lineage ([74f675d](https://github.com/KaJLabs/Lithosphere/commit/74f675d1478644f461c55ee465296d56c814e161))
* **multx:** reject inconsistent event ranges before cursor commit ([3020b1d](https://github.com/KaJLabs/Lithosphere/commit/3020b1d481096c6d010fa0a931dbee2b70c00a5d))
* **multx:** remediate Autha v0.9 governance and state findings ([1c23379](https://github.com/KaJLabs/Lithosphere/commit/1c23379723b19ed1a38a5f4a67192eac5958c86a))
* **multx:** reproduce archive bytecode and enforce closure regressions ([5994f26](https://github.com/KaJLabs/Lithosphere/commit/5994f263b9d1fd40c531410d6b23884eade9f5b9))
* **multx:** reproduce audited bytecode and close regression gaps ([#168](https://github.com/KaJLabs/Lithosphere/issues/168)) ([e7322e6](https://github.com/KaJLabs/Lithosphere/commit/e7322e6a3c98843e05379e6fa03796a712b8168a))
* **multx:** verify fresh source evidence before signing and release ([b0f9ca8](https://github.com/KaJLabs/Lithosphere/commit/b0f9ca8140e601370fbb1f15105c088eddc3a0c6))

## [1.28.2](https://github.com/KaJLabs/Lithosphere/compare/v1.28.1...v1.28.2) (2026-09-02)


### Bug Fixes

* **l1:** enforce pre-activation approval gate ([#156](https://github.com/KaJLabs/Lithosphere/issues/156)) ([dd55b50](https://github.com/KaJLabs/Lithosphere/commit/dd55b505f3ffc3dd6770931fb98aa64af90998fc))
* **mainnet:** protect controlled alert delivery ([#153](https://github.com/KaJLabs/Lithosphere/issues/153)) ([6bf8989](https://github.com/KaJLabs/Lithosphere/commit/6bf8989c443b931521de1b8e4d9b6e4615bd7411))

## [1.28.1](https://github.com/KaJLabs/Lithosphere/compare/v1.28.0...v1.28.1) (2026-09-02)


### Bug Fixes

* **multx:** close v0.8.1 audit blockers ([#150](https://github.com/KaJLabs/Lithosphere/issues/150)) ([f67ecfb](https://github.com/KaJLabs/Lithosphere/commit/f67ecfb1d0b3078e53c2eb39d6ba88e0ae373bdd))
* **pq:** close Phase 1 R1 audit findings ([#145](https://github.com/KaJLabs/Lithosphere/issues/145)) ([4b7f0f6](https://github.com/KaJLabs/Lithosphere/commit/4b7f0f6ede24e07859402a7538dfdbf5846ac182))


### Security

* **mainnet:** record RPC drift closure ([#147](https://github.com/KaJLabs/Lithosphere/issues/147)) ([4e01f43](https://github.com/KaJLabs/Lithosphere/commit/4e01f4391c652228cde37b4901d1ab0aea9c999d))


### Observability

* **mainnet:** prepare Telegram alert delivery ([#149](https://github.com/KaJLabs/Lithosphere/issues/149)) ([925fa92](https://github.com/KaJLabs/Lithosphere/commit/925fa928f3bc23dd86bc515a12462a471431f833))

## [1.28.0](https://github.com/KaJLabs/Lithosphere/compare/v1.27.1...v1.28.0) (2026-09-01)


### Features

* **auth:** server-validated Thanos sessions (/auth/me) ([0ca8f24](https://github.com/KaJLabs/Lithosphere/commit/0ca8f244eef65e6e2c452640fc5d579be5462561))
* **auth:** server-validated Thanos sessions (/auth/me) ([0062367](https://github.com/KaJLabs/Lithosphere/commit/0062367fc91062504570526becd0a35aec220923))
* **auth:** Sign in with Thanos (SIWE) ([eb59117](https://github.com/KaJLabs/Lithosphere/commit/eb591170b830c0d05aee989b3517b5ffd796a51a))
* **auth:** Sign in with Thanos (SIWE) ([6eb422f](https://github.com/KaJLabs/Lithosphere/commit/6eb422f0d42b133cf5db679a57500593ed9417a3))
* **bridge:** add external EVM destinations (Sepolia, Base, BNB) ([c77836e](https://github.com/KaJLabs/Lithosphere/commit/c77836e1c90b6cd904eab630a8398b45ef5e8c97))
* **bridge:** decode wallet/contract errors into actionable messages ([ff899c3](https://github.com/KaJLabs/Lithosphere/commit/ff899c3ac34dbc33928c7e2b3bf2a75735f9d947))
* **bridge:** decode wallet/contract errors into actionable messages ([18c10cb](https://github.com/KaJLabs/Lithosphere/commit/18c10cb965942a665ba3afc598aa00132c4ec3ca))
* **bridge:** external EVM destinations (Sepolia, Base, BNB) ([e9c09dd](https://github.com/KaJLabs/Lithosphere/commit/e9c09ddf10d593b1ca9c555e69044aa5347e5f98))
* **bridge:** MultX cross-chain bridge UI + API proxy ([dac1f34](https://github.com/KaJLabs/Lithosphere/commit/dac1f3424efb26ff6041a523c34f19704af4647c))
* **contracts:** harden Lithoswap V2 release gates ([f08fb46](https://github.com/KaJLabs/Lithosphere/commit/f08fb469bbe43e19cd79c38692928e6bcb220c6b))
* **contracts:** Lithoswap V2 DEX for Makalu (item 1 — native swap venue) ([1a8e3fa](https://github.com/KaJLabs/Lithosphere/commit/1a8e3fa2baea1c363a0f8d26ada2c441fe98c5dd))
* **contracts:** Lithoswap V2 DEX for Makalu (item 1 native swap venue) ([07b3796](https://github.com/KaJLabs/Lithosphere/commit/07b37969f00d97eaca17794c31a83546b60a1940))
* **dex:** Lithoswap V2 subgraph for Makalu pool/volume analytics ([7cc24f5](https://github.com/KaJLabs/Lithosphere/commit/7cc24f51a37e18081e3673a00c6511c42a342b45))
* **dex:** Lithoswap V2 subgraph for Makalu pool/volume analytics ([723ad9d](https://github.com/KaJLabs/Lithosphere/commit/723ad9d20690e0d1def5c2d7467f742e39aadf36))
* **dnns:** publish source and acceptance preflight ([cdd50e5](https://github.com/KaJLabs/Lithosphere/commit/cdd50e5694c7628c9ac1a8802ec70b7a54f182f0))
* **dnns:** publish source and acceptance preflight ([376aab5](https://github.com/KaJLabs/Lithosphere/commit/376aab5d8ddcca44b79ce4e039870e8c7ef7e510))
* **dnns:** resolve .litho names in explorer search ([93747d4](https://github.com/KaJLabs/Lithosphere/commit/93747d4e818ea2e040fce37acffe24940aaf32d2))
* **explorer:** footer credits LITHO Foundation with litho.foundation link ([4a92662](https://github.com/KaJLabs/Lithosphere/commit/4a9266270b9a61393983bbda02da61cf9a4510f1))
* **explorer:** NFT collections support + tx-value/hero UI fixes ([1646a22](https://github.com/KaJLabs/Lithosphere/commit/1646a22e0ca0ee716b550a00979bdeaf917e8103))
* **explorer:** show Lithosphere (litho1) address format ([22cb533](https://github.com/KaJLabs/Lithosphere/commit/22cb533d0907996a07da9c9f304d5c88c71bd839))
* **explorer:** show Lithosphere (litho1) format for addresses ([0c8df98](https://github.com/KaJLabs/Lithosphere/commit/0c8df98afd7c9c367b40e0cd46451170532f7a59))
* **explorer:** show Lithosphere bech32 addresses ahead of EVM ([3945369](https://github.com/KaJLabs/Lithosphere/commit/3945369d3e8d40962fb8929226e2e0e52a76f64e))
* **explorer:** show Lithosphere bech32 addresses ahead of EVM ([5fb6a25](https://github.com/KaJLabs/Lithosphere/commit/5fb6a2511464d0a3925c52b372e78efec5426dc9))
* **explorer:** Thanos sign-in also connects the wallet ([#58](https://github.com/KaJLabs/Lithosphere/issues/58)) ([f3a6ff7](https://github.com/KaJLabs/Lithosphere/commit/f3a6ff7b90e268ef84320bb1b2a90e4a098ab421))
* **explorer:** Thanos sign-in connects directly, sign-out disconnects wallet ([#59](https://github.com/KaJLabs/Lithosphere/issues/59)) ([912c768](https://github.com/KaJLabs/Lithosphere/commit/912c768228a180d493965645d0ad86a9d9b89cca))
* **explorer:** wallet menu links + Litho symbol balance ([62d1c65](https://github.com/KaJLabs/Lithosphere/commit/62d1c657cd5cc61141d66a9c31908d7ebf9943ed))
* **faucet:** fail closed for underfunded assets ([ef50928](https://github.com/KaJLabs/Lithosphere/commit/ef5092812cddc591836657cea6197f8aa2f46fac))
* **faucet:** fail closed for underfunded assets ([c83910f](https://github.com/KaJLabs/Lithosphere/commit/c83910f8022ff90f17aeffdfec4a2b19feb6b4b5))
* **faucet:** gate claims behind Thanos sign-in ([99e2362](https://github.com/KaJLabs/Lithosphere/commit/99e23624a3bf15d627503a0e1625db938a1340ec))
* **faucet:** gate claims behind Thanos sign-in ([db2de58](https://github.com/KaJLabs/Lithosphere/commit/db2de58e861ba33ea71d0821d88fb8d709955e4c))
* **infra:** add mainnet progression monitoring ([da6b5cf](https://github.com/KaJLabs/Lithosphere/commit/da6b5cff0ca934cd83eae0f4223a99cc4615bcd0))
* **infra:** gate 33-validator onboarding ([273e7b4](https://github.com/KaJLabs/Lithosphere/commit/273e7b4e5018f9b00a4dc0dd66d76d793dca7603))
* **infra:** prepare encrypted validator backups ([ae77262](https://github.com/KaJLabs/Lithosphere/commit/ae7726268c2facad99e6dd1087aa61c636903341))
* **infra:** restrict mainnet monitor access ([fc2e93c](https://github.com/KaJLabs/Lithosphere/commit/fc2e93cbb03a735c122e8dd9e4f2bf0a4287fbe4))
* **makalu:** harden Thanos wallet discovery ([#83](https://github.com/KaJLabs/Lithosphere/issues/83)) ([6ded419](https://github.com/KaJLabs/Lithosphere/commit/6ded419ca7034f9ded110255dd1a2683d3399029))
* **monitoring:** alert when faucet wallet balance is low ([cec562b](https://github.com/KaJLabs/Lithosphere/commit/cec562b1754821f2d03908bc63bd3d7f722f394c))
* **monitoring:** alert when faucet wallet balance is low ([abfcba3](https://github.com/KaJLabs/Lithosphere/commit/abfcba3d76e0c6bddc622475c2e745b867d915b3))
* **multx:** add disabled Fargate production signer candidate ([0d7620d](https://github.com/KaJLabs/Lithosphere/commit/0d7620d8bb4d5dd1b433e05ae64de8cf01f0e762))
* **multx:** add disabled Fargate production signer candidate ([4ca4c02](https://github.com/KaJLabs/Lithosphere/commit/4ca4c0212840936d8eebd73a1ebd9b14f02809bb))
* **multx:** add isolated AWS Fargate KMS verifiers ([#115](https://github.com/KaJLabs/Lithosphere/issues/115)) ([59f8e23](https://github.com/KaJLabs/Lithosphere/commit/59f8e23794ea8133f039e49dc98dfa06a5a1e257))
* **multx:** add VPS-only remote signer quorum ([5b5d230](https://github.com/KaJLabs/Lithosphere/commit/5b5d23080d8da42b477f5b2ab2c57741e70406d4))
* **multx:** consolidate source and mainnet infrastructure ([5db05ad](https://github.com/KaJLabs/Lithosphere/commit/5db05ad0e5fc396b0a1c532dff84d5d69f06adee))
* **multx:** consolidate source and mainnet infrastructure ([f32e576](https://github.com/KaJLabs/Lithosphere/commit/f32e5760d86b133b64afb03081e3bdd559e4798f))
* **multx:** gate mainnet deployment evidence ([3571f24](https://github.com/KaJLabs/Lithosphere/commit/3571f241819e21c018e88225db6930204f4f30d0))
* **multx:** gate mainnet deployment evidence ([b88617f](https://github.com/KaJLabs/Lithosphere/commit/b88617f88b0868e0eaed5238a329f2b131bbd1af))
* **multx:** gate paused v0.5 testnet redeployments ([5570c95](https://github.com/KaJLabs/Lithosphere/commit/5570c959c4dc746a5fdae28c859318d963b0a7ae))
* **multx:** gate paused v05 testnet redeployments ([0898f2f](https://github.com/KaJLabs/Lithosphere/commit/0898f2fa5f71f600312edcb029ab4f9ef9ed5add))
* **pq:** add phase 1 conformance candidate ([#137](https://github.com/KaJLabs/Lithosphere/issues/137)) ([849e3d7](https://github.com/KaJLabs/Lithosphere/commit/849e3d78492ebd4136f9bbaf24208284d4218841))
* prepare seven-validator migration gates ([52b8e0a](https://github.com/KaJLabs/Lithosphere/commit/52b8e0a720c7945de9e1071f9db74d497bed22c5))
* prepare seven-validator migration gates ([b45006c](https://github.com/KaJLabs/Lithosphere/commit/b45006c8e4b97b2cbdbcd87ac7528040c271bd88))
* **sdk:** implement layered @lithosphere/blockchain-core + @lithosphere/sdk ([4701d55](https://github.com/KaJLabs/Lithosphere/commit/4701d55a81d8fa6674a22e264db7887149524afd))
* **toolchain:** add conservative lithc checks ([cf68f7c](https://github.com/KaJLabs/Lithosphere/commit/cf68f7c001cd6a847f806cac09659bf72380bda2))
* **toolchain:** add conservative lithc checks ([d675555](https://github.com/KaJLabs/Lithosphere/commit/d6755554603df8397231a6cfa83e417a31f4cdfd))
* **toolchain:** add safe lithdev v0 boundary ([d6d1a26](https://github.com/KaJLabs/Lithosphere/commit/d6d1a26b41aecce6ed17c7213b56528ef6fce90e))
* **toolchain:** add safe lithdev v0 boundary ([af1c3a6](https://github.com/KaJLabs/Lithosphere/commit/af1c3a60b4d8be34c8024555ae2b7c88b1a1d12c))
* **toolchain:** scaffold lithc Rust toolchain ([e0dbcf6](https://github.com/KaJLabs/Lithosphere/commit/e0dbcf6795f879bf7d0092fff419cba10049bd44))


### Bug Fixes

* **api,explorer:** live-RPC balance for unindexed addrs; hide Sign In when connected ([195d225](https://github.com/KaJLabs/Lithosphere/commit/195d2259b095bf68068feecaaa068e29db125fe8))
* **api,explorer:** live-RPC balance for unindexed wallets; hide Sign In when connected ([1140376](https://github.com/KaJLabs/Lithosphere/commit/1140376daf313c4920c94d2ea37c200b67766572))
* **api:** count current token holders, not historical participants ([7fe3447](https://github.com/KaJLabs/Lithosphere/commit/7fe344758754dc497ce071f049ecd356bb77776d))
* **api:** dedupe /tokens by lower(address) (casing duplicates) ([16a47a0](https://github.com/KaJLabs/Lithosphere/commit/16a47a01f509b636c2069e87d04b8f7a586f2593))
* **api:** dedupe /tokens by lower(address) to drop casing duplicates ([318f2a6](https://github.com/KaJLabs/Lithosphere/commit/318f2a60ac7f97e86a643c8ef4db7cf55363d1e8))
* **api:** exclude NFT contracts from /tokens list ([c147a4e](https://github.com/KaJLabs/Lithosphere/commit/c147a4e8341c150ca217d000362421b89c1cbba1))
* **api:** exclude NFT contracts from /tokens list ([0b157bf](https://github.com/KaJLabs/Lithosphere/commit/0b157bfee737b0ef80ee10bdfd8f39efc4588f01))
* **api:** prevent infinite proxy loop for unmatched /api/* routes ([258e054](https://github.com/KaJLabs/Lithosphere/commit/258e054d5c4bd8b00407966489415f87c1bc89dd))
* **api:** prevent infinite proxy loop for unmatched /api/* routes ([f2b0d7f](https://github.com/KaJLabs/Lithosphere/commit/f2b0d7fa036108110ca8e6a11b02fca011183ae9))
* **api:** resolve bech32 contract addresses on /tokens routes ([692c717](https://github.com/KaJLabs/Lithosphere/commit/692c717d5315f259b560f50dccab17ca93e97e38))
* **api:** resolve bech32 contract addresses on /tokens routes ([ccc4d5b](https://github.com/KaJLabs/Lithosphere/commit/ccc4d5bec69c198a3f66325e86e99f10b18f19f3))
* **api:** serve /api/version from Express so the deploy health gate passes ([bf9fd60](https://github.com/KaJLabs/Lithosphere/commit/bf9fd6038bc9a61dd464b2fa6d4446c1fa078845))
* **api:** serve /api/version from Express so the deploy health gate passes ([05c7287](https://github.com/KaJLabs/Lithosphere/commit/05c7287de9ff1c752e01948e77b14fedaf4769d8))
* **api:** stop /stats/summary 500ing on the slow distinct-wallet aggregate ([737c90d](https://github.com/KaJLabs/Lithosphere/commit/737c90d5c7b5c1ec5dce512edbcfcfeba9fa6725))
* **api:** stop /stats/summary 500ing on the slow distinct-wallet aggregate ([bfaa935](https://github.com/KaJLabs/Lithosphere/commit/bfaa93551262068e51d95176203b20e019553d4e))
* **bridge:** correct BNB dest bridge address (+ coming-soon guard rails) ([6c03173](https://github.com/KaJLabs/Lithosphere/commit/6c03173204cff20a69fdf41017a8899569249c01))
* **bridge:** correct BNB dest bridge address; add coming-soon guard rails ([c1e6512](https://github.com/KaJLabs/Lithosphere/commit/c1e651246cb77ac10c12be76d95ab60a387803a3))
* **bridge:** hard-verify wallet chain after switch before approve/lock ([b7a2314](https://github.com/KaJLabs/Lithosphere/commit/b7a2314c42c896a472d20e98c3b8b865cbddfd29))
* **bridge:** hard-verify wallet chain after switch before approve/lock ([7aacc73](https://github.com/KaJLabs/Lithosphere/commit/7aacc736cac8ead9af817ed7b9a69ee7162ffeb8))
* **chain-id:** rip out stale lithosphere_700777-1 from live surfaces ([3a14b0e](https://github.com/KaJLabs/Lithosphere/commit/3a14b0ecd3feb0470ce079a2856dc3c3471353c6))
* **ci:** build MultX web from consolidated layout ([6d89305](https://github.com/KaJLabs/Lithosphere/commit/6d893058dbf7e83c420ce243eac064545f2c1b4e))
* **ci:** build sdk-template's workspace deps before the template itself ([08c29ee](https://github.com/KaJLabs/Lithosphere/commit/08c29ee71462d67f5de1f52bf51ba4205b5a9556))
* **ci:** invoke pinned promtool entrypoint ([452e683](https://github.com/KaJLabs/Lithosphere/commit/452e6831d2f13d04222aba83ad575bf05b4cf4ce))
* **ci:** make required status checks reportable on every PR ([e403b4f](https://github.com/KaJLabs/Lithosphere/commit/e403b4fa49ab48173c0d7af50cf458a3e2a7b356))
* **ci:** make required status checks reportable on every PR ([a49ccfb](https://github.com/KaJLabs/Lithosphere/commit/a49ccfb3aadccbe1c7e7efb0c4fb57a24d86824f))
* **ci:** quote Slither step name — colon broke YAML parser ([04ba66d](https://github.com/KaJLabs/Lithosphere/commit/04ba66d97a456342f4b701ad272b1dc296c44211))
* **ci:** rename duplicate Lint check in ci-contracts ([56f3f0a](https://github.com/KaJLabs/Lithosphere/commit/56f3f0ad18db0c4c4893e0abc7e3124b2be98fb2))
* **ci:** rename duplicate Lint check in ci-contracts ([d62545e](https://github.com/KaJLabs/Lithosphere/commit/d62545e8223a5b5a9548f57d3e3bf7bf6ab7a207))
* **ci:** rename duplicate Test check in ci-contracts ([bf8a319](https://github.com/KaJLabs/Lithosphere/commit/bf8a3191ec6ed80632ad9158cf5c2389611a42c9))
* **ci:** rename duplicate Test check in ci-contracts ([a8b2d83](https://github.com/KaJLabs/Lithosphere/commit/a8b2d83b606516090819db9caaabc08df968a9d0))
* **ci:** repair frozen-lockfile install + sync OpenAPI route set ([810fb50](https://github.com/KaJLabs/Lithosphere/commit/810fb50ec0c7dae05137d7aede086d598c23f85f))
* **ci:** repair frozen-lockfile install + sync OpenAPI route set ([f84c3a9](https://github.com/KaJLabs/Lithosphere/commit/f84c3a9bc0afa31b567a213c6d4a8fba3fee7b1f))
* **ci:** repair pre-existing Test + Lint failures exposed once install works ([47abf04](https://github.com/KaJLabs/Lithosphere/commit/47abf04e936baf3092f07cf1487f4324dfbde720))
* **deploy:** allow current mainnet block heights ([d338c9c](https://github.com/KaJLabs/Lithosphere/commit/d338c9c132f3fbe4d78d374886543b470df5fe95))
* **deploy:** reach indexer /version via docker exec, not host curl ([6e02878](https://github.com/KaJLabs/Lithosphere/commit/6e02878ef128b5fb4a0ad486c83686f0a42a5686))
* **explorer:** block stat overlap + reliable header balance/sign-in ([a3936de](https://github.com/KaJLabs/Lithosphere/commit/a3936deabd75d8cb389c5bb41cc5411fa6d98b78))
* **explorer:** block stat overlap + reliable header balance/sign-in ([c476928](https://github.com/KaJLabs/Lithosphere/commit/c476928808759bcdbc0267cedef896058f23955b))
* **explorer:** header balance, sign-in label, and block spacing ([345232a](https://github.com/KaJLabs/Lithosphere/commit/345232a2c31429ada50a56258a3998b3ef42f89a))
* **explorer:** improve light theme contrast ([dd26c56](https://github.com/KaJLabs/Lithosphere/commit/dd26c56e26a0bec36ff1cdcd8b3b2a57d466982c))
* **explorer:** Litho-first contract address in token info cards ([843a790](https://github.com/KaJLabs/Lithosphere/commit/843a79088855ff43fd7f777a157ca9bef54b917c))
* **explorer:** Litho-first contract address in token info cards ([9d046dd](https://github.com/KaJLabs/Lithosphere/commit/9d046dd877afc0e9b622dff69d98dc4a4d88a4b6))
* **explorer:** resolve header balance, sign-in label, and block spacing ([df6f447](https://github.com/KaJLabs/Lithosphere/commit/df6f44765616e520f1231ea8057901761ab06b78))
* **explorer:** revert OTel instrumentation to unblock deploys ([a9d2a6d](https://github.com/KaJLabs/Lithosphere/commit/a9d2a6d6bc49787ede4ef9dcfcbf425952c4ff44))
* **explorer:** route Add to Wallet through the connected wallet; fit the header pill ([a0ebcec](https://github.com/KaJLabs/Lithosphere/commit/a0ebcec8aa20f7b58462f39dfce277fb14b19e0d))
* **explorer:** route Add to Wallet through the connected wallet; fit the header pill ([f3ff1bf](https://github.com/KaJLabs/Lithosphere/commit/f3ff1bf06ab53c705cf00ef6f375ed222d8f6b53))
* **explorer:** stop network-switch nag on bridge chains ([cf19144](https://github.com/KaJLabs/Lithosphere/commit/cf191449f9499f6b7c6126fb5d08f9a2fe8d1f69))
* **explorer:** stop network-switch nag on bridge chains ([a31d88c](https://github.com/KaJLabs/Lithosphere/commit/a31d88c2a1a9676566c0e31345a8e78994c80638))
* **explorer:** use blue mainnet favicon ([6b747da](https://github.com/KaJLabs/Lithosphere/commit/6b747da175701c0d5e9cf4cbbe4a17c5b96106ec))
* **faucet:** fail closed on invalid production state ([#122](https://github.com/KaJLabs/Lithosphere/issues/122)) ([b1ad4ae](https://github.com/KaJLabs/Lithosphere/commit/b1ad4ae8829a666b91b2279d786b0ca829087bf5))
* **faucet:** make health check resilient + diagnosable; document wallet IDs ([19596a2](https://github.com/KaJLabs/Lithosphere/commit/19596a294320c3e2cc2b7d73a5938ec5f59e4045))
* **forge:** profile selection via FOUNDRY_PROFILE env, not --profile flag ([d5c1971](https://github.com/KaJLabs/Lithosphere/commit/d5c19710c0fca6b951ce2035a03f94e1a977682a))
* **holders:** count current native LITHO owners, not historical participants ([e90f92d](https://github.com/KaJLabs/Lithosphere/commit/e90f92d27815589a401da424841b5c555d44333c))
* **indexer:** bind /version + /health before DB wait ([f0aff8f](https://github.com/KaJLabs/Lithosphere/commit/f0aff8f012030564a7ab76c6db283a557cfcd48a))
* **indexer:** isolate token registries by chain ([a5e2b9d](https://github.com/KaJLabs/Lithosphere/commit/a5e2b9de857b7cc7a7df2707c2770a57d0f2eb9e))
* **indexer:** isolate token registries by chain ([beb7ec0](https://github.com/KaJLabs/Lithosphere/commit/beb7ec05aa38ea55efd8877cabc4fad8d325a255))
* **indexer:** populate accounts.evm_address so native holder count is real ([90ae439](https://github.com/KaJLabs/Lithosphere/commit/90ae439a5923e7d0831ce065e72b0853cecca93f))
* **indexer:** populate accounts.evm_address so native holder count is real ([620e5fd](https://github.com/KaJLabs/Lithosphere/commit/620e5fd10d8861836f198d819f1d6b1fa225b765))
* **indexer:** reclassify NFT contracts regardless of prior 'token' tag ([f202163](https://github.com/KaJLabs/Lithosphere/commit/f2021639752c7176f440f9ba8330f5de94cc242e))
* **indexer:** reclassify NFT contracts regardless of prior 'token' tag ([b152ef7](https://github.com/KaJLabs/Lithosphere/commit/b152ef756cebaa4be0144337f766a98cc370d708))
* **infra:** harden mainnet RPC recovery ([f2fdf3b](https://github.com/KaJLabs/Lithosphere/commit/f2fdf3b19f3edeedc6867741121e762205b95d0b))
* **integration:** add sslmode=disable to test DATABASE_URL ([133c417](https://github.com/KaJLabs/Lithosphere/commit/133c417d85bb307ba05253f3581ba764b4f02451))
* **l1:** close Autha implementation audit findings ([#135](https://github.com/KaJLabs/Lithosphere/issues/135)) ([0029b44](https://github.com/KaJLabs/Lithosphere/commit/0029b440df87d912490ee77de11d310f196850bc))
* **mainnet:** require independent backup recipients ([#139](https://github.com/KaJLabs/Lithosphere/issues/139)) ([a1e7bb1](https://github.com/KaJLabs/Lithosphere/commit/a1e7bb1c40e05e6b9420d39383a06c787d128acb))
* **makalu:** harden DNNS resolution ([c5448da](https://github.com/KaJLabs/Lithosphere/commit/c5448da8c617cf06083f9c08be7e08bd1b5cb6b2))
* **makalu:** harden DNNS resolution ([f61d3d1](https://github.com/KaJLabs/Lithosphere/commit/f61d3d15659da02713ea416acdf3eece1c763443))
* **makalu:** isolate core deploy from faucet gate ([#84](https://github.com/KaJLabs/Lithosphere/issues/84)) ([4fdb3ca](https://github.com/KaJLabs/Lithosphere/commit/4fdb3ca5a4bcb0d24978189ce158028ae6247984))
* **makalu:** require explicit Quantt contract settings ([c01ec48](https://github.com/KaJLabs/Lithosphere/commit/c01ec48472544270ec0716483e5a07bba947b079))
* **makalu:** require explicit Quantt contract settings ([18f2abf](https://github.com/KaJLabs/Lithosphere/commit/18f2abfbe583c69d1432742ee2848176d412b8a6))
* **multx:** allow policy-free disabled signer canary ([bfb180e](https://github.com/KaJLabs/Lithosphere/commit/bfb180e7c9ab916d623aa12fdd8d183704dba1ca))
* **multx:** bind releases to destination domain ([6ae4d3a](https://github.com/KaJLabs/Lithosphere/commit/6ae4d3a9dd0edb69a4426a1dde7d7933de2abe1d))
* **multx:** close Autha v0.8 deployment findings ([#129](https://github.com/KaJLabs/Lithosphere/issues/129)) ([6ab0dcb](https://github.com/KaJLabs/Lithosphere/commit/6ab0dcb0774421d6d57895b302ab8cc5b73d1762))
* **multx:** enforce approved deployment window ([6fa03fb](https://github.com/KaJLabs/Lithosphere/commit/6fa03fbd6c8cb50b45b4f1177d2638a79a59e70f))
* **multx:** harden mainnet deployment gates ([620e300](https://github.com/KaJLabs/Lithosphere/commit/620e300bce9c7d967ace6a778ba7ee84e79e5d86))
* **multx:** harden provider-neutral signer quorum ([60f3f7b](https://github.com/KaJLabs/Lithosphere/commit/60f3f7bb151e9e2be48632468212e602220f40f4))
* **multx:** harden provider-neutral signer quorum ([eafc76a](https://github.com/KaJLabs/Lithosphere/commit/eafc76af9c30c13809fd3a22af87b431517d8ccb))
* **multx:** remediate Autha v0 audit findings ([#125](https://github.com/KaJLabs/Lithosphere/issues/125)) ([41f0cf1](https://github.com/KaJLabs/Lithosphere/commit/41f0cf1c9b5028874ef40e541c44864569ad9868))
* **multx:** remediate Autha v0.7 blockers ([b2e156e](https://github.com/KaJLabs/Lithosphere/commit/b2e156eeaef2ccf031ace01bd813ad04430bbb33))
* **multx:** remediate Autha v0.7 blockers ([f70a6ed](https://github.com/KaJLabs/Lithosphere/commit/f70a6edf5ef575c7ab1b16f02c67b0b03daae40c))
* **multx:** resolve SDK dependencies in container build ([aa22e7e](https://github.com/KaJLabs/Lithosphere/commit/aa22e7e6036f1f08116a147b0dab0f6beeafd85a))
* **multx:** upgrade signer services to ethers v6 ([1ca6e63](https://github.com/KaJLabs/Lithosphere/commit/1ca6e63e1c87d743cdfd042811bbce633cf51b34))
* **pq:** close Autha R8 freeze evidence ([#136](https://github.com/KaJLabs/Lithosphere/issues/136)) ([1d07c91](https://github.com/KaJLabs/Lithosphere/commit/1d07c916f5b4bcc18f67cce2f509d76598a2b296))
* restore public repository boundary gates ([12a97fa](https://github.com/KaJLabs/Lithosphere/commit/12a97fac0f2a7448860ea724dcedc68d8cf87133))
* **sdk:** migrate MultX client to ethers v6 ([6295f76](https://github.com/KaJLabs/Lithosphere/commit/6295f766099f9c72e959513b21fc2c7820889f6d))
* show token holders in litho format; name unindexed tokens on tx pages ([a70edcb](https://github.com/KaJLabs/Lithosphere/commit/a70edcbc778c7fa303d050428657ed2ccc24baed))
* show token holders in litho format; name unindexed tokens on tx pages ([480a855](https://github.com/KaJLabs/Lithosphere/commit/480a85534c184a23d1f68ae2b87c7a6b6f0dfb64))
* **slither:** also convert printers_to_run + detectors_to_exclude to strings ([67a4053](https://github.com/KaJLabs/Lithosphere/commit/67a4053c376d5e228e749d4639eae57018664ddc))
* **slither:** filter_paths must be a comma-separated string, not a list ([8111e19](https://github.com/KaJLabs/Lithosphere/commit/8111e195f3b21b7e41a85ceee022030384635ef8))
* **subgraph:** remediate build dependency advisories ([4e6b759](https://github.com/KaJLabs/Lithosphere/commit/4e6b7598807b7ed11ff78f3be39525037a1eb349))
* **subgraph:** remediate build dependency advisories ([701f191](https://github.com/KaJLabs/Lithosphere/commit/701f19183ddb94d4ce4b227374d1d4d377b8bc0b))
* **thanos:** normalize wallet signature return before verify ([a3a89de](https://github.com/KaJLabs/Lithosphere/commit/a3a89deb0273d57ce8df2aff669e6e76b9806a10))
* **thanos:** normalize wallet signature return before verify ([1297a46](https://github.com/KaJLabs/Lithosphere/commit/1297a4623a1f826d920aa21148d6d5c2981bff68))
* **thanos:** sign SIWE via hex payload to dodge extension BytesLike bug ([d3abe97](https://github.com/KaJLabs/Lithosphere/commit/d3abe9745d734f528b39bcf04f2ee819854b43ee))
* **thanos:** sign SIWE via hex payload to dodge extension BytesLike bug ([c6abde6](https://github.com/KaJLabs/Lithosphere/commit/c6abde618c8c7341eb889000e10389421c92eb40))
* **tokens:** correct swapped FGPT/MUSA token metadata to match on-chain ([e52c76a](https://github.com/KaJLabs/Lithosphere/commit/e52c76ad49641f5dbfa869cf8b85690745fbff4b))
* **toolchain:** checksum macOS preview ([0c7cbf9](https://github.com/KaJLabs/Lithosphere/commit/0c7cbf91b3e845dc08af83761be91a9a74d177af))
* **toolchain:** clear expected boundary exit ([c9e4eb7](https://github.com/KaJLabs/Lithosphere/commit/c9e4eb736afac0ae0b9daea0321f6e829c1b368e))
* **toolchain:** harden lithlint v0 boundaries ([0e70108](https://github.com/KaJLabs/Lithosphere/commit/0e70108e59f3f68ccae1f90ae38c4d831bd1c389))
* **toolchain:** harden lithlint v0 boundaries ([c5fad7d](https://github.com/KaJLabs/Lithosphere/commit/c5fad7d8f7705f292596aac7a8d80a063c4458df))
* **toolchain:** match complete help output ([81ae816](https://github.com/KaJLabs/Lithosphere/commit/81ae816dfb3ddd79e016d7325af3d4119b6be62e))
* **toolchain:** preserve literals in lithfmt ([f8bbb2d](https://github.com/KaJLabs/Lithosphere/commit/f8bbb2d642638158c79c9fe22235d9766ab51a2a))
* **toolchain:** preserve literals in lithfmt ([9ebcc78](https://github.com/KaJLabs/Lithosphere/commit/9ebcc7862c469d6aa251dd247112394d6901041d))
* **toolchain:** verify common help boundary ([17fa698](https://github.com/KaJLabs/Lithosphere/commit/17fa698da2665e9570977f31742d9f9b8b2c83a3))
* **wallet:** add Kamet to Web3Modal supported chains ([e221f28](https://github.com/KaJLabs/Lithosphere/commit/e221f28fb21e81b8a0b7d290d4c877e7e225ac87))
* **wallet:** whitelist bridge dest chains to stop unsupported-network nag ([e3115c7](https://github.com/KaJLabs/Lithosphere/commit/e3115c7a6bcaa5755271101a69d9f5a764fd05bf))
* **wallet:** whitelist bridge dest chains to stop unsupported-network nag ([204e812](https://github.com/KaJLabs/Lithosphere/commit/204e8128c5794523d93b6eeb55778c52ec766c6b))
* **web:** harden wallet dependency stack ([4c94d3f](https://github.com/KaJLabs/Lithosphere/commit/4c94d3fbfcf70130c7d3522f34886e233f50a74c))


### Performance

* **api:** build DB performance indexes from API startup (fixes slow /txs) ([ef1bdf6](https://github.com/KaJLabs/Lithosphere/commit/ef1bdf6c5803fa2b5a9499e212822a510dc13e13))
* **api:** build DB performance indexes from API startup to fix slow /txs ([74a821f](https://github.com/KaJLabs/Lithosphere/commit/74a821f155f9155ab24d4220901ed5a5e578f90d))
* **api:** cache inconsistent-blocks CTE off /stats/summary hot path ([bc8e44a](https://github.com/KaJLabs/Lithosphere/commit/bc8e44a73d0fae9e775e1c18bd67310046baac31))
* **api:** cache inconsistent-blocks CTE off the /stats/summary hot path ([76988d1](https://github.com/KaJLabs/Lithosphere/commit/76988d1f2c0ce9a01bd87f8a987b52d65a941c85))
* **api:** give heavy stats counts a long TTL so /stats/summary stops re-scanning ([9b75aae](https://github.com/KaJLabs/Lithosphere/commit/9b75aae2e68dbc2d08c7255c5b1fa77a8b50337a))
* **api:** long TTL for heavy stats counts (wallet-addresses, tx-total) ([981c08e](https://github.com/KaJLabs/Lithosphere/commit/981c08e60888602cebe3c668dd3a56a27552d775))
* **api:** Redis-backed shared cache for /stats/summary across replicas ([bfc2f65](https://github.com/KaJLabs/Lithosphere/commit/bfc2f6505a21c86a6426ec38031faca498c6900f))
* **api:** Redis-backed shared cache for /stats/summary across replicas ([2a831bb](https://github.com/KaJLabs/Lithosphere/commit/2a831bb8c9e268f5b77a0c0bc6a0d36dcb9b3e38))
* **api:** remove per-row EVM RPC calls from /txs list; cache stats + token stats ([7c58fc2](https://github.com/KaJLabs/Lithosphere/commit/7c58fc23fc1ca6fba0065014d833e550857b9199))
* **api:** speed up /txs and homepage transaction loading ([3e9366b](https://github.com/KaJLabs/Lithosphere/commit/3e9366bc2ce10b7e430a7426dd500d71dcffc50a))
* **db:** add missing blocks indexes (block_time, proposer) for fast /stats/summary ([1b6c60f](https://github.com/KaJLabs/Lithosphere/commit/1b6c60f1aa0ceb145dfd9febbe4679144b830e1e))
* **db:** add missing blocks indexes (block_time, proposer) to fix slow /stats/summary ([1405792](https://github.com/KaJLabs/Lithosphere/commit/1405792ce7e3abc118195d76b792fab575cb09a3))
* **indexer:** ensure DB performance indexes at startup to fix slow /txs ([5298905](https://github.com/KaJLabs/Lithosphere/commit/5298905d50352ec65de85e2975882239ccde1d19))
* **indexer:** ensure performance indexes at startup to fix slow /txs ([b387a46](https://github.com/KaJLabs/Lithosphere/commit/b387a46715f65442c15d0d271b7c09e5034776ea))


### Security

* bump explorer's @coinbase/wallet-sdk to 4.3.7 (was 4.0.3 via web3modal) ([e9a1e8e](https://github.com/KaJLabs/Lithosphere/commit/e9a1e8ec777a5649ae6f0c9b50812a975864a8dc))
* **images:** strip bundled npm from api/indexer/explorer runner stages ([af4a18d](https://github.com/KaJLabs/Lithosphere/commit/af4a18d6d465d5eedf6e3573bed3a7170a62c0d7))
* **infra:** remove production topology from public config ([ce29bda](https://github.com/KaJLabs/Lithosphere/commit/ce29bdac5ca591c52fe865a1c2972963405eb50f))
* **l1:** backport Cosmos EVM StateDB guard ([#132](https://github.com/KaJLabs/Lithosphere/issues/132)) ([272ea76](https://github.com/KaJLabs/Lithosphere/commit/272ea76c5fa0be2b2e66b55c9968678e0c431314))
* **p10:** add pre-construction path check for CodeQL js/request-forgery ([a01f4dc](https://github.com/KaJLabs/Lithosphere/commit/a01f4dc9b179bc23bcfe38fb2a339374760c0c37))
* **p10:** close remaining 12 CodeQL alerts (4 fixed, 8 dismissed) ([38649a3](https://github.com/KaJLabs/Lithosphere/commit/38649a37b527186a5c7f3ffa77389b0e20703975))
* **p10:** CodeQL SAST for the JS/TS surface ([84bbbf0](https://github.com/KaJLabs/Lithosphere/commit/84bbbf08fd4451e63556d3487142977e263d8002))
* **p10:** license allow/deny policy + CI gate ([a625789](https://github.com/KaJLabs/Lithosphere/commit/a625789423f60dd1a3211bde36aea80aa53dee90))
* **p10:** make sanitizeForLog match CodeQL's recognised sanitizer pattern ([5201549](https://github.com/KaJLabs/Lithosphere/commit/52015494a0eac5bfc15ad372e6205a62c42ca117))
* **p10:** SLSA Build L2 build-provenance attestation on published images ([5410d66](https://github.com/KaJLabs/Lithosphere/commit/5410d662536d0805cc53a4193d646e005441f92f))
* **p10:** triage CodeQL first-scan — fix 8/23 at source ([ae2c0c7](https://github.com/KaJLabs/Lithosphere/commit/ae2c0c74cce55571625f72caf66afec339665441))
* **p7:** flip production Slither from advisory to blocking ([1e82620](https://github.com/KaJLabs/Lithosphere/commit/1e826203c8bf9afb7b0e0bef3eadc16163e22c14))
* **p7:** run Slither against production contracts, not just template ([22aa7a6](https://github.com/KaJLabs/Lithosphere/commit/22aa7a6ad9d6a2401f9cf330a42ece4ce7a0e2e5))
* prepare LITHO L1 dependency upgrade candidate ([#130](https://github.com/KaJLabs/Lithosphere/issues/130)) ([1b44f55](https://github.com/KaJLabs/Lithosphere/commit/1b44f550ad926e4544d206add47db644ea1f6aae))
* **repo:** sanitize legacy operational topology ([26db790](https://github.com/KaJLabs/Lithosphere/commit/26db79042e6ff8305ab71f1881cfcd142e66383f))


### Observability

* **p10:** typed audit-trail channel for security-sensitive actions ([5f7499b](https://github.com/KaJLabs/Lithosphere/commit/5f7499b7fc03dc7f9800f8e182c0211c807a04e7))
* **p9:** Cost dashboard — VPS spend visibility for operators ([25902f5](https://github.com/KaJLabs/Lithosphere/commit/25902f5cba242bbf8710185a5477da938061b342))
* **p9:** explorer instrumentation.ts + /api/version ([f8109de](https://github.com/KaJLabs/Lithosphere/commit/f8109de638ef8e5ba120f043a3e31e2454dd0839))
* **p9:** HTTP request metrics + SLO Grafana dashboard ([635cbd9](https://github.com/KaJLabs/Lithosphere/commit/635cbd99cf734975143b4493c8e7b1bec1c4870a))
* **p9:** propagate build metadata commit -&gt; image -&gt; running container ([20f0233](https://github.com/KaJLabs/Lithosphere/commit/20f02336cbae06d216aab69bae9ec6a7d7dfb870))
* **p9:** structured JSON logging + request-id correlation ([8bf7fda](https://github.com/KaJLabs/Lithosphere/commit/8bf7fda2a74465cd8e4c90c3fc16aa2f085a1c50))
* **p9:** sweep helper-level console.* to pino logger in api + indexer ([36f2f9b](https://github.com/KaJLabs/Lithosphere/commit/36f2f9be9f7e4d7631a26906a58bafca3db54cff))
* **p9:** wire env-gated OpenTelemetry SDK in api + indexer ([ebc449d](https://github.com/KaJLabs/Lithosphere/commit/ebc449d5cd0819b084d7c14887acd2486f72177a))


### Deployment

* **p3:** Cosign + SLSA verify pre-check in deploy-simple ([7e5e57d](https://github.com/KaJLabs/Lithosphere/commit/7e5e57dafc718dcf67850efdfabd40abdb24f7cf))
* **p3:** pin base image digests + GHCR retention + artifact catalog ([14eb68d](https://github.com/KaJLabs/Lithosphere/commit/14eb68d0fe79fe93444d9bfdb54d412e25f450ae))
* **p4:** formal approval flow + post-deploy SHA verification ([70263ee](https://github.com/KaJLabs/Lithosphere/commit/70263ee369467e2dbf85618e6ebef27155ab6f2c))
* **p4:** rip out unused K8s/ArgoCD/Kustomize boilerplate ([6908c08](https://github.com/KaJLabs/Lithosphere/commit/6908c08719dc38bc12485869660e6603771317c1))
* **p7:** structured deployment manifest + bytecode verifier + multi-sig runbook ([0aa2c90](https://github.com/KaJLabs/Lithosphere/commit/0aa2c9078c748778d97a15bc05bb9b461d0aec43))


### Developer Experience

* **p1:** local commit-msg hook + line-ending normalization ([eeef281](https://github.com/KaJLabs/Lithosphere/commit/eeef28110fc762936cdd639bee0a69f0b48b2c39))
* **p5:** make integration-test — one-command local integration suite ([fb84877](https://github.com/KaJLabs/Lithosphere/commit/fb84877d002c66d98e366d99475fa65828200bc7))
* **p8:** GraphQL schema artifact + drift gate ([216f26f](https://github.com/KaJLabs/Lithosphere/commit/216f26f35f98d90363d66979a78fc8bd76443a61))
* **p8:** OpenAPI REST artifact + drift gate ([f32d511](https://github.com/KaJLabs/Lithosphere/commit/f32d5113f130409de006a885876c3790058e129b))


### SDK

* **p8:** OpenAPI -&gt; TypeScript type codegen, drift-gated ([bd10297](https://github.com/KaJLabs/Lithosphere/commit/bd102979afb5a1383958b2636e126a6fc18fa7c1))
* **p8:** refresh sdk-template scaffold to consume @lithosphere/sdk ([ad0bc5b](https://github.com/KaJLabs/Lithosphere/commit/ad0bc5bedebefaec1c75884a12679932a9dc7660))
* **p8:** typed REST runtime client + runnable examples ([e7bd86d](https://github.com/KaJLabs/Lithosphere/commit/e7bd86dcb5d22ef3a0aabe27915196060e1be0f0))
