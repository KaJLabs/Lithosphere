import dotenv from 'dotenv';
import { loadProductionNetworkConfig } from './networkConfig.js';

// Production secrets are loaded by entrypoint.mjs from mounted files. Do not
// permit a production .env file to silently bypass those controls.
if (process.env.NODE_ENV !== 'production') dotenv.config();

export function resolveMultxEnabled(nodeEnv, value) {
  if (nodeEnv !== 'production') return value !== 'false';
  if (value === undefined || value === '') return false;
  if (value !== 'true' && value !== 'false') {
    throw new Error('MULTX_ENABLED must be exactly true or false in production');
  }
  return value === 'true';
}

const multxEnabled = resolveMultxEnabled(process.env.NODE_ENV, process.env.MULTX_ENABLED);

export function resolveMigrationsEnabled(nodeEnv, multxIsEnabled, value) {
  if (nodeEnv === 'production' && !multxIsEnabled) {
    if (value === undefined || value === '' || value === 'false') return false;
    throw new Error('DB_MIGRATIONS_ENABLED must remain false while MultX is disabled');
  }
  if (value === undefined || value === '') return true;
  if (value !== 'true' && value !== 'false') {
    throw new Error('DB_MIGRATIONS_ENABLED must be exactly true or false');
  }
  return value === 'true';
}

const migrationsEnabled = resolveMigrationsEnabled(
  process.env.NODE_ENV,
  multxEnabled,
  process.env.DB_MIGRATIONS_ENABLED,
);

// ── Multichain token registry (M4 v1) ──────────────────────────────────────
// Pairs (sourceChain, sourceToken) ↔ (destChain, destToken) so the event
// listener and validator service can correctly resolve which token gets
// released on which chain when a lock is observed.
//
// Format: bidirectional — for each canonical pair we list both directions.
// The event listener will resolve a release_token by querying this map with
// (observed_chain, observed_token, target_chain).
//
// Populated from contracts/deployments/{sepolia,base_sepolia}-bridge-latest.json
// after running scripts/03-deploy-dest-chain.js.
const KAMET = 900523;
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const MAKALU = 700777;
const BNB_TESTNET = 97;

// Canonical (sourceChain, sourceToken, destChain) → destToken lookup.
// Built once at module load and used by event listener + validator service.
const TOKEN_PAIRS = [
  // [kametToken, sepoliaWrapped, baseSepoliaWrapped]
  // Origin = Kamet LEP100. Wrapped addresses from sepolia-bridge-latest.json + base_sepolia-bridge-latest.json
  ['0x72791d72B6097D487cEC58605A62396c50C08b69', '0xbB86A8ed1170f5Be9cCC7C8df3541F9aA0f7e8F3', '0xbB86A8ed1170f5Be9cCC7C8df3541F9aA0f7e8F3', 'DOGE'],
  ['0xC0FC628e3aB128fe387e7ed5e729bD809C017888', '0x1904e61aD439D2A9c18305D53Db296Af6844DC7b', '0x1904e61aD439D2A9c18305D53Db296Af6844DC7b', 'wLITHO'],
  ['0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016', '0xe6eaECAB0a9A6CD63582DFd568c2014bb1a43808', '0xe6eaECAB0a9A6CD63582DFd568c2014bb1a43808', 'LitBTC'],
  ['0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb', '0xe69eA31F9795De5236B27664B44aB6E507570E28', '0xe69eA31F9795De5236B27664B44aB6E507570E28', 'LAX'],
  ['0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9', '0x2B3E9Ad23a6E384B4eA8f579074266B27F6a7Fe9', '0x2B3E9Ad23a6E384B4eA8f579074266B27F6a7Fe9', 'JOT'],
  ['0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA', '0x933d3cA124e19883E812265AE27B61C347562C36', '0x933d3cA124e19883E812265AE27B61C347562C36', 'COLLE'],
  ['0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0', '0xC9234d0C56e1a9F439d672a27d9fd8Bb3027FefD', '0xC9234d0C56e1a9F439d672a27d9fd8Bb3027FefD', 'IMAGE'],
  ['0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7', '0x1AEDC79abB9d3067Da042AB3a976D8fD088D7917', '0x1AEDC79abB9d3067Da042AB3a976D8fD088D7917', 'AGII'],
  ['0xF05f1F79273874E554F02ce06585E16132a3B62B', '0x950cEaFEb9C754fEe171fFDE25B20ee2FA93E9D3', '0x950cEaFEb9C754fEe171fFDE25B20ee2FA93E9D3', 'BLDR'],
  ['0x2F366c6350A6b211f6D6F847c3D56738C2E847ca', '0xB8b385645799e3365706d615a21e30C3F6E0a51a', '0xB8b385645799e3365706d615a21e30C3F6E0a51a', 'FGPT'],
  ['0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42', '0x396460c16A644f86965e2d5120f69Ed23fff6F4c', '0x396460c16A644f86965e2d5120f69Ed23fff6F4c', 'MUSA'],
  ['0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe', '0x7126Fa6c66B6e09d026Dd170a2519bb6d57c87D4', '0x7126Fa6c66B6e09d026Dd170a2519bb6d57c87D4', 'QTT'],
];

