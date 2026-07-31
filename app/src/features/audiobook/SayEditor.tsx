// features/audiobook/SayEditor.tsx
// =================================
// The [say] popout (user-designed): highlight a word, click [say], and
// a small card opens over it. The writer types ONLY the spoken form --
// the brackets are rendered chrome, impossible to break -- previews the
// result in the book's own voice before committing, hops through the
// word's other occurrences, and can open a tips library of vetted
// respelling tricks (each one ear-tested against the live engine).
//
// Edits land in the buffer like typing; manual save owns persistence.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Play, X } from "lucide-react";

import { previewSelection } from "./api";

interface SayEditorProps {
  content: string;
  /** The initially selected word's range in `content`. */
  start: number;
  end: number;
  workspacePath: string;
  voiceId: string;
  /** Commit the new buffer text (parent marks dirty). */
  onApply: (next: string) => void;
  onClose: () => void;
  /** Approximate pixel anchor of the word inside the editor wrapper. */
  anchor: { top: number; left: number } | null;
  /** Fired when the current occurrence changes -- the parent scrolls
      the editor there and repositions the popout. */
  onLocate?: (pos: number) => void;
}

// The tips library: an ACCORDION of ear-tested techniques (one section
// open at a time -- the writer studies one idea, not a wall). The
// doctrine here comes from live listening tests on the real engine
// (2026-07-30 round); the Preview button is always the final judge.
const TIPS: Array<{ title: string; body: string }> = [
  { title: "Spell the sounds, not the word",
    body: "Kaelith -> kay-lith. Write what a stranger should SAY, not "
      + "how it is written. Hyphens glue syllables into one spoken "
      + "word. Lowercase is the safe default -- see the case and "
      + "separation sections for the finer dials." },
  { title: "The vowel sounds: ah, eh, ih, oh, uh, oo",
    body: "A silent h after a vowel is the most useful English "
      + "respelling technique: ah = the vowel in father, eh = bed, "
      + "ih = sit, oh = go, uh = the unstressed vowel, oo = food. "
      + "Compare: [say:lah-rah], [say:lah-ruh], [say:lar-uh] -- three "
      + "different Laras from three vowel choices." },
  { title: "Case changes the inflection",
    body: "Lowercase is the rule; a single capital is a dial. Hey-soos, "
      + "hey-soos, and hey-Soos each land differently -- one capital "
      + "letter shifts the word's inflection. Keep it to ONE capital: "
      + "a RUN of capitals gets folded by the app, because the engine "
      + "would spell it out as letters." },
  { title: "Separation strength: space, hyphen, apostrophe",
    body: "Three break strengths, strongest to softest. SPACE treats "
      + "the parts as a strong separation -- Hey soos almost reads as "
      + "two words. HYPHEN joins them as syllable-like units of one "
      + "word -- Hey-soos. APOSTROPHE is the softest internal break -- "
      + "Hey'soos lands gentler than Hey-soos. (The apostrophe works "
      + "on most voices, not all -- preview it.)" },
  { title: "Longer vowels: double them",
    body: "Repeated vowels encourage a longer, held vowel: laa-rah, "
      + "lee-ah, koo-per, ree-na. Pair with the vowel-sound alphabet "
      + "for fine control over how a name stretches." },
  { title: "Words that change with meaning",
    body: "I read it -> [say:red]read[/say]. Also: lead, live, bow, tear, "
      + "wind, wound -- the engine guesses from context and sometimes "
      + "guesses wrong. One say fixes one spot." },
  { title: "Regional readings of a name",
    body: "Lara is lar-ah in Britain, lair-ah in Madrid, lor-uh in "
      + "America. Set the book-wide reading in Pronunciations, then let "
      + "a single character say it their way -- say wins where both "
      + "apply. Jesus -> hay-soos works the same trick." },
  { title: "Letters or a word?",
    body: "NASA can be nassa or en ay ess ay. Spell initialisms as "
      + "spaced letter sounds (F B I -> ef bee eye) when the engine "
      + "runs them together." },
  { title: "Numbers and years",
    body: "1066 -> ten sixty-six. 3.5 -> three and a half. Roman "
      + "numerals, verse numbers, and version numbers all read better "
      + "written out as words." },
  { title: "Character color, one spot only",
    body: "A drawl, a sneer, an accent at a single moment: well -> "
      + "way-ell, darling -> dahling. Small doses -- it is seasoning, "
      + "not the dish." },
  { title: "Shift the stress (experimental)",
    body: "The engine decides stress from the sounds it reads. Nudge it "
      + "by respelling the vowels: record can land noun-ish or verb-ish "
      + "as reh-kerd vs rih-kord. Combine with a single capital or a "
      + "doubled vowel on the strong syllable. Ear-driven territory: "
      + "preview every attempt, keep what sounds right." },
  { title: "Characters to AVOID",
    body: "Underscores (_lar_-ah), asterisks (*lar*-ah), quotes "
      + "(\"lar\"-ah), slashes (/lar-ah/), and parentheses ((lar)-ah) "
      + "all misbehave: letters get pronounced separately, symbols get "
      + "spoken aloud, unnatural pauses appear, and the engine splits "
      + "the word into chunks. Avoid accented characters too -- a few "
      + "work, most do not. Stick to plain letters, hyphens, "
      + "apostrophes, and spaces." },
];

