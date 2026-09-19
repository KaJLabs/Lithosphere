/**
 * @litho/multx-sdk — TypeScript SDK for the Lithosphere MultX cross-chain bridge.
 *
 * Public exports:
 * - {@link MultXClient}: framework-agnostic bridge client
 * - {@link MultXApi}: lower-level URL builder + fetch wrapper
 * - {@link MultXError}: custom error class for decoded bridge errors
 * - {@link MULTX_STEPS}: tx state-machine enum
 * - {@link decodeBridgeError}: standalone error-decoding helper
 * - Pure helpers: {@link isContractDeployed}, {@link formatTokenAmount}, {@link parseTokenAmount}, {@link normalizeAddress}, {@link normalizeBridgeApiBaseUrl}, {@link isBridgeTxHash}, {@link shortenBridgeTxHash}, {@link splitBridgeHistoryTimestamp}
 *
 * The optional React adapter (`useMultX` hook) lives at `@litho/multx-sdk/react`.
 */

export { MultXClient } from './client.js';
export { MultXApi, readJsonResponse } from './api.js';
export { MultXError, decodeBridgeError, isSequenceError, findRevertData } from './errors.js';
export { MULTX_STEPS } from './states.js';
export type { MultXStep } from './states.js';
export { bridgeAbi, tokenAbi } from './abis.js';
export {
  isContractDeployed,
  formatTokenAmount,
  parseTokenAmount,
  normalizeAddress,
} from './format.js';
export {
  normalizeBridgeApiBaseUrl,
  isBridgeTxHash,
  shortenBridgeTxHash,
  splitBridgeHistoryTimestamp,
} from './history.js';
export type { SplitTimestamp } from './history.js';
export type {
  ApproveTokenOptions,
  BridgeStatusResponse,
  BridgeStatusValue,
  BridgeTransaction,
  DestinationChain,
  FetchLike,
  GetStatusOptions,
  LockResult,
  LockTokensOptions,
  MultXConfig,
  SupportedToken,
  TokenMeta,
} from './types.js';

export { submitNativeSourceStep } from './nativeSource.js';
export type { NativeSourceStep, NativeSourceWalletBackend, NativeSourceSignedStore, NativeSourceSubmission } from './nativeSource.js';

export { openNativeSourceSignedStore } from './nativeSourceStore.js';
export type { NativeSourceBrowserStore } from './nativeSourceStore.js';

export { createNativeSourceWalletBackend } from './nativeSourceBackend.js';

export type { NativeSourceProgress, NativeSourceHttpBackend } from './nativeSourceBackend.js';

export { submitInjectedNativeSourceStep } from './nativeInjectedWallet.js';

export { createNativeQuoteBackend } from './nativeQuoteBackend.js';
export type { NativeQuote, NativeQuoteRequest, NativeQuoteHttpBackend } from './nativeQuoteBackend.js';

export { createNativeDestinationWalletBackend, submitInjectedNativeDestinationStep } from './nativeDestination.js';
export type { NativeDestinationStep, NativeDestinationProgress, NativeDestinationWalletBackend } from './nativeDestination.js';
