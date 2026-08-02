// features/audiobook/SpeakerWalkthrough.tsx
// ==========================================
// Walk the dialogue and say who speaks it -- the Cast half of the
// Formatting Walkthrough, in the same shape and the same violet the rest
// of the cast tools use.
//
// The order of operations here is the whole design, and it is the
// opposite of what the first build did:
//
//   FINDING the dialogue is local, instant and free. It is quotation
//   marks; no model is needed, nothing can hang, and it works offline.
//   Most lines also carry their own tag ("...," Elena said), so the
//   walk usually arrives with the answer already filled in.
//
//   GUESSING a name the prose does not give is the only part a model
//   helps with, so the AI is an OPTIONAL pass inside the walk. It can be
//   cancelled, it times out, and if it never answers the writer still
//   has every stop in front of them with the cast one click away.
//
// One-off characters (a store clerk with a single line) are why "Keep
// narrator" is a first-class button rather than a skip: most books have
// far more speakers than they have cast members, and answering "the
// narrator reads this one" has to be as fast as answering "Elena".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronRight, Loader2, Sparkles, Users, X,
} from "lucide-react";

import { analyzeSpeakers } from "./api";
import { mergeAiGuesses, scanSpeakers } from "./speakerScan";
import type { SpeakerStop } from "./speakerScan";

interface SpeakerWalkthroughProps {
  content: string;
  workspacePath: string;
  /** Character names from the cast -- the one-click answers. */
  castNames: string[];
  /** Wrap [start,end) in a voice span; the caller marks dirty. */
  onAssign: (stop: SpeakerStop, speaker: string) => void;
  /** Point the editor at this stop (select + scroll). */
  onHighlight: (start: number, length: number) => void;
  /** Add a name the walk used that the cast does not have yet. */
  onAddToCast: (name: string) => void;
  onClose: () => void;
}

// The AI pass is a structured read of one chapter, not a drafting turn.
// If it has not answered in this long it is not going to, and the writer
// should get their walk back rather than a spinner that never ends.
const AI_TIMEOUT_MS = 90_000;

// How much text the AI pass may be asked about at once. The endpoint
// refuses more than 30,000 characters, and a whole novel would be both
// refused and pointless -- proposals are matched back by their quoted
// words, so a window works exactly as well as the whole file.
const AI_WINDOW_CHARS = 24_000;

