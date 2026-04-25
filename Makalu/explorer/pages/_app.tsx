import type { AppProps } from 'next/app';
import type { Chain } from 'viem';
import { PrivyProvider } from '@privy-io/react-auth';
import Layout from '@/components/Layout';
import { WalletProvider } from '@/context/WalletContext';
import NetworkSwitchModal from '@/components/NetworkSwitchModal';
import '@/styles/globals.css';

const PRIVY_APP_ID = 'cmoejm6ig02k50dl4d9vevlf9';

const lithosphereChain: Chain = {
  id: 700777,
  name: 'Lithosphere Makalu',
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.litho.ai'] },
  },
  blockExplorers: {
    default: { name: 'Lithoscan', url: 'https://makalu.litho.ai' },
  },
};

export default function ExplorerApp({ Component, pageProps }: AppProps) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['google', 'twitter', 'discord', 'github', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#34d399',
          logo: 'https://makalu.litho.ai/litho-logo.png',
        },
        supportedChains: [lithosphereChain],
        defaultChain: lithosphereChain,
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <WalletProvider>
        <NetworkSwitchModal />
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </WalletProvider>
    </PrivyProvider>
  );
}
