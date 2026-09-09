const { expect } = require('chai');
const { ethers } = require('hardhat');
const { governance } = require('./governance-fixture');
const { validateGovernancePolicy } = require('../scripts/mainnet/governance-policy');
const { verifyGovernance, verifyRoles, verifySafe, GUARD_SLOT, FALLBACK_SLOT } = require('../scripts/mainnet/verify-governance');
const helpers = require('../scripts/mainnet/verify-deployment-readonly');
const zero = ethers.constants.AddressZero;
const a = n => ethers.utils.getAddress('0x'+n.toString(16).padStart(40,'0'));
async function rejects(fn, pattern) {
  let error;
  try { await fn(); } catch (e) { error = e; }
  expect(error, 'expected rejection').to.be.instanceOf(Error);
  expect(error.message).to.match(pattern);
}

describe('H-01 authenticated governance', function () {
  let deployer, safe, attacker, timelock, approved, record, evidence;
  beforeEach(async function () {
    [deployer,safe,attacker] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('GovTimelock');
    timelock = await factory.deploy(172800,[safe.address],[safe.address],zero);
    await timelock.deployed();
    const receipt = await timelock.deployTransaction.wait();
    approved = { safe:safe.address, timelock:timelock.address, timelockDelaySeconds:172800,
      governance:governance(safe.address,timelock.address,deployer.address) };
    record = {name:'test',governance:{timelockDeploymentTxHash:receipt.transactionHash,timelockDeploymentBlock:receipt.blockNumber}};
    evidence = {contracts:{govTimelock:{creationBytecode:factory.bytecode,
      runtimeSha256:helpers.sha256Code(await ethers.provider.getCode(timelock.address))}}};
  });
  it('reconstructs genuine constructor grants, including canceller and self-admin', async function () {
    await verifyRoles(ethers.provider,timelock,approved.governance.timelock,
      record.governance.timelockDeploymentBlock,await ethers.provider.getBlockNumber(),helpers.getLogsByTopics);
  });
  it('authenticates a real Safe 1.4.1 proxy and GovTimelock end-to-end', async function () {
    const safeArtifact = require('./fixtures/safe-1.4.1/Safe.json');
    const proxyArtifact = require('./fixtures/safe-1.4.1/SafeProxy.json');
    const singleton = await new ethers.ContractFactory(safeArtifact.abi,safeArtifact.bytecode,deployer).deploy();
    await singleton.deployed();
    const proxy = await new ethers.ContractFactory(proxyArtifact.abi,proxyArtifact.bytecode,deployer).deploy(singleton.address);
    await proxy.deployed();
    const realSafe = new ethers.Contract(proxy.address,safeArtifact.abi,deployer);
    await realSafe.setup([safe.address,attacker.address],2,zero,'0x',zero,zero,0,zero);
    const factory=await ethers.getContractFactory('GovTimelock');
    const realTimelock=await factory.deploy(172800,[realSafe.address],[realSafe.address],zero);
    const receipt=await realTimelock.deployTransaction.wait();
    const policy=governance(realSafe.address,realTimelock.address,deployer.address);
    Object.assign(policy.safe,{implementation:singleton.address,owners:[safe.address,attacker.address],
      proxyRuntimeSha256:helpers.sha256Code(await ethers.provider.getCode(proxy.address)),
      implementationRuntimeSha256:helpers.sha256Code(await ethers.provider.getCode(singleton.address))});
    const chain={name:'local',governance:{timelockDeploymentTxHash:receipt.transactionHash,timelockDeploymentBlock:receipt.blockNumber}};
    const plan={safe:realSafe.address,timelock:realTimelock.address,timelockDelaySeconds:172800,governance:policy};
    validateGovernancePolicy(plan);
    await verifyGovernance(ethers.provider,chain,plan,evidence,receipt.blockNumber,helpers);
  });
  it('rejects every hidden proposer, executor, canceller and administrator', async function () {
    for (const name of ['PROPOSER_ROLE','EXECUTOR_ROLE','CANCELLER_ROLE','DEFAULT_ADMIN_ROLE']) {
      const role = name === 'DEFAULT_ADMIN_ROLE' ? ethers.constants.HashZero : ethers.utils.id(name);
      const data = timelock.interface.encodeFunctionData('grantRole',[role,attacker.address]);
      const salt = ethers.utils.id(name);
      await timelock.connect(safe).schedule(timelock.address,0,data,ethers.constants.HashZero,salt,172800);
      await ethers.provider.send('evm_increaseTime',[172801]); await ethers.provider.send('evm_mine',[]);
      await timelock.connect(safe).execute(timelock.address,0,data,ethers.constants.HashZero,salt);
      const block = await ethers.provider.getBlockNumber();
      await rejects(() => verifyRoles(ethers.provider,timelock,approved.governance.timelock,
        record.governance.timelockDeploymentBlock,block,helpers.getLogsByTopics), /role set mismatch/);
      const revoke = timelock.interface.encodeFunctionData('revokeRole',[role,attacker.address]);
      const revokeSalt = ethers.utils.id('revoke'+name);
      await timelock.connect(safe).schedule(timelock.address,0,revoke,ethers.constants.HashZero,revokeSalt,172800);
      await ethers.provider.send('evm_increaseTime',[172801]); await ethers.provider.send('evm_mine',[]);
      await timelock.connect(safe).execute(timelock.address,0,revoke,ethers.constants.HashZero,revokeSalt);
      await verifyRoles(ethers.provider,timelock,approved.governance.timelock,
        record.governance.timelockDeploymentBlock,await ethers.provider.getBlockNumber(),helpers.getLogsByTopics);
    }
  });
  it('rejects false audited runtime even when role/delay views are correct', async function () {
    evidence.contracts.govTimelock.runtimeSha256='f'.repeat(64);
    await rejects(() => verifyGovernance(ethers.provider,record,approved,evidence,
      record.governance.timelockDeploymentBlock,helpers),/audited runtime mismatch/);
  });
  it('rejects different constructor privilege arrays and wrong creation provenance', async function () {
    approved.governance.timelock.executors=[zero];
    await rejects(() => verifyGovernance(ethers.provider,record,approved,evidence,
      record.governance.timelockDeploymentBlock,helpers),/constructor arguments mismatch/);
    approved.governance.timelock.deployer=attacker.address;
    await rejects(() => verifyGovernance(ethers.provider,record,approved,evidence,
      record.governance.timelockDeploymentBlock,helpers),/provenance mismatch/);
  });
  it('fails plan validation for unsafe governance and missing Safe acceptance', function () {
    for (const mutate of [g=>g.timelock.admins.push(attacker.address),g=>g.timelock.proposers=[attacker.address],
      g=>g.safe.modules=[attacker.address],g=>g.safe.guard=attacker.address,g=>g.safe.fallbackHandler=attacker.address,
      g=>g.safe.threshold=1,g=>g.safe.owners=[safe.address,safe.address],g=>g.safe.version='unknown',g=>delete g.safe.approvalRecordUrl]) {
      const input=JSON.parse(JSON.stringify(approved)); mutate(input.governance);
      expect(()=>validateGovernancePolicy(input)).to.throw();
    }
  });
});

