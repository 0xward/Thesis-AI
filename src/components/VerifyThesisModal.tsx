import React, { useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Loader2, ShieldCheck, Star, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CONTRACTS,
  getCertificateForHash,
  getReviewStats,
  sha256Hex,
  verifyThesis,
  type ThesisProof,
  type ReviewStats,
} from '../lib/stacksContracts';

type VerifyResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'found'; hash: string; proof: ThesisProof; certificateTokenId: number | null; reviewStats: ReviewStats };

const isLikelyHash = (value: string) => /^[0-9a-fA-F]{64}$/.test(value.trim());

export const VerifyThesisModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<'hash' | 'text'>('hash');
  const [inputValue, setInputValue] = useState('');
  const [result, setResult] = useState<VerifyResult>({ status: 'idle' });

  const runVerification = async (hashHex: string) => {
    setResult({ status: 'loading' });
    try {
      const proof = await verifyThesis(hashHex);
      if (!proof) {
        setResult({ status: 'not-found' });
        return;
      }
      const [certificateTokenId, reviewStats] = await Promise.all([
        getCertificateForHash(hashHex),
        getReviewStats(hashHex),
      ]);
      setResult({ status: 'found', hash: hashHex, proof, certificateTokenId, reviewStats });
    } catch (err: any) {
      setResult({ status: 'error', message: err?.message || 'Unable to reach the Stacks network. Try again shortly.' });
    }
  };

  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (mode === 'hash') {
      if (!isLikelyHash(trimmed)) {
        setResult({ status: 'error', message: 'That doesn\'t look like a SHA-256 hash (expected 64 hex characters). Switch to "Paste thesis text" if you want to hash it for you.' });
        return;
      }
      await runVerification(trimmed.toLowerCase());
    } else {
      const hashHex = await sha256Hex(trimmed);
      await runVerification(hashHex);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#0c0d10]/90 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#111318] w-full max-w-lg p-6 sm:p-8 rounded-[2rem] border border-emerald-500/20 shadow-2xl relative overflow-hidden max-h-[85vh] overflow-y-auto"
      >
        <div className="absolute top-0 right-0 w-56 h-56 bg-emerald-500/5 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#f0f1f3] tracking-tight">Verify Thesis</h2>
                <p className="text-[10px] text-[#4a4b4e] uppercase tracking-widest font-bold mt-1">On-chain provenance · Stacks Mainnet</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl border border-[#1f2128] text-[#4a4b4e] hover:text-[#f0f1f3] transition" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs leading-5 text-[#9ca3af]">
            Anyone can check whether a thesis was anchored on Stacks, whether a certificate was issued, and how it was reviewed. No wallet needed.
          </p>

          <div className="flex gap-2 rounded-xl border border-[#1f2128] bg-[#0c0d10] p-1">
            <button
              onClick={() => { setMode('hash'); setResult({ status: 'idle' }); }}
              className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase tracking-widest transition ${mode === 'hash' ? 'bg-emerald-500/15 text-emerald-400' : 'text-[#4a4b4e]'}`}
            >
              Paste hash
            </button>
            <button
              onClick={() => { setMode('text'); setResult({ status: 'idle' }); }}
              className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase tracking-widest transition ${mode === 'text' ? 'bg-emerald-500/15 text-emerald-400' : 'text-[#4a4b4e]'}`}
            >
              Paste thesis text
            </button>
          </div>

          {mode === 'hash' ? (
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="64-character SHA-256 hash, e.g. a1b2c3..."
              className="w-full rounded-xl border border-[#2d303a] bg-[#0c0d10] px-4 py-3 text-xs font-mono text-white outline-none transition placeholder:text-[#4a4b4e] focus:border-emerald-400"
            />
          ) : (
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Paste the exact thesis markdown/text that was anchored..."
              rows={5}
              className="w-full resize-none rounded-xl border border-[#2d303a] bg-[#0c0d10] px-4 py-3 text-xs text-white outline-none transition placeholder:text-[#4a4b4e] focus:border-emerald-400"
            />
          )}

          <button
            onClick={handleSubmit}
            disabled={result.status === 'loading' || !inputValue.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-[#0c0d10] shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {result.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {result.status === 'loading' ? 'Checking on-chain...' : 'Verify'}
          </button>

          <AnimatePresence mode="wait">
            {result.status === 'not-found' && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-xl border border-amber-800 bg-amber-900/20 px-4 py-3 text-xs text-amber-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>No anchor found for this hash. Either it was never anchored, or the text doesn't match exactly (even a single character difference produces a completely different hash).</span>
              </motion.div>
            )}

            {result.status === 'error' && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-xl border border-red-800 bg-red-900/30 px-4 py-3 text-xs text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{result.message}</span>
              </motion.div>
            )}

            {result.status === 'found' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"
              >
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-xs font-black uppercase tracking-widest">Anchored on-chain</span>
                </div>

                <div className="space-y-2 text-xs">
                  <Row label="Title" value={result.proof.title || '(untitled)'} />
                  <Row label="Anchored by" value={`${result.proof.owner.slice(0, 8)}...${result.proof.owner.slice(-6)}`} mono />
                  <Row label="Anchor block" value={`#${result.proof.block}`} mono />
                  <Row
                    label="Certificate"
                    value={result.certificateTokenId !== null ? `Issued (token #${result.certificateTokenId})` : 'Not yet issued'}
                  />
                  <Row
                    label="Peer reviews"
                    value={
                      result.reviewStats.reviewCount > 0
                        ? `${result.reviewStats.averageRating.toFixed(1)} / 5 (${result.reviewStats.reviewCount} review${result.reviewStats.reviewCount > 1 ? 's' : ''})`
                        : 'No reviews yet'
                    }
                  />
                </div>

                <a
                  href={`https://explorer.hiro.so/txid/${CONTRACTS.THESIS_REGISTRY}?chain=mainnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-mono text-emerald-300 transition hover:bg-emerald-400/20"
                >
                  View registry contract on Hiro Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-3 border-b border-[#1f2128] pb-2 last:border-0 last:pb-0">
    <span className="text-[#4a4b4e] font-bold uppercase tracking-wider text-[9px]">{label}</span>
    <span className={`text-right text-[#f0f1f3] ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);
