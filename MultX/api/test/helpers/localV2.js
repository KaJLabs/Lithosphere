import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
// Local-only fixture compiler and liquidity. Caller first verifies Hardhat identity.
export function compileLocalV2Artifacts(){
 const root=new URL('../../../../Makalu/contracts/src/dex/',import.meta.url),sources={};
 for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.sol')))sources[name]={content:fs.readFileSync(new URL(name,root),'utf8')};
 const compiler=fileURLToPath(new URL('../../scripts/compile-review-solidity.cjs',import.meta.url));
 const compiled=JSON.parse(execFileSync(process.execPath,[compiler],{input:JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),maxBuffer:16*1024*1024,encoding:'utf8'}));
 if((compiled.errors??[]).some(e=>e.severity==='error'))throw Error('local DEX compile failed');
 return compiled;
}
export async function seedLocalV2(signer,tokenIn,tokenOut){
 const compiled=compileLocalV2Artifacts();
 const deploy=async(name,args)=>{const a=compiled.contracts[name+'.sol'][name],c=await new ethers.ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const owner=await signer.getAddress(),factory=await deploy('LithoswapV2Factory',[owner]);
 const router=await deploy('LithoswapV2Router02',[await factory.getAddress(),await tokenIn.getAddress()]);
 const routerAddress=await router.getAddress();
 await(await tokenIn.approve(routerAddress,1000000)).wait();await(await tokenOut.approve(routerAddress,2000000)).wait();
 await(await router.addLiquidity(await tokenIn.getAddress(),await tokenOut.getAddress(),1000000,2000000,1000000,2000000,owner,Math.floor(Date.now()/1000)+3600)).wait();
 const hash=async address=>ethers.keccak256(await signer.provider.getCode(address));
 const input=await tokenIn.getAddress(),output=await tokenOut.getAddress(),pair=await factory.getPair(input,output);
 return {id:'local-destination-dex',enabled:true,chainId:Number((await signer.provider.getNetwork()).chainId),expiresAt:Math.floor(Date.now()/1000)+600,approvalRef:'local-fixture',standardTokensReviewed:true,tokenIn:input,tokenOut:output,router:routerAddress,factory:await factory.getAddress(),pair,routerCodeHash:await hash(routerAddress),factoryCodeHash:await hash(await factory.getAddress()),pairCodeHash:await hash(pair),tokenInCodeHash:await hash(input),tokenOutCodeHash:await hash(output),feeNumerator:997,feeDenominator:1000,maxPriceImpactBps:100,maxSlippageBps:100};
}
