import type { AppProps } from 'next/app';
import Layout from '@/components/Layout';
import { WalletProvider } from '@/context/WalletContext';
import NetworkSwitchModal from '@/components/NetworkSwitchModal';
import '@/styles/globals.css';

export default function ExplorerApp({ Component, pageProps }: AppProps) {
  return (
    <WalletProvider>
      {/* Global network-switch modal — shown on every page when wallet is on wrong chain */}
      <NetworkSwitchModal />
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </WalletProvider>
  );
}
