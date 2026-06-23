import React, { useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

/**
 * Splits one chapter's markdown into multiple physical A4 pages, the way a
 * real printed thesis/skripsi looks -- instead of one continuously-growing
 * block per chapter (which is what this screen looked like before).
 *
 * Approach:
 *   1. The chapter's markdown source is split into logical blocks (each
 *      heading, paragraph, or list becomes one block) on blank-line
 *      boundaries, since each of those is independently valid markdown.
 *   2. Every block is rendered once into a hidden, full-width,
 *      unconstrained-height container so its real rendered height can be
 *      measured with offsetHeight.
 *   3. Blocks are packed into pages: keep adding blocks to the current
 *      page until the next one would overflow the page's available
 *      height, then start a new page. A single block taller than one full
 *      page (e.g. a very long table) is placed alone on its own page
 *      rather than being force-split, since splitting markdown content
 *      mid-block isn't safe to do generically.
 *   4. The same blocks are rendered again, this time grouped into
 *      separate ".academic-paper" divs -- one per physical page -- each
 *      with the correct running page number.
 */

type PaginatedThesisViewProps = {
  /** Markdown content for a single chapter. */
  content: string;
  /** Components map passed straight through to react-markdown. */
  components: Record<string, any>;
  /** "Serif" or "Sans" -- controls which academic-paper-* class is applied. */
  fontFamily: 'Serif' | 'Sans';
  /** Starting page number for this chapter (continues numbering across chapters). */
  startPageNumber: number;
  /** Called once pagination finishes, with how many physical pages this chapter took. */
  onPageCountChange?: (pageCount: number) => void;
};

const PAGE_WIDTH_MM = 210;

/** Splits markdown source into independently-renderable logical blocks. */
function splitIntoBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export const PaginatedThesisView: React.FC<PaginatedThesisViewProps> = ({
  content,
  components,
  fontFamily,
  startPageNumber,
  onPageCountChange,
}) => {
  const blocks = React.useMemo(() => splitIntoBlocks(content), [content]);
  const measureContainerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [pageGroups, setPageGroups] = useState<string[][] | null>(null);

  useLayoutEffect(() => {
    const measureContainer = measureContainerRef.current;
    const sizerEl = sizerRef.current;
    if (!measureContainer || !sizerEl || blocks.length === 0) {
      setPageGroups(blocks.length > 0 ? [blocks] : null);
      return;
    }

    // Available content height = one rendered (empty) academic-paper's
    // clientHeight minus its own padding, read from computed styles, so
    // it always matches whatever the current breakpoint's CSS says rather
    // than hardcoding mm values that could drift out of sync over time.
    const sizerStyle = window.getComputedStyle(sizerEl);
    const paddingTop = parseFloat(sizerStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(sizerStyle.paddingBottom) || 0;
    const availableHeight = sizerEl.clientHeight - paddingTop - paddingBottom;

    const blockElements = Array.from(measureContainer.children) as HTMLElement[];

    if (availableHeight <= 0 || blockElements.length !== blocks.length) {
      setPageGroups([blocks]);
      return;
    }

    const groups: string[][] = [[]];
    let currentHeight = 0;

    blockElements.forEach((el, idx) => {
      const blockHeight = el.offsetHeight;
      const wouldOverflow = currentHeight + blockHeight > availableHeight;
      const currentGroup = groups[groups.length - 1];

      if (wouldOverflow && currentGroup.length > 0) {
        groups.push([]);
        currentHeight = 0;
      }

      groups[groups.length - 1].push(blocks[idx]);
      currentHeight += blockHeight;
    });

    setPageGroups(groups);
    onPageCountChange?.(groups.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, fontFamily, blocks]);

  const paperClass = cn(
    'academic-paper shadow-2xl relative',
    fontFamily === 'Serif' ? 'academic-paper-serif' : 'academic-paper-sans'
  );

  return (
    <>
      {/* Hidden sizer: one empty academic-paper, used purely to read the
          real computed padding/height for the current breakpoint. */}
      <div
        ref={sizerRef}
        className={paperClass}
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: 0, left: '-9999px', width: `${PAGE_WIDTH_MM}mm` }}
        aria-hidden="true"
      />

      {/* Hidden measurement container: each block rendered separately and
          unconstrained, purely so offsetHeight can be read per block. */}
      <div
        ref={measureContainerRef}
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: 0, left: '-9999px', width: `${PAGE_WIDTH_MM}mm`, padding: '0 40mm' }}
        aria-hidden="true"
      >
        {blocks.map((block, idx) => (
          <div key={idx} className="prose prose-slate max-w-none">
            <Markdown components={components}>{block}</Markdown>
          </div>
        ))}
      </div>

      {/* Real, visible, paginated output */}
      {pageGroups === null ? (
        // First paint before measurement completes: render nothing yet to
        // avoid a flash of unpaginated content collapsing into pages.
        <div className={paperClass}>
          <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] text-gray-400 font-serif italic tracking-widest opacity-50">
            Page {startPageNumber}
          </div>
        </div>
      ) : (
        pageGroups.map((groupBlocks, pageIdx) => (
          <div key={pageIdx} className="flex flex-col items-center">
            <div className={paperClass}>
              <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] text-gray-400 font-serif italic tracking-widest opacity-50">
                Page {startPageNumber + pageIdx}
              </div>
              <div className="prose prose-slate max-w-none">
                <Markdown components={components}>{groupBlocks.join('\n\n')}</Markdown>
              </div>
            </div>
            {pageIdx < pageGroups.length - 1 && (
              <div className="h-4 lg:h-12 w-full flex items-center justify-center opacity-5">
                <div className="w-1/3 h-px bg-white" />
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
};