// Route 1 — Makalu ↔ Kamet (both native LEP100, no wrapping). Pairs the 10
// shared tokens by their native address on each chain. Source of truth:
// contracts/deployments/makalu-bridge-latest.json (Makalu) + kamet-bridge-
// hardened (Kamet). QTT is Kamet-only, so it is not bridgeable to Makalu.
// [kametToken, makaluToken, symbol]
const MAKALU_KAMET_PAIRS = [
  ['0xC0FC628e3aB128fe387e7ed5e729bD809C017888', '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', 'wLITHO'],
  ['0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016', '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', 'LitBTC'],
  ['0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb', '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', 'LAX'],
  ['0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9', '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', 'JOT'],
  ['0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA', '0x10D4BB600c96e9243E2f50baFED8b2478F25af61', 'COLLE'],
  ['0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0', '0xAcD98E323968647936887aD4934e64B01060727e', 'IMAGE'],
  ['0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7', '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', 'AGII'],
  ['0xF05f1F79273874E554F02ce06585E16132a3B62B', '0x798eD6bFc5bfCFc60938d5098825b354427A0786', 'BLDR'],
  ['0x2F366c6350A6b211f6D6F847c3D56738C2E847ca', '0x151ef362eA96853702Cc5e7728107e3961fbD22e', 'FGPT'],
  ['0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42', '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', 'MUSA'],
];

// Route 2 — Makalu-origin tokens → Sepolia/Base Sepolia (m-prefixed wrapped tokens on the
// shared dest bridge 0xfdA3b83F…, deployed 2026-06-18). The wrapped address is identical on
// both Sepolia and Base Sepolia (deterministic CREATE from the same deployer nonce sequence).
// [makaluToken, wrappedToken (both dest chains), symbol]
const MAKALU_DEST_PAIRS = [
  ['0x599a7E135f1790ae117b4EdDc0422D24Bc766161', '0xF5A2D9B86592Fd41F074c56205EE693e7806EB06', 'wLITHO'],
  ['0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', '0x76b8B253971CA831ED1AAf21787708fBDa39da69', 'LitBTC'],
  ['0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', '0xA202fcB80Eb37989a108988d91F30c8e3640A8A4', 'LAX'],
  ['0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', '0x90e835644a94aCa0FBEF8346e50a729d7c47c1B9', 'JOT'],
  ['0x10D4BB600c96e9243E2f50baFED8b2478F25af61', '0x0bf2F140a2d7c43Cc2c67D3b0FbD51c6e91d5FeF', 'COLLE'],
  ['0xAcD98E323968647936887aD4934e64B01060727e', '0xa56C8Ad168F0E1607419cbDc4be3Ce8EEa519D93', 'IMAGE'],
  ['0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', '0x958dA8fa4a8Cd784F1e1Dd98347b8fE36c83542c', 'AGII'],
  ['0x798eD6bFc5bfCFc60938d5098825b354427A0786', '0xA3A533C808dA1D60Ef23288D51E259d316CdB336', 'BLDR'],
  ['0x151ef362eA96853702Cc5e7728107e3961fbD22e', '0x48B738d8910eEFE13B907ab9ab0d6C4Ee7EE3803', 'FGPT'],
  ['0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', '0x0FEd2530b6d5A39f1e3eAe4025eCe87a72428584', 'MUSA'],
];

