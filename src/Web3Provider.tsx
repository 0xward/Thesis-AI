import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type StacksProvider = {
  request: (method: string, params?: unknown) => Promise<any>;
};

type DetectedStacksWallet = {
  id: string;
  name: string;
  provider: StacksProvider;
  kind: 'leather' | 'xverse' | 'generic';
};

type StacksWalletContextValue = {
  address: string | null;
  walletName: string | null;
  detectedWallets: DetectedStacksWallet[];
  isConnected: boolean;
  isConnecting: boolean;
  isWalletBrowser: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  donateStx: (amountStx: string) => Promise<any>;
};

const DONATION_ADDRESS = (import.meta as any).env.VITE_STACKS_DONATION_ADDRESS || 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF';
const CONNECTED_WALLET_KEY = 'thesisai_stacks_wallet';
const CONNECTED_ADDRESS_KEY = 'thesisai_stacks_address';

const StacksWalletContext = createContext<StacksWalletContextValue | null>(null);

const isStacksAddress = (value: unknown): value is string => (
  typeof value === 'string' && /^S[PT][A-Z0-9]{20,}$/i.test(value)
);

const isMobileRuntime = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Xverse|Leather/i.test(ua) || navigator.maxTouchPoints > 1;
};

const getNested = (root: any, path: string) => path.split('.').reduce((acc, key) => acc?.[key], root);

const getProviderFromDescriptor = (root: any, descriptor: any): StacksProvider | null => {
  const candidate = descriptor?.provider || (descriptor?.id ? getNested(root, descriptor.id) : null);
  return candidate?.request ? candidate : null;
};

const detectStacksWallets = (): DetectedStacksWallet[] => {
  if (typeof window === 'undefined') return [];

  const root = window as any;
  const wallets: DetectedStacksWallet[] = [];
  const seen = new Set<StacksProvider>();

  const addWallet = (wallet: DetectedStacksWallet | null) => {
    if (!wallet || !wallet.provider?.request || seen.has(wallet.provider)) return;
    seen.add(wallet.provider);
    wallets.push(wallet);
  };

  addWallet(root.LeatherProvider ? {
    id: 'LeatherProvider',
    name: 'Leather',
    provider: root.LeatherProvider,
    kind: 'leather',
  } : null);

  addWallet(root.XverseProviders?.StacksProvider ? {
    id: 'XverseProviders.StacksProvider',
    name: 'Xverse',
    provider: root.XverseProviders.StacksProvider,
    kind: 'xverse',
  } : null);

  addWallet(root.XverseProviders?.BitcoinProvider ? {
    id: 'XverseProviders.BitcoinProvider',
    name: 'Xverse',
    provider: root.XverseProviders.BitcoinProvider,
    kind: 'xverse',
  } : null);

  const providerDescriptors = [
    ...(Array.isArray(root.btc_providers) ? root.btc_providers : []),
    ...(Array.isArray(root.webbtc_providers) ? root.webbtc_providers : []),
  ];

  providerDescriptors.forEach((descriptor: any) => {
    const methods = descriptor?.methods || [];
    const supportsStacks = methods.includes('stx_transferStx') || methods.includes('wallet_connect') || methods.includes('stx_getAddresses');
    const provider = getProviderFromDescriptor(root, descriptor);
    if (!supportsStacks || !provider) return;

    const descriptorId = String(descriptor.id || descriptor.name || 'StacksProvider');
    addWallet({
      id: descriptorId,
      name: descriptor.name || (descriptorId.toLowerCase().includes('xverse') ? 'Xverse' : 'Stacks Wallet'),
      provider,
      kind: descriptorId.toLowerCase().includes('xverse') ? 'xverse' : 'generic',
    });
  });

  return wallets;
};

const findStacksAddress = (payload: any): string | null => {
  if (!payload) return null;

  if (isStacksAddress(payload)) return payload;

  const candidates = [
    payload.address,
    payload.stxAddress,
    payload.stacksAddress,
    payload.result?.address,
    payload.result?.stxAddress,
    payload.result?.stacksAddress,
  ];

  for (const candidate of candidates) {
    if (isStacksAddress(candidate)) return candidate;
  }

  const arrays = [
    payload.addresses,
    payload.result?.addresses,
    payload.result?.accounts,
    payload.accounts,
    payload.result?.account?.addresses,
  ].filter(Array.isArray);

  for (const array of arrays) {
    const stacksEntry = array.find((entry: any) => {
      const type = String(entry?.type || entry?.symbol || entry?.blockchain || entry?.purpose || '').toLowerCase();
      return type.includes('stx') || type.includes('stacks') || isStacksAddress(entry?.address);
    });
    if (isStacksAddress(stacksEntry?.address)) return stacksEntry.address;
  }

  return null;
};

const requestStacksAccount = async (wallet: DetectedStacksWallet) => {
  if (wallet.kind === 'xverse') {
    const connectResponse = await wallet.provider.request('wallet_connect', {
      addresses: ['stacks'],
      network: 'mainnet',
      message: 'Connect ThesisAI to your Stacks mainnet address.',
    });
    return connectResponse;
  }

  return wallet.provider.request('stx_getAddresses', { network: 'mainnet' });
};

