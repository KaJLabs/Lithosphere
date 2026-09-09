const assert = require('assert');
const crypto = require('crypto');
const { ADDRESS, identityType, validateNativePolicy, validateNativeEvidence, validateNativeCheckpoint, verifyNativePrecompile } = require('../scripts/mainnet/verify-native-precompile');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bridge = '0x' + '12'.repeat(20);
function fixture() {
  const evidence = { schemaVersion: 1, chainId: 9005, cosmosChainId: 'lithosphere_9005-1', address: ADDRESS,
    nodeBinarySha256: 'a'.repeat(64), verificationBlock: 10, verificationBlockHash: '0x' + 'b'.repeat(64),
    moduleStateHeight: 10, moduleStateBlockHash: '0x' + 'b'.repeat(64),
    erc20Params: { enable_erc20: true, native_precompiles: [ADDRESS], dynamic_precompiles: [] },
    tokenPairs: [{ erc20_address: ADDRESS, denom: 'ulitho', enabled: true, contract_owner: 'OWNER_MODULE' }],
    bankBalance: { address: bridge, denom: 'ulitho', amount: '0' } };
  const asset = { identityType: 'native-precompile', originChainId: 9005, originToken: ADDRESS,
    name: 'Lithosphere', symbol: 'LITHO', decimals: 18, nativePrecompile: { denom: 'ulitho',
      implementationSha256: 'a'.repeat(64), evidenceSha256: '',
      securityApprovalUrl: 'https://review.example/security', operatorApprovalUrl: 'https://review.example/operator' } };
  const f = { asset, evidence, provider: { getNetwork: async () => ({ chainId: 9005 }), getCode: async () => '0x',
    getBalance: async () => 0, getBlock: async () => ({ hash: evidence.verificationBlockHash }) },
    token: { name: async () => 'Lithosphere', symbol: async () => 'LITHO', decimals: async () => 18, balanceOf: async () => 0 } };
  f.seal = () => { f.bytes = Buffer.from(JSON.stringify(evidence)); asset.nativePrecompile.evidenceSha256 = hash(f.bytes); };
  f.run = () => verifyNativePrecompile(f.provider, asset, f.bytes, bridge, 10, { hash: evidence.verificationBlockHash }, () => f.token);
  f.seal(); return f;
}

describe('native precompile identity and evidence', function () {
  it('accepts exact independently pinned evidence and reports its digest', async function () {
    const f = fixture(); assert.equal((await f.run()).evidenceSha256, hash(f.bytes));
  });
  it('rejects unknown types and native identity on another address or chain', function () {
    for (const [asset, chain, address] of [[{ identityType: 'anything' },9005,ADDRESS],
      [{identityType:'native-precompile'},1,ADDRESS], [{identityType:'native-precompile'},9005,bridge],
      [{identityType:'native-precompile',runtimeSha256:'a'.repeat(64)},9005,ADDRESS]]) {
      assert.throws(() => identityType(asset, chain, address));
    }
    assert.equal(identityType({},9005,bridge),'runtime-bytecode');
    assert.throws(() => identityType({nativePrecompile:{}},9005,bridge));
  });
  it('rejects absent approvals, wrong metadata and unapproved implementation', function () {
    for (const mutate of [f=>delete f.asset.nativePrecompile, f=>delete f.asset.nativePrecompile.operatorApprovalUrl,
      f=>f.asset.nativePrecompile.securityApprovalUrl='http://review.example', f=>f.asset.decimals=6,
      f=>f.asset.symbol='FAKE',f=>f.asset.nativePrecompile.implementationSha256='0'.repeat(64)]) {
      const f=fixture();mutate(f);assert.throws(()=>validateNativePolicy(f.asset));
    }
  });
  it('refuses missing and substituted evidence', function () {
    const f=fixture();assert.throws(()=>validateNativeEvidence(f.asset,undefined));
    assert.throws(()=>validateNativeEvidence(f.asset,Buffer.concat([f.bytes,Buffer.from(' ')])),/digest/);
  });
  it('rejects invalid module state even if its digest was approved', function () {
    for(const mutate of [e=>e.nodeBinarySha256='c'.repeat(64),e=>e.chainId=56,e=>e.moduleStateHeight=9,
      e=>e.moduleStateBlockHash='0x'+'c'.repeat(64),e=>e.erc20Params.enable_erc20=false,
      e=>e.erc20Params.native_precompiles=[],e=>e.erc20Params.dynamic_precompiles=[bridge],
      e=>e.tokenPairs.push({...e.tokenPairs[0]}),e=>e.tokenPairs[0].enabled=false,
      e=>e.tokenPairs[0].denom='aevmos',e=>e.tokenPairs[0].contract_owner='OWNER_EXTERNAL',
      e=>e.bankBalance.amount='1']) {
      const f=fixture();mutate(f.evidence);f.seal();assert.throws(()=>validateNativeEvidence(f.asset,f.bytes));
    }
  });
  it('rejects wrong RPC state, bank identity, metadata and changed checkpoint', async function () {
    for(const mutate of [f=>f.provider.getNetwork=async()=>({chainId:1}),f=>f.provider.getCode=async()=> '0x6000',
      f=>f.provider.getBalance=async()=>1,f=>f.token.balanceOf=async()=>1,f=>f.token.symbol=async()=> 'WRONG',
      f=>f.token.decimals=async()=>6,f=>f.provider.getBlock=async()=>({hash:'0x'+'c'.repeat(64)}),
      f=>{f.evidence.bankBalance.address=ADDRESS;f.seal();}]) {
      const f=fixture();mutate(f);await assert.rejects(f.run);
    }
  });
  it('pins all reads to the exact checkpoint and propagates RPC failures', async function () {
    const f=fixture();f.token.balanceOf=async(address,options)=>{assert.equal(address,bridge);assert.equal(options.blockTag,10);return 0;};
    f.provider.getBalance=async(address,block)=>{assert.equal(address,bridge);assert.equal(block,10);return 0;};
    await f.run();f.provider.getCode=async()=>{throw Error('RPC unavailable');};await assert.rejects(f.run,/RPC unavailable/);
  });
});


describe('native checkpoint freshness', function () {
  it('accepts matching fresh checkpoint and rejects stale/future/mismatched headers', function () {
    const e=fixture().evidence;const header={hash:e.verificationBlockHash,timestamp:1000};
    validateNativeCheckpoint(e,10,header,1010);
    for(const [latest,h,now] of [[43,header,1010],[9,header,1010],[10,header,1301],
      [10,header,994],[10,{...header,hash:'0x'+'c'.repeat(64)},1010],[10,{...header,timestamp:undefined},1010]]) {
      assert.throws(()=>validateNativeCheckpoint(e,latest,h,now));
    }
  });
});
