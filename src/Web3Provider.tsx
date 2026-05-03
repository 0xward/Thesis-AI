import React from 'react';
import { http, createConfig, WagmiProvider } from 'wagmi';
import { celo, celoAlfajores } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 1. Get projectId from environment
const projectId = (import.meta as any).env.VITE_WALLET_CONNECT_PROJECT_ID || '3e36c0a74b6abb5205385eab8ee4d0f3';

// 2. Create wagmiConfig
export const config = createConfig({
  chains: [celo],
  multiInjectedProviderDiscovery: true,
  connectors: [
    injected({
      target: 'metaMask', // MiniPay often injects as MetaMask-compatible
      shimDisconnect: true,
    }),
  ],
  transports: {
    [celo.id]: http('https://forno.celo.org'),
  },
});

// 3. Create QueryClient
const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
