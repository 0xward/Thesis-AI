import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, ExternalLink, Heart, Loader2, Wallet, X } from 'lucide-react';

const DEVELOPER_STACKS_ADDRESS = 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF';

type StacksProviderInfo = {
  id: string;
  name: string;
  provider: any;
};

type StacksWalletState = {
  address: string | null;
  providerName: string | null;
};

function getWindowProviders(): StacksProviderInfo[] {
  if (typeof window === 'undefined') return [];
  const w = window as any;
  const candidates: StacksProviderInfo[] = [
    { id: 'leather', name: 'Leather', provider: w.LeatherProvider },
    { id: 'xverse', name: 'Xverse', provider: w.XverseProviders?.BitcoinProvider || w.XverseProviders?.StacksProvider },
    { id: 'okx', name: 'OKX Wallet', provider: w.okxwallet?.stacks || w.okxwallet?.bitcoin },
    { id: 'bitget', name: 'Bitget Wallet', provider: w.bitkeep?.stacks || w.bitgetWallet?.stacks || w.bitgetWallet?.bitcoin },
    { id: 'hiro', name: 'Stacks Wallet', provider: w.StacksProvider || w.HiroWalletProvider },
  ];

  return candidates.filter((candidate, index, arr) => {
    if (!candidate.provider?.request) return false;
    return arr.findIndex((item) => item.provider === candidate.provider) === index;
  });
}

function isMobileWalletBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(ua);
}

function findStacksAddress(payload: any): string | null {
  const visited = new Set<any>();
  const scan = (value: any): string | null => {
    if (!value || visited.has(value)) return null;
    if (typeof value === 'string') return value.match(/S[PT][A-Z0-9]{20,}/)?.[0] || null;
    if (typeof value !== 'object') return null;
    visited.add(value);

    if (typeof value.address === 'string' && /^S[PT]/.test(value.address)) return value.address;
    if (typeof value.stxAddress === 'string') return value.stxAddress;
    if (typeof value.stacksAddress === 'string') return value.stacksAddress;
    if (value.type === 'stacks' && typeof value.address === 'string') return value.address;
    if (value.purpose === 'stacks' && typeof value.address === 'string') return value.address;

    for (const nested of Object.values(value)) {
      const found = scan(nested);
      if (found) return found;
    }
    return null;
  };

  return scan(payload);
}

