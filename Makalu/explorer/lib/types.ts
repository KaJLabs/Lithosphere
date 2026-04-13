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
  tps1m: number;
  tps5m: number;
  totalTransactions: number;
  walletAddresses: number;
  avgBlockTime: number;
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
  txs?: ApiTx[];
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
  holders?: number;
  transfers?: number;
  type: 'native' | 'LEP100';
}

export interface ApiTxList {
  txs: ApiTx[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiAddress {
  address: string;
  evmAddress?: string;
  cosmosAddress?: string;
  isValidator?: boolean;
  blocksProposed?: number;
  balance: string;
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
  type: 'native' | 'LEP100';
  creator?: string;
  creationTx?: string;
  creationBlock?: number;
  createdAt?: string;
  holders: number;
  transfers: number;
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

export interface ApiValidator {
  address: string;
  moniker: string;
  votingPower: string;
  commission: string;
  status: string;
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
