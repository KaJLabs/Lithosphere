const { governance } = require('./governance-fixture');
const { expect } = require('chai');
const crypto = require('crypto');
const { verifyApprovedDeploymentBindings } = require('../scripts/mainnet/verify-deployment-readonly');

const addr = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const validators = Array.from({ length: 7 }, (_, index) => addr(index + 1));
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
      threshold: 5, addresses: validators,
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
        signaturesRequired: 5, validators,
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

describe('approved deployment root binding', function () {
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
