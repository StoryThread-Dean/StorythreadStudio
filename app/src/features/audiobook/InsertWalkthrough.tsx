// features/audiobook/InsertWalkthrough.tsx
// =========================================
// The Guided Insert Walkthrough (spec 18.4, user-designed): starting at
// the cursor, walk DOWN the manuscript stop by stop -- every spot where
// a pause or a marker repair could improve the narration. At each stop
// the writer applies a proposal, picks a different one, or skips. Edits
// land in the BUFFER like typing (manual save still owns persistence).
//
// A pop-out window, sharing the Cast panel's shell (user decision,
// 2026-08-03). It began as a modeless strip above the editor, which the
// spec chose so a writer could hand-edit between stops -- but the strip
// ran out of room: seven kind toggles, per-reading Play buttons, a
// ten-step tutorial and a confirm banner do not fit in a band, and the
// remaining heteronym work only adds rows. Cast had already solved the
// same interaction (walk the chapter, decide one thing at a time, land
// every change on the buffer), so this now matches it.
//
// The trade, made deliberately: hand-editing mid-walk is gone, since the
// panel covers the editor. Closing and reopening resumes from the cursor.
// What that costs is offset by rendering the WHOLE paragraph in here --
// the panel must never need the screen behind it, which is the property
// that makes Cast work.
//
// Keyboard: Ctrl+Enter apply, Ctrl+Right skip, Ctrl+Left back, Esc close.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight, GraduationCap, Loader2, Play, Wand2, X,
} from "lucide-react";

import { InsertWalkthroughHelp } from "./InsertWalkthroughHelp";

import { previewSelection } from "./api";
import {
  applyStop, bulkApplyDefaults, DEFAULT_MUTED_KINDS, isBeatKind,
  isHeteronymKind, scanForStops, sentenceAround, STOP_KIND_HINTS,
  STOP_KIND_LABELS,
} from "./insertScan";
import type { InsertOption, InsertStop, StopKind } from "./insertScan";
import type { HeteronymReading } from "./heteronyms";
import { paragraphBoundsAt, stripAudioMarkers } from "./markers";

interface InsertWalkthroughProps {
  content: string;
  /** Where the walk begins (the caret when the panel opened). */
  startOffset: number;
  /** Commit an edit to the buffer; the caller marks dirty and restores
      the editor's caret/scroll to `caret`. */
  onApplyEdit: (next: string, caret: number) => void;
  /** Point the editor at the current stop (select + scroll). */
  onHighlight: (offset: number, length: number) => void;
  onClose: () => void;
  /** Needed by word-reading stops, which render each candidate
      pronunciation as audio in the book's own narration voice. */
  workspacePath: string;
  voiceId: string;
}

const ALL_KINDS = Object.keys(STOP_KIND_LABELS) as StopKind[];

