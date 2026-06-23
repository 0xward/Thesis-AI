import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronRight,
  Download,
  GraduationCap,
  Loader2,
  Save,
  Share,
  ShieldCheck,
  X,
} from 'lucide-react';

type FloatingActionBarProps = {
  visible: boolean;
  onDownloadDocx: () => void;
  onDownloadPdf: () => void;
  onShare: () => void;
  isWalletConnected: boolean;
  isAnchoring: boolean;
  anchorTxid: string | null;
  onAnchor: () => void;
  isMinting: boolean;
  mintTxid: string | null;
  onMint: () => void;
  onScrollToTop: () => void;
  /** Anything truthy renders inline at the bottom of the expanded panel (e.g. <ReviewAction />). */
  reviewSlot?: React.ReactNode;
};

/**
 * A compact floating control that appears once a thesis is finished, so
 * the export/anchor/mint/review actions stay reachable without scrolling
 * all the way back up to the header toolbar -- especially useful once a
 * thesis spans many A4 pages.
 *
 * Collapsed: a small pill in the bottom-right corner.
 * Expanded (on tap): a vertical action panel with the same actions as the
 * header toolbar, plus a dedicated "back to top" shortcut for anyone who
 * specifically wants the full header view (table of contents, chapter
 * title, etc).
 */
export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  visible,
  onDownloadDocx,
  onDownloadPdf,
  onShare,
  isWalletConnected,
  isAnchoring,
  anchorTxid,
  onAnchor,
  isMinting,
  mintTxid,
  onMint,
  onScrollToTop,
  reviewSlot,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Collapse automatically if the bar becomes irrelevant (e.g. user
  // navigates away from the finished-thesis view).
  useEffect(() => {
    if (!visible) setIsOpen(false);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-[min(20rem,calc(100vw-2.5rem))] rounded-2xl border border-[#1f2128] bg-[#111318]/95 p-3 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#4a4b4e]">Quick Actions</span>
              <button onClick={() => setIsOpen(false)} className="text-[#4a4b4e] transition hover:text-white" aria-label="Close quick actions">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <button
                onClick={onDownloadDocx}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#f0f1f3] transition hover:bg-[#b59a6d]/10"
              >
                <Save className="h-3.5 w-3.5 text-[#b59a6d]" /> Download DOCX
              </button>
              <button
                onClick={onDownloadPdf}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#f0f1f3] transition hover:bg-white/5"
              >
                <Download className="h-3.5 w-3.5 text-[#9ca3af]" /> Download PDF
              </button>
              <button
                onClick={onShare}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#f0f1f3] transition hover:bg-white/5"
              >
                <Share className="h-3.5 w-3.5 text-[#9ca3af]" /> Share
              </button>

              <div className="my-1.5 h-px bg-[#1f2128]" />

              <button
                onClick={onAnchor}
                disabled={!isWalletConnected || isAnchoring || anchorTxid !== null}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#f4c95d] transition hover:bg-[#f4c95d]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isAnchoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {anchorTxid ? 'Anchored \u2713' : isAnchoring ? 'Anchoring...' : 'Anchor Proof'}
              </button>

              <button
                onClick={onMint}
                disabled={anchorTxid === null || isMinting || mintTxid !== null}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-purple-400 transition hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isMinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" />}
                {mintTxid ? 'Minted \ud83c\udf93' : isMinting ? 'Minting...' : 'Mint Certificate'}
              </button>

              {reviewSlot && (
                <div className="pt-1">
                  {reviewSlot}
                </div>
              )}

              <div className="my-1.5 h-px bg-[#1f2128]" />

              <button
                onClick={() => {
                  setIsOpen(false);
                  onScrollToTop();
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold text-[#4a4b4e] transition hover:bg-white/5 hover:text-[#9ca3af]"
              >
                <span className="flex items-center gap-2.5"><ArrowUp className="h-3.5 w-3.5" /> Back to top</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isOpen && (
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 rounded-full border border-[#b59a6d]/30 bg-[#111318] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#b59a6d] shadow-2xl shadow-black/40 backdrop-blur-xl"
          aria-label="Open quick actions"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Actions
        </motion.button>
      )}
    </div>
  );
};
