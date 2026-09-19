import React from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, getBytes } from 'ethers';
import { NativeSwapResume } from '../../src/pages/Swap/NativeSwapResume';
import { openNativeSourceSignedStore } from '@litho/multx-sdk';
// Local browser fixture only. No funded key or external chain access.
const wallet = Wallet.createRandom();
window.nativeFixture = { openStore: openNativeSourceSignedStore, sends: 0, address:wallet.address };
const injected = { request: async ({method,params}) => {
  if (method === 'eth_chainId') return '0x7a69';
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet.address];
  if (method === 'personal_sign') return wallet.signMessage(getBytes(params[0]));
  if (method === 'eth_sendTransaction') { window.nativeFixture.sends++; throw Error('No transactions permitted in browser fixture'); }
  throw Error('Unexpected fixture RPC: '+method);
}};
createRoot(document.getElementById('root')).render(<NativeSwapResume
 wallet={{account:wallet.address,chainId:31337,isConnected:true,provider:{provider:injected}}}
 config={{enabled:true,baseUrl:location.origin+'/native-source',destinationBaseUrl:location.origin+'/native-destination',audience:'local-browser-fixture'}} />);
