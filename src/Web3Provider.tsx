import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  connect,
  disconnect,
  isConnected,
  getLocalStorage,
  request,
} from '@stacks/connect';
import { Cl } from '@stacks/transactions';
import {
  CONTRACTS,
  fetchThesisBalance,
  sha256Hex,
  hexToBytes,
} from './lib/stacksContracts';

type StacksWalletContextValue = {
  address: string | null;
  walletName: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  donateStx: (amountStx: string) => Promise<{ txid: string }>;
  thesisBalance: number;
  anchorThesis: (title: string, markdown: string) => Promise<string>;
  /**
   * Submits the anchored thesis hash to the backend for certificate minting.
   * Unlike v1, minting is no longer done from the user's wallet directly -
   * see contracts-workspace/contracts/thesis-certificate-v2.clar for why.
   * The backend verifies the hash is anchored to this exact address before
   * minting (see api/index.ts: POST /api/certificates/mint).
   */
  mintCertificate: (title: string, markdown: string) => Promise<string>;
  submitReview: (thesisMarkdown: string, rating: number, comment: string) => Promise<string>;
};

const DONATION_ADDRESS = (import.meta as any).env.VITE_STACKS_DONATION_ADDRESS || 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF';
const STACKS_NETWORK = (import.meta as any).env.VITE_STACKS_NETWORK === 'testnet' ? 'testnet' : 'mainnet';

const StacksWalletContext = createContext<StacksWalletContextValue | null>(null);

const toMicroStx = (amountStx: string): bigint => {
  const [whole, frac = ''] = amountStx.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(fracPadded || '0');
};

/** Reads the connected STX address from @stacks/connect's local storage cache. */
const readStoredAddress = (): string | null => {
  try {
    const data = getLocalStorage();
    return data?.addresses?.stx?.[0]?.address ?? null;
  } catch {
    return null;
  }
};

