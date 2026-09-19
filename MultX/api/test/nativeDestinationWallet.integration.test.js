import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { ethers } from 'ethers';
import { seedLocalV2 } from './helpers/localV2.js';
import { createNativeApplication } from '../src/nativeApplication.js';
import { createNativeSourceIntent } from '../src/services/nativeSourceIntent.js';
import { verifyAndRecordNativeSource } from '../src/services/nativeSourceSettlement.js';
import { verifyNativeSwapReadiness } from '../src/services/nativeSwapReadiness.js';
import { bindSignedNativeDexExecution } from '../src/services/nativeDexExecution.js';
import { reconcileNativeDexBatch } from '../src/services/nativeDexMonitor.js';
import { prepareNativeRedemption, submitBoundNativeRedemption, verifyNativeRedemption } from '../src/services/nativeRedemption.js';
import { coordinateNativePayout } from '../src/services/nativePayoutCoordinator.js';
import { reconcileNativePayoutBatch } from '../src/services/nativePayoutMonitor.js';
import { reviewDestinationRpc, reviewPostgres, reviewSourceRpc } from './helpers/reviewLab.js';

test('original wallet authorizes destination approval/trade; separate custody redeems and pays native',
 {skip:process.env.MULTX_CROSS_CHAIN_TEST!=='1'},async()=>{
 const {createNativeDestinationWalletBackend,submitInjectedNativeDestinationStep}=await import('../../sdk/dist/index.js');
 const source=new ethers.JsonRpcProvider(reviewSourceRpc(),undefined,{cacheTimeout:-1});
 const destination=new ethers.JsonRpcProvider(reviewDestinationRpc(),undefined,{cacheTimeout:-1});
 const options=reviewPostgres(),admin=new pg.Pool(options);
 const schema='destination_'+Date.now();let pool,server,created=false;
 try{
  for(const [rpc,id]of [[source,31337],[destination,9005]]){assert.match(await rpc.send('web3_clientVersion',[]),/Hardhat/i);assert.equal(Number((await rpc.getNetwork()).chainId),id);}
  const original=ethers.Wallet.createRandom().connect(source),user=new ethers.Wallet(original.privateKey,destination),operator=ethers.Wallet.createRandom().connect(destination);
  for(const wallet of [original,user,operator])await wallet.provider.send('hardhat_setBalance',[wallet.address,'0x56BC75E2D63100000']);
  const sourceSigner=new ethers.NonceManager(original),operatorSigner=new ethers.NonceManager(operator);
  const artifact=name=>JSON.parse(fs.readFileSync(new URL('../../contracts/artifacts/contracts/'+name+'.sol/'+name+'.json',import.meta.url),'utf8'));
  const deploy=async(name,args,signer)=>{const a=artifact(name),contract=await new ethers.ContractFactory(a.abi,a.bytecode,signer).deploy(...args);await contract.waitForDeployment();return contract;};
  const validators=Array.from({length:5},()=>ethers.Wallet.createRandom()).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const sourceBridge=await deploy('MultXBridge',[validators.map(v=>v.address),3],sourceSigner);
  const sourceToken=await deploy('MockNativeWrapper',[],sourceSigner);
  const bridge=await deploy('MultXBridge',[validators.map(v=>v.address),3],operatorSigner);
  const settlement=await deploy('MockERC20',['Destination settlement','SET',18],operatorSigner);
  const nativeWrapper=await deploy('MockNativeWrapper',[],operatorSigner);
  await(await nativeWrapper.deposit({value:2000000})).wait();
  const venue=await seedLocalV2(operatorSigner,settlement,nativeWrapper);
  const sourceBridgeAddress=(await sourceBridge.getAddress()).toLowerCase(),sourceTokenAddress=(await sourceToken.getAddress()).toLowerCase(),bridgeAddress=(await bridge.getAddress()).toLowerCase();
  await(await sourceBridge.addSupportedToken(sourceTokenAddress)).wait();await(await sourceBridge.setSupportedRoute(sourceTokenAddress,9005,true)).wait();
  await admin.query('CREATE SCHEMA '+schema);created=true;pool=new pg.Pool({...options,options:'-c search_path='+schema});
  for(const file of fs.readdirSync(new URL('../src/db/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')&&name>='009').sort())await pool.query(fs.readFileSync(new URL('../src/db/migrations/'+file,import.meta.url),'utf8'));
  await pool.query("INSERT INTO native_swaps(swap_id,destination_chain,recipient,minimum_output) VALUES('wallet',9005,$1,2500)",[user.address.toLowerCase()]);
  const inputPolicy={enabled:true,chainId:31337,targetChains:[9005],confirmations:1,wrapper:sourceTokenAddress,bridge:sourceBridgeAddress,wrapperCodeHash:ethers.keccak256(await source.getCode(sourceTokenAddress)),bridgeCodeHash:ethers.keccak256(await source.getCode(sourceBridgeAddress)),approvalRef:'local-wallet-source',expiresAt:Math.floor(Date.now()/1000)+3600};
  const sourcePlan=await createNativeSourceIntent(pool,source,'wallet',inputPolicy,{sender:original.address,amountBaseUnits:'2000',targetChain:9005});
  let locked;
  for(const {kind,...request}of sourcePlan.steps){locked=await(await sourceSigner.sendTransaction(request)).wait();}
  const event=locked.logs.map(log=>{try{return sourceBridge.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='TokensLocked');
  const lock={sourceChain:31337,sourceBridge:sourceBridgeAddress,sourceTxHash:event.args.txHash,sourceBlock:locked.blockNumber,sourceBlockHash:locked.blockHash,sourceToken:sourceTokenAddress,user:original.address,amount:'2000',targetChain:9005,sourceNonce:event.args.nonce.toString()};
  await pool.query("INSERT INTO native_swap_sources(swap_id,source_chain,source_bridge,source_lock_hash,expectation) VALUES('wallet',31337,$1,$2,$3)",[sourceBridgeAddress,lock.sourceTxHash,lock]);
  const sourcePolicy={chainId:31337,bridgeAddress:sourceBridgeAddress,confirmations:1},sourceClient={provider:source,contract:sourceBridge};
  await verifyAndRecordNativeSource(pool,'wallet',sourcePolicy,sourceClient);
  await(await settlement.transfer(bridgeAddress,2000)).wait();
  const digest=ethers.solidityPackedKeccak256(['bytes32','address','address','address','uint256','uint256','uint256','uint256','address'],[lock.sourceTxHash,sourceBridgeAddress,venue.tokenIn,user.address,2000,31337,lock.sourceNonce,9005,bridgeAddress]);
  const signatures=await Promise.all(validators.slice(0,3).map(wallet=>wallet.signMessage(ethers.getBytes(digest))));
  const released=await(await bridge.releaseTokens(venue.tokenIn,user.address,2000,31337,sourceBridgeAddress,lock.sourceNonce,lock.sourceTxHash,signatures)).wait();
  const policy={mode:'direct-native-payout',chainId:9005,confirmations:1,bridge:bridgeAddress,bridgeCodeHash:ethers.keccak256(await destination.getCode(bridgeAddress)),token:venue.tokenIn,sourceChain:31337,sourceBridge:sourceBridgeAddress,sourceToken:sourceTokenAddress,sourceConfirmations:1,sourceAmountBaseUnits:'2000',settlementAmountBaseUnits:'2000',settlementHolder:user.address.toLowerCase(),payoutSender:operator.address.toLowerCase(),custodyRef:'separate-native-custody',excludedRecipients:[],maxPayoutGas:'30000',minimumNativeOutputBaseUnits:'2500',liquidityCommitmentRef:'local-funded-route',
   destinationDex:{venue,minimumOutput:'2500',slippageBps:50,confirmations:3,maxGas:'300000',maxApprovalGas:'100000'},nativeOutput:{kind:'wrapped-native-redemption',wrapper:venue.tokenOut,wrapperCodeHash:venue.tokenOutCodeHash,approvalRef:'local-wrapper',confirmations:3,maxGas:'120000'}};
  await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) VALUES('wallet-route',$1,'fixture-only','fixture',now()+interval '1 hour',true)",[policy]);
  const expectation={destinationChain:9005,transactionHash:released.hash,sourceChain:31337,sourceBridge:sourceBridgeAddress,sourceLockHash:lock.sourceTxHash,token:venue.tokenIn,holder:user.address.toLowerCase(),amount:'2000'};
  await pool.query("INSERT INTO native_swap_destinations(swap_id,policy_id,destination_chain,transaction_hash,expectation) VALUES('wallet','wallet-route',9005,$1,$2)",[released.hash,expectation]);
  const audience='destination-wallet-test',app=createNativeApplication({pool,providers:new Map([[31337,source],[9005,destination]]),sourcePolicies:new Map([[31337,inputPolicy]]),audience,allowedOrigins:['http://localhost:4178']});
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  const baseUrl='http://127.0.0.1:'+server.address().port+'/native-destination';let captured;
  const backend=createNativeDestinationWalletBackend({baseUrl,audience,signer:user,fetch:async(url,init)=>{captured={url,init};return fetch(url,init);}});
  assert.equal((await backend.getProgress('wallet')).state,'awaiting_settlement');
  assert.equal((await fetch(captured.url,captured.init)).status,401);
  const stranger=createNativeDestinationWalletBackend({baseUrl,audience,signer:operator});
  await assert.rejects(stranger.getProgress('wallet'),/403/);
  await verifyNativeSwapReadiness(pool,'wallet',sourcePolicy,sourceClient,destination);
  assert.equal((await backend.getProgress('wallet')).step,0);
  await assert.rejects(backend.getStep('wallet',1),/409/);
  const records=new Map(),store={get:async key=>records.get(key)??null,putIfAbsent:async(key,value)=>{if(!records.has(key))records.set(key,value);return records.get(key);}};
  let approvals=0;
  const approvalSigner={provider:destination,getAddress:()=>user.getAddress(),sendTransaction:async request=>{approvals++;return user.sendTransaction(request);}};
  assert.equal((await submitInjectedNativeDestinationStep({swapId:'wallet',step:0,signer:approvalSigner,backend,store})).state,'submitted');
  assert.equal((await submitInjectedNativeDestinationStep({swapId:'wallet',step:0,signer:approvalSigner,backend,store})).state,'submitted');assert.equal(approvals,1);
  assert.equal((await backend.getProgress('wallet')).state,'awaiting_finality');
  await destination.send('hardhat_mine',['0x2','0x0']);
  assert.equal((await backend.getProgress('wallet')).step,1);
  let trades=0,tradeHash;
  const lostTradeSigner={provider:destination,getAddress:()=>user.getAddress(),sendTransaction:async request=>{trades++;const sent=await user.sendTransaction(request);tradeHash=sent.hash;throw Error('wallet response lost after sending trade');}};
  const submission={swapId:'wallet',step:1,signer:lostTradeSigner,backend,store};
  assert.equal((await submitInjectedNativeDestinationStep(submission)).state,'wallet_reconciliation_required');
  assert.equal((await submitInjectedNativeDestinationStep(submission)).state,'wallet_reconciliation_required');assert.equal(trades,1);
  assert.equal((await backend.getProgress('wallet')).submissionReserved,true);
  // Approval hash is chain-visible but cannot be substituted for the trade.
  const approvalHash=(await pool.query("SELECT transaction_hash FROM native_destination_wallet_steps WHERE swap_id='wallet' AND step=0")).rows[0].transaction_hash;
  await assert.rejects(backend.observeTransaction('wallet',1,approvalHash),/409/);
  // Recreate the application and pool to resume from the durable journal.
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await pool.end();pool=new pg.Pool({...options,options:'-c search_path='+schema});
  const resumed=createNativeApplication({pool,providers:new Map([[31337,source],[9005,destination]]),sourcePolicies:new Map([[31337,inputPolicy]]),audience,allowedOrigins:['http://localhost:4178']});
  await new Promise(resolve=>{server=resumed.listen(Number(new URL(baseUrl).port),'127.0.0.1',resolve);});
  await pool.query("UPDATE native_route_policies SET enabled=false WHERE policy_id='wallet-route'");
  assert.equal((await backend.observeTransaction('wallet',1,tradeHash)).transactionHash,tradeHash);
  assert.equal((await backend.observeTransaction('wallet',1,tradeHash)).transactionHash,tradeHash);
  await assert.rejects(backend.assertCanSubmit('wallet',1),/409/);
  const tx=await destination.getTransaction(tradeHash);
  const raw=ethers.Transaction.from({type:tx.type,to:tx.to,nonce:tx.nonce,gasLimit:tx.gasLimit,gasPrice:tx.gasPrice,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,maxFeePerGas:tx.maxFeePerGas,data:tx.data,value:tx.value,chainId:tx.chainId,signature:tx.signature,accessList:tx.accessList}).serialized;
  await assert.rejects(bindSignedNativeDexExecution(pool,'wallet',raw),/mode already fixed/);
  await assert.rejects(pool.query("DELETE FROM native_destination_wallet_steps WHERE swap_id='wallet'"),/cannot be deleted/);
  await pool.query("UPDATE native_route_policies SET enabled=true WHERE policy_id='wallet-route'");
  await destination.send('hardhat_mine',['0x2','0x0']);
  assert.equal((await backend.getProgress('wallet')).state,'awaiting_verification');
  assert.equal((await reconcileNativeDexBatch(pool,new Map([[9005,destination]]))).results[0].state,'dex_verified');
  assert.equal((await backend.getProgress('wallet')).state,'dex_confirmed');
  assert.equal(await settlement.balanceOf(user.address),0n);
  const redemption=await prepareNativeRedemption(pool,destination,'wallet'),{from,...withdrawal}=redemption.transaction;
  const redemptionRaw=await operator.signTransaction(withdrawal);
  await submitBoundNativeRedemption(pool,destination,'wallet',redemptionRaw);
  await destination.send('hardhat_mine',['0x2','0x0']);await verifyNativeRedemption(pool,destination,'wallet');
  const before=await destination.getBalance(user.address);let signed;
  const custody={custodyRef:policy.custodyRef,getSignedTransaction:async request=>{if(!signed){const {from,...unsigned}=request.transaction;signed=await operator.signTransaction(unsigned);}return signed;}};
  await coordinateNativePayout({pool,provider:destination,swapId:'wallet',custody,sourcePolicy,sourceClient,submit:true});
  await reconcileNativePayoutBatch(pool,new Map([[9005,destination]]));
  assert.equal(await destination.getBalance(user.address)-before,2500n);
  assert.equal((await backend.getProgress('wallet')).state,'completed');
 }finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(pool)await pool.end();if(created)await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();source.destroy();destination.destroy();
 }
});
