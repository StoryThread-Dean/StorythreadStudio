// ThesaurusPopover.tsx -- Right-click word lookup
// =================================================
// Shows spelling corrections AND thesaurus suggestions for the right-clicked
// word in a single popover, in priority order:
//
//   Spellcheck  -- dictionary corrections (only when the word is misspelled)
//   Synonyms    -- direct thesaurus synonyms (Datamuse rel_syn)
//   Related     -- "means like" alternatives (Datamuse ml), deduped
//
// Why both here? The editor's red squiggle comes from the WebView's native
// spell checker, but the browser won't hand its correction suggestions to
// JavaScript, and opening this popover suppresses the native right-click menu.
// So a misspelled word would otherwise lose its corrections entirely. We
// generate corrections ourselves via the bundled dictionary (utils/spellcheck)
// and show them ABOVE the thesaurus, so the common case -- "I right-clicked a
// word with a red squiggle to fix it" -- works the way the writer expects.
//
// Spelling corrections come from the local dictionary (instant, offline).
// Synonyms/related come from the Datamuse API (free, no key required).
//
// Clicking any suggestion replaces the original word in the editor,
// preserving the original word's capitalization style.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pin } from "lucide-react";
import { isMisspelled, suggestCorrections } from "../../utils/spellcheck";
import { Explain } from "../../components/learn/Explain";

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
  /** A multi-word selection, when there is one: "Kithicor Forest". */
  phrase?:   string;
  /** The sentence it sits in, kept with a mark as a reminder. */
  sentence?: string;
  /** Enables the Weaving action. Absent on surfaces with no project. */
  projectPath?: string;
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
  word, from, to, x, y, phrase, sentence, projectPath, onReplace, onClose,
}: ThesaurusPopoverProps) {
  // What Weaving would mark: the selection when there is one, otherwise
  // the word under the cursor. A writer selecting "Kithicor Forest"
  // means the forest, not the word "Forest".
  const markable = (phrase || word).trim();
  const [marked, setMarked] = useState<"" | "saving" | "done" | "already" | "failed">("");

  async function mark() {
    if (!projectPath || !markable) return;
    setMarked("saving");
    try {
      const response = await fetch("http://localhost:8000/api/codex/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, phrase: markable,
                               where: sentence ?? "" }),
      });
      if (!response.ok) throw new Error();
      const body = await response.json();
      // "Already marked" is a different answer from "marked", and saying
      // so stops the writer wondering whether the click registered.
      setMarked(body.pinned ? "done" : "already");
    } catch {
      setMarked("failed");
    }
  }
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

  // ── Spelling corrections (local dictionary, synchronous) ───────────────────
  // Computed from the bundled dictionary, not Datamuse. Only populated when the
  // word is actually misspelled AND the dictionary has suggestions -- so the
  // Spellcheck section stays hidden for correctly-spelled words and for
  // invented names the dictionary can't help with. Memoized on `word` so the
  // dictionary lookup runs once per opened word, not on every render.
  const corrections = useMemo(
    () => (isMisspelled(word) ? suggestCorrections(word) : []),
    [word],
  );
  const hasCorrections = corrections.length > 0;

  const hasSynonyms = synonyms.length > 0;
  const hasRelated  = related.length  > 0;
  const noThesaurus = !loading && !hasSynonyms && !hasRelated;

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
      {/* ── Spellcheck section (top priority) ────────────────────────────────
          Shown only when the word is misspelled and we have corrections, so a
          right-click on a red-squiggled word leads with the fix, exactly as a
          native spell-check menu would. */}
      {hasCorrections && (
        <Section
          label="Spellcheck"
          word={word}
          words={corrections}
          onSelect={handleSelect}
          accentSelection
        />
      )}

      {/* ── Weaving ────────────────────────────────────────────────────────────
          Weaving will miss things. This is how the writer says "this one
          matters" about a word it never raised.

          It MARKS rather than connects, deliberately. A form asking for a
          relation and two endpoints has two failure modes with nothing to
          catch them -- the wrong relation gets recorded, or there is
          nothing to connect to yet and the form cannot be finished. A mark
          has neither: nothing to get wrong, and it can wait.

          Nothing is written into the manuscript. The mark goes into the
          Weave's own answers file. */}
      {projectPath && markable && (
        <div className="flex flex-col border-b border-border">
          <div className="flex items-baseline gap-1.5 px-3 py-2 border-b border-border shrink-0">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              Weaving
            </span>
            <span className="font-medium text-violet-300 truncate">{markable}</span>
          </div>
          {marked === "" || marked === "saving" ? (
            <button
              type="button"
              onClick={() => void mark()}
              disabled={marked === "saving"}
              className="flex items-center gap-2 px-3 py-2 text-left text-xs text-text-primary hover:bg-bg-raised disabled:opacity-50"
            >
              <Pin size={12} className="text-violet-300" />
              Mark for Weaving
            </button>
          ) : (
            <p className="px-3 py-2 text-mini text-text-muted">
              {marked === "done"
                ? "Marked. Weaving will ask you about it -- nothing was changed in your text."
                : marked === "already"
                  ? "Already marked. Weaving has it waiting for you."
                  : "That could not be marked. Your text is untouched."}
            </p>
          )}
        </div>
      )}

      {/* ── Thesaurus section ────────────────────────────────────────────────
          Always present so the writer can reach synonyms even for a misspelled
          word. The header repeats the word for the same reason the spellcheck
          header does -- the two sections can stack and each should be labeled. */}
      <div className="flex flex-col">
        <div className="flex items-baseline gap-1.5 px-3 py-2 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Thesaurus
          </span>
          <span className="font-medium text-accent truncate">{word}</span>
          {/* Why this exists rather than the operating system's own menu, which
              is the first thing a writer wonders when their usual right-click
              stops appearing. */}
          <Explain of="thesaurus.what" />
        </div>

        {loading ? (
          <div className="px-3 py-3 text-text-muted text-xs">Looking up synonyms&hellip;</div>
        ) : noThesaurus ? (
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
    </div>
  );
}


// ── Section ───────────────────────────────────────────────────────────────────
// Two header styles:
//   - With `word`: a top-level labeled header matching the Thesaurus header
//     (used by the Spellcheck section, which stacks as its own block).
//   - Without `word`: a small sub-label (used by Synonyms / Related inside the
//     Thesaurus block).

interface SectionProps {
  label:            string;
  words:            string[];
  onSelect:         (word: string) => void;
  word?:            string;   // when set, render the prominent labeled header
  accentSelection?: boolean;  // visually nudge the writer toward these (corrections)
}

function Section({ label, words, onSelect, word, accentSelection }: SectionProps) {
  return (
    <div>
      {word !== undefined ? (
        <div className="flex items-baseline gap-1.5 px-3 py-2 border-b border-border shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            {label}
          </span>
          <span className="font-medium text-accent truncate">{word}</span>
        </div>
      ) : (
        <div className="px-3 pt-2 pb-0.5 text-micro font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </div>
      )}
      {words.map(w => (
        <button
          key={w}
          onClick={() => onSelect(w)}
          className={`
            w-full text-left px-4 py-1.5 text-sm
            text-text-primary hover:bg-bg-raised hover:text-accent
            transition-colors duration-75
            ${accentSelection ? "font-medium" : ""}
          `}
        >
          {w}
        </button>
      ))}
    </div>
  );
}
