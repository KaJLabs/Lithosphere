const { governance } = require('./governance-fixture');
const { expect } = require('chai');
const crypto = require('crypto');
const { verifyApprovedDeploymentBindings } = require('../scripts/mainnet/verify-deployment-readonly');

const addr = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const validators = Array.from({ length: 5 }, (_, index) => addr(index + 1));
const evidence = {
  auditedTag: 'multx-audited-v1.0.0', commit: 'a'.repeat(40),
  contracts: {
    govTimelock: { runtimeSha256:'f'.repeat(64), creationBytecode:'0x63', creationSha256:crypto.createHash('sha256').update(Buffer.from('63','hex')).digest('hex') },
    sourceBridge: { runtimeSha256: 'b'.repeat(64), creationBytecode: '0x60', creationSha256: crypto.createHash('sha256').update(Buffer.from('60', 'hex')).digest('hex') },
    destinationBridge: { runtimeSha256: 'c'.repeat(64), creationBytecode: '0x61', creationSha256: crypto.createHash('sha256').update(Buffer.from('61', 'hex')).digest('hex') },
    wrappedToken: { normalizedRuntimeSha256: 'd'.repeat(64), immutableReferences: [{ start: 10, length: 32 }], creationBytecode: '0x62', creationSha256: crypto.createHash('sha256').update(Buffer.from('62', 'hex')).digest('hex') },
  },
};
const evidenceBytes = Buffer.from(JSON.stringify(evidence));

function fixture() {
  const chainIds = [9005, 1, 56, 8453];
  const plan = {
    schemaVersion: 1,
    status: 'approved-for-deployment',
    release: {
      auditedTag: 'multx-audited-v1.0.0', commit: 'a'.repeat(40),
      auditReportUrl: 'https://evidence.example/audit', fixReviewUrl: 'https://evidence.example/fix',
      bytecodeEvidenceSha256: digest(evidenceBytes),
      sourceBridgeRuntimeSha256: 'b'.repeat(64), destinationBridgeRuntimeSha256: 'c'.repeat(64),
      govTimelockRuntimeSha256: 'f'.repeat(64), wrappedTokenNormalizedRuntimeSha256: 'd'.repeat(64),
    },
    changeWindow: {
      startUtc: '2026-09-02T10:00:00Z', endUtc: '2026-09-02T11:00:00Z',
      approvalRecordUrl: 'https://evidence.example/window',
    },
    bridgeSignerSet: {
      threshold: 3, addresses: validators,
      acceptanceRecords: validators.map((_, index) => `https://evidence.example/signer-${index}`),
    },
    chains: chainIds.map((chainId, index) => ({
      chainId, name: `Chain ${chainId}`, bridgeKind: chainId === 9005 ? 'source' : 'destination',
      expectedBridgeAddress: addr(60 + index),
      rpcHttps: `https://rpc-${chainId}.example`, rpcWss: `wss://rpc-${chainId}.example/ws`, confirmations: 12,
      safe: addr(20 + index * 4), timelock: addr(21 + index * 4),
      pauseGuardian: addr(22 + index * 4), deployer: addr(23 + index * 4), feePayer: addr(20 + index * 4),
      timelockDelaySeconds: 172800,
      governance: governance(addr(20 + index * 4), addr(21 + index * 4), addr(23 + index * 4)),
    })),
    assets: [{
      symbol: 'ASSET', name: 'Asset', decimals: 18, originChainId: 9005, originToken: addr(50),
      destinationChainIds: [1, 56, 8453],
      dailyCapBaseUnits: Object.fromEntries(chainIds.map((id) => [id, '1000000000000000000'])),
      destinationTokenAddresses: { 1: addr(71), 56: addr(72), 8453: addr(73) },
      approvalRecordUrl: 'https://evidence.example/asset',
    }],
  };
  const planBytes = Buffer.from(JSON.stringify(plan));
  const manifest = {
    schemaVersion: 1, status: 'deployed-paused-verified',
    release: {
      auditedTag: plan.release.auditedTag, commit: plan.release.commit,
      deploymentPlanSha256: digest(planBytes), bytecodeEvidenceSha256: digest(evidenceBytes),
      deploymentApprovalUrl: 'https://evidence.example/deployment', deployedAtUtc: '2026-09-02T10:30:00Z',
      sourceBridgeRuntimeSha256: plan.release.sourceBridgeRuntimeSha256,
      destinationBridgeRuntimeSha256: plan.release.destinationBridgeRuntimeSha256,
      govTimelockRuntimeSha256: 'f'.repeat(64), wrappedTokenNormalizedRuntimeSha256: plan.release.wrappedTokenNormalizedRuntimeSha256,
    },
    chains: plan.chains.map((approved, index) => ({
      chainId: approved.chainId, name: approved.name, rpcHttps: approved.rpcHttps,
      bridgeKind: approved.bridgeKind,
      governance: { timelockDeploymentTxHash:'0x'+'9'.repeat(64), timelockDeploymentBlock:10 }, bridge: {
        address: addr(60 + index), deploymentTxHash: `0x${String(index + 1).padStart(64, '0')}`,
        deploymentBlock: 100 + index,
        runtimeSha256: approved.chainId === 9005 ? plan.release.sourceBridgeRuntimeSha256 : plan.release.destinationBridgeRuntimeSha256,
        owner: approved.timelock, governanceSafe: approved.safe, pauseGuardian: approved.pauseGuardian, paused: true,
        signaturesRequired: 3, validators,
        explorerUrl: `https://explorer.example/${approved.chainId}`, sourceVerified: true,
      },
      assets: [{
        kind: approved.chainId === 9005 ? 'canonical' : 'wrapped', symbol: 'ASSET',
        address: approved.chainId === 9005 ? addr(50) : addr(70 + index),
        targetChainIds: approved.chainId === 9005 ? [1, 56, 8453] : [9005],
        dailyCapBaseUnits: '1000000000000000000',
        runtimeSha256: 'e'.repeat(64),
        ...(approved.chainId === 9005 ? {} : {
          originChainId: 9005, originToken: addr(50),
          deploymentTxHash: `0x${String(index + 10).padStart(64, '0')}`, deploymentBlock: 200 + index,
          explorerUrl: `https://explorer.example/${approved.chainId}/asset`, sourceVerified: true,
        }),
      }],
    })),
  };
  return { planBytes, manifest };
}

  function evmFixture(origin) {
    const f=fixture(), plan=JSON.parse(f.planBytes), manifest=f.manifest;
    for(const document of [plan,manifest]) {
      document.schemaVersion=2; document.rollout='evm-first'; document.sourceChainId=origin;
      document.chains=document.chains.filter(c=>c.chainId!==origin);
      const source=document.chains.find(c=>c.chainId===9005);
      source.chainId=origin;
    }
    const asset=plan.assets[0]; asset.originChainId=origin;
    asset.destinationChainIds=asset.destinationChainIds.filter(id=>id!==origin);
    delete asset.destinationTokenAddresses[origin]; delete asset.dailyCapBaseUnits[9005];
    for(const chain of manifest.chains) for(const token of chain.assets) {
      token.targetChainIds=chain.chainId===origin?asset.destinationChainIds:[origin];
      if(token.kind==='wrapped') token.originChainId=origin;
    }
    const planBytes=Buffer.from(JSON.stringify(plan)); manifest.release.deploymentPlanSha256=digest(planBytes);
    return {plan,manifest,planBytes};
  }
