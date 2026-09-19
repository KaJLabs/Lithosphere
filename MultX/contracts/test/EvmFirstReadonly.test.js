const { expect } = require('chai');
const { ethers } = require('ethers');
const { evmFixture, evidence, digest } = require('./MainnetApprovedBinding.test');
const { verifyDeploymentReadonly } = require('../scripts/mainnet/verify-deployment-readonly');
const { ROLE_ABI, ROLES } = require('../scripts/mainnet/verify-governance');

// Deterministic RPC double, not a deployed-chain rehearsal. No verifier helper is stubbed.
function liveFixture(origin) {
  const { plan, manifest } = evmFixture(origin);
  const ev = JSON.parse(JSON.stringify(evidence));
  const code = { sourceBridge:'0x6001', destinationBridge:'0x6002', govTimelock:'0x6003',
    wrappedToken:'0x6000', canonical:'0x6004', proxy:'0x6005', implementation:'0x6006' };
  const hash = value => digest(Buffer.from(value.slice(2), 'hex'));
  for (const key of ['sourceBridge','destinationBridge','govTimelock']) {
    ev.contracts[key].runtimeSha256 = hash(code[key]);
    plan.release[`${key}RuntimeSha256`] = manifest.release[`${key}RuntimeSha256`] = hash(code[key]);
  }
  ev.contracts.wrappedToken.immutableReferences = [{start:1,length:1}];
  ev.contracts.wrappedToken.normalizedRuntimeSha256 = hash(code.wrappedToken);
  plan.release.wrappedTokenNormalizedRuntimeSha256 = manifest.release.wrappedTokenNormalizedRuntimeSha256 = hash(code.wrappedToken);
  for (const chain of manifest.chains) {
    const approved = plan.chains.find(c => c.chainId === chain.chainId);
    chain.bridge.runtimeSha256 = hash(code[chain.chainId === origin ? 'sourceBridge' : 'destinationBridge']);
    chain.assets[0].runtimeSha256 = hash(code[chain.chainId === origin ? 'canonical' : 'wrappedToken']);
    approved.governance.safe.proxyRuntimeSha256 = hash(code.proxy);
    approved.governance.safe.implementationRuntimeSha256 = hash(code.implementation);
  }
  const evidenceBytes = Buffer.from(JSON.stringify(ev));
  plan.release.bytecodeEvidenceSha256 = manifest.release.bytecodeEvidenceSha256 = digest(evidenceBytes);
  const planBytes = Buffer.from(JSON.stringify(plan));
  manifest.release.deploymentPlanSha256 = digest(planBytes);
  const faults = {};
  const iface = new ethers.utils.Interface([...ROLE_ABI,
    'function owner() view returns(address)', 'function pauseGuardian() view returns(address)',
    'function paused() view returns(bool)', 'function signaturesRequired() view returns(uint256)',
    'function getValidatorCount() view returns(uint256)', 'function getValidators() view returns(address[])',
    'function supportedTokens(address) view returns(bool)', 'function supportedRoutes(address,uint256) view returns(bool)',
    'function dailyCap(address) view returns(uint256)', 'function dailyVolume(address) view returns(uint256)',
    'function releaseVolume(address) view returns(uint256)', 'function nonce() view returns(uint256)',
    'function VERSION() view returns(string)', 'function getOwners() view returns(address[])',
    'function getThreshold() view returns(uint256)', 'function getModulesPaginated(address,uint256) view returns(address[],address)',
    'function originChainId() view returns(uint256)', 'function originToken() view returns(address)',
    'function bridge() view returns(address)', 'function totalSupply() view returns(uint256)',
    'event SupportedTokenSet(address indexed token,bool supported)',
  ]);
  const factory = (_rpc, id) => {
    const chain = manifest.chains.find(c => c.chainId === id), approved = plan.chains.find(c => c.chainId === id);
    const token = chain.assets[0], safe = approved.governance.safe, timelock = approved.governance.timelock;
    const creations = new Map([
      [chain.bridge.deploymentTxHash, {address:chain.bridge.address, block:chain.bridge.deploymentBlock,
        data:ev.contracts[id === origin ? 'sourceBridge' : 'destinationBridge'].creationBytecode}],
      [chain.governance.timelockDeploymentTxHash, {address:approved.timelock, block:chain.governance.timelockDeploymentBlock,
        data:ev.contracts.govTimelock.creationBytecode + ethers.utils.defaultAbiCoder.encode(
          ['uint256','address[]','address[]','address'], [172800,timelock.proposers,timelock.executors,timelock.constructorAdmin]).slice(2)}],
    ]);
    if (token.kind === 'wrapped') creations.set(token.deploymentTxHash,
      {address:token.address,block:token.deploymentBlock,data:ev.contracts.wrappedToken.creationBytecode});
    const event = (name, values, blockNumber) => ({...iface.encodeEventLog(iface.getEvent(name),values),
      blockNumber,transactionIndex:0,logIndex:0,removed:false});
    return {
      _isProvider:true, resolveName:async name => name,
      getNetwork:async () => ({chainId:id}), getBlockNumber:async () => 1000,
      getBlock:async () => ({hash:'0x'+'a'.repeat(64)}),
      getTransactionReceipt:async tx => {
        const c = creations.get(tx);
        return {status:1,blockNumber:c.block,contractAddress:c.address};
      },
      getTransaction:async tx => ({hash:tx,from:approved.deployer,to:null,
        data:faults.chain === id && faults.creation && tx === chain.bridge.deploymentTxHash ? faults.creation : creations.get(tx).data}),
      getCode:async (address, block) => {
        const creation = [...creations.values()].find(c => c.address.toLowerCase() === address.toLowerCase());
        if (creation && block < creation.block) return '0x';
        const codes = {[chain.bridge.address]:code[id === origin ? 'sourceBridge':'destinationBridge'],
          [approved.timelock]:code.govTimelock,[approved.safe]:code.proxy,[safe.implementation]:code.implementation,
          [token.address]:code[token.kind === 'canonical' ? 'canonical':'wrappedToken']};
        return Object.entries(codes).find(([a]) => a.toLowerCase() === address.toLowerCase())[1];
      },
      getStorageAt:async (_address, slot) => slot === 0 ? ethers.utils.hexZeroPad(safe.implementation,32) : ethers.constants.HashZero,
      getLogs:async filter => {
        if (filter.address.toLowerCase() === approved.timelock.toLowerCase()) return Object.entries(ROLES).flatMap(([name,role]) =>
          timelock[name].map(account => event('RoleGranted',[role,account,approved.deployer],10)));
        if (filter.topics[0] === iface.getEventTopic('SupportedTokenSet')) return [event('SupportedTokenSet',[token.address,true],chain.bridge.deploymentBlock)];
        return [];
      },
      call:async ({data}) => {
        const {name,args} = iface.parseTransaction({data});
        const values = {owner:approved.timelock,pauseGuardian:approved.pauseGuardian,paused:true,signaturesRequired:3,
          getValidatorCount:5,getValidators:chain.bridge.validators,supportedTokens:true,
          supportedRoutes:faults.chain === id && faults.extraRoute ? true : token.targetChainIds.includes(Number(args[1])),
          dailyCap:token.dailyCapBaseUnits,dailyVolume:0,releaseVolume:0,nonce:0,
          getMinDelay:172800,hasRole:true,VERSION:'1.4.1',getOwners:safe.owners,getThreshold:2,
          originChainId:faults.chain === id && faults.wrappedOrigin !== undefined ? faults.wrappedOrigin : origin,
          originToken:token.originToken,bridge:chain.bridge.address,totalSupply:0};
        return iface.encodeFunctionResult(name, name === 'getModulesPaginated' ? [[],ethers.utils.getAddress('0x'+'0'.repeat(39)+'1')] : [values[name]]);
      },
    };
  };
  return { faults, manifest, run:() => verifyDeploymentReadonly(manifest,{planBytes,evidenceBytes},factory) };
}

