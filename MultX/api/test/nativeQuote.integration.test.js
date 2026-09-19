import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { ethers } from 'ethers';
import { createNativeApplication } from '../src/nativeApplication.js';
import { seedLocalV2 } from './helpers/localV2.js';
import { reviewDestinationRpc, reviewPostgres, reviewSourceRpc } from './helpers/reviewLab.js';

test('wallet-authenticated quote creates one immutable source intent', { skip: process.env.MULTX_CROSS_CHAIN_TEST !== '1' }, async () => {
  const { createNativeQuoteBackend, createNativeSourceWalletBackend } = await import('../../sdk/dist/index.js');
  const source = new ethers.JsonRpcProvider(reviewSourceRpc(), undefined, { cacheTimeout: -1 });
  const destination = new ethers.JsonRpcProvider(reviewDestinationRpc(), undefined, { cacheTimeout: -1 });
  const options = reviewPostgres();
  const admin = new pg.Pool(options);
  const schema = 'quote_' + Date.now();
  let pool, server, created = false;
  try {
    assert.equal(Number((await source.getNetwork()).chainId), 31337);
    const wallet = ethers.Wallet.createRandom().connect(source);
    await source.send('hardhat_setBalance', [wallet.address, '0x56BC75E2D63100000']);
    const signer = new ethers.NonceManager(wallet);
    const artifact = name => JSON.parse(fs.readFileSync(new URL('../../contracts/artifacts/contracts/' + name + '.sol/' + name + '.json', import.meta.url), 'utf8'));
    const deploy = async (name, args) => {
      const a = artifact(name);
      const contract = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };
    const validators = Array.from({ length: 5 }, () => ethers.Wallet.createRandom().address);
    const bridge = await deploy('MultXBridge', [validators, 3]);
    const wrapper = await deploy('MockNativeWrapper', []);
    const bridgeAddress = (await bridge.getAddress()).toLowerCase();
    const wrapperAddress = (await wrapper.getAddress()).toLowerCase();
    await (await bridge.addSupportedToken(wrapperAddress)).wait();
    await (await bridge.setSupportedRoute(wrapperAddress, 9005, true)).wait();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const sourceInputPolicy = { enabled: true, chainId: 31337, targetChains: [9005], confirmations:1, wrapper: wrapperAddress, bridge: bridgeAddress,
      wrapperCodeHash: ethers.keccak256(await source.getCode(wrapperAddress)), bridgeCodeHash: ethers.keccak256(await source.getCode(bridgeAddress)),
      approvalRef: 'local-quote-test', expiresAt };
    const payoutSender = ethers.Wallet.createRandom().address.toLowerCase();
    const routePolicy = { mode: 'direct-native-payout', sourceChain: 31337, chainId: 9005, sourceBridge: bridgeAddress,
      sourceToken: wrapperAddress, sourceAmountBaseUnits: '1000', minimumNativeOutputBaseUnits: '900',
      payoutSender, excludedRecipients: [], maxPayoutGas: '30000', sourceConfirmations: 1,
      quoteTerms: { fundingMode: 'prefunded-fixed-fill', atomic: false, fundingRef: 'test-funding', recoveryRef: 'test-recovery', automaticTimeoutRefund: false,
        fees: ['source-gas','destination-gas','bridge','protocol'].map(kind => ({kind, amountBaseUnits:'0', chainId:kind==='source-gas'?31337:9005, accounting:kind==='source-gas'?'separate-estimate':'included-in-fixed-output'})) } };

    await admin.query('CREATE SCHEMA ' + schema); created = true;
    pool = new pg.Pool({ ...options, options: '-c search_path=' + schema });
    for (const file of ['009-native-payout-assignments.sql', '010-native-swap-completion.sql', '011-native-source-evidence.sql',
      '012-native-destination-readiness.sql', '013-native-payout-drafts.sql', '014-native-payout-submissions.sql',
      '015-native-source-intents.sql', '016-native-wallet-auth.sql', '017-native-dex-executions.sql',
      '018-native-wallet-attempts.sql', '019-native-quotes.sql', '020-native-wallet-modes.sql', '021-native-redemptions.sql', '022-native-destination-wallet.sql']) {
      await pool.query(fs.readFileSync(new URL('../src/db/migrations/' + file, import.meta.url), 'utf8'));
    }
    await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) VALUES('quote-route',$1,'test-only','fixture',now()+interval '1 hour',true)", [routePolicy]);
    const audience = 'multx-local-quote-only';
    const app = createNativeApplication({pool,audience,providers:new Map([[31337,source],[9005,destination]]),
      sourcePolicies:new Map([[31337,sourceInputPolicy]]),allowedOrigins:['http://localhost:4178']});
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    const baseUrl = 'http://127.0.0.1:' + server.address().port + '/native-quotes';
    const client = createNativeQuoteBackend({ baseUrl, audience, signer: wallet });
    const request = { sourceChain: 31337, destinationChain: 9005, inputAmount: '1000', minimumOutput: '900', recipient: wallet.address };
    const quote = await client.createQuote(request);
    const second = await client.createQuote(request);
    assert.equal(quote.sourcePlan.steps[0].kind, 'wrap');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM native_swaps')).rows[0].count, 0);
    const stranger = createNativeQuoteBackend({ baseUrl, audience, signer: ethers.Wallet.createRandom() });
    await assert.rejects(stranger.acceptQuote(quote.quoteId), /409/);
    await assert.rejects(client.acceptQuote(quote.quoteId), /409/);
    await destination.send('hardhat_setBalance', [payoutSender, '0x56BC75E2D63100000']);
    assert.deepEqual(await client.acceptQuote(quote.quoteId), { swapId: quote.quoteId, alreadyAccepted: false });
    assert.deepEqual(await client.acceptQuote(quote.quoteId), { swapId: quote.quoteId, alreadyAccepted: true });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM native_swaps')).rows[0].count, 1);
    await assert.rejects(client.acceptQuote(second.quoteId), /409/);
    const sourceBackend=createNativeSourceWalletBackend({baseUrl:baseUrl.replace('/native-quotes','/native-source'),audience,signer:wallet});
    assert.equal((await sourceBackend.getStep(quote.quoteId,0)).kind,'wrap');
    assert.equal((await sourceBackend.getProgress(quote.quoteId)).swapState,'awaiting_settlement');
    await pool.query("UPDATE native_route_policies SET enabled=false WHERE policy_id='quote-route'");
    await assert.rejects(sourceBackend.assertCanSubmit(quote.quoteId,0),/409/);
    assert.equal((await sourceBackend.getProgress(quote.quoteId)).swapState,'awaiting_settlement');
    assert.equal((await pool.query('SELECT plan->>\'sender\' AS sender FROM native_source_intents WHERE swap_id=$1', [quote.quoteId])).rows[0].sender, wallet.address);
    const expiredId='0x'+'22'.repeat(32);
    await pool.query("INSERT INTO native_quotes(quote_id,wallet,policy_id,request,source_plan,expires_at) SELECT $1,wallet,policy_id,request,source_plan,now()-interval '1 minute' FROM native_quotes WHERE quote_id=$2",[expiredId,quote.quoteId]);
    await assert.rejects(client.acceptQuote(expiredId),/409/);
    await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) SELECT 'second-route',policy,'test-only-second','fixture',expires_at,true FROM native_route_policies WHERE policy_id='quote-route'");
    const next=await client.createQuote({...request,minimumOutput:'800'});
    const price=(await destination.getFeeData()).maxFeePerGas;
    const perFill=900n+30000n*price;
    await destination.send('hardhat_setBalance',[payoutSender,ethers.toBeHex(2n*perFill-1n)]);
    await assert.rejects(client.acceptQuote(next.quoteId),/409/);
    await destination.send('hardhat_setBalance',[payoutSender,'0x56BC75E2D63100000']);
    await client.acceptQuote(next.quoteId);
    assert.equal((await pool.query('SELECT minimum_output::text AS amount FROM native_swaps WHERE swap_id=$1',[next.quoteId])).rows[0].amount,'900');
    const destinationWallet=ethers.Wallet.createRandom().connect(destination);
    await destination.send('hardhat_setBalance',[destinationWallet.address,'0x56BC75E2D63100000']);
    const destinationSigner=new ethers.NonceManager(destinationWallet);
    const destinationDeploy=async(name,args)=>{
      const a=artifact(name),contract=await new ethers.ContractFactory(a.abi,a.bytecode,destinationSigner).deploy(...args);
      await contract.waitForDeployment();return contract;
    };
    const settlement=await destinationDeploy('MockERC20',['Quote settlement','SET',18]);
    const nativeWrapper=await destinationDeploy('MockNativeWrapper',[]);
    await(await settlement.mint(destinationWallet.address,1000000)).wait();
    await(await nativeWrapper.deposit({value:2000000})).wait();
    const venue=await seedLocalV2(destinationSigner,settlement,nativeWrapper);
    const marketPolicy={...routePolicy,token:venue.tokenIn,settlementHolder:wallet.address.toLowerCase(),settlementAmountBaseUnits:'1000',
      quoteTerms:{...routePolicy.quoteTerms,fundingMode:'dex-wrapped-native',fees:routePolicy.quoteTerms.fees.map(fee=>({...fee,accounting:fee.kind==='destination-gas'?'separate-estimate':fee.accounting}))},
      nativeOutput:{kind:'wrapped-native-redemption',wrapper:venue.tokenOut,wrapperCodeHash:venue.tokenOutCodeHash,approvalRef:'local-native-delivery',confirmations:1,maxGas:'120000'},
      destinationDex:{venue,minimumOutput:'900',slippageBps:50,confirmations:1,maxGas:'300000',maxApprovalGas:'100000'}};
    await pool.query("UPDATE native_route_policies SET enabled=false WHERE policy_id='second-route'");
    await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) VALUES('native-dex-route',$1,'test-only-native','fixture',now()+interval '1 hour',true)",[marketPolicy]);
    await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) VALUES('wrong-wallet-better-route',$1,'test-only-native','fixture',now()+interval '1 hour',true)",[{...marketPolicy,settlementHolder:destinationWallet.address.toLowerCase(),minimumNativeOutputBaseUnits:'1000'}]);
    const marketQuote=await client.createQuote(request);
    assert.equal(marketQuote.policyId,'native-dex-route');
    assert.equal(marketQuote.terms.fundingMode,'dex-wrapped-native');
    assert.ok(BigInt(marketQuote.terms.destinationQuote.minimumOutput)>=900n);
    assert.equal(marketQuote.terms.destinationQuote.venueId,venue.id);
    const marketPrice=(await destination.getFeeData()).maxFeePerGas;
    const allGasAndExistingFills=1800n+(60000n+30000n+120000n)*marketPrice;
    await destination.send('hardhat_setBalance',[payoutSender,ethers.toBeHex(allGasAndExistingFills-1n)]);
    await assert.rejects(client.acceptQuote(marketQuote.quoteId),/409/);
    // No native output prefunding is needed for this fill: the approved DEX
    // wrapper will supply it. Existing fills and all delivery gas stay reserved.
    await destination.send('hardhat_setBalance',[payoutSender,ethers.toBeHex(allGasAndExistingFills)]);
    await assert.rejects(client.acceptQuote(marketQuote.quoteId),/409/);
    await destination.send('hardhat_setBalance',[wallet.address,ethers.toBeHex(400000n*marketPrice-1n)]);
    await assert.rejects(client.acceptQuote(marketQuote.quoteId),/409/);
    await destination.send('hardhat_setBalance',[wallet.address,ethers.toBeHex(400000n*marketPrice)]);
    await client.acceptQuote(marketQuote.quoteId);
    await pool.query("INSERT INTO native_route_policies(policy_id,policy,approval_ref,approved_by,expires_at,enabled) VALUES('another-user-gas-fill',$1,'test-only-native','fixture',now()+interval '1 hour',true)",[marketPolicy]);
    const competing=await client.createQuote(request);
    await destination.send('hardhat_setBalance',[payoutSender,'0x56BC75E2D63100000']);
    await assert.rejects(client.acceptQuote(competing.quoteId),/409/);
    const backing=await destination.getBalance(venue.tokenOut);
    await destination.send('hardhat_setBalance',[venue.tokenOut,'0x0']);
    await assert.rejects(client.createQuote(request),/409/);
    await destination.send('hardhat_setBalance',[venue.tokenOut,ethers.toBeHex(backing)]);
    await assert.rejects(pool.query("UPDATE native_quotes SET request=jsonb_set(request,'{inputAmount}','\"1001\"') WHERE quote_id=$1", [quote.quoteId]), /immutable/);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    if (created) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end(); source.destroy(); destination.destroy();
  }
});
