export interface SeedToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
}

export const MAKALU_EVM_CHAIN_ID = 700777;
export const KAMET_EVM_CHAIN_ID = 900523;
export const LITHO_MAINNET_EVM_CHAIN_ID = 9005;

const MAKALU_TOKENS: readonly SeedToken[] = [
  { address: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', name: 'Wrapped Lithosphere', symbol: 'wLITHO', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', name: 'Lithosphere LitBTC', symbol: 'LitBTC', decimals: 18, totalSupply: '21000000000000000000000000' },
  { address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', name: 'Lithosphere Algo', symbol: 'LAX', decimals: 18, totalSupply: '10000000000000000000000000000' },
  { address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', name: 'Jot Art', symbol: 'JOT', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61', name: 'Colle AI', symbol: 'COLLE', decimals: 18, totalSupply: '5000000000000000000000000000' },
  { address: '0xAcD98E323968647936887aD4934e64B01060727e', name: 'Imagen Network', symbol: 'IMAGE', decimals: 18, totalSupply: '10000000000000000000000000000' },
  { address: '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', name: 'AGII', symbol: 'AGII', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x798eD6bFc5bfCFc60938d5098825b354427A0786', name: 'Built AI', symbol: 'BLDR', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', name: 'Mansa AI', symbol: 'MUSA', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e', name: 'FurGPT', symbol: 'FGPT', decimals: 18, totalSupply: '1000000000000000000000000000' },
];

// Verified by read-only RPC calls against EVM chain 900523 on 2026-08-11.
const KAMET_TOKENS: readonly SeedToken[] = [
  { address: '0xC0FC628e3aB128fe387e7ed5e729bD809C017888', name: 'Wrapped Lithosphere', symbol: 'wLITHO', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016', name: 'Lithosphere LitBTC', symbol: 'LitBTC', decimals: 18, totalSupply: '21000000000000000000000000' },
  { address: '0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb', name: 'Lithosphere Algo', symbol: 'LAX', decimals: 18, totalSupply: '10000000000000000000000000000' },
  { address: '0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9', name: 'Jot Art', symbol: 'JOT', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA', name: 'Colle AI', symbol: 'COLLE', decimals: 18, totalSupply: '5000000000000000000000000000' },
  { address: '0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0', name: 'Imagen Network', symbol: 'IMAGE', decimals: 18, totalSupply: '10000000000000000000000000000' },
  { address: '0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7', name: 'AGII', symbol: 'AGII', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0xF05f1F79273874E554F02ce06585E16132a3B62B', name: 'Built AI', symbol: 'BLDR', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x2F366c6350A6b211f6D6F847c3D56738C2E847ca', name: 'FurGPT', symbol: 'FGPT', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42', name: 'Mansa AI', symbol: 'MUSA', decimals: 18, totalSupply: '1000000000000000000000000000' },
  { address: '0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe', name: 'Quantts', symbol: 'QTT', decimals: 18, totalSupply: '1000000000000000000000000000' },
];

// Pre-reset and superseded Makalu addresses that must never be reintroduced by
// static seeding. They remain cleanup candidates on every network.
const LEGACY_STALE_TOKEN_ADDRESSES = [
  '0xEB6cfcC84F35D6b20166cD6149Fed712ED2a7Cfe',
  '0x468022F17CAFEBD43C18f68D53c66a1a7f0E5249',
  '0x9611436ea7B4764Eeb1E31B83A5bF03c835Eb3e8',
  '0x8187b232BDa461d17EA519Ba6898F7b220AAf2e2',
  '0xE7eBf52bD714348984Fb00b4c99d9e994D60DF49',
  '0x7a29252B13367800dD78FED47afFaB86a615c844',
  '0x9984ad7a774218B263D74BD8A5FFEDa7DD6Fe020',
  '0x07039884740F4DB0f71BD3bCF87a3FfA0B85A26F',
  '0xa25c2a49893B0296977E2E70Da56AF47241d592F',
  '0xDEE12eD9C5A1F7c29f3ab3961B892a8434A97EFa',
  '0x93d74580a7b63a5B1FE5Aae05b7470bf9317aF9A',
  '0xeC2B25393287025dbcdDb30659E689678c478337',
  '0x0292C22AFC5DF714d51273BF16F9Fc3f17d97e7E',
  '0xC0725568E86DCF6abE5729903bDF6FF999Ad52BD',
  '0x25F70D427EB96b784ff2d0B458B6Aa5f6D251346',
  '0xdB7b1F4b735e9f8096a44657599c9F6882ba0B0D',
  '0xDB04AD818614a329110bdDA30c7c5e8C1Be61e45',
  '0xb47B81370934Db2461759BD29796100fdD35e3E9',
  '0x71ce67fCf5D130473F46DBaD05f3260A8390dE73',
  '0x72791d72B6097D487cEC58605A62396c50C08b69',
] as const;

const REGISTRIES = new Map<number, readonly SeedToken[]>([
  [MAKALU_EVM_CHAIN_ID, MAKALU_TOKENS],
  [KAMET_EVM_CHAIN_ID, KAMET_TOKENS],
  // Mainnet token metadata is discovered on chain, including native Lithic
  // deployments. Never seed testnet contract addresses into production.
  [LITHO_MAINNET_EVM_CHAIN_ID, []],
]);

export function parseConfiguredEvmChainId(value: string | undefined): number {
  const chainId = Number(value ?? MAKALU_EVM_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('LITHO_CHAIN_ID must be a positive safe integer');
  }
  return chainId;
}

export function resolveSeededTokens(chainId: number): readonly SeedToken[] {
  return REGISTRIES.get(chainId) ?? [];
}

export function resolveStaleTokenAddresses(chainId: number): string[] {
  const active = new Set(resolveSeededTokens(chainId).map((token) => token.address.toLowerCase()));
  const known = [
    ...LEGACY_STALE_TOKEN_ADDRESSES,
    ...MAKALU_TOKENS.map((token) => token.address),
    ...KAMET_TOKENS.map((token) => token.address),
  ];

  return [...new Set(known.map((address) => address.toLowerCase()))]
    .filter((address) => !active.has(address));
}
