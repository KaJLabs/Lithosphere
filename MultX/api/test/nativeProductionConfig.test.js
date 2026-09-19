import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeProductionConfig } from '../src/nativeProductionConfig.js';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const config=(phase='evm-initial')=>{
  const ids=phase==='evm-initial'?[1,56,8453]:[1,56,8453,9005];
  return {schemaVersion:1,environment:'multx-native-mainnet',phase,enabled:false,audience:'multx.production.native.v1',
    allowedOrigins:['https://multx.example'],...(phase==='evm-litho'?{lithoCompatibilityEvidenceUrl:'https://evidence.example/litho'}:{}),
    chains:ids.map((chainId,index)=>({chainId,name:`chain-${chainId}`,rpcHttps:`https://rpc-${chainId}.example`,
      bridge:address(index*2+1),wrapper:address(index*2+2),bridgeCodeHash:'0x'+'a'.repeat(64),wrapperCodeHash:'0x'+'b'.repeat(64),
      confirmations:3,approvalRef:`https://evidence.example/chain-${chainId}`,expiresAt:2000000000,targetChains:ids.filter(id=>id!==chainId)}))};
};

test('validates disabled all-direction EVM and EVM/LITHO native application profiles',()=>{
  for(const phase of ['evm-initial','evm-litho']){
    const result=validateNativeProductionConfig(config(phase),1900000000);
    assert.equal(result.enabled,false);
    assert.equal(result.sourcePolicies.size,phase==='evm-initial'?3:4);
    for(const policy of result.sourcePolicies.values())assert.equal(policy.enabled,false);
  }
});

test('never treats configuration as activation and rejects incomplete mesh inputs',()=>{
  for(const mutate of [
    value=>{value.enabled=true;},value=>{value.chains.pop();},value=>{value.chains[0].targetChains.pop();},
    value=>{value.chains[0].targetChains.push(137);},value=>{value.chains[0].confirmations='3';},
    value=>{value.chains[0].rpcHttps='http://rpc.example';},value=>{value.allowedOrigins[0]='https://multx.example/path';},
    value=>{value.chains[0].wrapper=value.chains[0].bridge;},value=>{value.chains[0].bridgeCodeHash='0x'+'0'.repeat(64);},
    value=>{value.chains[0].expiresAt=1800000000;},value=>{value.phase='other';},
  ]){const value=config();mutate(value);assert.throws(()=>validateNativeProductionConfig(value,1900000000));}
});

test('requires bounded compatibility evidence before adding LITHO',()=>{
  const value=config('evm-litho');delete value.lithoCompatibilityEvidenceUrl;
  assert.throws(()=>validateNativeProductionConfig(value,1900000000),/lithoCompatibilityEvidenceUrl/);
  const evm=config();evm.lithoCompatibilityEvidenceUrl='https://evidence.example/litho';
  assert.throws(()=>validateNativeProductionConfig(evm,1900000000),/only to evm-litho/);
});