export function InsertWalkthrough({
  content, startOffset, onApplyEdit, onHighlight, onClose,
  workspacePath, voiceId,
}: InsertWalkthroughProps) {
  // Scanned ONCE on open; offsets shift locally after each apply. If the
  // buffer changes some other way (the writer typed), we rescan from the
  // current stop so the walk stays honest.
  const [stops, setStops] = useState<InsertStop[]>(() => scanForStops(content, startOffset));
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState<Set<StopKind>>(
    () => new Set(DEFAULT_MUTED_KINDS));
  const [applied, setApplied] = useState(0);
  const [confirmingAuto, setConfirmingAuto] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const expectedContent = useRef(content);
  // Which reading is currently rendering, and any preview error. Audio is
  // cached per (sentence, spoken form) so replaying and stepping Back are
  // instant -- two syntheses per stop across a long chapter is the one
  // thing that could make this tedious.
  const [playing, setPlaying] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const clipCache = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => {
    audioRef.current?.pause();
    for (const url of clipCache.current.values()) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (content === expectedContent.current) return;
    // External edit: rescan from where the walk currently is.
    expectedContent.current = content;
    setStops(prev => {
      const at = prev[index]?.offset ?? startOffset;
      return scanForStops(content, at);
    });
    setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const visible = useMemo(
    () => stops.filter(stop => !muted.has(stop.kind)),
    [stops, muted]);
  const current = visible[index] ?? null;

  // Keep the editor pointed at the current stop.
  useEffect(() => {
    if (current) onHighlight(current.offset, current.length);
  }, [current, onHighlight]);

  const advance = useCallback(() => {
    setIndex(i => Math.min(i + 1, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  const applyOption = useCallback((option: InsertOption) => {
    if (!current) return;
    const { next, caret, delta } = applyStop(content, current, option);
    expectedContent.current = next;
    setStops(prev => prev
      .filter(stop => stop !== current)
      .map(stop => stop.offset > current.offset
        ? { ...stop, offset: stop.offset + delta } : stop));
    setApplied(n => n + 1);
    onApplyEdit(next, caret);
    // The current stop vanished from the list, so the same index now
    // shows the next one -- clamp in case it was the last.
    setIndex(i => Math.min(i, Math.max(0, visible.length - 2)));
  }, [content, current, onApplyEdit, visible.length]);

  const skip = useCallback(() => {
    if (index < visible.length - 1) advance();
  }, [advance, index, visible.length]);
  const back = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  // ── Word-reading audio ──────────────────────────────────────────────────────
  // The clip is the writer's OWN sentence with one reading applied, in the
  // book's narration voice. Not a carrier phrase and not a bare word: which
  // reading is right depends on the sentence, so the sentence is what has
  // to be heard. Local Kokoro renders it, which is free -- see
  // previewSelection's hardcoded provider.
  const clipText = useCallback((stop: InsertStop, reading: HeteronymReading) => {
    const { start, end } = sentenceAround(content, stop.offset);
    const left = stripAudioMarkers(content.slice(start, stop.offset));
    const right = stripAudioMarkers(
      content.slice(stop.offset + stop.length, end));
    const middle = reading.spoken === null
      ? (stop.word ?? "")
      : `[say:${reading.spoken}]${stop.word ?? ""}[/say]`;
    return (left + middle + right).trim();
  }, [content]);

  const playReading = useCallback(async (
    stop: InsertStop, reading: HeteronymReading,
  ) => {
    const text = clipText(stop, reading);
    const key = `${text}|${reading.spoken ?? ""}`;
    setPreviewError(null);
    const cached = clipCache.current.get(key);
    if (cached) {
      audioRef.current?.pause();
      const audio = new Audio(cached);
      audioRef.current = audio;
      void audio.play();
      return;
    }
    setPlaying(reading.sense);
    try {
      const { blob } = await previewSelection(workspacePath, text, voiceId);
      const url = URL.createObjectURL(blob);
      clipCache.current.set(key, url);
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      void audio.play();
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPlaying(null);
    }
  }, [clipText, voiceId, workspacePath]);

  /** How many more of THIS word lie ahead in the chapter. The writer's
   *  choice is never applied in bulk -- the same word in the next
   *  sentence may be the other sense entirely -- but they should know the
   *  walk continues rather than wonder whether it caught them all. */
  const remainingSameWord = useMemo(() => {
    if (!current?.word) return 0;
    return visible.filter(
      (stop, i) => i > index && stop.word?.toLowerCase() === current.word?.toLowerCase(),
    ).length;
  }, [current, index, visible]);

  // Auto-apply: every remaining unmuted stop's default beat at once.
  // Marker repairs stay manual (a broken pace has a direction choice
  // only the writer can make).
  const autoBeatCount = visible.filter(s => isBeatKind(s.kind)).length;
  const autoApply = useCallback(() => {
    const { next, applied: batch } = bulkApplyDefaults(content, visible);
    expectedContent.current = next;
    // Fresh scan of the new text: the inserted pauses suppress their own
    // spots, so what remains is marker repairs plus any muted kinds.
    setStops(scanForStops(next, startOffset));
    setApplied(n => n + batch);
    setIndex(0);
    setConfirmingAuto(false);
    onApplyEdit(next, startOffset);
  }, [content, onApplyEdit, startOffset, visible]);

  // Global keys so the flow works while the editor keeps focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!e.ctrlKey) return;
      // Ctrl+Enter is the fast path for a beat, where there IS a sensible
      // default. A word-reading stop has none on purpose: picking one for
      // the writer is picking what their sentence means.
      if (e.key === "Enter" && current && !isHeteronymKind(current.kind)) {
        e.preventDefault();
        applyOption(current.options[0]);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyOption, back, current, onClose, skip]);

  const toggleKind = (kind: StopKind) => {
    setMuted(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setIndex(0);
  };

  const countOf = (kind: StopKind) => stops.filter(s => s.kind === kind).length;

  // The stop in context, proposal rendered inline. Now the WHOLE
  // paragraph: this panel covers the editor, so a 90-character window
  // either side -- which was fine when the manuscript sat visible behind
  // the strip -- would leave the writer deciding a beat without being able
  // to see the sentence it belongs to. Cast works for exactly this reason;
  // it never needs the screen behind it.
  const context = useMemo(() => {
    if (!current) return null;
    const { start, end } = paragraphBoundsAt(content, current.offset);
    return {
      before: content.slice(start, current.offset),
      replaced: content.slice(current.offset, current.offset + current.length),
      after: content.slice(current.offset + current.length, Math.max(end, current.offset)),
      // Whether the paragraph runs past the window we are showing, so the
      // ellipses tell the truth instead of always claiming there is more.
      truncatedStart: start > 0,
      truncatedEnd: end < content.length,
    };
  }, [content, current]);

  return (
    // A workbench, not a toolbar. Same shell as the Cast panel because it
    // is the same interaction -- walk the chapter, decide one thing at a
    // time, every change lands in the buffer -- and two shells for one
    // shape was the real inconsistency. The strip this replaced had run
    // out of room: seven kind toggles, three reading rows with their own
    // Play buttons, a ten-step tutorial and a confirm banner, all in a
    // band above the editor.
    <div
      role="dialog"
      aria-label="Formatting Walkthrough"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-blue-900 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <Wand2 size={15} className="text-blue-300" />
          <h2 className="text-sm font-semibold text-zinc-100">
            Formatting Walkthrough
          </h2>
          {/* Progress only. When the walk is empty the panel below says so
              in full -- saying it in both places is one sentence too many
              in a window this size. */}
          <span className="flex-1 text-[11px] text-zinc-500">
            {visible.length > 0
              && `stop ${index + 1} of ${visible.length}`
                 + (applied > 0 ? ` -- ${applied} applied` : "")}
          </span>
          <button
            onClick={() => setShowHelp(v => !v)}
            className={"inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors "
              + (showHelp
                ? "border-blue-500 bg-blue-900/40 text-blue-100"
                : "border-blue-800 text-blue-200 hover:border-blue-500")}
          >
            <GraduationCap size={11} /> Show me how this works
          </button>
          <button onClick={onClose} aria-label="Close walkthrough"
                  className="rounded p-1 text-zinc-500 hover:text-zinc-100">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {showHelp && (
        <div className="mb-3">
          <InsertWalkthroughHelp onClose={() => setShowHelp(false)} />
        </div>
      )}

      {confirmingAuto && (
        <div className="mb-2 rounded border border-amber-800 bg-amber-950/50 px-3 py-2">
          {/* Warning sized just under the manuscript's text-sm -- this
              is the one strip that must actually get READ. */}
          <p className="mb-1.5 text-[13px] font-semibold text-amber-200">
            Add all {autoBeatCount} pauses without listening to each one?
          </p>
          <p className="mb-2 text-[13px] leading-relaxed text-amber-300/90">
            Some of them will be wrong for the scene. A pause where the
            line should push forward, or a gap inside a run you wrote to
            tumble. Listen to the chapter with the free narrator on your
            machine before you pay for a voice.
            <br /><br />
            Nothing is written to your file until you press Save in the
            editor, so if the whole batch reads badly you can close without
            saving and none of it happened.
            <br /><br />
            Marker fixes and word readings are not included. A broken
            marker could be corrected two different ways, and only you know
            which reading of a word like "read" you meant. Those stay here
            for you to decide.
          </p>
          <div className="flex gap-2">
            <button
              onClick={autoApply}
              className="rounded bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
            >
              Yes, add all {autoBeatCount}
            </button>
            <button
              onClick={() => setConfirmingAuto(false)}
              className="rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-300 hover:border-zinc-500"
            >
              No, let me go one at a time
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        {/* The rail: what the walk is looking for, and how much of each it
            found. Every kind names what it is FOR -- a count beside a
            label the writer cannot interpret is a toggle they will never
            touch. */}
        <div className="shrink-0 sm:w-56">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            What to look for
          </p>
          <div className="overflow-hidden rounded border border-zinc-800">
            {ALL_KINDS.map(kind => (
              <label
                key={kind}
                className="flex cursor-pointer items-start gap-2 border-b border-zinc-800/60 px-2 py-1.5 last:border-b-0 hover:bg-zinc-800/30"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={!muted.has(kind)}
                  onChange={() => toggleKind(kind)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1 text-[11px] font-medium text-zinc-200">
                    <span className="flex-1">{STOP_KIND_LABELS[kind]}</span>
                    <span className="text-[10px] text-zinc-500">{countOf(kind)}</span>
                  </span>
                  <span className="block text-[10px] leading-tight text-zinc-500">
                    {STOP_KIND_HINTS[kind]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {autoBeatCount > 0 && !confirmingAuto && (
            <button
              onClick={() => setConfirmingAuto(true)}
              title="Adds every pause still being suggested, at the shorter length. Marker fixes and word readings stay here for you to decide."
              className="mt-2 w-full rounded border border-amber-700 px-2 py-1 text-[11px] text-amber-300 hover:border-amber-500"
            >
              {/* Was "Auto-apply N beats". Read by a first-time writer,
                  "N" is a letter and "beats" is music -- the button
                  announced itself in two words neither of which meant
                  anything. It now says what it does and to how many. */}
              Add all {autoBeatCount} pauses at once
            </button>
          )}
        </div>

        {/* The work surface. */}
        <div className="min-w-0 flex-1">
      {current && context && (
        <>
          <p className="mb-1 text-xs font-medium text-zinc-200">{current.title}</p>
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">{current.detail}</p>
          {/* The sentence in context. A word-reading stop shows the word
              itself standing where it is -- there is no proposal to
              preview until the writer picks a reading. */}
          <p className="mb-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12px] leading-relaxed text-zinc-400">
            {context.truncatedStart && "... "}{context.before}
            {isHeteronymKind(current.kind) ? (
              <span className="rounded bg-blue-950 px-0.5 font-semibold text-blue-300">
                {context.replaced}
              </span>
            ) : (
              <>
                {context.replaced
                  ? <s className="text-rose-400">{context.replaced}</s>
                  : null}
                <span className="rounded bg-blue-950 px-0.5 font-semibold text-blue-300">
                  {current.options[0].text || "(removed)"}
                </span>
              </>
            )}
            {context.after}{context.truncatedEnd && " ..."}
          </p>

          {/* Word readings: each candidate is offered as AUDIO, in this
              sentence, in the book's voice. "reed / red" on screen asks
              the writer to trust a notation they have no reason to
              trust; two Play buttons ask them to use their ear, and that
              takes about two seconds. */}
          {isHeteronymKind(current.kind) && current.readings && (
            <div className="mb-2 overflow-hidden rounded border border-zinc-800">
              {current.readings.map(reading => {
                const isEngine = reading.spoken === null;
                const option = current.options.find(
                  o => o.reading?.sense === reading.sense);
                return (
                  <div key={reading.sense}
                       className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 bg-zinc-950/60 px-2 py-1.5 last:border-b-0">
                    <button
                      onClick={() => void playReading(current, reading)}
                      disabled={playing !== null}
                      aria-label={`Play "${reading.sense}"`}
                      title={`Hear this sentence with the "${reading.sense}" reading`}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
                    >
                      {playing === reading.sense
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Play size={11} />}
                      Play
                    </button>
                    <span className="min-w-0 flex-1 text-[11px] leading-tight">
                      <span className="font-medium text-zinc-200">{reading.sense}</span>
                      <span className="text-zinc-500"> -- {reading.example}</span>
                      <span className="block text-[10px] text-zinc-600">
                        sounds like "{reading.sounds}"
                        {isEngine && " -- what you get today"}
                      </span>
                    </span>
                    {option ? (
                      <button
                        onClick={() => applyOption(option)}
                        className="shrink-0 rounded bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                      >
                        Use this
                      </button>
                    ) : (
                      // The engine's own reading needs no marker. Saying so
                      // is kinder than an inert button.
                      <span className="shrink-0 text-[10px] text-zinc-600">
                        already how it reads -- Skip keeps it
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {remainingSameWord > 0 && (
            // No bulk apply, by design: the next "read" may be the other
            // sense entirely, and a wrong batch is worse than a skip
            // because the writer then believes it is handled.
            <p className="mb-2 text-[10px] text-zinc-500">
              {remainingSameWord} more "{current.word}"
              {remainingSameWord === 1 ? " lies" : " lie"} ahead -- each one
              gets its own ask.
            </p>
          )}

          {previewError && (
            <p className="mb-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1 text-[10px] text-rose-300">
              {previewError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Beat stops get Apply buttons with a highlighted default.
                Word readings already have their own per-reading buttons
                above, and repeating them here would offer a "first"
                choice this stop is not allowed to have. */}
            {!isHeteronymKind(current.kind) && current.options.map((option, i) => (
              <button
                key={option.label}
                onClick={() => applyOption(option)}
                className={i === 0
                  ? "inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                  : "rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300"}
                title={i === 0 ? "Apply (Ctrl+Enter)" : "Apply this instead"}
              >
                {i === 0 && <Check size={11} />}
                {option.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-zinc-800" />
            <button onClick={back} disabled={index === 0}
                    title="Back (Ctrl+Left)"
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 disabled:opacity-40">
              <ChevronLeft size={11} /> Back
            </button>
            <button onClick={skip} disabled={index >= visible.length - 1}
                    title="Skip (Ctrl+Right)"
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-600 hover:text-blue-300 disabled:opacity-40">
              Skip <ChevronRight size={11} />
            </button>
          </div>

          {/* The shortcuts, greyed, directly under the buttons they
              duplicate (user-placed). They were a whole tutorial step,
              which put the least important thing in this feature on equal
              footing with why any of it exists. Reference belongs beside
              the thing it describes. */}
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            Keyboard: Ctrl+Enter adds the first choice, Ctrl+Right skips,
            Ctrl+Left goes back, Esc closes.
          </p>
        </>
      )}

      {!current && (
        // The panel used to be a strip that simply went quiet here. As a
        // window it has to say what happened and offer a way out, or the
        // writer is looking at an empty box wondering what they broke.
        <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-4 text-center">
          <p className="text-[12px] text-zinc-300">
            {applied > 0
              ? `Nothing further from here -- ${applied} applied.`
              : "Nothing to suggest from here."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {muted.size > 0
              ? "The walk starts at your cursor and runs to the end of the "
                + "chapter. Switch a kind back on beside this, or close and "
                + "reopen from higher up."
              : "The walk starts at your cursor and runs to the end of the "
                + "chapter. Close and reopen from higher up to cover what is "
                + "above it."}
          </p>
          <button
            onClick={onClose}
            className="mt-3 rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-500"
          >
            Close
          </button>
        </div>
      )}
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