// Route 3 — Kamet-origin tokens → BNB testnet (wrapped tokens on the BNB dest
// bridge 0x93d74580…, deployed 2026-07-06). Source: bnb_testnet-bridge-latest.json.
// [kametToken, bnbWrapped, symbol]
const KAMET_BNB_PAIRS = [
  ['0x72791d72B6097D487cEC58605A62396c50C08b69', '0xeC2B25393287025dbcdDb30659E689678c478337', 'DOGE'],
  ['0xC0FC628e3aB128fe387e7ed5e729bD809C017888', '0x0292C22AFC5DF714d51273BF16F9Fc3f17d97e7E', 'wLITHO'],
  ['0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016', '0xC0725568E86DCF6abE5729903bDF6FF999Ad52BD', 'LitBTC'],
  ['0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb', '0x25F70D427EB96b784ff2d0B458B6Aa5f6D251346', 'LAX'],
  ['0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9', '0xdB7b1F4b735e9f8096a44657599c9F6882ba0B0D', 'JOT'],
  ['0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA', '0xDB04AD818614a329110bdDA30c7c5e8C1Be61e45', 'COLLE'],
  ['0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0', '0xb47B81370934Db2461759BD29796100fdD35e3E9', 'IMAGE'],
  ['0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7', '0x71ce67fCf5D130473F46DBaD05f3260A8390dE73', 'AGII'],
  ['0xF05f1F79273874E554F02ce06585E16132a3B62B', '0x72791d72B6097D487cEC58605A62396c50C08b69', 'BLDR'],
  ['0x2F366c6350A6b211f6D6F847c3D56738C2E847ca', '0xFEC7EF3AB4D80eAe1B65744b06914afeB579e2bc', 'FGPT'],
  ['0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42', '0x39C21d6Cd2B56AdD1dBdAf71597CF1AE97E2EE59', 'MUSA'],
  ['0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe', '0x8B562D2946c55dC0c1D6fd21B72661814bD9E2cB', 'QTT'],
];

// Build forward & reverse lookup tables: tokenRegistry[fromChain][fromTokenLower][toChain] = toToken
const tokenRegistry = {};
const addPair = (fromChain, fromToken, toChain, toToken) => {
  if (!fromToken || !toToken) return;
  tokenRegistry[fromChain] = tokenRegistry[fromChain] || {};
  const key = fromToken.toLowerCase();
  tokenRegistry[fromChain][key] = tokenRegistry[fromChain][key] || {};
  tokenRegistry[fromChain][key][toChain] = toToken;
};

for (const [kametToken, sepoliaToken, baseSepToken] of TOKEN_PAIRS) {
  // Forward: Kamet → dest
  addPair(KAMET, kametToken, SEPOLIA, sepoliaToken);
  addPair(KAMET, kametToken, BASE_SEPOLIA, baseSepToken);
  // Reverse: dest → Kamet
  addPair(SEPOLIA, sepoliaToken, KAMET, kametToken);
  addPair(BASE_SEPOLIA, baseSepToken, KAMET, kametToken);
}

// Route 1 — Makalu ↔ Kamet (bidirectional native pairs)
for (const [kametToken, makaluToken] of MAKALU_KAMET_PAIRS) {
  addPair(KAMET, kametToken, MAKALU, makaluToken);
  addPair(MAKALU, makaluToken, KAMET, kametToken);
}

// Route 3 — Kamet ↔ BNB testnet (mint wrapped on BNB / burn to release on Kamet)
for (const [kametToken, bnbToken] of KAMET_BNB_PAIRS) {
  addPair(KAMET, kametToken, BNB_TESTNET, bnbToken);
  addPair(BNB_TESTNET, bnbToken, KAMET, kametToken);
}