export function SayEditor({
  content, start, end, workspacePath, voiceId, onApply, onClose, anchor,
  onLocate,
}: SayEditorProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const word = useMemo(() => content.slice(start, end), []);  // fixed at open
  const [searchFrom, setSearchFrom] = useState(start);
  const [spoken, setSpoken] = useState("");
  const [showTips, setShowTips] = useState(false);
  // The accordion: one tip open at a time -- opening one closes the other.
  const [openTip, setOpenTip] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => () => audioRef.current?.pause(), []);

  // Every occurrence of the word (exact, word-boundary) not already
  // inside a [say] span -- recomputed as the buffer changes under us.
  const occurrences = useMemo(() => {
    if (!word.trim()) return [];
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9'’])${escaped}(?![A-Za-z0-9'’])`, "g");
    const found: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const before = content.slice(Math.max(0, match.index - 60), match.index);
      const opens = before.lastIndexOf("[say:");
      const closes = before.lastIndexOf("[/say]");
      if (opens !== -1 && opens > closes) continue;  // already overridden
      found.push(match.index);
    }
    return found;
  }, [content, word]);

  const remaining = occurrences.filter(pos => pos >= searchFrom);
  const currentPos = remaining[0] ?? null;
  const position = currentPos === null
    ? 0 : occurrences.indexOf(currentPos) + 1;

  useEffect(() => {
    if (currentPos !== null) onLocate?.(currentPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPos]);

  const handleAccept = useCallback(() => {
    if (currentPos === null || !spoken.trim()) return;
    const replacement = `[say:${spoken.trim()}]${word}[/say]`;
    const next = content.slice(0, currentPos) + replacement
      + content.slice(currentPos + word.length);
    setApplied(n => n + 1);
    setSearchFrom(currentPos + replacement.length);
    onApply(next);
  }, [content, currentPos, onApply, spoken, word]);

  const handleNext = useCallback(() => {
    if (currentPos !== null) setSearchFrom(currentPos + 1);
  }, [currentPos]);

  const handlePreview = useCallback(async () => {
    if (currentPos === null || previewing) return;
    setPreviewing(true);
    setError(null);
    try {
      // A FIXED carrier phrase around the word. A bare single word is
      // the engine's worst case -- cold onset plus a manufactured
      // ending with nothing between, heard as garble at the word's
      // edges (live finding). Extracting the writer's own sentence was
      // worse (its boundary hunt tripped over the "." in [pause:0.8]),
      // so the lead-in is constant text with the word MID-sentence:
      // natural onset, natural exit, no markers, fully predictable.
      const wrapped = spoken.trim()
        ? `[say:${spoken.trim()}]${word}[/say]`
        : word;
      const carrier = `You will hear ${wrapped} in the narration.`;
      const { blob } = await previewSelection(workspacePath, carrier, voiceId);
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      void audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  }, [content, currentPos, previewing, spoken, voiceId, word, workspacePath]);

  const style = anchor
    ? { top: anchor.top, left: Math.max(8, Math.min(anchor.left, 9999)) }
    : { top: 8, left: 8 };

  return (
    <div
      className="absolute z-40 w-[26rem] max-w-[92%] rounded-lg border border-blue-800 bg-zinc-900 p-3 shadow-xl shadow-black/50"
      style={style}
      onKeyDown={e => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter") handleAccept();
      }}
    >
      {currentPos === null ? (
        <p className="text-xs text-zinc-300">
          {applied > 0
            ? `Done -- ${applied} spot${applied === 1 ? "" : "s"} set.`
            : "No more occurrences from here."}
        </p>
      ) : (
        <>
          {/* The structured marker: only the spoken form is typeable. */}
          <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-xs">
            <span className="text-zinc-500">[say:</span>
            <input
              ref={inputRef}
              value={spoken}
              onChange={e => setSpoken(e.target.value)}
              placeholder="how to speak it"
              aria-label="Spoken form"
              className="w-36 rounded border border-blue-800 bg-zinc-950 px-1.5 py-0.5 text-blue-200 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-zinc-500">]</span>
            <span className="font-semibold text-zinc-100">{word}</span>
            <span className="text-zinc-500">[/say]</span>
            <button
              onClick={() => void handlePreview()}
              disabled={previewing}
              title={spoken.trim()
                ? "Hear the word with your spoken form applied"
                : "Hear the engine's current reading of the word"}
              className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
            >
              {previewing ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Preview
            </button>
          </div>

          {/* Tips: the vetted respelling tricks, expandable. */}
          <button
            onClick={() => setShowTips(v => !v)}
            className="mb-1 inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200"
          >
            {showTips ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Tips: ways writers use this
          </button>
          {showTips && (
            <ul className="mb-2 max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-950">
              {TIPS.map((tip, index) => (
                <li key={tip.title} className="border-b border-zinc-800/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenTip(prev => (prev === index ? null : index))}
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[11px] font-medium text-zinc-200 hover:text-blue-200"
                  >
                    {openTip === index
                      ? <ChevronDown size={10} className="shrink-0" />
                      : <ChevronRight size={10} className="shrink-0" />}
                    {tip.title}
                  </button>
                  {openTip === index && (
                    <p className="px-3 pb-2 pl-6 text-[11px] leading-relaxed text-zinc-400">
                      {tip.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleAccept}
              disabled={!spoken.trim()}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              <Check size={11} /> Accept
            </button>
            <button
              onClick={handleNext}
              disabled={remaining.length <= 1}
              title={`Skip to the next "${word}"`}
              className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40"
            >
              Next ({position} of {occurrences.length})
            </button>
            <button
              onClick={onClose}
              className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-500"
            >
              Cancel
            </button>
            <button onClick={onClose} aria-label="Close say editor"
                    className="ml-auto rounded p-0.5 text-zinc-500 hover:text-zinc-200">
              <X size={12} />
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1 text-[10px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