describe('approved deployment root binding', function () {
  it('requires the schema-2 rollout declaration', function () {
    const { validateDeploymentPlan } = require('../scripts/mainnet/validate-deployment-plan');
    for (const rollout of [undefined, 'other']) {
      const f = evmFixture(1); f.plan.rollout = rollout;
      expect(() => validateDeploymentPlan(f.plan)).to.throw('requires evm-first rollout');
    }
  });
  it('checks agreement before downstream identity checks on independently valid profiles', function () {
    const approved = evmFixture(1), other = evmFixture(56);
    other.manifest.release.deploymentPlanSha256 = digest(approved.planBytes);
    expect(() => verifyApprovedDeploymentBindings(approved.planBytes, evidenceBytes, other.manifest))
      .to.throw('rollout profile does not match approved plan');
  });
  it('rejects otherwise valid additional assets in each schema-2 validator', function () {
    const { validateDeploymentPlan } = require('../scripts/mainnet/validate-deployment-plan');
    const { validateDeploymentManifest } = require('../scripts/mainnet/validate-deployment-manifest');
    const f = evmFixture(1);
    f.plan.assets.push({...f.plan.assets[0], symbol:'SECOND', originToken:addr(501),
      destinationTokenAddresses:{56:addr(502),8453:addr(503)}});
    expect(() => validateDeploymentPlan(f.plan)).to.throw('exactly one origin asset');
    for (const chain of f.manifest.chains) chain.assets.push({...chain.assets[0],symbol:'SECOND',address:addr(500+chain.chainId)});
    expect(() => validateDeploymentManifest(f.manifest)).to.throw('exactly one origin asset');
  });
  for(const origin of [1,56,8453]) it(`binds explicit EVM-first origin ${origin} and rejects rollout drift`,()=>{
    const f=evmFixture(origin);
    expect(()=>verifyApprovedDeploymentBindings(f.planBytes,evidenceBytes,f.manifest)).not.to.throw();
    for(const mutate of [
      p=>{delete p.sourceChainId;}, p=>{p.sourceChainId=9005;},
      p=>{p.chains.push({...p.chains[0],chainId:9005});},
      p=>{p.assets[0].originChainId=9005;},
      p=>{p.assets[0].destinationChainIds=[9005];},
      p=>{p.chains[0].bridgeKind='destination';},
    ]) {
      const next=evmFixture(origin); mutate(next.plan);
      const bytes=Buffer.from(JSON.stringify(next.plan)); next.manifest.release.deploymentPlanSha256=digest(bytes);
      expect(()=>verifyApprovedDeploymentBindings(bytes,evidenceBytes,next.manifest)).to.throw();
    }
    f.manifest.sourceChainId=origin===1?56:1;
    expect(()=>verifyApprovedDeploymentBindings(f.planBytes,evidenceBytes,f.manifest)).to.throw();
  });
  it('enforces the live threshold through the deployment verifier call site', async function () {
    const { ethers } = require('ethers');
    const { verifyDeploymentReadonly } = require('../scripts/mainnet/verify-deployment-readonly');
    const f = fixture(), plan = JSON.parse(f.planBytes);
    const ev = JSON.parse(evidenceBytes);
    const runtime = '0x6000', runtimeHash = digest(Buffer.from('6000', 'hex'));
    ev.contracts.sourceBridge.runtimeSha256 = runtimeHash;
    plan.release.sourceBridgeRuntimeSha256 = runtimeHash;
    f.manifest.release.sourceBridgeRuntimeSha256 = runtimeHash;
    f.manifest.chains[0].bridge.runtimeSha256 = runtimeHash;
    const evBytes = Buffer.from(JSON.stringify(ev));
    plan.release.bytecodeEvidenceSha256 = digest(evBytes);
    f.manifest.release.bytecodeEvidenceSha256 = digest(evBytes);
    const bytes = Buffer.from(JSON.stringify(plan));
    f.manifest.release.deploymentPlanSha256 = digest(bytes);
    const chain = f.manifest.chains[0], approved = plan.chains[0];
    const iface = new ethers.utils.Interface([
      'function owner() view returns(address)', 'function pauseGuardian() view returns(address)',
      'function paused() view returns(bool)', 'function signaturesRequired() view returns(uint256)',
    ]);
    let threshold = 3, downstreamReached = false;
    const provider = {
      _isProvider: true,
      getNetwork: async () => ({chainId:9005}), getBlockNumber: async () => 1000,
      getBlock: async () => ({hash:'0x'+'a'.repeat(64)}),
      getCode: async (_address, block) => block === 99 ? '0x' : runtime,
      resolveName: async name => name,
      getTransactionReceipt: async hash => {
        if (hash !== chain.bridge.deploymentTxHash) { downstreamReached = true; throw Error('DOWNSTREAM_GOVERNANCE_BOUNDARY'); }
        return {status:1, blockNumber:100, contractAddress:chain.bridge.address};
      },
      getTransaction: async hash => ({hash, from:approved.deployer, data:'0x60'}),
      call: async ({data}) => {
        const name = iface.parseTransaction({data}).name;
        return iface.encodeFunctionResult(name, [{owner:approved.timelock, pauseGuardian:approved.pauseGuardian, paused:true, signaturesRequired:threshold}[name]]);
      },
    };
    const run = () => verifyDeploymentReadonly(f.manifest, {planBytes:bytes,evidenceBytes:evBytes}, () => provider);
    let error;
    try { await run(); } catch (e) { error = e; }
    expect(error.message).to.equal('DOWNSTREAM_GOVERNANCE_BOUNDARY');
    expect(downstreamReached).to.equal(true);
    for (const wrong of [2, 4, 5]) {
      threshold = wrong; downstreamReached = false; error = undefined;
      try { await run(); } catch (e) { error = e; }
      expect(error.message).to.equal('Chain 9005 threshold is not 3');
      expect(downstreamReached).to.equal(false);
    }
  });
  it('rejects valid but byte-different approved plan without relying on policy drift', function () {
    const { planBytes, manifest } = fixture();
    const changed = Buffer.concat([planBytes, Buffer.from('\n')]);
    expect(() => verifyApprovedDeploymentBindings(changed, evidenceBytes, manifest)).to.throw('approved deployment plan SHA-256');
  });

  for (const root of ['plan', 'manifest']) {
    it(`rejects valid evidence bytes when only the ${root} evidence digest differs`, function () {
      const { planBytes, manifest } = fixture();
      const plan = JSON.parse(planBytes);
      if (root === 'plan') plan.release.bytecodeEvidenceSha256 = '9'.repeat(64);
      else manifest.release.bytecodeEvidenceSha256 = '9'.repeat(64);
      const bytes = Buffer.from(JSON.stringify(plan));
      manifest.release.deploymentPlanSha256 = digest(bytes);
      expect(() => verifyApprovedDeploymentBindings(bytes, evidenceBytes, manifest)).to.throw('independent bytecode evidence SHA-256');
    });
  }

  it('rejects a different otherwise valid precomputed bridge address', function () {
    const { planBytes, manifest } = fixture();
    manifest.chains[0].bridge.address = addr(999);
    expect(() => verifyApprovedDeploymentBindings(planBytes, evidenceBytes, manifest)).to.throw('bridge address does not match approved plan');
  });
  it('binds the exact plan and independent evidence bytes to all manifest policy', function () {
    const { planBytes, manifest } = fixture();
    expect(() => verifyApprovedDeploymentBindings(planBytes, evidenceBytes, manifest)).not.to.throw();
  });

  it('fails closed if plan, evidence, signer policy, governance, route, cap, or release identity drifts', function () {
    for (const mutate of [
      (value) => { value.release.auditedTag = 'multx-other-v1.0.0'; },
      (value) => { value.chains[0].bridge.validators.reverse(); },
      (value) => { value.chains[0].bridge.owner = addr(99); },
      (value) => { value.chains[0].assets[0].dailyCapBaseUnits = '2'; },
      (value) => { value.chains[0].assets[0].targetChainIds = [1, 56]; },
    ]) {
      const { planBytes, manifest } = fixture(); mutate(manifest);
      expect(() => verifyApprovedDeploymentBindings(planBytes, evidenceBytes, manifest)).to.throw();
    }
    const { planBytes, manifest } = fixture();
    expect(() => verifyApprovedDeploymentBindings(planBytes, Buffer.from('tampered'), manifest)).to.throw('bytecode evidence');
  });
});