describe('EVM-first complete read-only verifier with simulated RPC', function () {
  it('requires an explicit supported numeric origin at the rollout-policy boundary', function () {
    const { rolloutPolicy } = require('../scripts/mainnet/rollout-policy');
    for (const sourceChainId of [undefined,9005,0,137,'1',null]) {
      expect(() => rolloutPolicy({schemaVersion:2,rollout:'evm-first',sourceChainId})).to.throw('explicit origin');
    }
  });
  for (const origin of [1,56,8453]) {
    it(`verifies all three chains with origin ${origin}`, async function () {
      const f = liveFixture(origin), results = await f.run();
      expect(results.map(r => r.chainId).sort()).to.deep.equal([1,56,8453].sort());
      expect(results.every(r => r.status === 'verified-paused-pristine')).to.equal(true);
    });
    it(`rejects wrong source/destination creation and wrapped origins for origin ${origin}`, async function () {
      for (const chain of [1,56,8453]) {
        const f = liveFixture(origin);
        Object.assign(f.faults,{chain,creation:chain === origin ? '0x61':'0x60'});
        await expectFailure(f.run(), 'deployment transaction does not contain audited creation bytecode');
        if (chain !== origin) {
          for (const wrong of [9005,chain]) {
            const g = liveFixture(origin); Object.assign(g.faults,{chain,wrappedOrigin:wrong});
            await expectFailure(g.run(),'origin chain mismatch');
          }
          const g = liveFixture(origin); Object.assign(g.faults,{chain,extraRoute:true});
          await expectFailure(g.run(),'on-chain routes do not exactly match');
        }
      }
    });
  }
});

async function expectFailure(promise, message) {
  let error;
  try { await promise; } catch (caught) { error = caught; }
  expect(error, `expected rejection: ${message}`).to.be.instanceOf(Error);
  expect(error.message).to.include(message);
}
