import React, { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSendTransaction, useBalance } from 'wagmi';
import { celo } from 'wagmi/chains';
import { parseEther, formatUnits } from 'viem';
import { Wallet, LogOut, CheckCircle, AlertCircle, Loader2, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const SUPPORT_WALLET = (import.meta as any).env.VITE_CELO_WALLET_ADDRESS || '0x2A6b5204B83C7619c90c4EB6b5365AA0b7d912F7';

export const MiniPayAction: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { sendTransaction, isPending, isSuccess, error } = useSendTransaction();
  const { data: balance } = useBalance({ address });
  
  const [isMiniPay, setIsMiniPay] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [amount, setAmount] = useState('0.1');
  const [isCustomAmount, setIsCustomAmount] = useState(false);

  useEffect(() => {
    // Detect if running in MiniPay (Opera browser with ethereum injected)
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      // Typically MiniPay or other web3 browsers
      setIsMiniPay(true);
    }
  }, []);

  useEffect(() => {
    if (isSuccess || error) {
      setShowNotification(true);
      const timer = setTimeout(() => setShowNotification(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, error]);

  const handleSupport = () => {
    if (!isConnected) {
      const connector = connectors.find(c => c.id === 'injected');
      if (connector) {
        connect({ connector });
      }
      return;
    }

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    sendTransaction({
      to: SUPPORT_WALLET as `0x${string}`,
      value: parseEther(amount),
    });
  };

  return (
    <div className="flex flex-col items-end gap-3">
      {/* Support Amount Selection */}
      <AnimatePresence>
        {isConnected && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col gap-2 p-3 bg-[#1f2128] border border-[#2d303a] rounded-xl shadow-xl w-64"
          >
            <div className="text-[10px] text-gray-500 font-mono flex justify-between uppercase tracking-wider mb-1">
              <span>Select Amount (CELO)</span>
              <span>⚡ Fast Pay</span>
            </div>
            
            <div className="grid grid-cols-3 gap-2 mb-2">
              {['0.1', '0.5', '1.0'].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    setAmount(val);
                    setIsCustomAmount(false);
                  }}
                  className={`px-2 py-1.5 rounded-md text-xs font-mono transition-all border ${
                    amount === val && !isCustomAmount 
                      ? 'bg-[#b59a6d] text-[#111318] border-[#b59a6d]' 
                      : 'bg-[#2d303a] text-gray-400 border-[#3d404a] hover:border-[#b59a6d]'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>

            <div className="relative">
              <input
                type="number"
                step="0.01"
                placeholder="Custom Amount..."
                value={isCustomAmount ? amount : ''}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setIsCustomAmount(true);
                }}
                className={`w-full bg-[#111318] border px-3 py-2 rounded-lg text-xs font-mono transition-all outline-none ${
                  isCustomAmount ? 'border-[#b59a6d] text-white' : 'border-[#2d303a] text-gray-500 hover:border-[#3d404a]'
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-600 font-mono">CELO</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!isConnected ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              const connector = connectors.find(c => c.id === 'injected');
              if (connector) connect({ connector });
            }}
            className="flex items-center gap-2 bg-[#b59a6d] hover:bg-[#c6ab7e] text-[#111318] px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-lg"
          >
            <Wallet size={16} />
            Connect MiniPay
          </motion.button>
        ) : (
          <div className="flex items-center gap-2 bg-[#1f2128] border border-[#2d303a] px-3 py-2 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-xs font-mono text-gray-300">
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
            <button 
              onClick={() => disconnect()}
              className="text-gray-500 hover:text-red-400 p-1 transition-colors"
              title="Disconnect"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        {isConnected && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isPending}
            onClick={handleSupport}
            className="flex items-center gap-2 bg-[#b59a6d] hover:bg-[#c6ab7e] text-[#111318] px-4 py-2 rounded-lg font-medium text-sm transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
            Pay {amount} CELO
          </motion.button>
        )}
      </div>

      {balance && isConnected && (
        <div className="text-[10px] text-gray-500 font-mono">
          Balance: {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} {balance.symbol}
        </div>
      )}

      {/* MiniPay Badge */}
      {isMiniPay && !isConnected && (
        <div className="text-[10px] text-[#b59a6d] font-mono animate-pulse">
           MiniPay Detected - Tap to connect
        </div>
      )}

      {/* Notifications */}
      <AnimatePresence>
        {showNotification && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
              isSuccess ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-red-900/40 text-red-400 border border-red-800'
            }`}
          >
            {isSuccess ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {isSuccess ? 'Payment Successful! Thank you!' : `Error: ${error?.message.split('\n')[0]}`}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
