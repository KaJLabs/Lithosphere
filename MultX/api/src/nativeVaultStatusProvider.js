import { JsonRpcProvider } from 'ethers';

// Runtime identity must be read from the same observed anchor, even if a
// same-height canonical block changes inside ethers' default cache window.
export const createNativeVaultStatusProvider = url =>
  new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
