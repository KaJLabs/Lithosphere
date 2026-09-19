import express from 'express';
import rateLimit from 'express-rate-limit';
import { prepareNativeDestinationStep, reserveNativeDestinationAttempt, observeNativeDestinationTransaction, inspectNativeDestinationProgress } from '../services/nativeDestinationWallet.js';
import { consumeNativeWalletNonce, verifyNativeWalletRequest } from '../services/nativeWalletAuth.js';

// Wallet-owned actions only. No caller-supplied targets, raw signing, keys or
// broadcast endpoint. Historical observations remain available after revocation.
export function createNativeDestinationRouter({pool,registry,audience}){
 if(typeof audience!=='string'||!audience.trim()||audience.length>200||typeof registry?.resolve!=='function')throw Error('native destination registry and audience required');
 const router=express.Router();
 router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
 router.use(express.json({limit:'8kb'}));
 router.all(['/:swapId/status','/:swapId/steps/:step/:action?'],async(req,res)=>{
  const {swapId,action}=req.params,status=req.params.step===undefined,step=Number(req.params.step);
  if(!swapId?.trim()||swapId.length>200||!((status&&req.method==='GET')||(!status&&/^[01]$/.test(req.params.step??'')&&
     ((req.method==='GET'&&!action)||(req.method==='POST'&&['check','reserve','observe'].includes(action))))))return res.status(404).json({error:'unsupported_destination_request'});
  const body=req.method==='GET'?'':JSON.stringify(req.body??{});
  if(action==='check'&&body!=='{}')return res.status(400).json({error:'invalid_destination_body'});
  if(action==='reserve'&&(Object.keys(req.body??{}).join(',')!=='attemptId'||!/^0x[0-9a-f]{64}$/.test(req.body?.attemptId??'')))return res.status(400).json({error:'invalid_destination_attempt'});
  if(action==='observe'&&(Object.keys(req.body??{}).join(',')!=='transactionHash'||!/^0x[0-9a-f]{64}$/i.test(req.body?.transactionHash??'')))return res.status(400).json({error:'invalid_destination_observation'});
  let auth;
  try{
   auth=verifyNativeWalletRequest({audience,domain:'MultX destination request v1',req,body});
  }catch{return res.status(401).json({error:'invalid_wallet_auth'});}
  try{
   const intent=(await pool.query('SELECT plan FROM native_source_intents WHERE swap_id=$1',[swapId])).rows[0];
   if(!intent||intent.plan.sender.toLowerCase()!==auth.wallet)return res.status(403).json({error:'destination_intent_not_owned'});
   try{await consumeNativeWalletNonce(pool,{audience,...auth});}
   catch{return res.status(401).json({error:'wallet_auth_replayed'});}
   const swap=(await pool.query('SELECT state,destination_chain FROM native_swaps WHERE swap_id=$1',[swapId])).rows[0];
   if(status&&swap.state==='awaiting_settlement')return res.json({swapId,chainId:Number(swap.destination_chain),state:'awaiting_settlement'});
   if(status&&swap.state==='recovery_required')return res.json({swapId,chainId:Number(swap.destination_chain),state:'recovery_required'});
   const selected=await registry.resolve(swapId);
   if(status)return res.json(await inspectNativeDestinationProgress(pool,selected,swapId));
   if(action==='observe')return res.json(await observeNativeDestinationTransaction(pool,selected.provider,swapId,step,req.body.transactionHash));
   // Return a saved plan without new authorization for lost-hash reconciliation.
   if(req.method==='GET'){
    const saved=(await pool.query('SELECT plan FROM native_destination_wallet_steps WHERE swap_id=$1 AND step=$2',[swapId,step])).rows[0];
    return res.json(saved?.plan??await prepareNativeDestinationStep(pool,selected,swapId,step));
   }
   if(action==='reserve')return res.json(await reserveNativeDestinationAttempt(pool,selected,swapId,step,req.body.attemptId));
   await prepareNativeDestinationStep(pool,selected,swapId,step);
   return res.json({eligible:true});
  }catch{return res.status(409).json({error:'destination_request_rejected'});}
 });
 return router;
}
