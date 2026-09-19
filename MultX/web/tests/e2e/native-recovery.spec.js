import { test, expect } from '@playwright/test';
import { Interface, verifyMessage, keccak256, toUtf8Bytes } from 'ethers';
const fixture='/tests/e2e/native-recovery.html';
const key='0x'+'1'.repeat(64);
test('real IndexedDB commits survive reload and concurrent tabs preserve one winner',async({page,context})=>{
 await page.goto(fixture,{waitUntil:'commit'});await page.waitForFunction(()=>!!window.nativeFixture,null,{timeout:120000});
 await page.evaluate(async key=>{const s=await window.nativeFixture.openStore('browser-recovery');await s.putIfAbsent(key,'0xaabb');s.close();},key);
 await page.reload({waitUntil:'commit'});await page.waitForFunction(()=>!!window.nativeFixture,null,{timeout:120000});
 expect(await page.evaluate(async key=>{const s=await window.nativeFixture.openStore('browser-recovery');const result=await s.get(key);s.close();return result;},key)).toBe('0xaabb');
 const other=await context.newPage();await other.goto(fixture,{waitUntil:'commit'});await other.waitForFunction(()=>!!window.nativeFixture,null,{timeout:120000});
 const raceKey='0x'+'2'.repeat(64);
 const put=async(tab,raw)=>tab.evaluate(async({key,raw})=>{const s=await window.nativeFixture.openStore('browser-recovery');const result=await s.putIfAbsent(key,raw);s.close();return result;},{key:raceKey,raw});
 const winners=await Promise.all([put(page,'0xcc'),put(other,'0xdd')]);expect(winners[0]).toBe(winners[1]);await other.close();
});
test('recovery panel authenticates status and does not send for a pending source',async({page})=>{
 let requests=0;
 await page.route('**/native-source/**',async route=>{
  const headers=route.request().headers();expect(headers['x-multx-signature']).toMatch(/^0x[0-9a-f]{130}$/i);requests++;
  await route.fulfill({json:{swapId:'local-swap',swapState:'awaiting_settlement',source:{state:'pending_or_unknown',step:'wrap',evidence:[]}}});
 });
 await page.goto(fixture);await page.getByLabel('Swap ID').fill('local-swap');await page.getByRole('button',{name:'Refresh status'}).click();
 await expect(page.getByRole('status')).toContainText('No new payment will be sent');
 expect(requests).toBe(1);expect(await page.evaluate(()=>window.nativeFixture.sends)).toBe(0);
 await expect(page.getByRole('button',{name:/Confirm/})).toHaveCount(0);
});

test('destination reconciliation uses its signed API and never repeats a wallet send',async({page})=>{
 const hash='0x'+'44'.repeat(32);let observations=0;
 await page.route('**/native-source/**',route=>route.fulfill({json:{swapId:'local-destination',swapState:'payout_ready',source:{state:'source_locked',evidence:[]}}}));
 await page.route('**/native-destination/**',async route=>{
  const request=route.request(),headers=request.headers(),body=request.postData()??'';
  const path=new URL(request.url()).pathname.replace('/native-destination','');
  const message='MultX destination request v1\n'+JSON.stringify(['local-browser-fixture',request.method(),path,keccak256(toUtf8Bytes(body)),headers['x-multx-time'],headers['x-multx-nonce']]);
  expect(verifyMessage(message,headers['x-multx-signature'])).toBe(await page.evaluate(()=>window.nativeFixture.address));
  if(path.endsWith('/observe')){
   expect(request.postDataJSON()).toEqual({transactionHash:hash});observations++;
   return route.fulfill({json:{transactionHash:hash}});
  }
  return route.fulfill({json:{swapId:'local-destination',chainId:9005,state:'wallet_reconciliation_required',step:1,submissionReserved:true}});
 });
 await page.goto(fixture);await page.getByLabel('Swap ID').fill('local-destination');await page.getByRole('button',{name:'Refresh status'}).click();
 await page.getByLabel('Wallet transaction hash').fill(hash);await page.getByRole('button',{name:'Reconcile transaction'}).click();
 await expect(page.getByRole('status')).toContainText('Transaction linked');expect(observations).toBe(1);
 expect(await page.evaluate(()=>window.nativeFixture.sends)).toBe(0);await expect(page.getByRole('button',{name:/Confirm/})).toHaveCount(0);
});

test('destination confirmation remains disabled on the source chain',async({page})=>{
 await page.route('**/native-source/**',route=>route.fulfill({json:{swapId:'chain-switch',swapState:'payout_ready',source:{state:'source_locked',evidence:[]}}}));
 await page.route('**/native-destination/**',async route=>{
  if(route.request().url().endsWith('/status'))return route.fulfill({json:{swapId:'chain-switch',chainId:9005,state:'wallet_action_required',step:1}});
  const abi=new Interface(['function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)']),expiresAt=Math.floor(Date.now()/1000)+30;
  return route.fulfill({json:{kind:'trade',chainId:9005,from:await page.evaluate(()=>window.nativeFixture.address),to:'0x0000000000000000000000000000000000000092',value:'0',gasLimit:'200000',expiresAt,
   data:abi.encodeFunctionData('swapExactTokensForTokens',[1000,900,['0x0000000000000000000000000000000000000091','0x0000000000000000000000000000000000000093'],'0x0000000000000000000000000000000000000094',expiresAt])}});
 });
 await page.goto(fixture);await page.getByLabel('Swap ID').fill('chain-switch');await page.getByRole('button',{name:'Refresh status'}).click();
 await expect(page.getByRole('button',{name:'Confirm execute destination trade'})).toBeDisabled();
 await expect(page.getByRole('status')).toContainText('Switch your wallet to chain 9005');expect(await page.evaluate(()=>window.nativeFixture.sends)).toBe(0);
});
