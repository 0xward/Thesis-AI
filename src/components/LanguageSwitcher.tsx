import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Languages } from 'lucide-react';

export type LanguageOption = {
  code: string;
  nativeLabel: string;
  aiTargetName: string;
};

type LanguageSwitcherProps = {
  current: string;
  options: LanguageOption[];
  onSelect: (code: string) => void;
  /** "compact" for the desktop navbar pill, "full" for the mobile menu row. */
  variant?: 'compact' | 'full';
};

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ current, options, onSelect, variant = 'compact' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentOption = options.find((o) => o.code === current) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={
          variant === 'compact'
            ? 'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 hover:border-sky-400/60 transition'
            : 'flex w-full items-center gap-3 px-3 py-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-[11px] font-black uppercase tracking-widest text-sky-400 hover:bg-sky-500/20 transition text-left'
        }
      >
        <Languages className="w-3.5 h-3.5 shrink-0" />
        <span className={variant === 'compact' ? 'hidden sm:inline' : ''}>{currentOption.nativeLabel}</span>
        <span className={variant === 'compact' ? 'sm:hidden uppercase' : 'hidden'}>{currentOption.code}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className={
              variant === 'compact'
                ? 'absolute right-0 top-full mt-2 z-50 max-h-80 w-48 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-[#1f2128] bg-[#111318] p-1.5 shadow-2xl'
                : 'absolute left-0 top-full mt-1 z-50 max-h-80 w-full overflow-y-auto rounded-2xl border border-[#1f2128] bg-[#111318] p-1.5 shadow-2xl'
            }
          >
            {options.map((option) => (
              <button
                key={option.code}
                onClick={() => {
                  onSelect(option.code);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-[#e5e7eb] transition hover:bg-[#b59a6d]/10"
              >
                <span dir={option.code === 'ar' || option.code === 'fa' ? 'rtl' : 'ltr'}>{option.nativeLabel}</span>
                {option.code === current && <Check className="h-3.5 w-3.5 shrink-0 text-[#b59a6d]" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
