import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, MessageSquareText, Star, Wallet } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useStacksWallet } from '../Web3Provider';

const getErrorMessage = (error: unknown) => {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) return String((error as any).message);
  return String(error);
};

type ReviewActionProps = {
  /** The exact markdown content that was anchored on-chain - hashed the
   * same way as anchorThesis, so the review attaches to the right hash. */
  thesisMarkdown: string;
  /** Disabled until the thesis has actually been anchored, since
   * thesis-review.clar rejects reviews for unanchored hashes. */
  isAnchored: boolean;
};

export const ReviewAction: React.FC<ReviewActionProps> = ({ thesisMarkdown, isAnchored }) => {
  const {
    address,
    isConnected,
    isConnecting,
    connectWallet,
    submitReview,
    error: walletError,
  } = useStacksWallet();

  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewTxid, setReviewTxid] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleOpen = async () => {
    setNotice(null);
    if (!isConnected) {
      try {
        await connectWallet();
      } catch (connectError) {
        setNotice({ type: 'error', message: getErrorMessage(connectError) || 'Unable to connect wallet.' });
        return;
      }
    }
    setIsOpen(true);
  };

  const handleSubmit = async () => {
    if (rating < 1) {
      setNotice({ type: 'error', message: 'Pick a rating from 1 to 5 stars first.' });
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      const txid = await submitReview(thesisMarkdown, rating, comment.trim());
      setReviewTxid(txid);
      setNotice({ type: 'success', message: 'Review submitted on-chain. Thanks for reading closely.' });
    } catch (submitError) {
      // thesis-review.clar's own error codes surface here, e.g. attempting
      // to review your own anchored thesis, or reviewing twice.
      setNotice({ type: 'error', message: getErrorMessage(submitError) || 'Review was not submitted.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAnchored) {
    return (
      <span className="text-[9px] text-[#4a4b4e]">Anchor the thesis on-chain before it can be reviewed</span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-sky-500/20 bg-[#111318]/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-400">Peer Review</p>
                <p className="mt-1 text-xs leading-5 text-[#9ca3af]">Rate and comment on this thesis. Your review is recorded on-chain and cannot be duplicated or self-submitted.</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[#4a4b4e] transition hover:text-white" aria-label="Close review panel">×</button>
            </div>

            <div className="mb-4 flex items-center justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition"
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                >
                  <Star
                    className={`h-7 w-7 ${(hoverRating || rating) >= star ? 'fill-sky-400 text-sky-400' : 'text-[#2d303a]'}`}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, 280))}
              placeholder="Short comment for the author (max 280 characters)..."
              rows={3}
              className="w-full resize-none rounded-xl border border-[#2d303a] bg-[#0c0d10] px-3 py-3 text-sm text-white outline-none transition placeholder:text-[#4a4b4e] focus:border-sky-400"
            />
            <p className="mt-1 text-right text-[9px] font-mono text-[#4a4b4e]">{comment.length}/280</p>

            {isConnected && (
              <div className="mt-3 rounded-xl border border-[#1f2128] bg-[#0c0d10] px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#4a4b4e]">Reviewing as</p>
                <p className="font-mono text-[10px] text-[#9ca3af]">{address?.slice(0, 6)}...{address?.slice(-6)}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isSubmitting || rating < 1}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-black text-[#0c0d10] shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
              {isSubmitting ? 'Submitting...' : 'Submit Review On-Chain'}
            </button>

            {reviewTxid && (
              <a
                href={`https://explorer.hiro.so/txid/${reviewTxid}?chain=mainnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block truncate rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-center text-[9px] font-mono text-sky-300 transition hover:bg-sky-400/20"
              >
                ✓ tx: {reviewTxid.slice(0, 16)}...
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!isOpen && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleOpen}
          disabled={isConnecting}
          className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-sky-400 transition hover:bg-sky-500/10 disabled:opacity-50"
        >
          {isConnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3" />}
          {isConnecting ? 'Connecting...' : 'Review This Thesis'}
        </motion.button>
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
