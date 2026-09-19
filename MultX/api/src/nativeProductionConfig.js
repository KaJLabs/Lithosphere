import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const PHASES = Object.freeze({
  'evm-initial': [1, 56, 8453],
  'evm-litho': [1, 56, 8453, 9005],
});

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${field} must be an object`);
  return value;
}
function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${field} is required`);
  return value.trim();
}
function integer(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw Error(`${field} must be a positive safe integer`);
  return value;
}
function address(value, field) {
  let result;
  try { result = ethers.getAddress(value); } catch { throw Error(`${field} must be a valid address`); }
  if (result === ethers.ZeroAddress) throw Error(`${field} must not be zero`);
  return result;
}
function hash(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0{64}$/i.test(value)) throw Error(`${field} must be a nonzero bytes32 hash`);
  return value.toLowerCase();
}
function https(value, field, originOnly = false) {
  let result;
  try { result = new URL(value); } catch { throw Error(`${field} must be a valid URL`); }
  if (result.protocol !== 'https:' || result.username || result.password || (originOnly && result.origin !== value)) throw Error(`${field} must be credential-free HTTPS${originOnly ? ' origin' : ''}`);
  return originOnly ? result.origin : result.toString();
}
function sameNumbers(actual, expected) {
  return actual.length === expected.length && [...actual].sort((a,b)=>a-b).every((value,index)=>value===[...expected].sort((a,b)=>a-b)[index]);
}

// This config drives only the opt-in native application. It deliberately cannot
// enable production or replace the separately approved route-policy/deployment records.
export function validateNativeProductionConfig(input, now = Math.floor(Date.now() / 1000)) {
  object(input, 'config');
  if (input.schemaVersion !== 1 || input.environment !== 'multx-native-mainnet') throw Error('unsupported native production profile');
  if (input.enabled !== false) throw Error('candidate native configuration must remain disabled');
  const expected = PHASES[input.phase];
  if (!expected) throw Error('native phase must be evm-initial or evm-litho');
  const audience = text(input.audience, 'audience');
  if (!/^[a-zA-Z0-9._:-]{3,128}$/.test(audience)) throw Error('audience contains unsupported characters');
  if (!Array.isArray(input.allowedOrigins) || !input.allowedOrigins.length) throw Error('allowedOrigins must be non-empty');
  const allowedOrigins = input.allowedOrigins.map((value,index)=>https(value,`allowedOrigins[${index}]`,true));
  if (new Set(allowedOrigins).size !== allowedOrigins.length) throw Error('allowedOrigins contains duplicates');
  if (!Array.isArray(input.chains) || input.chains.length !== expected.length) throw Error('chains do not match native phase');
  const ids = input.chains.map((chain,index)=>integer(chain?.chainId,`chains[${index}].chainId`));
  if (!sameNumbers(ids,expected) || new Set(ids).size !== ids.length) throw Error('chains do not match native phase');
  if (input.phase === 'evm-litho') https(input.lithoCompatibilityEvidenceUrl,'lithoCompatibilityEvidenceUrl');
  else if (input.lithoCompatibilityEvidenceUrl !== undefined) throw Error('LITHO evidence belongs only to evm-litho phase');
  const sourcePolicies = new Map(), endpoints = new Map();
  for (const [index, chain] of input.chains.entries()) {
    object(chain,`chains[${index}]`);
    const prefix=`chains[${index}]`, chainId=chain.chainId;
    const bridge=address(chain.bridge,`${prefix}.bridge`),wrapper=address(chain.wrapper,`${prefix}.wrapper`);
    if (bridge === wrapper) throw Error(`${prefix} bridge and wrapper must differ`);
    const targets = Array.isArray(chain.targetChains) ? chain.targetChains.map((v,i)=>integer(v,`${prefix}.targetChains[${i}]`)) : [];
    const expectedTargets=expected.filter(id=>id!==chainId);
    if (!sameNumbers(targets,expectedTargets) || new Set(targets).size!==targets.length) throw Error(`${prefix}.targetChains must contain every other phase chain exactly once`);
    const expiresAt=integer(chain.expiresAt,`${prefix}.expiresAt`);
    if (expiresAt<=now)throw Error(`${prefix}.expiresAt must be in the future`);
    const approvalRef=https(chain.approvalRef,`${prefix}.approvalRef`);
    endpoints.set(chainId,{name:text(chain.name,`${prefix}.name`),rpcHttps:https(chain.rpcHttps,`${prefix}.rpcHttps`)});
    sourcePolicies.set(chainId,{enabled:false,chainId,targetChains:targets,wrapper,bridge,
      wrapperCodeHash:hash(chain.wrapperCodeHash,`${prefix}.wrapperCodeHash`),
      bridgeCodeHash:hash(chain.bridgeCodeHash,`${prefix}.bridgeCodeHash`),
      confirmations:integer(chain.confirmations,`${prefix}.confirmations`),approvalRef,expiresAt});
  }
  return {schemaVersion:1,environment:input.environment,phase:input.phase,enabled:false,audience,allowedOrigins,endpoints,sourcePolicies};
}

export function loadNativeProductionConfig(file, now) {
  if (!file || !path.isAbsolute(file)) throw Error('absolute native configuration file required');
  const stat=fs.statSync(file);
  if (!stat.isFile())throw Error('native configuration must be a regular file');
  return validateNativeProductionConfig(JSON.parse(fs.readFileSync(file,'utf8')),now);
}
