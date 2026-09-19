import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coordinateNativePayout } from '../src/services/nativePayoutCoordinator.js';
import { createFilePayoutCustody } from '../src/services/nativeFileCustody.js';
import pg from 'pg';
import { reviewDestinationRpc, reviewPostgres } from './helpers/reviewLab.js';
import { ethers } from 'ethers';
import { verifyNativeSwapReadiness } from '../src/services/nativeSwapReadiness.js';
import { prepareNativePayout } from '../src/services/nativePayoutDraft.js';
import { bindSignedNativePayout } from '../src/services/nativeSignedPayout.js';
import { reconcileNativePayoutBatch } from '../src/services/nativePayoutMonitor.js';
import { verifyAndRecordNativePayout } from '../src/services/nativePayoutStore.js';
import { submitBoundNativePayout } from '../src/services/nativePayoutSubmission.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),h=n=>'0x'+n.toString(16).padStart(64,'0');
test('PostgreSQL readiness binds source, destination and approved route atomically',{skip:process.env.MULTX_PAYOUT_DB_TEST!=='1'},async()=>{
 const options=reviewPostgres();
 const realEvm=process.env.MULTX_PAYOUT_LOCAL_EVM==='1';
 const local=realEvm?new ethers.JsonRpcProvider(reviewDestinationRpc(),undefined,{cacheTimeout:-1}):null;
 const custodyDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'multx-custody-'));let custodyFile;
 const admin=new pg.Pool(options),schema='ready_'+Date.now();let pool;
 try{
  await admin.query('CREATE SCHEMA '+schema);pool=new pg.Pool({...options,options:'-c search_path='+schema});
  for(const name of fs.readdirSync(new URL('../src/db/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')&&name>='009').sort())await pool.query(fs.readFileSync(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
  await pool.query("INSERT INTO native_swaps(swap_id,destination_chain,recipient,minimum_output) VALUES('s',9005,$1,1000)",[a(70)]);
  const lock={sourceChain:1,sourceBridge:a(40),sourceTxHash:h(2),sourceBlock:40,sourceBlockHash:h(4),sourceToken:a(80),user:a(90),amount:'2000',targetChain:9005,sourceNonce:'1'};
  await pool.query("INSERT INTO native_swap_sources(swap_id,source_chain,source_bridge,source_lock_hash,expectation,verified_evidence,verified_at) VALUES('s',1,$1,$2,$3,'{}',now())",[a(40),h(2),lock]);
  const wallet=ethers.Wallet.createRandom();
  if(local){
   assert.match(await local.send('web3_clientVersion',[]),/Hardhat/i);
   assert.equal((await local.getNetwork()).chainId,9005n);
   await local.send('hardhat_setBalance',[wallet.address,'0xDE0B6B3A7640000']);
  }
  const policy={mode:'direct-native-payout',payoutSender:wallet.address.toLowerCase(),custodyRef:'synthetic-operator',excludedRecipients:[a(1)],maxPayoutGas:'30000',chainId:9005,confirmations:12,bridge:a(20),token:a(30),bridgeCodeHash:ethers.keccak256('0x6000'),sourceChain:1,sourceBridge:a(40),sourceToken:a(80),settlementHolder:a(90),sourceAmountBaseUnits:'2000',settlementAmountBaseUnits:'2000',minimumNativeOutputBaseUnits:'1000',liquidityCommitmentRef:'synthetic-fixed-payout'};
  await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at) VALUES('p',$1,'synthetic-approval','fixture',now()+interval '1 hour')",[policy]);
  const e={destinationChain:9005,transactionHash:h(1),sourceChain:1,sourceBridge:a(40),sourceLockHash:h(2),token:a(30),holder:a(90),amount:'2000'};
  await pool.query("INSERT INTO native_swap_destinations(swap_id,policy_id,destination_chain,transaction_hash,expectation) VALUES('s','p',9005,$1,$2)",[h(1),e]);
  const sourcePolicy={chainId:1,bridgeAddress:a(40),confirmations:12};
  const src={provider:{getNetwork:async()=>({chainId:1n}),getBlockNumber:async()=>60,getBlock:async()=>({hash:h(4)})},contract:{filters:{TokensLocked:()=>({})},queryFilter:async()=>[{removed:false,address:a(40),blockNumber:40,blockHash:h(4),args:{txHash:h(2),token:a(80),user:a(90),amount:'2000',targetChain:9005,nonce:'1'}}]}};
  const abi=new ethers.Interface(['event TokensReleased(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 sourceChain,address sourceBridge,address releasedBy)']);
  const event=abi.encodeEventLog(abi.getEvent('TokensReleased'),[h(2),a(30),a(90),2000,1,a(40),a(60)]);
  const dst={getNetwork:async()=>({chainId:9005n}),getTransactionReceipt:async()=>({status:1,hash:h(1),to:a(20),blockNumber:50,blockHash:h(3),logs:[{address:a(20),...event}]}),getBlockNumber:async()=>61,getBlock:async()=>({hash:h(3)}),getCode:async()=> '0x6000',call:async req=>ethers.AbiCoder.defaultAbiCoder().encode(['uint256'],[req.blockTag===49?0:2000])};
  const ready=()=>verifyNativeSwapReadiness(pool,'s',sourcePolicy,src,dst);
  await assert.rejects(ready(),/active route/);
  await assert.rejects(pool.query("UPDATE native_swaps SET state='payout_ready',route_policy_ref='p',settlement_evidence_ref=$1 WHERE swap_id='s'",[h(1)]),/verified destination/);
  await pool.query("UPDATE native_route_policies SET enabled=true WHERE policy_id='p'");
  const saved=dst.getBlock;dst.getBlock=async()=>({hash:h(99)});await assert.rejects(ready(),/reorg/);dst.getBlock=saved;
  await pool.query("CREATE FUNCTION fail_ready_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected readiness failure'; END $$; CREATE TRIGGER fail_ready BEFORE UPDATE ON native_swaps FOR EACH ROW EXECUTE FUNCTION fail_ready_test()");
  await assert.rejects(ready(),/injected readiness/);
  assert.equal((await pool.query("SELECT verified_evidence FROM native_swap_destinations WHERE swap_id='s'")).rows[0].verified_evidence,null);
  await pool.query('DROP TRIGGER fail_ready ON native_swaps');
  const results=await Promise.allSettled([ready(),ready()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const row=(await pool.query("SELECT * FROM native_swaps WHERE swap_id='s'")).rows[0];assert.equal(row.state,'payout_ready');assert.equal(row.route_policy_ref,'p');assert.equal(row.settlement_evidence_ref,h(1));
  await assert.rejects(pool.query("UPDATE native_route_policies SET policy='{}' WHERE policy_id='p'"),/new version/);
  const payoutProvider={getNetwork:async()=>({chainId:9005n}),getCode:async()=> '0x',getTransactionCount:async()=>7,getFeeData:async()=>({gasPrice:2n}),estimateGas:async()=>21000n,getBalance:async()=>100000n};
  if(local)for(const method of Object.keys(payoutProvider))payoutProvider[method]=local[method].bind(local);
  await assert.rejects(prepareNativePayout(pool,{...payoutProvider,getBalance:async()=>1n},'s'),/insufficient payout/);
  await assert.rejects(prepareNativePayout(pool,{...payoutProvider,getNetwork:async()=>({chainId:1n})},'s'),/wrong payout chain/);
  await assert.rejects(prepareNativePayout(pool,{...payoutProvider,getCode:async()=> '0x6000'},'s'),/EOA/);
  const drafts=await Promise.all([prepareNativePayout(pool,payoutProvider,'s'),prepareNativePayout(pool,payoutProvider,'s')]);
  assert.equal(drafts.filter(d=>!d.alreadyPrepared).length,1);
  assert.equal(drafts[0].transaction.to,a(70));assert.equal(drafts[0].transaction.value,'1000');assert.ok(BigInt(drafts[0].transaction.gasLimit)>=21000n&&BigInt(drafts[0].transaction.gasLimit)<=30000n);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM native_payout_drafts')).rows[0].n,1);
  await assert.rejects(pool.query('DELETE FROM native_payout_drafts'),/immutable/);
  const {from,...unsigned}=drafts[0].transaction;
  const sign=async changes=>wallet.signTransaction({...unsigned,...changes});
  for(const changed of [{to:a(999)},{value:'999'},{nonce:8},{chainId:1},{gasLimit:(BigInt(unsigned.gasLimit)+1n).toString()},{gasPrice:'3'},{data:'0x01'}])await assert.rejects(bindSignedNativePayout(pool,'s',await sign(changed)),/differs/);
  await assert.rejects(bindSignedNativePayout(pool,'s',await ethers.Wallet.createRandom().signTransaction(unsigned)),/differs/);
  const signed=await sign({});
  const bindings=await Promise.all([bindSignedNativePayout(pool,'s',signed),bindSignedNativePayout(pool,'s',signed)]);
  assert.equal(bindings.filter(b=>!b.alreadyBound).length,1);
  assert.equal(bindings[0].transactionHash,ethers.Transaction.from(signed).hash);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM native_payout_assignments')).rows[0].n,1);
  assert.equal((await pool.query("SELECT state FROM native_swaps WHERE swap_id='s'")).rows[0].state,'payout_ready');
  let broadcasts=0,known=false;
  const submissionProvider={...dst,...payoutProvider,getCode:async address=>address.toLowerCase()===a(20)?'0x6000':'0x',getTransaction:async hash=>local?local.getTransaction(hash):(known?{hash}:null),
   broadcastTransaction:async raw=>{assert.equal(raw,signed);broadcasts++;if(local)await local.broadcastTransaction(raw);known=true;throw Error('simulated response lost after acceptance');}};
  const custody=createFilePayoutCustody(custodyDirectory,policy.custodyRef);
  const args={pool,provider:submissionProvider,swapId:'s',custody,sourcePolicy,sourceClient:src};
  const prepared=await coordinateNativePayout(args);
  assert.equal(prepared.state,'prepared');assert.equal(broadcasts,0);
  assert.equal((await coordinateNativePayout({...args,submit:true})).state,'awaiting_custody');
  await assert.rejects(coordinateNativePayout({...args,submit:true,custody:{...custody,custodyRef:'wrong'}}),/matching custody/);
  custodyFile=path.join(custodyDirectory,prepared.request.requestId+'.signed');
  fs.writeFileSync(custodyFile,await sign({value:'999'}),{mode:0o600});
  await assert.rejects(coordinateNativePayout({...args,submit:true}),/differs/);assert.equal(broadcasts,0);
  fs.writeFileSync(custodyFile,signed,{mode:0o600});
  const submitted=await coordinateNativePayout({...args,submit:true});
  assert.equal(submitted.state,'uncertain');
  const recovered=await coordinateNativePayout({...args,submit:true,custody:createFilePayoutCustody(custodyDirectory,policy.custodyRef)});
  assert.equal(recovered.state,'submitted');assert.equal(broadcasts,1);
  assert.equal((await pool.query("SELECT state FROM native_swaps WHERE swap_id='s'")).rows[0].state,'payout_ready');
  await pool.query("UPDATE native_route_policies SET enabled=false WHERE policy_id='p'");
  await assert.rejects(submitBoundNativePayout(pool,submissionProvider,'s',signed,sourcePolicy,src),/revoked or expired/);
  assert.equal(broadcasts,1);
  await assert.rejects(bindSignedNativePayout(pool,'s',signed),/revoked or expired/);
  await assert.rejects(prepareNativePayout(pool,payoutProvider,'s'),/revoked or expired/);
  // Revocation stops new submissions, but must not hide an already-paid transfer.
  const transactionHash=ethers.Transaction.from(signed).hash;
  const minedProvider={getNetwork:async()=>({chainId:9005n}),
   getTransaction:async()=>({hash:transactionHash,from:wallet.address,to:a(70),nonce:7,data:'0x',value:1000n,blockNumber:70,blockHash:h(700)}),
   getTransactionReceipt:async()=>({hash:transactionHash,status:1,blockNumber:70,blockHash:h(700)}),
   getBlockNumber:async()=>81,getBlock:async()=>({hash:h(700)}),getCode:async()=> '0x',
   getBalance:async(address,height)=>height===69?0n:1000n};
  if(local){
   await assert.rejects(verifyAndRecordNativePayout(pool,local,'s'),/not final/);
   await local.send('hardhat_mine',['0xb','0x0']);
   for(const method of Object.keys(minedProvider))minedProvider[method]=local[method].bind(local);
  }
  await assert.rejects(verifyAndRecordNativePayout(pool,{...minedProvider,getTransactionReceipt:async()=>null},'s'),/not mined/);
  await assert.rejects(verifyAndRecordNativePayout(pool,{...minedProvider,getBlockNumber:async()=>0},'s'),/not final/);
  await assert.rejects(verifyAndRecordNativePayout(pool,{...minedProvider,getBalance:async()=>0n},'s'),/credit not established/);
  assert.equal((await pool.query("SELECT state FROM native_swaps WHERE swap_id='s'")).rows[0].state,'payout_ready');
  const missing=await reconcileNativePayoutBatch(pool,new Map(),{limit:1});
  assert.equal(missing.results[0].state,'provider_missing');assert.equal(missing.next,'s');
  const pending=await reconcileNativePayoutBatch(pool,new Map([[9005,{...minedProvider,getTransactionReceipt:async()=>null}]]),{limit:1});
  assert.equal(pending.results[0].state,'unverified');assert.equal(pending.next,'s');
  const end=await reconcileNativePayoutBatch(pool,new Map(),{after:pending.next,limit:1});
  assert.equal(end.next,'');assert.deepEqual(end.results,[]);
  // Fresh worker cursor after restart re-discovers the persisted assignment.
  const completed=await reconcileNativePayoutBatch(pool,new Map([[9005,minedProvider]]));
  assert.equal(completed.results[0].state,'completed');
  const replay=await verifyAndRecordNativePayout(pool,minedProvider,'s');
  assert.equal(replay.alreadyRecorded,true);assert.equal(replay.evidence.transactionHash,transactionHash);
  assert.equal((await pool.query("SELECT state FROM native_swaps WHERE swap_id='s'")).rows[0].state,'completed');
  assert.deepEqual((await reconcileNativePayoutBatch(pool,new Map([[9005,minedProvider]]))).results,[]);
  assert.equal(broadcasts,1);
  assert.equal((await coordinateNativePayout({...args,submit:true,custody:null})).state,'completed');

 }finally{if(custodyFile&&fs.existsSync(custodyFile))fs.unlinkSync(custodyFile);fs.rmdirSync(custodyDirectory);if(local)local.destroy();if(pool)await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