export function SpeakerWalkthrough({
  content, workspacePath, castNames, onAssign, onHighlight, onAddToCast, onClose,
}: SpeakerWalkthroughProps) {
  const [stops, setStops] = useState<SpeakerStop[]>(() => scanSpeakers(content));
  const [index, setIndex] = useState(0);
  const [assigned, setAssigned] = useState(0);
  const [typed, setTyped] = useState("");
  const [aiState, setAiState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const expected = useRef(content);

  // The buffer changed under us (an assign, or the writer typing). A
  // rescan keeps the offsets honest -- stale offsets would wrap the
  // wrong words, which is the one unrecoverable mistake here.
  useEffect(() => {
    if (content === expected.current) return;
    expected.current = content;
    setStops(scanSpeakers(content));
  }, [content]);

  const current = stops[index];

  useEffect(() => {
    setTyped(current?.guess ?? "");
    if (current) onHighlight(current.start, current.end - current.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.start]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const advance = useCallback(() => setIndex(i => i + 1), []);

  const assign = useCallback((name: string) => {
    const speaker = name.trim();
    if (!current || !speaker) return;
    // Offsets came from a scan of THIS content, so re-check before
    // wrapping. Cheap, and it is the difference between marking a line
    // and mangling a paragraph.
    if (content.slice(current.start, current.end) !== current.quote) {
      setStops(scanSpeakers(content));
      return;
    }
    onAssign(current, speaker);
    if (!castNames.some(n => n.toLowerCase() === speaker.toLowerCase())) {
      onAddToCast(speaker);
    }
    setAssigned(a => a + 1);
    advance();
  }, [current, content, castNames, onAssign, onAddToCast, advance]);

  // Keyboard, so the walk can be done without leaving the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!e.ctrlKey) return;
      if (e.key === "Enter") { e.preventDefault(); assign(typed); }
      else if (e.key === "ArrowRight") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assign, advance, onClose, typed]);

  const unnamed = useMemo(() => stops.filter(s => !s.guess).length, [stops]);

  async function runAiPass() {
    if (aiState === "running") return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    setAiState("running");
    setAiNote(null);
    try {
      // Send a WINDOW, never the whole book. A novel is far past what
      // the endpoint accepts, and asking a model to read 300 pages to
      // name a dozen speakers is slow enough to look broken -- which is
      // exactly how this failed the first time it shipped.
      const first = stops.find(s => !s.guess) ?? stops[0];
      const from = Math.max(0, (first?.start ?? 0) - 500);
      const window_ = content.slice(from, from + AI_WINDOW_CHARS);
      const result = await analyzeSpeakers(workspacePath, window_, controller.signal);
      setStops(prev => mergeAiGuesses(prev, result.proposals));
      setAiState("done");
      setAiNote(result.proposals.length
        ? `Filled in ${result.proposals.length} name${result.proposals.length === 1 ? "" : "s"}.`
        : "The AI did not add any names. Your own tags are still here.");
    } catch (e) {
      setAiState("failed");
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setAiNote(aborted
        ? "Stopped. The walk below still works -- assign speakers yourself."
        : (e instanceof Error ? e.message : "The AI pass failed.")
          + " The walk below still works.");
    } finally {
      window.clearTimeout(timer);
      abortRef.current = null;
    }
  }

  function cancelAi() {
    abortRef.current?.abort();
  }

  const before = current ? content.slice(Math.max(0, current.start - 70), current.start) : "";
  const after = current
    ? content.slice(current.end, current.end + 70) : "";

  return (
    <div className="shrink-0 border-b border-violet-900/60 bg-violet-950/30 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300">
          <Users size={12} /> Cast Walkthrough
        </span>
        <span className="text-[11px] text-zinc-500">
          {stops.length === 0
            ? "no unassigned dialogue found here"
            : !current
              ? `all done -- ${assigned} assigned`
              : `line ${index + 1} of ${stops.length}`
                + (assigned > 0 ? ` -- ${assigned} assigned` : "")}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {/* The AI is help, not the engine. Offered when there are
              names the prose did not give, cancellable while it runs. */}
          {aiState === "running" ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-violet-300">
              <Loader2 size={11} className="animate-spin" />
              Asking the AI who speaks...
              <button
                onClick={cancelAi}
                className="rounded border border-violet-700 px-1.5 py-0.5 text-[10px] text-violet-200 hover:border-violet-400"
              >
                Cancel
              </button>
            </span>
          ) : unnamed > 0 && (
            <button
              onClick={() => void runAiPass()}
              title="Ask the AI to name the speakers your prose does not tag. Optional -- the walk works without it."
              className="inline-flex items-center gap-1 rounded border border-violet-700 px-2 py-0.5 text-[10px] text-violet-200 hover:border-violet-400"
            >
              <Sparkles size={10} />
              {aiState === "idle"
                ? `Ask AI about ${unnamed} untagged line${unnamed === 1 ? "" : "s"}`
                : "Ask AI again"}
            </button>
          )}
          <button onClick={onClose} aria-label="Close cast walkthrough"
                  className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={13} />
          </button>
        </span>
      </div>

      {aiNote && (
        <p className={"mb-2 text-[10px] "
          + (aiState === "failed" ? "text-amber-300" : "text-violet-300/80")}>
          {aiNote}
        </p>
      )}

      {stops.length === 0 && (
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Every quoted line here is either already assigned or too short to
          read as dialogue. Select a different chapter and open the
          walkthrough again, or mark a passage by hand with the Voice button.
        </p>
      )}

      {!current && stops.length > 0 && (
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Nothing left in this pass. The markers are in the editor only --
          press Save to keep them.
        </p>
      )}

      {current && (
        <>
          <p className="mb-2 truncate font-serif text-[13px] leading-relaxed text-zinc-400">
            <span className="opacity-50">{before}</span>
            <span className="rounded bg-violet-900/60 px-0.5 text-zinc-100">
              {current.quote}
            </span>
            <span className="opacity-50">{after}</span>
          </p>

          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Who says this?
            </span>
            {current.guessSource === "tag" && current.guess && (
              <span className="text-[10px] text-emerald-300">
                your text says "{current.guess}"
              </span>
            )}
            {current.guessSource === "ai" && current.guess && (
              <span className="text-[10px] text-violet-300">
                AI suggests {current.guess}
                {typeof current.confidence === "number"
                  && ` (${Math.round(current.confidence * 100)}% sure)`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* The cast, one click each. */}
            {castNames.map(name => (
              <button
                key={name}
                onClick={() => assign(name)}
                className={"rounded border px-2.5 py-1 text-[11px] transition-colors "
                  + (name.toLowerCase() === (current.guess || "").toLowerCase()
                    ? "border-violet-500 bg-violet-900/50 text-violet-100"
                    : "border-zinc-700 text-zinc-200 hover:border-violet-500")}
              >
                {name}
              </button>
            ))}

            {/* A one-off speaker: the store clerk with a single line.
                Most books have far more speakers than cast members, so
                this has to be as fast as picking a name. */}
            <button
              onClick={advance}
              title="Leave this line to the narrator -- right for one-off speakers you will never cast"
              className="inline-flex items-center gap-1 rounded border border-zinc-600 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-zinc-400"
            >
              <ChevronRight size={11} /> Keep narrator
            </button>

            <span className="mx-1 h-4 w-px bg-zinc-800" />

            <input
              aria-label="Speaker name"
              value={typed}
              placeholder="or type a name"
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") assign(typed); }}
              className="w-36 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100"
            />
            <button
              onClick={() => assign(typed)}
              disabled={!typed.trim()}
              className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              <Check size={11} /> Assign
            </button>
            <span className="text-[10px] text-zinc-600">
              Ctrl+Enter assign, Ctrl+Right skip. Nothing is saved until you
              press Save.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