// Route 2 — Makalu ↔ Sepolia/Base Sepolia (same wrapped address on both dest chains)
for (const [makaluToken, wrappedToken] of MAKALU_DEST_PAIRS) {
  // Forward: Makalu lock → mint wrapped on dest
  addPair(MAKALU, makaluToken, SEPOLIA, wrappedToken);
  addPair(MAKALU, makaluToken, BASE_SEPOLIA, wrappedToken);
  // Reverse: burn wrapped on dest → release on Makalu
  addPair(SEPOLIA, wrappedToken, MAKALU, makaluToken);
  addPair(BASE_SEPOLIA, wrappedToken, MAKALU, makaluToken);
}

// Production never inherits historical Kamet/Makalu/testnet addresses. It
// starts only with an explicit, audited mainnet manifest mounted read-only by
// the VPS deployment. A missing or malformed manifest fails startup.
const productionNetwork = process.env.NODE_ENV === 'production' && multxEnabled
  ? loadProductionNetworkConfig(process.env.MULTX_NETWORK_CONFIG_FILE)
  : null;

if (productionNetwork) {
  for (const chainId of Object.keys(tokenRegistry)) delete tokenRegistry[chainId];
  for (const route of productionNetwork.tokenPairs) {
    addPair(route.sourceChain, route.sourceToken, route.targetChain, route.releaseToken);
  }
}

const productionSource = productionNetwork?.chainsToWatch.find(
  (chain) => chain.chainId === productionNetwork.sourceChainId
);

/**
 * Resolve the token address on the release chain given an observed lock.
 * Returns null if no mapping exists (the row will be flagged for manual handling).
 */
export const resolveReleaseToken = (sourceChain, sourceToken, releaseChain) => {
  const m = tokenRegistry[sourceChain];
  if (!m) return null;
  const t = m[String(sourceToken).toLowerCase()];
  if (!t) return null;
  return t[releaseChain] || null;
};