async function requestStacksAddress(providerInfo: StacksProviderInfo): Promise<string> {
  const { provider } = providerInfo;
  const requests = [
    () => provider.request('wallet_connect', { addresses: ['stacks'], network: 'Mainnet', message: 'Connect your Stacks wallet to ThesisAI.' }),
    () => provider.request({ method: 'wallet_connect', params: { addresses: ['stacks'], network: 'Mainnet', message: 'Connect your Stacks wallet to ThesisAI.' } }),
    () => provider.request('stx_getAccounts', {}),
    () => provider.request({ method: 'stx_getAccounts', params: {} }),
    () => provider.request('getAddresses', { addresses: ['stacks'], network: 'Mainnet' }),
    () => provider.request({ method: 'getAddresses', params: { addresses: ['stacks'], network: 'Mainnet' } }),
  ];

  let lastError: any;
  for (const request of requests) {
    try {
      const response = await request();
      const address = findStacksAddress(response);
      if (address) return address;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No Stacks address returned by the wallet.');
}

async function requestStacksDonation(providerInfo: StacksProviderInfo, amountStx: string) {
  const amount = String(Math.round(Number(amountStx) * 1_000_000));
  const params = {
    recipient: DEVELOPER_STACKS_ADDRESS,
    amount,
    memo: 'ThesisAI support',
  };

  try {
    return await providerInfo.provider.request('stx_transferStx', params);
  } catch (firstError) {
    return providerInfo.provider.request({ method: 'stx_transferStx', params });
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}...${address.slice(-5)}`;
}

export function StacksWalletButton({ compact = false }: { compact?: boolean }) {
  const [wallet, setWallet] = useState<StacksWalletState>({ address: null, providerName: null });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = useMemo(getWindowProviders, []);

  const connectWallet = async (preferred?: StacksProviderInfo) => {
    const selected = preferred || providers[0];
    if (!selected) {
      setError('Install or open this page in a Stacks wallet browser such as Xverse, Leather, OKX, or Bitget.');
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const address = await requestStacksAddress(selected);
      setWallet({ address, providerName: selected.name });
    } catch (e: any) {
      setError(e?.message || 'Wallet connection failed.');
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (wallet.address || isConnecting || providers.length === 0 || !isMobileWalletBrowser()) return;
    connectWallet(providers[0]);
    // Mobile wallet browsers are expected to prompt directly once provider injection is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length]);

  if (wallet.address) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#f4c95d]/25 bg-[#16110c] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#f4c95d]">
        <CheckCircle className="h-3.5 w-3.5" />
        <span className={compact ? 'hidden lg:inline' : ''}>{wallet.providerName}</span>
        <span className="font-mono text-[#f8ead2]">{shortAddress(wallet.address)}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => connectWallet()}
        disabled={isConnecting}
        className="inline-flex items-center gap-2 rounded-xl border border-[#f4c95d]/35 bg-[#f4c95d] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#1a120c] shadow-lg shadow-[#f4c95d]/10 transition hover:bg-[#ffe18a] disabled:opacity-60"
      >
        {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
        <span className={compact ? 'hidden sm:inline' : ''}>Connect Wallet</span>
        <span className="sm:hidden">Wallet</span>
      </button>
      {error && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-red-500/20 bg-[#1a1110] p-3 text-[11px] leading-5 text-red-200 shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}

export function StacksDonateAction() {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('1');
  const [isCustomAmount, setIsCustomAmount] = useState(false);
  const [wallet, setWallet] = useState<StacksWalletState>({ address: null, providerName: null });
  const [providerInfo, setProviderInfo] = useState<StacksProviderInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const providers = useMemo(getWindowProviders, []);

  const connect = async () => {
    const selected = providers[0];
    if (!selected) {
      setStatus('Open with Xverse/Leather/OKX/Bitget or install a Stacks-capable wallet extension.');
      return null;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      const address = await requestStacksAddress(selected);
      setWallet({ address, providerName: selected.name });
      setProviderInfo(selected);
      return selected;
    } catch (e: any) {
      setStatus(e?.message || 'Stacks wallet connection failed.');
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const donate = async () => {
    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus('Enter a valid STX amount.');
      return;
    }
    setIsBusy(true);
    setStatus(null);
    try {
      const selected = providerInfo || await connect();
      if (!selected) return;
      const result = await requestStacksDonation(selected, amount);
      const txid = result?.result?.txid || result?.txid || findStacksAddress(result) || 'submitted';
      setStatus(`Donation transaction ${txid === 'submitted' ? 'submitted' : `submitted: ${txid}`}`);
    } catch (e: any) {
      setStatus(e?.message || 'Donation failed or was rejected.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            className="w-[min(92vw,22rem)] rounded-3xl border border-[#f4c95d]/25 bg-[#111318] p-4 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#f4c95d]">Donate via Stacks</p>
                <p className="mt-1 text-xs leading-5 text-[#9c8c75]">Support ThesisAI development with a direct STX transfer.</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="rounded-full p-1 text-[#9c8c75] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
            </div>

            <div className="rounded-2xl border border-[#1f2128] bg-[#0c0d10] p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#4a4b4e]">Developer address</p>
              <p className="mt-1 break-all font-mono text-[10px] text-[#f8ead2]">{DEVELOPER_STACKS_ADDRESS}</p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {['0.5', '1', '2'].map((value) => (
                <button
                  key={value}
                  onClick={() => { setAmount(value); setIsCustomAmount(false); }}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${amount === value && !isCustomAmount ? 'border-[#f4c95d] bg-[#f4c95d] text-[#1a120c]' : 'border-[#2d303a] bg-[#16181d] text-[#c9b99f] hover:border-[#f4c95d]/50'}`}
                >
                  {value} STX
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <input
                type="number"
                min="0"
                step="0.1"
                value={isCustomAmount ? amount : ''}
                onChange={(e) => { setAmount(e.target.value); setIsCustomAmount(true); }}
                placeholder="Custom amount"
                className="w-full rounded-xl border border-[#2d303a] bg-[#0c0d10] px-3 py-3 pr-12 text-sm text-white outline-none focus:border-[#f4c95d]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#6f573d]">STX</span>
            </div>

            {wallet.address && (
              <p className="mt-3 text-[10px] text-[#9c8c75]">Connected: <span className="font-mono text-[#f4c95d]">{shortAddress(wallet.address)}</span> via {wallet.providerName}</p>
            )}
            {status && <p className="mt-3 rounded-xl bg-[#0c0d10] p-3 text-[11px] leading-5 text-[#d9c39d]">{status}</p>}

            <button
              onClick={wallet.address ? donate : connect}
              disabled={isBusy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f4c95d] px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-[#1a120c] transition hover:bg-[#ffe18a] disabled:opacity-60"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {wallet.address ? 'Send STX Donation' : 'Connect Stacks Wallet'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-2xl border border-[#f4c95d]/25 bg-[#f4c95d] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#1a120c] shadow-2xl shadow-[#f4c95d]/15 transition hover:-translate-y-0.5 hover:bg-[#ffe18a]"
      >
        <Heart className="h-4 w-4" /> Donate STX <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}
