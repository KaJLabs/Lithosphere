// ── REST API response types (Express API on port 4000) ──────────────

export interface StatsSummary {
  tipHeight: number;
  chainTipHeight: number;
  latestTransactionHeight: number;
  latestBlockTimestamp: string | null;
  latestTransactionTimestamp: string | null;
  syncLagBlocks: number;
  isSyncing: boolean;
  inconsistentBlocks: number;
  totalTransactions: number;
  /** Cumulative count of every address ever seen on-chain (all-time, not current holders). */
  walletAddresses: number;
  /** Distinct addresses currently holding a non-zero native LITHO balance. */
  currentHolders?: number;
  avgBlockTime: number;
  /** Live chain gas price in wei (= ulitho on Lithosphere). null if RPC unreachable. */
  gasPriceWei?: string | null;
}

export interface TokenConfig {
  token: { symbol: string; decimals: number };
  fiat: { symbol: string; price: number | null; fetchedAt: string | null };
}

export interface ApiBlock {
  height: number;
  hash: string;
  parentHash?: string;
  proposerAddress?: string | null;
  gasUsed?: string;
  timestamp: string;
  txCount: number;
  txFilteredCount?: number;
  txs?: ApiTx[];
  txOffset?: number;
  txLimit?: number;
  txHasMore?: boolean;
  // Genesis-only fields (populated only for block #1)
  chainId?: string;
  genesisTime?: string;
  genesisHash?: string;
}

export interface ApiTx {
  hash: string;
  evmHash?: string;
  blockHeight: number;
  fromAddr: string;
  toAddr: string | null;
  value: string;
  tokenTransferAmount?: string;
  denom?: string;
  feePaid: string;
  gasUsed?: string | null;
  gasWanted?: string | null;
  success: boolean;
  method?: string;
  methodName?: string;
  tokenSymbol?: string;
  txType?: 'transfer' | 'call' | 'create';
  memo?: string;
  memoUnavailable?: boolean;
  timestamp?: string;
  contractAddress?: string;
  nonce?: number;
  gasPrice?: string;
  inputData?: string;
  rawLog?: string;
  evmFromAddr?: string;
  evmToAddr?: string;
  cosmosFromAddr?: string;
  cosmosToAddr?: string;
}

export interface EvmLog {
  index: number;
  address: string;
  topics: string[];
  data: string;
}

export interface EvmLogsResponse {
  logs: EvmLog[];
  raw: Record<string, unknown> | null;
}

export interface ApiPrice {
  price: number | null;
  symbol: string;
  currency: string;
}

export interface ApiToken {
  symbol: string;
  name: string;
  decimals: number;
  contractAddress?: string;
  totalSupply?: string;
  holders?: number | null;
  transfers?: number | null;
  type: 'native' | 'LEP100' | 'LEP100-6';
}

export interface ApiAddressToken {
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  type: 'LEP100' | 'LEP100-6';
  balance: string;
}

export interface ApiAddressTokenTransfer {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  tokenId: string | null;
  blockHeight: string;
  timestamp: string | null;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  type: 'LEP100' | 'LEP100-6';
}

export interface ApiAddressTokenTransferList {
  items: ApiAddressTokenTransfer[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApiTxList {
  txs: ApiTx[];
  total: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
}

export interface ApiAddressTxList {
  items: ApiTx[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApiAddress {
  address: string;
  evmAddress?: string;
  cosmosAddress?: string;
  isValidator?: boolean;
  blocksProposed?: number;
  balance: string;
  balanceSource: 'rpc' | 'indexed' | 'unavailable';
  txCount: number;
  lastSeen: string;
  isContract?: boolean;
  isToken?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  totalSupply?: string;
}

export interface ApiTokenDetail {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  type: 'native' | 'LEP100' | 'LEP100-6';
  creator?: string;
  creationTx?: string;
  creationBlock?: number;
  createdAt?: string;
  holders: number | null;
  transfers: number | null;
  contractAddress?: string | null;
  standard?: string;
  description?: string;
  verified?: boolean;
}

export interface ApiTokenTransfer {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  tokenId?: string | null;
  blockHeight: number;
  timestamp: string;
}

export interface ApiTokenTransferList {
  transfers: ApiTokenTransfer[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiTokenHolder {
  address: string;
  balance: string;
  percentage: number;
}

export interface ApiTokenHolderList {
  holders: ApiTokenHolder[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiNftCollection {
  contractAddress: string;
  name: string;
  symbol: string;
  type: 'LEP100-6';
  standard: string;
  /** distinct token_ids ever minted */
  items: number;
  /** distinct current owners (excl. burn address) */
  holders: number;
  /** total ERC-721 Transfer events */
  transfers: number;
  totalSupply?: string | null;
  creator?: string | null;
  createdAt?: string | null;
}

export interface ApiNftTransfer {
  txHash: string;
  contractAddress: string;
  collectionName: string | null;
  collectionSymbol: string | null;
  fromAddress: string;
  toAddress: string;
  tokenId: string | null;
  blockHeight: number;
  timestamp: string;
}

export interface ApiNftTransferList {
  transfers: ApiNftTransfer[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiValidator {
  address: string;
  moniker: string;
  votingPower: string;
  commission: string;
  status: string;
  tokens?: string;
  uptimePercentage?: number | null;
  missedBlocks?: string | null;
  jailed?: boolean;
  updatedAt?: string | null;
}

export interface ApiValidatorDetail extends ApiValidator {
  consensusAddress: string | null;
  identity: string | null;
  website: string | null;
  securityContact: string | null;
  details: string | null;
  tokens: string;
  delegatorShares: string;
  minSelfDelegation: string;
  commissionMaxRate: string;
  commissionMaxChange: string;
  jailed: boolean;
  uptimePercentage: number | null;
  missedBlocks: string | null;
  updatedAt: string | null;
  rank: number;
  votingPowerPercentage: number;
  profileImageUrl: string | null;
}

export interface SearchResult {
  type: 'block' | 'tx' | 'address' | 'unknown';
}

export interface PriceData {
  price: number;
  symbol: string;
}

export interface TimeseriesBucket {
  t: string;
  tps: number;
  avgFee: number;
}

// ── Pagination helpers (kept for DataTable/Pagination components) ────

export interface PageInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
