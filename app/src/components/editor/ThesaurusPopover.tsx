// ThesaurusPopover.tsx -- Right-click word lookup
// =================================================
// Shows synonym and related-word suggestions for the right-clicked word.
// Fetches from the Datamuse API (free, no key required).
//
// Displays two sections when results exist:
//   Synonyms  -- direct thesaurus synonyms (rel_syn)
//   Related   -- "means like" alternatives (ml), deduped against synonyms
//
// Clicking any suggestion replaces the original word in the editor,
// preserving the original word's capitalization style.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DatamuseWord {
  word:  string;
  score: number;
}

interface ThesaurusPopoverProps {
  word:      string;
  from:      number;   // CodeMirror document position (start of word)
  to:        number;   // CodeMirror document position (end of word)
  x:         number;   // Mouse X in viewport px
  y:         number;   // Mouse Y in viewport px
  onReplace: (word: string, from: number, to: number) => void;
  onClose:   () => void;
}

// ── Case-matching helper ───────────────────────────────────────────────────────
// When the writer replaces "Walking" with a synonym, it should become "Strolling",
// not "strolling". This preserves the prose flow without forcing a manual fix.

function matchCase(original: string, replacement: string): string {
  if (!replacement) return replacement;

  // ALL CAPS
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  // Title Case (first letter upper, rest lower)
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  // lowercase as-is
  return replacement;
}


// ── ThesaurusPopover ──────────────────────────────────────────────────────────

export function ThesaurusPopover({
  word, from, to, x, y, onReplace, onClose,
}: ThesaurusPopoverProps) {
  const ref                             = useRef<HTMLDivElement>(null);
  const [synonyms, setSynonyms]         = useState<string[]>([]);
  const [related,  setRelated]          = useState<string[]>([]);
  const [loading,  setLoading]          = useState(true);
  const [pos,      setPos]              = useState({ x, y });

  // ── Fetch from Datamuse ───────────────────────────────────────────────────
  // Two parallel requests:
  //   rel_syn = direct thesaurus synonyms
  //   ml      = "means like" (broader alternatives, deduped against synonyms)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSynonyms([]);
    setRelated([]);

    const base    = "https://api.datamuse.com/words";
    const encoded = encodeURIComponent(word.toLowerCase());

    Promise.all([
      fetch(`${base}?rel_syn=${encoded}&max=14`).then(r => r.json() as Promise<DatamuseWord[]>),
      fetch(`${base}?ml=${encoded}&max=10`).then(r => r.json()    as Promise<DatamuseWord[]>),
    ]).then(([synData, mlData]) => {
      if (cancelled) return;
      const synWords = synData.map(d => d.word);
      const synSet   = new Set(synWords);
      // Filter "means like" to remove duplicates and stop-words (very short words)
      const relWords = mlData
        .filter(d => !synSet.has(d.word) && d.word.length > 2)
        .map(d => d.word)
        .slice(0, 8);
      setSynonyms(synWords);
      setRelated(relWords);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [word]);

  // ── Viewport clamping ─────────────────────────────────────────────────────
  // After the popover renders, measure it and shift it inward if it clips
  // the viewport edge. Runs after layout so we know the popover's dimensions.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    const pad = 8;
    if (nx + width  > window.innerWidth  - pad) nx = window.innerWidth  - width  - pad;
    if (ny + height > window.innerHeight - pad) ny = window.innerHeight - height - pad;
    if (nx < pad) nx = pad;
    if (ny < pad) ny = pad;
    setPos({ x: nx, y: ny });
  }, [x, y, loading]);   // re-clamp after loading resolves (height changes)

  // ── Close on click outside ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // mousedown so the click doesn't propagate into the editor underneath
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSelect = (suggestion: string) => {
    onReplace(matchCase(word, suggestion), from, to);
    onClose();
  };

  const hasSynonyms = synonyms.length > 0;
  const hasRelated  = related.length  > 0;
  const empty       = !loading && !hasSynonyms && !hasRelated;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className="
        min-w-[200px] max-w-[280px] max-h-80 overflow-y-auto
        rounded-lg border border-border shadow-2xl
        bg-bg-panel text-text-primary text-sm
        flex flex-col
      "
    >
      {/* Header */}
      <div className="flex items-baseline gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Thesaurus
        </span>
        <span className="font-medium text-accent truncate">{word}</span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="px-3 py-3 text-text-muted text-xs">Looking up synonyms&hellip;</div>
      ) : empty ? (
        <div className="px-3 py-3 text-text-muted text-xs">
          No synonyms found for &ldquo;{word}&rdquo;.
        </div>
      ) : (
        <div className="flex flex-col">
          {hasSynonyms && (
            <Section label="Synonyms" words={synonyms} onSelect={handleSelect} />
          )}
          {hasRelated && (
            <Section label="Related" words={related} onSelect={handleSelect} />
          )}
        </div>
      )}
    </div>
  );
}


// ── Section ───────────────────────────────────────────────────────────────────

interface SectionProps {
  label:    string;
  words:    string[];
  onSelect: (word: string) => void;
}

function Section({ label, words, onSelect }: SectionProps) {
  return (
    <div>
      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </div>
      {words.map(w => (
        <button
          key={w}
          onClick={() => onSelect(w)}
          className="
            w-full text-left px-4 py-1.5 text-sm
            text-text-primary hover:bg-bg-surface hover:text-accent
            transition-colors duration-75
          "
        >
          {w}
        </button>
      ))}
    </div>
  );
}
