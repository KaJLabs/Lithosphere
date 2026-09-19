import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeRouteProposal } from '../src/services/nativeRoutePolicy.js';

const address = n => `0x${n.toString(16).padStart(40,'0')}`;
// All contracts, amounts and evidence references below are synthetic.
function fixture(chain = 1, reverse = false) {
  const native = (id, chainId) => ({id,chainId,kind:'native',decimals:18});
  const erc20 = (id, chainId, n) => ({id,chainId,kind:'erc20',decimals:18,address:address(n)});
  const assets = [native('external',chain),native('litho',9005),erc20('wrapped-native',chain,10),
    erc20('backed-litho',chain,11),erc20('litho-contract-facing',9005,12)];
  const shape = reverse ? [
    ['wrap','litho','litho-contract-facing'], ['bridge','litho-contract-facing','backed-litho'],
    ['swap','backed-litho','wrapped-native'], ['unwrap','wrapped-native','external'],
  ] : [
    ['wrap','external','wrapped-native'], ['swap','wrapped-native','backed-litho'],
    ['bridge','backed-litho','litho-contract-facing'], ['native-release','litho-contract-facing','litho'],
  ];
  const edges = shape.map(([kind,input,output],i) => ({id:`edge-${i}`,kind,input,output,capacityBaseUnits:'100',
    evidence:{reference:`synthetic-evidence-${i}`,observedAt:1000,validUntil:1100,
      quotedInputBaseUnits:String(100-i),minimumOutputBaseUnits:String(99-i),
      deploymentReference:'synthetic-deployment',liquidityReference:'synthetic-liquidity',
      backingReference:'synthetic-backing',finalityPolicyReference:'synthetic-finality',nativeAccountingReference:'synthetic-native-accounting'}}));
  const quote = {schemaVersion:1,id:'synthetic-quote',inputAsset:reverse?'litho':'external',outputAsset:reverse?'external':'litho',
    inputAmountBaseUnits:'100',minimumNativeOutputBaseUnits:'96',recipient:address(99),createdAt:1000,expiresAt:1060,
    executionMode:'recoverable-requote',atomic:false,recovery:{claimant:address(99),automaticTimeoutRefund:false,policyReference:'synthetic-recovery'},
    fees:[{kind:'source-gas',asset:reverse?'litho':'external',amountBaseUnits:'1',accounting:'separate'},
      {kind:'destination-gas',asset:reverse?'external':'litho',amountBaseUnits:'1',accounting:'separate'},
      {kind:'bridge',asset:'litho',amountBaseUnits:'0',accounting:'included-in-step-minimum'},
      {kind:'protocol',asset:'litho',amountBaseUnits:'0',accounting:'included-in-step-minimum'}],
    steps:edges.map((e,i)=>({edgeId:e.id,inputAmountBaseUnits:String(100-i),minimumOutputBaseUnits:String(99-i),evidenceReference:e.evidence.reference}))};
  return {quote,policy:{schemaVersion:1,mode:'offline-design',maxEvidenceAgeSeconds:60,maxQuoteLifetimeSeconds:60,assets,edges}};
}
const run = f => validateNativeRouteProposal(f.quote,f.policy,1010);

for (const chain of [1,56]) for (const reverse of [false,true]) {
  test(`synthetic native route ${reverse ? 'LITHO to' : 'to LITHO from'} ${chain}`, () => {
    const f=fixture(chain,reverse), result=run(f);
    assert.equal(result.status,'offline-design-valid');
    assert.equal(result.executable,false); assert.equal(result.evidenceAuthenticated,false);
    assert.equal(result.outputIdentity,`eip155:${reverse?chain:9005}/native`);
    assert.equal(result.minimumNativeOutputBaseUnits,'96');
  });
}

const negatives = [
  ['wrapped final output',f=>{f.quote.outputAsset='backed-litho';},/native endpoints/],
  ['wrong chain',f=>{f.policy.assets[2].chainId=56;},/chain transition/],
  ['native sentinel address',f=>{f.policy.assets[0].address=address(12);},/native asset/],
  ['unknown asset',f=>{f.quote.inputAsset='ETH';},/native endpoints/],
  ['duplicate identity',f=>{f.policy.assets.push({...f.policy.assets[0],id:'other'});},/duplicate asset/],
  ['unlisted edge',f=>{f.quote.steps[1].edgeId='attacker';},/allowlist/],
  ['wrong step order',f=>{f.quote.steps.reverse();},/continuity/],
  ['calldata injection',f=>{f.quote.steps[0].calldata='0xdead';},/payloads forbidden/],
  ['capacity exceeded',f=>{f.policy.edges[0].capacityBaseUnits='99';},/capacity/],
  ['missing liquidity evidence',f=>{delete f.policy.edges[1].evidence.liquidityReference;},/liquidity evidence/],
  ['missing backing evidence',f=>{delete f.policy.edges[2].evidence.backingReference;},/backing evidence/],
  ['missing finality evidence',f=>{delete f.policy.edges[2].evidence.finalityPolicyReference;},/finality policy/],
  ['missing native compatibility',f=>{delete f.policy.edges[3].evidence.nativeAccountingReference;},/native accounting/],
  ['stale evidence',f=>{f.policy.edges[1].evidence.observedAt=900;},/stale/],
  ['future evidence',f=>{f.policy.edges[1].evidence.observedAt=1020;},/future/],
  ['expired evidence',f=>{f.policy.edges[1].evidence.validUntil=1010;},/stale/],
  ['unbound evidence',f=>{f.quote.steps[1].evidenceReference='other';},/binding/],
  ['invented output quote',f=>{f.quote.steps[1].minimumOutputBaseUnits='200';},/amounts not bound/],
  ['wrong evidenced input',f=>{f.policy.edges[1].evidence.quotedInputBaseUnits='1000';},/amounts not bound/],
  ['expired quote',f=>{f.quote.expiresAt=1010;},/expired/],
  ['unbounded quote',f=>{f.quote.expiresAt=9999;},/lifetime/],
  ['amount discontinuity',f=>{f.quote.steps[1].inputAmountBaseUnits='100';},/amount continuity/],
  ['zero output',f=>{f.quote.steps[3].minimumOutputBaseUnits='0';},/out of range/],
  ['floating amount',f=>{f.quote.inputAmountBaseUnits=100;},/decimal string/],
  ['inflated final minimum',f=>{f.quote.minimumNativeOutputBaseUnits='100';},/minimum mismatch/],
  ['missing fee category',f=>{f.quote.fees.pop();},/all fee/],
  ['wrong gas chain',f=>{f.quote.fees[0].asset='litho';},/gas fee/],
  ['unknown fee treatment',f=>{delete f.quote.fees[2].accounting;},/fee accounting/],
  ['atomic promise',f=>{f.quote.atomic=true;},/non-atomic/],
  ['unproven guaranteed fill',f=>{f.quote.executionMode='guaranteed';},/recoverable/],
  ['automatic timeout refund',f=>{f.quote.recovery.automaticTimeoutRefund=true;},/no automatic refund/],
  ['wrong claimant',f=>{f.quote.recovery.claimant=address(98);},/claimant/],
  ['zero recipient',f=>{f.quote.recipient=address(0);},/recipient/],
  ['production mode',f=>{f.policy.mode='production';},/offline schema/],
];
for (const [name,mutate,message] of negatives) test(`rejects ${name}`,()=>{
  const f=fixture(); mutate(f); assert.throws(()=>run(f),message);
});

test('does not mutate quote or caller policy',()=>{
  const f=fixture(), before=JSON.stringify(f);run(f);assert.equal(JSON.stringify(f),before);
});
