const { expect } = require('chai');
const { ethers } = require('ethers');
const fs = require('fs'), path = require('path');
const { governance } = require('./governance-fixture');
const { validateGovernancePolicy } = require('../scripts/mainnet/governance-policy');
const { verifyGovernance, ROLES, ROLE_ABI, GUARD_SLOT, FALLBACK_SLOT } = require('../scripts/mainnet/verify-governance');
const { sha256Code } = require('../scripts/mainnet/verify-deployment-readonly');
const handler = '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99';
const hash = '8143b6ff3cf48028121244d88321907a1bddc24f1a6f12db01364511e816259a';
const raw = fs.readFileSync(path.join(__dirname,'fixtures/safe-v141-handler.hex'),'utf8').trim();
const a = n => '0x'+n.toString(16).padStart(40,'0');
function fixture(chainId = 56) {
  const approved = {chainId, safe:a(10), timelock:a(11), timelockDelaySeconds:172800, governance:governance(a(10),a(11),a(12))};
  const s = approved.governance.safe, t = approved.governance.timelock;
  Object.assign(s,{fallbackHandler:handler,fallbackHandlerRuntimeSha256:hash,proxyRuntimeSha256:sha256Code('0x60'),implementationRuntimeSha256:sha256Code('0x61')});
  const state = {code:raw,slot:handler,guard:a(0),modules:[],calls:0};
  const iface = new ethers.utils.Interface(ROLE_ABI);
  const logs = Object.entries(ROLES).flatMap(([name,role])=>t[name].map(account=>({
    ...iface.encodeEventLog(iface.getEvent('RoleGranted'),[role,account,a(12)]),blockNumber:1,transactionIndex:0,logIndex:0})));
  const provider = {
    getTransaction:async()=>({to:null,data:'0x63'+ethers.utils.defaultAbiCoder.encode(['uint256','address[]','address[]','address'],[172800,t.proposers,t.executors,t.constructorAdmin]).slice(2)}),
    getCode:async(address,block)=>{
      expect(block).to.equal(100);
      if(address.toLowerCase()===handler) {state.calls++; return state.code;}
      return address===approved.safe?'0x60':address===s.implementation?'0x61':'0x62';
    },
    getStorageAt:async(_address,slot)=>ethers.utils.hexZeroPad(slot===0?s.implementation:slot===GUARD_SLOT?state.guard:slot===FALLBACK_SLOT?state.slot:a(0),32),
  };
  const factory = address => address===approved.timelock ? {address, getMinDelay:async()=>172800,hasRole:async()=>true} : {
    VERSION:async()=>s.version,getOwners:async()=>s.owners,getThreshold:async()=>s.threshold,
    getModulesPaginated:async()=>[state.modules,a(1)],
  };
  const helpers = {verifyCreationProvenance:async()=>1,sha256Code,getLogsByTopics:async()=>logs};
  const run = ()=>verifyGovernance(provider,{name:'test',governance:{timelockDeploymentBlock:1}},approved,
    {contracts:{govTimelock:{creationBytecode:'0x63',runtimeSha256:sha256Code('0x62')}}},100,helpers,factory);
  return {approved,s,state,run};
}
async function rejects(run, message) {
  let error; try {await run();} catch(e) {error=e;}
  expect(error).to.be.instanceOf(Error); expect(error.message).to.include(message);
}
describe('pinned fallback amendment candidate',()=>{
  it('accepts the pinned handler only on the three allowlisted chains',async()=>{
    expect(sha256Code(raw)).to.equal(hash);
    for(const id of [1,56,8453]) {const f=fixture(id); validateGovernancePolicy(f.approved); await f.run(); expect(f.state.calls).to.equal(1);}
  });
  it('preserves the zero-handler path without fetching handler code',async()=>{
    const f=fixture(9005); f.s.fallbackHandler=a(0); delete f.s.fallbackHandlerRuntimeSha256; f.state.slot=a(0);
    validateGovernancePolicy(f.approved); await f.run(); expect(f.state.calls).to.equal(0);
    f.s.fallbackHandlerRuntimeSha256=hash; expect(()=>validateGovernancePolicy(f.approved)).to.throw('zero handler must omit');
  });
  for(const [label,mutate,error] of [
    ['chain',f=>{f.approved.chainId=9005;},'chain not allowlisted'],
    ['address',f=>{f.s.fallbackHandler=a(88);},'address not allowlisted'],
    ['hash',f=>{f.s.fallbackHandlerRuntimeSha256='a'.repeat(64);},'hash not pinned'],
    ['missing hash',f=>{delete f.s.fallbackHandlerRuntimeSha256;},'hash not pinned'],
  ]) it(`rejects isolated ${label} drift in plan and live governance entrypoint`,async()=>{
    const f=fixture(); mutate(f); expect(()=>validateGovernancePolicy(f.approved)).to.throw(error); await rejects(f.run,error);
  });
  it('rejects enabled modules and guard in the plan',()=>{
    const f=fixture(); f.s.modules=[a(88)]; expect(()=>validateGovernancePolicy(f.approved)).to.throw('modules and guard');
    f.s.modules=[]; f.s.guard=a(88); expect(()=>validateGovernancePolicy(f.approved)).to.throw('modules and guard');
  });
  for(const [label,mutate,error] of [
    ['empty runtime',f=>{f.state.code='0x';},'no runtime code'],
    ['changed runtime',f=>{f.state.code='0x6000';},'live runtime hash mismatch'],
    ['slot mismatch',f=>{f.state.slot=a(88);},'authority state mismatch'],
    ['live module',f=>{f.state.modules=[a(88)];},'authority state mismatch'],
    ['live guard',f=>{f.state.guard=a(88);},'authority state mismatch'],
  ]) it(`rejects ${label} through full governance verification`,async()=>{
    const f=fixture(); await f.run(); mutate(f); await rejects(f.run,error);
  });
});
