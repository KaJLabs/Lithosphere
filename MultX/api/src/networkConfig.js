import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';


const LITHO_MAINNET_CHAIN_ID = 9005;
const REQUIRED_MAINNET_CHAIN_IDS = new Set([9005, 1, 56, 8453]);


const positiveSafeInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return parsed;
};

const nonNegativeSafeInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return parsed;
};


const httpsUrl = (value, field) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
  return parsed.toString();
};


const wssUrl = (value, field) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'wss:') throw new Error(`${field} must use WSS`);
  return parsed.toString();
};


const address = (value, field) => {
  let parsed;
  try {
    parsed = ethers.getAddress(value || '');
  } catch {
    throw new Error(`${field} must be a valid EVM address`);
  }
  if (parsed === ethers.ZeroAddress) throw new Error(`${field} must not be the zero address`);
  return parsed;
};


const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};


export function validateProductionNetworkConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('network config must be a JSON object');
  }
  const evmFirst = input.schemaVersion === 2;
  if (input.schemaVersion !== undefined && ![1,2].includes(input.schemaVersion)) throw new Error('unsupported network schemaVersion');
  if (evmFirst && (input.environment !== 'multx-evm-mainnet' || input.rollout !== 'evm-first')) throw new Error('schemaVersion 2 requires evm-first mainnet profile');
  if (!evmFirst && input.environment !== 'litho-mainnet') {
    throw new Error('environment must be litho-mainnet');
  }

  const sourceChainId = positiveSafeInteger(input.sourceChainId, 'sourceChainId');
  const requiredIds = evmFirst ? new Set([1,56,8453]) : REQUIRED_MAINNET_CHAIN_IDS;
  if (evmFirst && (!requiredIds.has(input.sourceChainId))) throw new Error('explicit EVM origin must be 1, 56 or 8453');
  if (!evmFirst && sourceChainId !== LITHO_MAINNET_CHAIN_ID) {
    throw new Error(`sourceChainId must be ${LITHO_MAINNET_CHAIN_ID}`);
  }

  if (!Array.isArray(input.supportedChains) || input.supportedChains.length === 0) {
    throw new Error('supportedChains must be a non-empty array');
  }
  const supportedIds = new Set();
  const supportedChains = input.supportedChains.map((chain, index) => {
    const prefix = `supportedChains[${index}]`;
    const chainId = positiveSafeInteger(chain?.chainId, `${prefix}.chainId`);
    if (!requiredIds.has(chainId)) {
      throw new Error(`${prefix}.chainId is not an approved MultX mainnet`);
    }
    if (supportedIds.has(chainId)) throw new Error(`${prefix}.chainId is duplicated`);
    supportedIds.add(chainId);
    return {
      chainId,
      name: requiredText(chain?.name, `${prefix}.name`),
      symbol: requiredText(chain?.symbol, `${prefix}.symbol`),
      bridge: address(chain?.bridge, `${prefix}.bridge`),
    };
  });
  for (const chainId of requiredIds) {
    if (!supportedIds.has(chainId)) throw new Error(`supportedChains is missing required mainnet chain ${chainId}`);
  }

  if (!Array.isArray(input.chainsToWatch) || input.chainsToWatch.length !== supportedChains.length) {
    throw new Error('chainsToWatch must contain one entry for every supported chain');
  }
  const watchedIds = new Set();
  const chainsToWatch = input.chainsToWatch.map((chain, index) => {
    const prefix = `chainsToWatch[${index}]`;
    const chainId = positiveSafeInteger(chain?.chainId, `${prefix}.chainId`);
    if (!supportedIds.has(chainId)) throw new Error(`${prefix}.chainId is not supported`);
    if (watchedIds.has(chainId)) throw new Error(`${prefix}.chainId is duplicated`);
    watchedIds.add(chainId);
    const supported = supportedChains.find((item) => item.chainId === chainId);
    const bridge = address(chain?.bridge, `${prefix}.bridge`);
    if (bridge !== supported.bridge) throw new Error(`${prefix}.bridge does not match supportedChains`);
    return {
      name: requiredText(chain?.name, `${prefix}.name`),
      chainId,
      rpc: httpsUrl(chain?.rpc, `${prefix}.rpc`),
      ws: wssUrl(chain?.ws, `${prefix}.ws`),
      bridge,
      pollMs: positiveSafeInteger(chain?.pollMs || 4000, `${prefix}.pollMs`),
      startBlock: nonNegativeSafeInteger(chain?.startBlock, `${prefix}.startBlock`),
      confirmations: positiveSafeInteger(chain?.confirmations, `${prefix}.confirmations`),
      reorgOverlap: nonNegativeSafeInteger(chain?.reorgOverlap, `${prefix}.reorgOverlap`),
    };
  });

  if (!Array.isArray(input.tokenPairs) || input.tokenPairs.length === 0) {
    throw new Error('tokenPairs must be a non-empty array');
  }
  const routeKeys = new Set();
  const tokenPairs = input.tokenPairs.map((route, index) => {
    const prefix = `tokenPairs[${index}]`;
    const sourceChain = positiveSafeInteger(route?.sourceChain, `${prefix}.sourceChain`);
    const targetChain = positiveSafeInteger(route?.targetChain, `${prefix}.targetChain`);
    if (!supportedIds.has(sourceChain) || !supportedIds.has(targetChain)) {
      throw new Error(`${prefix} references an unsupported chain`);
    }
    if (sourceChain === targetChain) throw new Error(`${prefix} must cross chains`);
    if (evmFirst && sourceChain !== sourceChainId && targetChain !== sourceChainId) throw new Error('destination-to-destination route is unsupported');
    const sourceToken = address(route?.sourceToken, `${prefix}.sourceToken`);
    const releaseToken = address(route?.releaseToken, `${prefix}.releaseToken`);
    const key = `${sourceChain}:${sourceToken.toLowerCase()}:${targetChain}`;
    if (routeKeys.has(key)) throw new Error(`${prefix} duplicates a token route`);
    routeKeys.add(key);
    return { sourceChain, sourceToken, targetChain, releaseToken };
  });

  if (evmFirst) {
    if (input.lithoTokenAddress !== undefined) throw new Error('EVM-first profile must use originTokenAddress');
    const origin = address(input.originTokenAddress, 'originTokenAddress');
    const destinations = [...requiredIds].filter(id=>id!==sourceChainId);
    if (tokenPairs.length !== destinations.length * 2) throw new Error('exact bidirectional origin routes required');
    for (const id of destinations) {
      const forward = tokenPairs.find(r=>r.sourceChain===sourceChainId && r.targetChain===id);
      const reverse = tokenPairs.find(r=>r.sourceChain===id && r.targetChain===sourceChainId);
      if (!forward || !reverse || forward.sourceToken!==origin || reverse.releaseToken!==origin || forward.releaseToken!==reverse.sourceToken) {
        throw new Error('origin route mapping or reverse pair mismatch');
      }
    }
  }
  return {
    environment: input.environment,
    sourceChainId,
    // Internal compatibility alias only; EVM-first input uses an explicit origin.
    lithoTokenAddress: address(evmFirst ? input.originTokenAddress : input.lithoTokenAddress, evmFirst ? 'originTokenAddress' : 'lithoTokenAddress'),
    supportedChains,
    chainsToWatch,
    tokenPairs,
  };
}


export function loadProductionNetworkConfig(file) {
  if (!file) throw new Error('MULTX_NETWORK_CONFIG_FILE is required in production');
  if (!path.isAbsolute(file)) throw new Error('MULTX_NETWORK_CONFIG_FILE must be an absolute path');
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('MULTX_NETWORK_CONFIG_FILE must reference a regular file');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateProductionNetworkConfig(document);
}