describe('H-01 Safe exact policy', function () {
  function fixture() {
    const policy=governance(a(10),a(11),a(12)).safe;
    policy.proxyRuntimeSha256=helpers.sha256Code('0x6000');
    policy.implementationRuntimeSha256=helpers.sha256Code('0x6001');
    const slots = {'0':ethers.utils.hexZeroPad(policy.implementation,32),[GUARD_SLOT]:ethers.constants.HashZero,[FALLBACK_SLOT]:ethers.constants.HashZero};
    const provider={getCode:async address=>address===a(10)?'0x6000':'0x6001',getStorageAt:async (_a,slot)=>slots[String(slot)]};
    const safe={VERSION:async()=>policy.version,getOwners:async()=>policy.owners,getThreshold:async()=>ethers.BigNumber.from(policy.threshold),
      getModulesPaginated:async()=>[[],a(1)]};
    return {policy,slots,provider,safe,run:()=>verifySafe(provider,a(10),policy,1,helpers.sha256Code,()=>safe)};
  }
  it('accepts exactly approved proxy, implementation, owners and threshold',async function(){await fixture().run();});
  it('rejects fake proxy, singleton replacement, hidden owners/modules, threshold, guard and fallback',async function(){
    for(const mutate of [f=>f.provider.getCode=async()=> '0x60ff',f=>f.slots['0']=ethers.utils.hexZeroPad(a(666),32),
      f=>f.safe.getOwners=async()=>[...f.policy.owners,a(666)],f=>f.safe.getThreshold=async()=>ethers.BigNumber.from(1),
      f=>f.safe.getModulesPaginated=async()=>[[a(666)],a(1)],f=>f.slots[GUARD_SLOT]=ethers.utils.hexZeroPad(a(666),32),
      f=>f.slots[FALLBACK_SLOT]=ethers.utils.hexZeroPad(a(666),32)]) {
      const f=fixture();mutate(f);await rejects(f.run,/Safe/);
    }
  });
});

describe('M-01 exact supported-token universe', function () {
  for(const name of ['MultXBridge','MultXBridgeDest']) {
    it(`${name}: discovers undeclared supported token, including token without a route`,async function(){
      const signers=await ethers.getSigners();
      const factory=await ethers.getContractFactory(name);
      const bridge=await factory.deploy(signers.slice(0,7).map(s=>s.address),5);
      await bridge.deployed();
      const chain={name:'test',bridge:{address:bridge.address,deploymentBlock:(await bridge.deployTransaction.wait()).blockNumber},assets:[{address:a(101)}]};
      await expect(bridge.addSupportedToken(a(101))).to.emit(bridge,'SupportedTokenSet').withArgs(a(101),true);
      await helpers.verifyTokenUniverse(ethers.provider,bridge,chain,await ethers.provider.getBlockNumber());
      await bridge.addSupportedToken(a(999));
      const tip=await ethers.provider.getBlockNumber();
      await rejects(()=>helpers.verifyTokenUniverse(ethers.provider,bridge,chain,tip),/universe mismatch/);
      await expect(bridge.removeSupportedToken(a(999))).to.emit(bridge,'SupportedTokenSet').withArgs(a(999),false);
      await helpers.verifyTokenUniverse(ethers.provider,bridge,chain,await ethers.provider.getBlockNumber());
      await bridge.removeSupportedToken(a(101));
      await rejects(()=>helpers.verifyTokenUniverse(ethers.provider,bridge,chain,tip+2),/universe mismatch/);
    });
  }
});