export function StacksWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => readStoredAddress());
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thesisBalance, setThesisBalance] = useState<number>(0);

  // Sync state if the user already has a session from a previous visit
  // (e.g. address was cached in local storage by @stacks/connect).
  useEffect(() => {
    if (isConnected()) {
      const stored = readStoredAddress();
      if (stored) setAddress(stored);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const response = await connect();
      const nextAddress = response?.addresses?.find((a: any) => a.symbol === 'STX')?.address
        ?? response?.addresses?.[0]?.address
        ?? readStoredAddress();

      if (!nextAddress) {
        throw new Error('Wallet connected but did not return a Stacks address.');
      }
      setAddress(nextAddress);
    } catch (connectError: any) {
      const message = connectError?.message || 'Unable to connect Stacks wallet. Make sure Leather or Xverse is installed.';
      setError(message);
      throw new Error(message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    disconnect();
    setAddress(null);
    setError(null);
  }, []);

  const ensureConnected = useCallback(async (): Promise<string> => {
    if (address) return address;
    await connectWallet();
    const stored = readStoredAddress();
    if (!stored) throw new Error('Connect a Stacks wallet first.');
    return stored;
  }, [address, connectWallet]);

  const donateStx = useCallback(async (amountStx: string) => {
    await ensureConnected();
    const microStx = toMicroStx(amountStx);
    const result = await request('stx_transferStx', {
      recipient: DONATION_ADDRESS,
      amount: microStx.toString(),
      memo: 'ThesisAI donation',
      network: STACKS_NETWORK,
    });
    return { txid: result.txid };
  }, [ensureConnected]);

  // Fetch $THESIS balance on connect and refresh every 60s
  useEffect(() => {
    if (!address) { setThesisBalance(0); return; }
    fetchThesisBalance(address).then(setThesisBalance);
    const interval = setInterval(
      () => fetchThesisBalance(address).then(setThesisBalance),
      60_000
    );
    return () => clearInterval(interval);
  }, [address]);

  const anchorThesis = useCallback(async (title: string, markdown: string): Promise<string> => {
    const activeAddress = await ensureConnected();
    if (!CONTRACTS.THESIS_REGISTRY) throw new Error('Thesis registry contract address not configured.');
    const hexHash = await sha256Hex(markdown);
    const hashBytes = hexToBytes(hexHash);

    const result = await request('stx_callContract', {
      contract: CONTRACTS.THESIS_REGISTRY as `${string}.${string}`,
      functionName: 'anchor-thesis',
      functionArgs: [
        Cl.buffer(hashBytes),
        Cl.stringUtf8(title),
      ],
      network: STACKS_NETWORK,
    });

    if (!result?.txid) throw new Error('Wallet did not return a transaction ID.');
    return result.txid;
  }, [ensureConnected]);

  /**
   * Mint flow (v2): the user signs nothing here. They anchor on-chain
   * themselves (anchorThesis), then this function asks the BACKEND to mint
   * the certificate on their behalf, because thesis-certificate-v2's `mint`
   * is owner-gated (see contracts-workspace/contracts/thesis-certificate-v2.clar).
   * The backend independently re-verifies the hash is anchored to this
   * address before calling `mint` - the frontend cannot bypass that check.
   */
  const mintCertificate = useCallback(async (title: string, markdown: string): Promise<string> => {
    const activeAddress = await ensureConnected();
    const hexHash = await sha256Hex(markdown);
    const metadataUri = `https://thesisai.vercel.app/certificate/${hexHash}`;

    try {
      const res = await axios.post('/api/certificates/mint', {
        recipient: activeAddress,
        thesisHash: hexHash,
        metadataUri,
        title,
      });
      fetchThesisBalance(activeAddress).then(setThesisBalance);
      return res.data.txid as string;
    } catch (mintError: any) {
      const message = mintError?.response?.data?.error || mintError?.message || 'Failed to mint certificate.';
      throw new Error(message);
    }
  }, [ensureConnected]);

  /**
   * Peer-review attestation. Unlike minting, this is NOT owner-gated - any
   * connected wallet can submit a review directly. thesis-review.clar
   * itself enforces no-self-review and no-duplicate-review, so there's no
   * need to route this through the backend.
   */
  const submitReview = useCallback(async (thesisMarkdown: string, rating: number, comment: string): Promise<string> => {
    await ensureConnected();
    if (!CONTRACTS.THESIS_REVIEW) throw new Error('Thesis review contract address not configured.');
    if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5.');

    const hexHash = await sha256Hex(thesisMarkdown);
    const hashBytes = hexToBytes(hexHash);

    const result = await request('stx_callContract', {
      contract: CONTRACTS.THESIS_REVIEW as `${string}.${string}`,
      functionName: 'submit-review',
      functionArgs: [
        Cl.buffer(hashBytes),
        Cl.uint(rating),
        Cl.stringUtf8(comment),
      ],
      network: STACKS_NETWORK,
    });

    if (!result?.txid) throw new Error('Wallet did not return a transaction ID.');
    return result.txid;
  }, [ensureConnected]);

  const value = useMemo<StacksWalletContextValue>(() => ({
    address,
    walletName: address ? 'Stacks Wallet' : null,
    isConnected: Boolean(address),
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    donateStx,
    thesisBalance,
    anchorThesis,
    mintCertificate,
    submitReview,
  }), [address, isConnecting, error, connectWallet, disconnectWallet, donateStx, thesisBalance, anchorThesis, mintCertificate, submitReview]);

  return (
    <StacksWalletContext.Provider value={value}>
      {children}
    </StacksWalletContext.Provider>
  );
}

export function useStacksWallet(): StacksWalletContextValue {
  const ctx = useContext(StacksWalletContext);
  if (!ctx) throw new Error('useStacksWallet must be used within a StacksWalletProvider');
  return ctx;
}

// Alias kept for backwards compatibility with existing imports
// (e.g. `import { Web3Provider } from './Web3Provider'` in main.tsx).
export const Web3Provider = StacksWalletProvider;
