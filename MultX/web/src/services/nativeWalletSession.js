import { BrowserProvider } from 'ethers';
import { createNativeQuoteBackend, createNativeSourceWalletBackend, createNativeDestinationWalletBackend, openNativeSourceSignedStore, submitInjectedNativeSourceStep, submitInjectedNativeDestinationStep } from '@litho/multx-sdk';

export async function openNativeWalletSession(wallet, config) {
  if (!config.enabled || !config.baseUrl || !config.audience) throw Error('Native swaps are not configured.');
  if (!wallet.isConnected || !wallet.account) throw Error('Connect your wallet first.');
  const injected = wallet.provider?.provider;
  if (!injected?.request) throw Error('This wallet connection is not supported yet.');
  const provider = new BrowserProvider(injected);
  try {
    const signer = await provider.getSigner(wallet.account);
    const backend = createNativeSourceWalletBackend({ baseUrl: config.baseUrl, audience: config.audience, signer });
    const quotes = config.quoteBaseUrl ? createNativeQuoteBackend({ baseUrl: config.quoteBaseUrl, audience: config.audience, signer }) : null;
    const destination = config.destinationBaseUrl ? createNativeDestinationWalletBackend({baseUrl:config.destinationBaseUrl,audience:config.audience,signer}) : null;
    const store = await openNativeSourceSignedStore();
    return {
      createQuote: request => {
        if (!quotes) throw Error('Native quote service is not configured.');
        return quotes.createQuote(request);
      },
      acceptQuote: id => {
        if (!quotes) throw Error('Native quote service is not configured.');
        return quotes.acceptQuote(id);
      },
      getProgress: id => backend.getProgress(id),
      getStep: (id, step) => backend.getStep(id, step),
      observe: (id, step, hash) => backend.observeTransaction(id, step, hash),
      submit: (id, step) => submitInjectedNativeSourceStep({ swapId: id, step, signer, backend, store }),
      getDestinationProgress: id => {
        if(!destination)throw Error('Destination wallet service is not configured.');
        return destination.getProgress(id);
      },
      getDestinationStep: (id,step) => {
        if(!destination)throw Error('Destination wallet service is not configured.');
        return destination.getStep(id,step);
      },
      observeDestination: (id,step,hash) => {
        if(!destination)throw Error('Destination wallet service is not configured.');
        return destination.observeTransaction(id,step,hash);
      },
      submitDestination: (id,step) => {
        if(!destination)throw Error('Destination wallet service is not configured.');
        return submitInjectedNativeDestinationStep({swapId:id,step,signer,backend:destination,store});
      },
      close: () => { store.close(); provider.destroy(); }
    };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}
