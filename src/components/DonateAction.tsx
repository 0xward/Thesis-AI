import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Gift, Loader2, LogOut, Wallet } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useStacksWallet } from '../Web3Provider';

const DONATION_ADDRESS = (import.meta as any).env.VITE_STACKS_DONATION_ADDRESS || 'SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF';
const DONATION_PRESETS = ['5', '10', '50'];

const getErrorMessage = (error: unknown) => {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) return String((error as any).message);
  return String(error);
};

export const DonateAction: React.FC = () => {
  const {
    address,
    walletName,
    isConnected,
    isConnecting,
    isWalletBrowser,
    connectWallet,
    disconnectWallet,
    donateStx,
    error: walletError,
  } = useStacksWallet();

  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('5');
  const [isCustomAmount, setIsCustomAmount] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleDonate = async () => {
    setNotice(null);

    if (!isConnected) {
      try {
        await connectWallet();
        setIsOpen(true);
      } catch (connectError) {
        setNotice({ type: 'error', message: getErrorMessage(connectError) || 'Unable to connect wallet.' });
      }
      return;
    }

    setIsSending(true);
    try {
      await donateStx(amount);
      setNotice({ type: 'success', message: `Donation request sent for ${amount} STX. Thank you for supporting ThesisAI.` });
    } catch (donationError) {
      setNotice({ type: 'error', message: getErrorMessage(donationError) || 'Donation was not completed.' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-[min(21rem,calc(100vw-2rem))] rounded-2xl border border-[#f4c95d]/20 bg-[#111318]/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#f4c95d]">Donate with STX</p>
                <p className="mt-1 text-xs leading-5 text-[#9ca3af]">Support ThesisAI on the Stacks layer. Preset or custom amounts are sent to the project treasury.</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[#4a4b4e] transition hover:text-white" aria-label="Close donate panel">×</button>
            </div>

            <div className="mb-4 rounded-xl border border-[#1f2128] bg-[#0c0d10] p-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#4a4b4e]">Destination</p>
              <p className="mt-2 break-all font-mono text-[10px] text-[#f0f1f3]">{DONATION_ADDRESS}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {DONATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setAmount(preset);
                    setIsCustomAmount(false);
                  }}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${amount === preset && !isCustomAmount ? 'border-[#f4c95d] bg-[#f4c95d] text-[#1a120c]' : 'border-[#2d303a] bg-[#1f2128] text-[#9ca3af] hover:border-[#f4c95d]/60'}`}
                >
                  {preset} STX
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <input
                type="number"
                min="0"
                step="0.000001"
                placeholder="Custom amount"
                value={isCustomAmount ? amount : ''}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setIsCustomAmount(true);
                }}
                className="w-full rounded-xl border border-[#2d303a] bg-[#0c0d10] px-3 py-3 pr-14 text-sm font-mono text-white outline-none transition placeholder:text-[#4a4b4e] focus:border-[#f4c95d]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-[#6b7280]">STX</span>
            </div>

            {isConnected && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-[#1f2128] bg-[#0c0d10] px-3 py-2">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#4a4b4e]">{walletName || 'Stacks Wallet'}</p>
                  <p className="font-mono text-[10px] text-[#9ca3af]">{address?.slice(0, 6)}...{address?.slice(-6)}</p>
                </div>
                <button onClick={disconnectWallet} className="rounded-lg p-2 text-[#4a4b4e] transition hover:bg-red-500/10 hover:text-red-400" title="Disconnect Stacks wallet">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            if (!isOpen) setIsOpen(true);
            else handleDonate();
          }}
          disabled={isConnecting || isSending}
          className="flex items-center gap-2 rounded-xl bg-[#f4c95d] px-4 py-3 text-sm font-black text-[#1a120c] shadow-lg shadow-[#f4c95d]/20 transition hover:bg-[#ffe18a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isConnecting || isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
          {isOpen && isConnected ? `Donate ${amount || '0'} STX` : 'Donate'}
        </motion.button>

        {!isConnected && isOpen && (
          <button onClick={handleDonate} disabled={isConnecting} className="flex items-center gap-2 rounded-xl border border-[#f4c95d]/25 bg-[#111318] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-[#f4c95d] transition hover:bg-[#f4c95d]/10 disabled:opacity-60">
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Connect Stacks
          </button>
        )}
      </div>

      {isWalletBrowser && !isConnected && (
        <div className="rounded-lg border border-[#f4c95d]/20 bg-[#111318] px-3 py-2 text-[10px] font-mono text-[#f4c95d]">
          Stacks wallet browser detected — auto-connect enabled.
        </div>
      )}

      <AnimatePresence>
        {(notice || walletError) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={`flex max-w-xs items-start gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${notice?.type === 'success' ? 'border-green-800 bg-green-900/40 text-green-300' : 'border-red-800 bg-red-900/40 text-red-300'}`}
          >
            {notice?.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{notice?.message || walletError}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
