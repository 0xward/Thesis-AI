import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import {
  Loader2,
  ArrowRight,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  ThesisConfig,
  ResearchSource,
  ThesisStructure,
  ChapterDefinition,
  generateSectionStream,
  refineSectionStream,
} from '../services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SectionRecord {
  subchapterTitle: string;
  content: string;
}

type Phase =
  | 'idle'
  | 'streaming'
  | 'waiting_action'
  | 'refining'
  | 'chapter_done'
  | 'all_done'
  | 'error';

interface ModularChapterWriterProps {
  structure: ThesisStructure;
  sources: ResearchSource[];
  config: ThesisConfig;
  fontFamily?: 'Serif' | 'Sans';
  /** Called whenever a chapter fully completes */
  onChapterComplete: (chapter: { chapterTitle: string; content: string }) => void;
  /** Called when all chapters are done */
  onAllComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModularChapterWriter({
  structure,
  sources,
  config,
  fontFamily = 'Serif',
  onChapterComplete,
  onAllComplete,
}: ModularChapterWriterProps) {
  const [chapterIdx, setChapterIdx] = useState(0);
  const [subchapterIdx, setSubchapterIdx] = useState(0);
  const [completedSections, setCompletedSections] = useState<SectionRecord[]>([]);
  const [activeStreamText, setActiveStreamText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const previousContextRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentChapter: ChapterDefinition | undefined = structure.chapters[chapterIdx];
  const totalChapters = structure.chapters.length;
  const totalSubchapters = currentChapter?.subchapters?.length ?? 0;
  const currentSubchapterTitle = currentChapter?.subchapters?.[subchapterIdx] ?? '';

  // Scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeStreamText, completedSections, phase]);

  // Auto-start first section on mount
  useEffect(() => {
    if (phase === 'idle') {
      startSection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stream a section ───────────────────────────────────────────────────────
  const startSection = useCallback(
    async (textToRefine?: string) => {
      if (!currentChapter) return;

      const isRefining = textToRefine !== undefined;
      setPhase(isRefining ? 'refining' : 'streaming');
      setActiveStreamText('');
      setErrorMsg('');

      try {
        const stream = isRefining
          ? await refineSectionStream(
              textToRefine!,
              previousContextRef.current,
              config
            )
          : await generateSectionStream(
              currentChapter.chapter_title,
              currentSubchapterTitle,
              currentChapter.summary,
              structure,
              sources,
              config,
              previousContextRef.current
            );

        let accumulated = '';
        for await (const chunk of stream) {
          accumulated += chunk.text;
          setActiveStreamText(accumulated);
        }

        setActiveStreamText(accumulated);
        setPhase('waiting_action');
      } catch (err: any) {
        setErrorMsg(err.message || 'Generation failed. Please try again.');
        setPhase('error');
      }
    },
    [currentChapter, currentSubchapterTitle, config, sources, structure]
  );

  // ── "Continue to next section" ────────────────────────────────────────────
  const handleContinue = useCallback(() => {
    if (!currentChapter) return;

    // Save current section
    const savedSection: SectionRecord = {
      subchapterTitle: currentSubchapterTitle,
      content: activeStreamText,
    };
    const updatedSections = [...completedSections, savedSection];
    setCompletedSections(updatedSections);

    // Update context
    previousContextRef.current +=
      `\n\nSection "${currentSubchapterTitle}":\n${activeStreamText.substring(0, 600)}`;
    if (previousContextRef.current.length > 8000)
      previousContextRef.current = previousContextRef.current.slice(-8000);

    setActiveStreamText('');

    const nextSub = subchapterIdx + 1;

    if (nextSub < totalSubchapters) {
      // More subchapters in this chapter
      setSubchapterIdx(nextSub);
    } else {
      // Chapter complete — combine all sections + current
      const chapterContent = updatedSections.map((s) => s.content).join('\n\n');
      onChapterComplete({
        chapterTitle: currentChapter.chapter_title,
        content: `# ${currentChapter.chapter_title}\n\n${chapterContent}`,
      });

      const nextCh = chapterIdx + 1;
      if (nextCh < totalChapters) {
        // Move to next chapter
        setChapterIdx(nextCh);
        setSubchapterIdx(0);
        setCompletedSections([]);
        previousContextRef.current +=
          `\n\n[Chapter "${currentChapter.chapter_title}" completed.]`;
      } else {
        // All chapters done
        setPhase('all_done');
        onAllComplete();
        return;
      }
    }

    // Start next section (use useEffect dependency trick via state update)
    // We schedule it manually because state updates are async
    setTimeout(() => startSection(), 0);
  }, [
    activeStreamText,
    chapterIdx,
    completedSections,
    currentChapter,
    currentSubchapterTitle,
    onAllComplete,
    onChapterComplete,
    startSection,
    subchapterIdx,
    totalChapters,
    totalSubchapters,
  ]);

  // ── "Refine/Rewrite this section" ─────────────────────────────────────────
  const handleRefine = useCallback(() => {
    startSection(activeStreamText);
  }, [activeStreamText, startSection]);

  // ── Retry after error ─────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    startSection();
  }, [startSection]);

  if (!currentChapter && phase !== 'all_done') return null;

  const isStreaming = phase === 'streaming' || phase === 'refining';
  const showActionBar = phase === 'waiting_action';

  return (
    <div className="space-y-0">
      {/* Progress header */}
      <div className="sticky top-0 z-10 bg-[#0c0d10]/90 backdrop-blur-sm border-b border-[#1f2128] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#b59a6d]" />
          ) : phase === 'waiting_action' ? (
            <CheckCircle className="w-4 h-4 text-green-400" />
          ) : (
            <BookOpen className="w-4 h-4 text-[#b59a6d]" />
          )}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#b59a6d]">
              {phase === 'refining' ? 'Refining Section...' : isStreaming ? 'Writing...' : 'Section Ready'}
            </p>
            <p className="text-[10px] text-[#4a4b4e] font-mono">
              Chapter {chapterIdx + 1} of {totalChapters} · Section {subchapterIdx + 1} of{' '}
              {totalSubchapters}
            </p>
          </div>
        </div>
        <div className="text-[9px] text-[#2a2d35] font-mono uppercase tracking-widest hidden sm:block">
          {structure.title.substring(0, 40)}
          {structure.title.length > 40 ? '...' : ''}
        </div>
      </div>

      {/* Paper content */}
      <div
        className={cn(
          'academic-paper shadow-2xl relative mx-auto',
          fontFamily === 'Serif' ? 'academic-paper-serif' : 'academic-paper-sans'
        )}
        style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
      >
        {/* Chapter heading */}
        <div className="mb-8 pb-6 border-b border-gray-200">
          <h1 className="text-2xl font-serif font-bold text-gray-900">
            {currentChapter?.chapter_title}
          </h1>
          <p className="text-xs text-gray-400 mt-1 font-mono uppercase tracking-widest">
            {structure.title}
          </p>
        </div>

        {/* Completed sections */}
        {completedSections.map((sec, i) => (
          <div key={i} className="prose prose-slate max-w-none mb-8 opacity-80">
            <Markdown>{sec.content}</Markdown>
          </div>
        ))}

        {/* Live streaming section */}
        {(activeStreamText || isStreaming) && (
          <div
            className={cn(
              'prose prose-slate max-w-none transition-opacity',
              isStreaming && 'opacity-70'
            )}
          >
            <Markdown>{activeStreamText || ' '}</Markdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-[#b59a6d] animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}

        {/* Error state */}
        {phase === 'error' && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-950/30 border border-red-900/40 mt-4">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-300">Generation Error</p>
              <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Page number */}
        <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] text-gray-400 font-serif italic tracking-widest opacity-50">
          Chapter {chapterIdx + 1}
        </div>
      </div>

      {/* ── Action Bar ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showActionBar && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="sticky bottom-0 z-20 bg-[#111318]/95 backdrop-blur-md border-t border-[#b59a6d]/20 px-4 sm:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            {/* Context info */}
            <div className="text-center sm:text-left">
              <p className="text-xs font-bold text-[#f0f1f3]">
                Section complete:{' '}
                <span className="text-[#b59a6d]">{currentSubchapterTitle}</span>
              </p>
              <p className="text-[10px] text-[#4a4b4e] mt-0.5 font-mono">
                {subchapterIdx + 1 < totalSubchapters
                  ? `Next: "${currentChapter?.subchapters?.[subchapterIdx + 1]}"`
                  : chapterIdx + 1 < totalChapters
                  ? `Next chapter: "${structure.chapters[chapterIdx + 1]?.chapter_title}"`
                  : 'This is the final section'}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 shrink-0">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleRefine}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#b59a6d]/40 text-[#b59a6d] text-[11px] font-black uppercase tracking-widest hover:bg-[#b59a6d]/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refine / Rewrite
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleContinue}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#b59a6d] text-[#0c0d10] text-[11px] font-black uppercase tracking-widest hover:bg-[#a38a60] transition-colors shadow-lg shadow-[#b59a6d]/20"
              >
                {subchapterIdx + 1 < totalSubchapters ? (
                  <>
                    <ArrowRight className="w-3.5 h-3.5" />
                    Continue to Next Section
                  </>
                ) : chapterIdx + 1 < totalChapters ? (
                  <>
                    <ChevronRight className="w-3.5 h-3.5" />
                    Next Chapter
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    Complete Thesis
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error retry bar */}
      <AnimatePresence>
        {phase === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="sticky bottom-0 z-20 bg-[#111318]/95 backdrop-blur-md border-t border-red-900/30 px-4 sm:px-8 py-4 flex items-center justify-between gap-4"
          >
            <p className="text-xs text-red-400 font-mono">{errorMsg}</p>
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-900/40 border border-red-700/50 text-red-300 text-[11px] font-black uppercase tracking-widest hover:bg-red-900/60 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All done */}
      {phase === 'all_done' && (
        <div className="flex items-center justify-center py-8 gap-3">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-sm font-bold text-[#f0f1f3]">
            All sections generated. Scroll up to review.
          </p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
