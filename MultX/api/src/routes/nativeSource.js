import express from 'express';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import { assertNativeSourceStepReady, bindSignedNativeSourceStep, recoverNativeSourceIntent } from '../services/nativeSourceIntent.js';
import { claimNativeWalletMode } from '../services/nativeWalletMode.js';
import { consumeNativeWalletNonce, verifyNativeWalletRequest } from '../services/nativeWalletAuth.js';

// Explicitly mounted by a reviewed application. No route/intent creation, custody
// keys or broadcast endpoint. Registry resolves only operator-controlled inputs.
export function createNativeSourceRouter({pool,registry,audience}){
 if(typeof audience!=='string'||!audience.trim()||audience.length>200||typeof registry?.resolve!=='function')throw Error('native source registry and audience required');
 const router=express.Router();
 router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
 router.use(express.json({limit:'8kb'}));
 router.all('/:swapId/steps/:step/:action?',async(req,res)=>{
  const {swapId,action}=req.params,step=Number(req.params.step);
  if(!swapId||swapId.length>200||! /^[012]$/.test(req.params.step)||!((req.method==='GET'&&(!action||(action==='status'&&step===0)))||(req.method==='POST'&&['check','bind','reserve','observe'].includes(action))))return res.status(404).json({error:'unsupported_source_request'});
  const body=req.method==='GET'?'':JSON.stringify(req.body??{});
  if((action==='bind'&&(typeof req.body?.raw!=='string'||Object.keys(req.body).join(',')!=='raw'))||(action==='check'&&body!=='{}'))return res.status(400).json({error:'invalid_source_body'});
  if(action==='reserve'&&(Object.keys(req.body??{}).join(',')!=='attemptId'||!/^0x[0-9a-f]{64}$/.test(req.body?.attemptId??'')))return res.status(400).json({error:'invalid_attempt'});
  if(action==='observe'&&(Object.keys(req.body??{}).join(',')!=='transactionHash'||!/^0x[0-9a-f]{64}$/i.test(req.body?.transactionHash??'')))return res.status(400).json({error:'invalid_observation'});
  let auth;
  try{
   auth=verifyNativeWalletRequest({audience,domain:'MultX source request v1',req,body});
  }catch{return res.status(401).json({error:'invalid_wallet_auth'});}
  try{
   const row=(await pool.query('SELECT plan FROM native_source_intents WHERE swap_id=$1',[swapId])).rows[0];
   if(!row||row.plan.sender.toLowerCase()!==auth.wallet)return res.status(403).json({error:'source_intent_not_owned'});
   try{await consumeNativeWalletNonce(pool,{audience,...auth});}
   catch{return res.status(401).json({error:'wallet_auth_replayed'});}
   if(req.method==='GET'&&action==='status'){
    const {provider,confirmations}=await registry.resolve(swapId);
    const source=await recoverNativeSourceIntent(pool,provider,swapId,confirmations);
    const index=['wrap','approve','lock'].indexOf(source.step);
    if(index>=0)source.submissionReserved=(await pool.query('SELECT step FROM native_wallet_attempts WHERE swap_id=$1 AND step=$2',[swapId,index])).rowCount>0;
    const swap=(await pool.query('SELECT state FROM native_swaps WHERE swap_id=$1',[swapId])).rows[0];
    return res.json({swapId,source,swapState:swap.state});
   }
   if(req.method==='GET')return res.json(row.plan.steps[step]);
   const {provider,policy,input,confirmations}=await registry.resolve(swapId);
   if(action==='observe'){
    const reservation=await pool.query("SELECT a.step FROM native_wallet_attempts a JOIN native_wallet_modes m USING(swap_id) WHERE a.swap_id=$1 AND a.step=$2 AND m.mode='injected'",[swapId,step]);
    if(!reservation.rowCount)throw Error('injected reservation required');
    const tx=await provider.getTransaction(req.body.transactionHash);
    if(!tx||tx.hash.toLowerCase()!==req.body.transactionHash.toLowerCase())return res.status(409).json({error:'transaction_not_visible'});
    const serialized=ethers.Transaction.from({type:tx.type,to:tx.to,nonce:tx.nonce,gasLimit:tx.gasLimit,gasPrice:tx.gasPrice,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,maxFeePerGas:tx.maxFeePerGas,data:tx.data,value:tx.value,chainId:tx.chainId,signature:tx.signature,accessList:tx.accessList}).serialized;
    return res.json(await bindSignedNativeSourceStep(pool,swapId,step,serialized));
   }
   await assertNativeSourceStepReady(pool,provider,swapId,step,policy,input,confirmations);
   if(action==='reserve'){
    return res.json(await claimNativeWalletMode(pool,swapId,'injected',step,req.body.attemptId));
   }
   if(action==='check')return res.json({eligible:true});
   await claimNativeWalletMode(pool,swapId,'raw');
   return res.json(await bindSignedNativeSourceStep(pool,swapId,step,req.body.raw));
  }catch{return res.status(409).json({error:'source_request_rejected'});}
 });
 return router;
}
