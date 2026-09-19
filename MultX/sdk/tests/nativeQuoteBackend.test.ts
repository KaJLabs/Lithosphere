import { expect, it } from 'vitest';
import { ethers } from 'ethers';
import { createNativeQuoteBackend } from '../src/nativeQuoteBackend.js';

it('signs an exact quote request and rejects a changed response', async () => {
  const signer = ethers.Wallet.createRandom();
  const input = { sourceChain: 1, destinationChain: 56, inputAmount: '1000', minimumOutput: '900', recipient: signer.address };
  let received: { url: string; init: RequestInit } | undefined;
  let changed=false;
  const quoteId = '0x' + '11'.repeat(32);
  const wrapper='0x0000000000000000000000000000000000000099', bridge='0x0000000000000000000000000000000000000098';
  const abi=new ethers.Interface(['function deposit()','function approve(address,uint256)','function lockTokens(address,uint256,uint256)']);
  const steps=['wrap','approve','lock'].map((kind,i)=>({kind,chainId:1,from:signer.address,to:i===2?bridge:wrapper,value:i===0?'1000':'0',data:[abi.encodeFunctionData('deposit'),abi.encodeFunctionData('approve',[bridge,1000]),abi.encodeFunctionData('lockTokens',[wrapper,1000,56])][i]}));
  const terms={fundingMode:'prefunded-fixed-fill',atomic:false,automaticTimeoutRefund:false,fundingRef:'f',recoveryRef:'r',payoutSender:bridge,claimant:signer.address,nativeOutputAmount:'900',fees:['source-gas','destination-gas','bridge','protocol'].map(kind=>({kind,chainId:kind==='source-gas'?1:56,amountBaseUnits:'0',accounting:kind==='source-gas'?'separate-estimate':'included-in-fixed-output'}))};
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    received = { url: url.toString(), init: init! };
    return new Response(JSON.stringify({ quoteId, policyId: 'approved-1', wallet: signer.address,
      ...input, destinationChain:changed?8453:56, terms, expiresAt: Date.now() + 29000, sourcePlan: { approvalRef: 'a', expiresAt: Math.floor(Date.now() / 1000) + 30,
        sender: signer.address, steps } }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const client = createNativeQuoteBackend({ baseUrl: 'https://quotes.example/', audience: 'multx', signer, fetch: fetcher as typeof fetch });
  expect((await client.createQuote(input)).quoteId).toBe(quoteId);
  const headers = received!.init.headers as Record<string, string>;
  const body = received!.init.body as string;
  const message = 'MultX quote request v1\n' + JSON.stringify(['multx', 'POST', '/', ethers.keccak256(ethers.toUtf8Bytes(body)), headers['x-multx-time'], headers['x-multx-nonce']]);
  expect(ethers.verifyMessage(message, headers['x-multx-signature'])).toBe(signer.address);
  expect(received!.url).toBe('https://quotes.example/');
  changed=true;
  await expect(client.createQuote(input)).rejects.toThrow('invalid native quote response');
});

it('requires secure endpoints and exact acceptance identity', async () => {
  const signer = ethers.Wallet.createRandom();
  expect(() => createNativeQuoteBackend({ baseUrl: 'http://quotes.example', audience: 'a', signer })).toThrow('secure');
  const client = createNativeQuoteBackend({ baseUrl: 'http://127.0.0.1:1', audience: 'a', signer,
    fetch: (async () => new Response(JSON.stringify({ swapId: 'wrong', alreadyAccepted: false }), { status: 200 })) as typeof fetch });
  await expect(client.acceptQuote('0x' + '22'.repeat(32))).rejects.toThrow('invalid quote acceptance');
});
