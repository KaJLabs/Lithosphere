import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { validateProductionNetworkConfig } from '../src/networkConfig.js';


const bridge = (number) => ethers.getAddress(`0x${number.toString(16).padStart(40, '0')}`);
const chainIds = [9005, 1, 56, 8453];


const candidate = () => ({
  environment: 'litho-mainnet',
  sourceChainId: 9005,
  lithoTokenAddress: bridge(100),
  supportedChains: chainIds.map((chainId, index) => ({
    chainId,
    name: `chain-${chainId}`,
    symbol: index === 0 ? 'LITHO' : 'GAS',
    bridge: bridge(index + 1),
  })),
  chainsToWatch: chainIds.map((chainId, index) => ({
    chainId,
    name: `chain-${chainId}`,
    rpc: `https://rpc-${chainId}.example.com`,
    ws: `wss://rpc-${chainId}.example.com/websocket`,
    bridge: bridge(index + 1),
    pollMs: 4000,
    startBlock: 1000 + index,
    confirmations: 12,
    reorgOverlap: 12,
  })),
  tokenPairs: [
    { sourceChain: 9005, sourceToken: bridge(100), targetChain: 1, releaseToken: bridge(101) },
    { sourceChain: 1, sourceToken: bridge(101), targetChain: 9005, releaseToken: bridge(100) },
  ],
});


test('accepts an explicit LITHO and external-mainnet manifest', () => {
  const result = validateProductionNetworkConfig(candidate());
  assert.equal(result.sourceChainId, 9005);
  assert.equal(result.supportedChains.length, 4);
  assert.equal(result.tokenPairs.length, 2);
});

function evmCandidate(origin) {
  const input=candidate(); input.schemaVersion=2; input.rollout='evm-first'; input.environment='multx-evm-mainnet';
  input.sourceChainId=origin; input.originTokenAddress=bridge(100); delete input.lithoTokenAddress;
  input.supportedChains=input.supportedChains.filter(c=>c.chainId!==9005);
  input.chainsToWatch=input.chainsToWatch.filter(c=>c.chainId!==9005);
  input.tokenPairs=[1,56,8453].filter(id=>id!==origin).flatMap(id=>[
    {sourceChain:origin,sourceToken:bridge(100),targetChain:id,releaseToken:bridge(id+200)},
    {sourceChain:id,sourceToken:bridge(id+200),targetChain:origin,releaseToken:bridge(100)},
  ]);
  return input;
}
for(const origin of [1,56,8453]) test(`EVM-first origin ${origin} enforces exact reciprocal routes`,()=>{
  const input=evmCandidate(origin); assert.equal(validateProductionNetworkConfig(input).sourceChainId,origin);
  for(const mutate of [
    p=>{delete p.sourceChainId;}, p=>{p.sourceChainId=9005;}, p=>{p.sourceChainId=String(origin);},
    p=>{p.tokenPairs.pop();}, p=>{p.tokenPairs[1].releaseToken=bridge(99);},
    p=>{p.tokenPairs[1].sourceToken=bridge(99);}, p=>{p.lithoTokenAddress=bridge(100);},
    p=>{p.supportedChains.push({chainId:9005,name:'extra',symbol:'LITHO',bridge:bridge(999)});},
    p=>{p.schemaVersion=3;}, p=>{p.rollout='other';},
    p=>{p.tokenPairs.push({sourceChain:input.tokenPairs[0].targetChain,targetChain:input.tokenPairs[2].targetChain,sourceToken:bridge(44),releaseToken:bridge(55)});},
  ]) {const next=evmCandidate(origin); mutate(next); assert.throws(()=>validateProductionNetworkConfig(next));}
});


test('EVM-first rejects additional asset routes even when all required pairs remain', () => {
  const input = evmCandidate(1);
  input.tokenPairs.push({...input.tokenPairs[0],sourceToken:bridge(999)});
  assert.throws(() => validateProductionNetworkConfig(input), /exact bidirectional origin routes/);
});

test('rejects unknown schemas even with an otherwise valid legacy profile', () => {
  for (const schemaVersion of [0,3,'1',null]) {
    const input = candidate(); input.schemaVersion = schemaVersion;
    assert.throws(() => validateProductionNetworkConfig(input), /unsupported network schemaVersion/);
  }
});

test('rejects a historical testnet source chain', () => {
  const input = candidate();
  input.sourceChainId = 900523;
  assert.throws(() => validateProductionNetworkConfig(input), /sourceChainId must be 9005/);
});


test('rejects a missing required destination mainnet', () => {
  const input = candidate();
  input.supportedChains = input.supportedChains.filter((chain) => chain.chainId !== 56);
  input.chainsToWatch = input.chainsToWatch.filter((chain) => chain.chainId !== 56);
  assert.throws(() => validateProductionNetworkConfig(input), /missing required mainnet chain 56/);
});


test('rejects an unapproved extra chain', () => {
  const input = candidate();
  input.supportedChains.push({ chainId: 137, name: 'Polygon', symbol: 'POL', bridge: bridge(50) });
  input.chainsToWatch.push({
    chainId: 137,
    name: 'polygon',
    rpc: 'https://polygon.example.com',
    ws: 'wss://polygon.example.com/websocket',
    bridge: bridge(50),
    pollMs: 4000,
  });
  assert.throws(() => validateProductionNetworkConfig(input), /not an approved MultX mainnet/);
});


test('rejects a bridge mismatch between public and watched chain records', () => {
  const input = candidate();
  input.chainsToWatch[0].bridge = bridge(999);
  assert.throws(() => validateProductionNetworkConfig(input), /bridge does not match/);
});

test('rejects missing or invalid event-ingestion safety parameters', () => {
  const missing = candidate();
  delete missing.chainsToWatch[0].startBlock;
  assert.throws(() => validateProductionNetworkConfig(missing), /startBlock/);

  const zeroConfirmations = candidate();
  zeroConfirmations.chainsToWatch[0].confirmations = 0;
  assert.throws(() => validateProductionNetworkConfig(zeroConfirmations), /confirmations/);

  const negativeOverlap = candidate();
  negativeOverlap.chainsToWatch[0].reorgOverlap = -1;
  assert.throws(() => validateProductionNetworkConfig(negativeOverlap), /reorgOverlap/);
});


test('rejects a duplicate token release route', () => {
  const input = candidate();
  input.tokenPairs.push({ ...input.tokenPairs[0] });
  assert.throws(() => validateProductionNetworkConfig(input), /duplicates a token route/);
});


test('production config refuses to load without a mounted mainnet manifest', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFile = process.env.MULTX_NETWORK_CONFIG_FILE;
  const previousEnabled = process.env.MULTX_ENABLED;
  process.env.NODE_ENV = 'production';
  process.env.MULTX_ENABLED = 'true';
  delete process.env.MULTX_NETWORK_CONFIG_FILE;
  try {
    await assert.rejects(
      import(`../src/config.js?missing-manifest=${Date.now()}`),
      /MULTX_NETWORK_CONFIG_FILE is required in production/
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFile === undefined) delete process.env.MULTX_NETWORK_CONFIG_FILE;
    else process.env.MULTX_NETWORK_CONFIG_FILE = previousFile;
    if (previousEnabled === undefined) delete process.env.MULTX_ENABLED;
    else process.env.MULTX_ENABLED = previousEnabled;
  }
});
