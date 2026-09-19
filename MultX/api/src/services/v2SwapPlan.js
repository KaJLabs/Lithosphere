import { ethers } from 'ethers';
import { quoteV2Routes } from './v2RouteQuote.js';
// Internal, unsigned execution plan. Requote the single approved venue and retain
// the user's original minimum; refreshed prices can never weaken that minimum.
export async function prepareV2Swap(provider,route,input){
 const sender=ethers.getAddress(input.sender),recipient=ethers.getAddress(input.recipient);
 if([sender,recipient].includes(ethers.ZeroAddress)||typeof input.minimumOutput!=='string'||! /^[1-9][0-9]{0,77}$/.test(input.minimumOutput)||BigInt(input.minimumOutput)>=2n**256n)throw Error('explicit swap parties and minimum required');
 const {quotes}=await quoteV2Routes(provider,[route],input),quote=quotes[0];
 if(!quote)throw Error('verified venue unavailable');
 const original=BigInt(input.minimumOutput),minimum=original>BigInt(quote.minimumOutput)?original:BigInt(quote.minimumOutput);
 if(BigInt(quote.amountOut)<minimum)throw Error('original minimum no longer available');
 const token=new ethers.Contract(input.tokenIn,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],provider);
 if(await token.balanceOf(sender)<BigInt(quote.amountIn))throw Error('insufficient swap input');
 const allowance=await token.allowance(sender,quote.router);
 const approve=new ethers.Interface(['function approve(address,uint256) returns(bool)']);
 const swap=new ethers.Interface(['function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])']);
 const common={from:sender,chainId:quote.chainId,value:'0'};
 return {quote,minimumOutput:minimum.toString(),
  approval:allowance<BigInt(quote.amountIn)?{...common,to:quote.path[0],data:approve.encodeFunctionData('approve',[quote.router,quote.amountIn])}:null,
  transaction:{...common,to:quote.router,data:swap.encodeFunctionData('swapExactTokensForTokens',[quote.amountIn,minimum,quote.path,recipient,quote.expiresAt])}};
}