export const config = {
  multxEnabled,
  migrationsEnabled,
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || ['http://localhost:3002'],
  lithoRpcWs: productionNetwork ? productionSource.ws : (process.env.LITHO_RPC_WS || 'wss://rpc-3.litho.ai:8546'),
  lithoRpcHttp: productionNetwork ? productionSource.rpc : (process.env.LITHO_RPC_HTTP || 'https://rpc-3.litho.ai'),
  bridgeAddress: productionNetwork ? productionSource.bridge : (process.env.BRIDGE_CONTRACT_ADDRESS || ''),
  // Canonical LITHO-side token used by /health to report bridge-asset
  // deployment readiness. Production obtains it from the mounted manifest.
  lithoTokenAddress: productionNetwork?.lithoTokenAddress || process.env.KAMET_LITHO_TOKEN_ADDRESS || '0xC0FC628e3aB128fe387e7ed5e729bD809C017888',
  kametLithoTokenAddress: productionNetwork?.lithoTokenAddress || process.env.KAMET_LITHO_TOKEN_ADDRESS || '0xC0FC628e3aB128fe387e7ed5e729bD809C017888',
  bridgeContracts: {
    sepolia:    process.env.BRIDGE_CONTRACT_SEPOLIA || '',
    bnbTestnet: process.env.BRIDGE_CONTRACT_BNB    || ''
  },
  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    user:     process.env.DB_USER     || 'bridge_user',
    password: process.env.DB_PASSWORD || 'CHANGE_ME',
    database: process.env.DB_NAME     || 'bridge'
  },
  signaturesRequired:     parseInt(process.env.SIGNATURES_REQUIRED || '2', 10),
  // Release executor (releaseService). When RELAYER_PRIVATE_KEY is set, this EOA
  // submits releaseTokens on the destination bridge for `signed` transfers. It
  // needs gas on every destination chain it serves. Leave unset to keep releases
  // on the manual/claim path.
  relayerPrivateKey:      process.env.RELAYER_PRIVATE_KEY || '',
  releaseIntervalMs:      parseInt(process.env.RELEASE_INTERVAL_MS || '5000', 10),
  useMockValidator:       process.env.MOCK_VALIDATOR === 'true',
  mockValidatorCount:     parseInt(process.env.MOCK_VALIDATOR_COUNT || '3', 10),
  mockSignaturesRequired: parseInt(process.env.MOCK_SIGNATURES_REQUIRED || '2', 10),
  mockSignDelayMs:        parseInt(process.env.MOCK_SIGN_DELAY_MS || '5000', 10),
  rateLimit: {
    windowMs:  parseInt(process.env.RATE_LIMIT_WINDOW_MS  || '60000',  10),
    max:       parseInt(process.env.RATE_LIMIT_MAX        || '100',    10),
  },
  supportedChains: productionNetwork?.supportedChains || [
    { chainId: 900523,   name: 'Lithosphere Kamet',  symbol: 'LITHO', bridge: process.env.BRIDGE_CONTRACT_ADDRESS || '' },
    { chainId: 700777,   name: 'Lithosphere Makalu', symbol: 'LITHO', bridge: process.env.BRIDGE_CONTRACT_MAKALU || '0x5832D5E609c6690f74c7683606Eb20F89ff096a6' },
    { chainId: 11155111, name: 'Ethereum Sepolia',   symbol: 'ETH',   bridge: process.env.BRIDGE_CONTRACT_SEPOLIA || '' },
    { chainId: 84532,    name: 'Base Sepolia',       symbol: 'ETH',   bridge: process.env.BRIDGE_CONTRACT_BASE_SEPOLIA || '' },
    { chainId: 97,       name: 'BNB Chain Testnet',  symbol: 'BNB',   bridge: process.env.BRIDGE_CONTRACT_BNB    || '' }
  ],

  // Chains the event listener actively polls for TokensLocked events.
  // Each entry needs an rpc URL and the deployed bridge address. Missing
  // bridge addresses are skipped (so a chain can be configured but inactive
  // until its bridge is deployed).
  chainsToWatch: productionNetwork?.chainsToWatch || [
    {
      name: 'kamet',
      chainId: 900523,
      rpc: process.env.LITHO_RPC_HTTP || 'https://rpc-3.litho.ai',
      bridge: process.env.BRIDGE_CONTRACT_ADDRESS || '',
      pollMs: 2000,
    },
    {
      // Route 1 — Makalu ↔ Kamet. MAKALU_RPC_HTTP defaults to the public
      // Cloudflare host; for production polling prefer a direct mtest sentry
      // EVM RPC (reachable from vps2) to avoid round-robin/pruned-backend reverts.
      name: 'makalu',
      chainId: 700777,
      rpc: process.env.MAKALU_RPC_HTTP || 'https://rpc.litho.ai',
      bridge: process.env.BRIDGE_CONTRACT_MAKALU || '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
      pollMs: 2000,
    },
    {
      name: 'sepolia',
      chainId: 11155111,
      rpc: process.env.SEPOLIA_RPC_HTTP || 'https://ethereum-sepolia-rpc.publicnode.com',
      bridge: process.env.BRIDGE_CONTRACT_SEPOLIA || '0xfdA3b83FE8438123eAF5153945A46F8fcF6175f4',
      pollMs: 4000,
    },
    {
      name: 'base-sepolia',
      chainId: 84532,
      rpc: process.env.BASE_SEPOLIA_RPC_HTTP || 'https://sepolia.base.org',
      bridge: process.env.BRIDGE_CONTRACT_BASE_SEPOLIA || '0xfdA3b83FE8438123eAF5153945A46F8fcF6175f4',
      pollMs: 4000,
    },
    {
      name: 'bnb-testnet',
      chainId: 97,
      // publicnode is stable from the vps2 containers; the data-seed endpoints
      // rate-limit getLogs ("limit exceeded") — same choice as relayer-topup.
      rpc: process.env.BNB_TESTNET_RPC_HTTP || 'https://bsc-testnet-rpc.publicnode.com',
      bridge: process.env.BRIDGE_CONTRACT_BNB || '0x93d74580a7b63a5B1FE5Aae05b7470bf9317aF9A',
      pollMs: 4000,
    },
  ],
};