const fallbackRequestStacksAccount = async (wallet: DetectedStacksWallet) => {
  if (wallet.kind === 'xverse') {
    await wallet.provider.request('wallet_requestPermissions', undefined);
    return wallet.provider.request('wallet_getAccount', { addresses: ['stacks'] });
  }

  return wallet.provider.request('getAddresses', { purposes: ['stacks'], network: 'mainnet' });
};

const toMicroStx = (amountStx: string) => {
  const trimmed = amountStx.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error('Enter a valid STX amount with up to 6 decimals.');
  }

  const [whole, fractional = ''] = trimmed.split('.');
  const microStx = BigInt(whole) * 1_000_000n + BigInt((fractional + '000000').slice(0, 6));
  if (microStx <= 0n) throw new Error('Donation amount must be greater than 0 STX.');
  return microStx;
};

export function useStacksWallet() {
  const context = useContext(StacksWalletContext);
  if (!context) {
    throw new Error('useStacksWallet must be used within Web3Provider');
  }
  return context;
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [detectedWallets, setDetectedWallets] = useState<DetectedStacksWallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<DetectedStacksWallet | null>(null);
  const [address, setAddress] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(CONNECTED_ADDRESS_KEY);
  });
  const [walletName, setWalletName] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(CONNECTED_WALLET_KEY);
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWalletBrowser, setIsWalletBrowser] = useState(false);

  const refreshWallets = useCallback(() => {
    const wallets = detectStacksWallets();
    setDetectedWallets(wallets);
    setIsWalletBrowser(isMobileRuntime() && wallets.length > 0);

    const remembered = walletName ? wallets.find((wallet) => wallet.name === walletName || wallet.id === walletName) : null;
    setActiveWallet((current) => current || remembered || wallets[0] || null);
    return wallets;
  }, [walletName]);

  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const wallets = refreshWallets();
      const wallet = activeWallet || wallets[0];
      if (!wallet) {
        throw new Error('No Stacks wallet detected. Install Leather or Xverse, then refresh this page.');
      }

      let response: any;
      try {
        response = await requestStacksAccount(wallet);
      } catch (primaryError) {
        response = await fallbackRequestStacksAccount(wallet);
      }

      const nextAddress = findStacksAddress(response);
      if (!nextAddress) {
        throw new Error('Connected wallet did not return a Stacks mainnet address.');
      }

      setActiveWallet(wallet);
      setWalletName(wallet.name);
      setAddress(nextAddress);
      window.localStorage.setItem(CONNECTED_WALLET_KEY, wallet.name);
      window.localStorage.setItem(CONNECTED_ADDRESS_KEY, nextAddress);
    } catch (connectError: any) {
      const message = connectError?.error?.message || connectError?.message || 'Unable to connect Stacks wallet.';
      setError(message);
      throw new Error(message);
    } finally {
      setIsConnecting(false);
    }
  }, [activeWallet, refreshWallets]);

  const disconnectWallet = useCallback(async () => {
    if (activeWallet?.kind === 'xverse') {
      await activeWallet.provider.request('wallet_disconnect', undefined).catch(() => undefined);
      await activeWallet.provider.request('wallet_renouncePermissions', undefined).catch(() => undefined);
    }

    setAddress(null);
    setWalletName(null);
    setActiveWallet(null);
    setError(null);
    window.localStorage.removeItem(CONNECTED_WALLET_KEY);
    window.localStorage.removeItem(CONNECTED_ADDRESS_KEY);
  }, [activeWallet]);

  const donateStx = useCallback(async (amountStx: string) => {
    let wallet = activeWallet;
    if (!wallet || !address) {
      await connectWallet();
      const wallets = detectStacksWallets();
      wallet = activeWallet || wallets[0];
    }

    if (!wallet) throw new Error('Connect a Stacks wallet before donating.');

    const microStx = toMicroStx(amountStx);
    const amount = wallet.kind === 'xverse' && microStx <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(microStx)
      : microStx.toString();

    return wallet.provider.request('stx_transferStx', {
      recipient: DONATION_ADDRESS,
      amount,
      memo: 'ThesisAI donation',
      network: 'mainnet',
    });
  }, [activeWallet, address, connectWallet]);

  useEffect(() => {
    const tryAutoConnect = (wallets: DetectedStacksWallet[]) => {
      if (isMobileRuntime() && wallets.length > 0 && !address && !isConnecting) {
        connectWallet().catch(() => undefined);
      }
    };

    tryAutoConnect(refreshWallets());
    const timer = window.setTimeout(() => {
      tryAutoConnect(refreshWallets());
    }, 750);

    return () => window.clearTimeout(timer);
  }, []);

  const value = useMemo<StacksWalletContextValue>(() => ({
    address,
    walletName,
    detectedWallets,
    isConnected: Boolean(address),
    isConnecting,
    isWalletBrowser,
    error,
    connectWallet,
    disconnectWallet,
    donateStx,
  }), [address, walletName, detectedWallets, isConnecting, isWalletBrowser, error, connectWallet, disconnectWallet, donateStx]);

  return (
    <StacksWalletContext.Provider value={value}>
      {children}
    </StacksWalletContext.Provider>
  );
}