module.exports = { evmFixture, evidence, digest };

describe('native identity approved-plan integration', function () {
  function nativeFixture() {
    const f=fixture();const plan=JSON.parse(f.planBytes);
    const address=require('../scripts/mainnet/verify-native-precompile').ADDRESS;
    Object.assign(plan.assets[0],{symbol:'LITHO',name:'Lithosphere',originToken:address,identityType:'native-precompile',
      nativePrecompile:{denom:'ulitho',implementationSha256:'a'.repeat(64),evidenceSha256:'b'.repeat(64),
        securityApprovalUrl:'https://evidence.example/security',operatorApprovalUrl:'https://evidence.example/operator'}});
    for(const chain of f.manifest.chains){
      chain.assets[0].symbol='LITHO';
      if(chain.chainId===9005){Object.assign(chain.assets[0],{address,identityType:'native-precompile'});delete chain.assets[0].runtimeSha256;}
      else chain.assets[0].originToken=address;
    }
    f.planBytes=Buffer.from(JSON.stringify(plan));f.manifest.release.deploymentPlanSha256=digest(f.planBytes);return f;
  }
  it('binds canonical native identity while retaining ordinary destination provenance', function(){
    const f=nativeFixture();expect(()=>verifyApprovedDeploymentBindings(f.planBytes,evidenceBytes,f.manifest)).not.to.throw();
  });
  it('rejects identity downgrade and destination native bypass',function(){
    for(const change of [f=>{delete f.manifest.chains[0].assets[0].identityType;f.manifest.chains[0].assets[0].runtimeSha256='e'.repeat(64);},
      f=>{f.manifest.chains[1].assets[0].identityType='native-precompile';delete f.manifest.chains[1].assets[0].runtimeSha256;},
      f=>delete f.manifest.chains[1].assets[0].runtimeSha256]){
      const f=nativeFixture();change(f);expect(()=>verifyApprovedDeploymentBindings(f.planBytes,evidenceBytes,f.manifest)).to.throw();
    }
  });
  it('requires native evidence before creation or governance verification',async function(){
    const f=nativeFixture();const {verifyDeploymentReadonly}=require('../scripts/mainnet/verify-deployment-readonly');
    const provider={getNetwork:async()=>({chainId:9005}),getBlockNumber:async()=>10};
    try{await verifyDeploymentReadonly(f.manifest,{planBytes:f.planBytes,evidenceBytes},()=>provider);throw Error('expected rejection');}
    catch(e){expect(e.message).to.include('independent bounded evidence file required');}
  });
});
