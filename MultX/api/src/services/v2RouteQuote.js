import { ethers } from 'ethers';
const address=value=>ethers.getAddress(value).toLowerCase();
const amount=value=>{if(typeof value!=='string'||! /^[1-9][0-9]{0,77}$/.test(value)||BigInt(value)>=2n**256n)throw Error('invalid route amount');return BigInt(value);};
// Read-only, direct ERC-20 V2 paths. Registry is operator-owned and reviewed.
export async function quoteV2Routes(provider,registry,input){
 const chainId=Number((await provider.getNetwork()).chainId),tokenIn=address(input.tokenIn),tokenOut=address(input.tokenOut),amountIn=amount(input.amountIn);
 if(tokenIn===tokenOut||[tokenIn,tokenOut].includes(ethers.ZeroAddress)||!Number.isSafeInteger(chainId)||chainId<=0)throw Error('invalid route identity');
 if(!Number.isInteger(input.slippageBps)||input.slippageBps<0||input.slippageBps>1000||!Array.isArray(registry)||registry.length>20)throw Error('invalid routing bounds');
 if(registry.some(r=>typeof r?.id!=='string'||!r.id.trim())||new Set(registry.map(r=>r.id)).size!==registry.length)throw Error('unique venue identities required');
 const height=await provider.getBlockNumber(),block=await provider.getBlock(height),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(height)||height<1||! /^0x[0-9a-f]{64}$/i.test(block?.hash??'')||!Number.isSafeInteger(block?.timestamp)||block.timestamp>now+5||now-block.timestamp>120)throw Error('fresh canonical route block required');
 const quotes=[],unavailable=[];
 for(const route of registry){
  try{
   if(!route.enabled||route.chainId!==chainId||!Number.isSafeInteger(route.expiresAt)||route.expiresAt<=now||typeof route.approvalRef!=='string'||!route.approvalRef.trim()||route.standardTokensReviewed!==true)throw Error('route not approved');
   if(address(route.tokenIn)!==tokenIn||address(route.tokenOut)!==tokenOut)throw Error('asset pair not covered');
   if(!Number.isInteger(route.feeNumerator)||!Number.isInteger(route.feeDenominator)||route.feeNumerator<=0||route.feeNumerator>=route.feeDenominator||route.feeDenominator>1000000||!Number.isInteger(route.maxPriceImpactBps)||route.maxPriceImpactBps<0||route.maxPriceImpactBps>1000||!Number.isInteger(route.maxSlippageBps)||route.maxSlippageBps<0||route.maxSlippageBps>1000||input.slippageBps>route.maxSlippageBps)throw Error('invalid venue risk policy');
   for(const [target,hash] of [[route.router,route.routerCodeHash],[route.factory,route.factoryCodeHash],[route.pair,route.pairCodeHash],[tokenIn,route.tokenInCodeHash],[tokenOut,route.tokenOutCodeHash]]){
    const code=await provider.getCode(address(target),height);
    if(code==='0x'||ethers.keccak256(code)!==hash)throw Error('venue runtime mismatch');
   }
   const call=async(target,signature,args=[])=>{const abi=new ethers.Interface([signature]),fn=abi.fragments[0].name;return abi.decodeFunctionResult(fn,await provider.call({to:address(target),data:abi.encodeFunctionData(fn,args),blockTag:height}));};
   if(address((await call(route.router,'function factory() view returns(address)'))[0])!==address(route.factory))throw Error('router factory mismatch');
   if(address((await call(route.factory,'function getPair(address,address) view returns(address)',[tokenIn,tokenOut]))[0])!==address(route.pair))throw Error('factory pool mismatch');
   const t0=address((await call(route.pair,'function token0() view returns(address)'))[0]),t1=address((await call(route.pair,'function token1() view returns(address)'))[0]);
   if(!((t0===tokenIn&&t1===tokenOut)||(t0===tokenOut&&t1===tokenIn)))throw Error('pool asset mismatch');
   const reserves=await call(route.pair,'function getReserves() view returns(uint112,uint112,uint32)');
   const [rin,rout]=t0===tokenIn?[reserves[0],reserves[1]]:[reserves[1],reserves[0]];
   if(rin<=0n||rout<=0n)throw Error('pool has no liquidity');
   for(const [token,reserve] of [[tokenIn,rin],[tokenOut,rout]])if((await call(token,'function balanceOf(address) view returns(uint256)',[route.pair]))[0]<reserve)throw Error('pool reserve deficit');
   const weighted=amountIn*BigInt(route.feeNumerator),out=weighted*rout/(rin*BigInt(route.feeDenominator)+weighted);
   const quoted=(await call(route.router,'function getAmountsOut(uint256,address[]) view returns(uint256[])',[amountIn,[tokenIn,tokenOut]]))[0];
   if(quoted.length!==2||quoted[0]!==amountIn||quoted[1]!==out||out<=0n||out>=rout)throw Error('venue quote mismatch');
   const spot=amountIn*rout/rin;
   if(spot<=0n||(spot-out)*10000n>spot*BigInt(route.maxPriceImpactBps))throw Error('price impact exceeds policy');
   const minimum=out*BigInt(10000-input.slippageBps)/10000n;if(minimum<=0n)throw Error('zero output minimum');
   quotes.push({venueId:route.id,approvalRef:route.approvalRef,chainId,router:address(route.router),pair:address(route.pair),path:[tokenIn,tokenOut],amountIn:amountIn.toString(),amountOut:out.toString(),minimumOutput:minimum.toString(),blockNumber:height,blockHash:block.hash,expiresAt:Math.min(route.expiresAt,now+30),executable:false});
  }catch{unavailable.push({venueId:route.id,reason:'verification_failed'});}
 }
 if((await provider.getBlock(height))?.hash?.toLowerCase()!==block.hash.toLowerCase())throw Error('route block reorged');
 quotes.sort((a,b)=>BigInt(a.amountOut)>BigInt(b.amountOut)?-1:BigInt(a.amountOut)<BigInt(b.amountOut)?1:String(a.venueId).localeCompare(String(b.venueId)));
 return {quotes,unavailable};
}
