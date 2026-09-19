import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ethers } from 'ethers';
import { reviewDestinationRpc } from './helpers/reviewLab.js';
import { compileLocalV2Artifacts } from './helpers/localV2.js';
import { quoteV2Routes } from '../src/services/v2RouteQuote.js';
import { prepareV2Swap } from '../src/services/v2SwapPlan.js';

test('local V2 liquidity, verified quote and min-output-enforced execution',{skip:process.env.MULTX_LOCAL_DEX_TEST!=='1'},async()=>{
 const provider=new ethers.JsonRpcProvider(reviewDestinationRpc(),undefined,{cacheTimeout:-1});
 try{
  assert.match(await provider.send('web3_clientVersion',[]),/Hardhat/i);assert.equal((await provider.getNetwork()).chainId,9005n);
  const compiled=compileLocalV2Artifacts();
  assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==='error'),[]);
  const wallet=ethers.Wallet.createRandom().connect(provider),signer=new ethers.NonceManager(wallet);
  await provider.send('hardhat_setBalance',[wallet.address,'0x56BC75E2D63100000']);
  const deploy=async(artifact,args)=>{const c=await new ethers.ContractFactory(artifact.abi,artifact.bytecode??('0x'+artifact.evm.bytecode.object),signer).deploy(...args);await c.waitForDeployment();return c;};
  const tokenArtifact=JSON.parse(fs.readFileSync(new URL('../../contracts/artifacts/contracts/MockERC20.sol/MockERC20.json',import.meta.url),'utf8'));
  const inputToken=await deploy(tokenArtifact,['Input','IN',18]),outputToken=await deploy(tokenArtifact,['Output','OUT',18]);
  const factory=await deploy(compiled.contracts['LithoswapV2Factory.sol'].LithoswapV2Factory,[wallet.address]);
  const router=await deploy(compiled.contracts['LithoswapV2Router02.sol'].LithoswapV2Router02,[await factory.getAddress(),await inputToken.getAddress()]);
  const tokenIn=await inputToken.getAddress(),tokenOut=await outputToken.getAddress(),routerAddress=await router.getAddress();
  await(await inputToken.approve(routerAddress,1000000)).wait();await(await outputToken.approve(routerAddress,2000000)).wait();
  await(await router.addLiquidity(tokenIn,tokenOut,1000000,2000000,1000000,2000000,wallet.address,Math.floor(Date.now()/1000)+3600)).wait();
  const pair=await factory.getPair(tokenIn,tokenOut);
  const codeHash=async a=>ethers.keccak256(await provider.getCode(a));
  const route={id:'local-v2',enabled:true,chainId:9005,expiresAt:Math.floor(Date.now()/1000)+600,approvalRef:'local-fixture',standardTokensReviewed:true,tokenIn,tokenOut,router:routerAddress,factory:await factory.getAddress(),pair,routerCodeHash:await codeHash(routerAddress),factoryCodeHash:await codeHash(await factory.getAddress()),pairCodeHash:await codeHash(pair),tokenInCodeHash:await codeHash(tokenIn),tokenOutCodeHash:await codeHash(tokenOut),feeNumerator:997,feeDenominator:1000,maxPriceImpactBps:100,maxSlippageBps:100};
  const recipient=ethers.Wallet.createRandom().address,input={tokenIn,tokenOut,amountIn:'1000',slippageBps:50,sender:wallet.address,recipient,minimumOutput:'1982'};
  const result=await quoteV2Routes(provider,[route],input);assert.equal(result.quotes.length,1);assert.equal(result.quotes[0].amountOut,'1992');
  await assert.rejects(prepareV2Swap(provider,route,{...input,minimumOutput:'2000'}),/minimum no longer available/);
  const plan=await prepareV2Swap(provider,route,input);assert.ok(plan.approval);
  await(await signer.sendTransaction(plan.approval)).wait();
  await assert.rejects(router.swapExactTokensForTokens.staticCall(1000,2000,[tokenIn,tokenOut],recipient,plan.quote.expiresAt),/INSUFFICIENT_OUTPUT_AMOUNT/);
  const beforeIn=await inputToken.balanceOf(wallet.address),beforeOut=await outputToken.balanceOf(recipient);
  await(await signer.sendTransaction(plan.transaction)).wait();
  assert.equal(beforeIn-await inputToken.balanceOf(wallet.address),1000n);
  assert.equal(await outputToken.balanceOf(recipient)-beforeOut,1992n);
  assert.equal(await inputToken.allowance(wallet.address,routerAddress),0n);
  await assert.rejects(router.swapExactTokensForTokens.staticCall(1000,1,[tokenIn,tokenOut],recipient,1),/EXPIRED/);
 }finally{provider.destroy();}
});
