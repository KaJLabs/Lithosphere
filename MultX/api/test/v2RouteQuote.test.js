import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { quoteV2Routes } from '../src/services/v2RouteQuote.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),h='0x'+'1'.repeat(64),code='0x6000',hash=ethers.keccak256(code);
function fixture(){
 const route={id:'venue-a',enabled:true,chainId:31337,expiresAt:Math.floor(Date.now()/1000)+600,approvalRef:'fixture',standardTokensReviewed:true,tokenIn:a(1),tokenOut:a(2),router:a(3),factory:a(4),pair:a(5),routerCodeHash:hash,factoryCodeHash:hash,pairCodeHash:hash,tokenInCodeHash:hash,tokenOutCodeHash:hash,feeNumerator:997,feeDenominator:1000,maxPriceImpactBps:100,maxSlippageBps:100};
 const abi=new ethers.Interface(['function factory() view returns(address)','function getPair(address,address) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function balanceOf(address) view returns(uint256)','function getAmountsOut(uint256,address[]) view returns(uint256[])']);
 const provider={getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>50,getBlock:async()=>({hash:h,timestamp:Math.floor(Date.now()/1000)}),getCode:async()=>code,call:async req=>{
  assert.equal(req.blockTag,50);const tx=abi.parseTransaction({data:req.data});
  const output={factory:[a(4)],getPair:[a(5)],token0:[a(1)],token1:[a(2)],getReserves:[1000000n,2000000n,0],balanceOf:[3000000n],getAmountsOut:[[1000n,1992n]]}[tx.name];
  return abi.encodeFunctionResult(tx.name,output);
 }};
 return {route,provider,input:{tokenIn:a(1),tokenOut:a(2),amountIn:'1000',slippageBps:50}};
}
test('verified V2 quote binds canonical block, reserves, fees and minimum output',async()=>{
 const {route,provider,input}=fixture();const result=await quoteV2Routes(provider,[route],input);
 assert.equal(result.quotes.length,1);assert.equal(result.quotes[0].amountOut,'1992');assert.equal(result.quotes[0].minimumOutput,'1982');assert.equal(result.quotes[0].executable,false);
});
test('bad venue is excluded while another verified venue remains available',async()=>{
 const {route,provider,input}=fixture();const result=await quoteV2Routes(provider,[{...route,id:'bad',routerCodeHash:ethers.ZeroHash},route],input);
 assert.equal(result.quotes.length,1);assert.equal(result.unavailable.length,1);
});
test('expired policy, missing token review, excessive impact and empty bytecode refuse routes',async()=>{
 const {route,provider,input}=fixture();
 for(const changed of [{expiresAt:0},{standardTokensReviewed:false},{maxPriceImpactBps:1}])assert.equal((await quoteV2Routes(provider,[{...route,...changed}],input)).quotes.length,0);
 assert.equal((await quoteV2Routes({...provider,getCode:async()=> '0x'},[route],input)).quotes.length,0);
});
test('reorg invalidates all quotes',async()=>{
 const {route,provider,input}=fixture();let reads=0;
 await assert.rejects(quoteV2Routes({...provider,getBlock:async()=>({hash:++reads===1?h:ethers.ZeroHash,timestamp:Math.floor(Date.now()/1000)})},[route],input),/reorg/);
});

test('selects higher output from two independently verified pools',async()=>{
 const {route,provider,input}=fixture();
 const second={...route,id:'venue-b',router:a(7),factory:a(8),pair:a(6)};
 const abi=new ethers.Interface(['function factory() view returns(address)','function getPair(address,address) view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function getAmountsOut(uint256,address[]) view returns(uint256[])']);
 const original=provider.call;
 provider.call=async req=>{
  if([a(6),a(7),a(8)].includes(req.to)){
   let parsed;try{parsed=abi.parseTransaction({data:req.data});}catch{}
   if(parsed){const values={factory:[a(8)],getPair:[a(6)],getReserves:[1000000n,3000000n,0],getAmountsOut:[[1000n,2988n]]}[parsed.name];return abi.encodeFunctionResult(parsed.name,values);}
  }
  return original(req);
 };
 const result=await quoteV2Routes(provider,[route,second],input);
 assert.equal(result.quotes.length,2);assert.equal(result.quotes[0].venueId,'venue-b');assert.equal(result.quotes[0].amountOut,'2988');
});
