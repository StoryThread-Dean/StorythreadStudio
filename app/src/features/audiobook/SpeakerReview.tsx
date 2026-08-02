// features/audiobook/SpeakerReview.tsx
// =====================================
// The AI proposes who speaks each line; the writer decides (spec 27.3).
// One proposal at a time, in reading order, with three answers: Accept
// (wrap it in a [voice:NAME] span), Change the name first, or Keep
// narrator (skip it).
//
// This is an AI pass over the writer's own prose, so it inherits the two
// rules that govern every AI feature in this app:
//
//   IT PROPOSES, IT NEVER APPLIES. Accepting edits the editor BUFFER.
//   Nothing reaches the file until the writer saves, exactly like the
//   Formatting Walkthrough -- so an unconvincing pass costs one Ctrl+Z,
//   or simply closing without saving.
//
//   IT NEVER RE-TYPES THE PROSE. Every proposal carries offsets into the
//   text that was analysed, verified server-side to match character for
//   character. The wrap uses those offsets, so the words inside the span
//   are the writer's own -- never the model's copy of them.
//
// Low confidence is shown, not hidden. A model that is unsure is useful
// information; a model that hides being unsure is a trap.

import { useEffect, useState } from "react";
import { Check, Loader2, SkipForward, Sparkles, X } from "lucide-react";

import type { SpeakerProposal } from "./api";

interface SpeakerReviewProps {
  proposals: SpeakerProposal[];
  dropped: number;
  /** The exact text the proposals were computed against. Offsets are
   *  meaningless against anything else, so this is passed back with
   *  every accept and re-checked before the edit. */
  analyzedText: string;
  busy?: boolean;
  /** Wrap [start, end) of the analysed passage in a voice span. */
  onAccept: (proposal: SpeakerProposal, speaker: string) => void;
  onClose: () => void;
}

function confidenceLabel(value: number): { text: string; className: string } {
  if (value >= 0.8) return { text: "confident", className: "text-emerald-300" };
  if (value >= 0.5) return { text: "fairly sure", className: "text-amber-300" };
  return { text: "unsure", className: "text-rose-300" };
}

export function SpeakerReview({
  proposals, dropped, analyzedText, busy, onAccept, onClose,
}: SpeakerReviewProps) {
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [applied, setApplied] = useState(0);

  const current = proposals[index];

  useEffect(() => { setName(current?.speaker ?? ""); }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (busy) {
    return (
      <div className="shrink-0 border-b border-violet-900 bg-violet-950/40 px-4 py-2">
        <p className="flex items-center gap-2 text-[11px] text-violet-200">
          <Loader2 size={12} className="animate-spin" />
          Reading the passage and working out who speaks...
        </p>
      </div>
    );
  }

  if (!proposals.length) {
    return (
      <div className="shrink-0 border-b border-violet-900 bg-violet-950/40 px-4 py-2">
        <p className="flex items-center justify-between gap-2 text-[11px] text-violet-200">
          <span>
            No dialogue was confidently attributed in this passage.
            {dropped > 0 && ` (${dropped} suggestion${dropped === 1 ? "" : "s"} `
              + "did not match your text exactly and were discarded.)"}
          </span>
          <button onClick={onClose} className="shrink-0 text-violet-300 hover:text-violet-100">
            <X size={13} />
          </button>
        </p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="shrink-0 border-b border-violet-900 bg-violet-950/40 px-4 py-2">
        <p className="flex items-center justify-between gap-2 text-[11px] text-violet-200">
          <span>
            Done -- {applied} voice marker{applied === 1 ? "" : "s"} added to the
            editor. Nothing is saved until you press Save.
          </span>
          <button onClick={onClose} className="shrink-0 text-violet-300 hover:text-violet-100">
            <X size={13} />
          </button>
        </p>
      </div>
    );
  }

  // Offsets are only meaningful against the text they were computed on.
  // If the writer edited while the panel was open, this proposal cannot
  // be applied safely -- so it is skipped rather than wrapped blind.
  const stillMatches =
    analyzedText.slice(current.start, current.end) === current.quote;
  const confidence = confidenceLabel(current.confidence);

  function accept() {
    if (!current || !stillMatches || !name.trim()) return;
    onAccept(current, name.trim());
    setApplied(a => a + 1);
    setIndex(i => i + 1);
  }

  return (
    <div className="shrink-0 border-b border-violet-900 bg-violet-950/40 px-4 py-2">
      <div className="flex items-start gap-3">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-violet-200">
            <span className="font-medium">
              Speaker {index + 1} of {proposals.length}
            </span>
            <span className={confidence.className}>
              {confidence.text} ({Math.round(current.confidence * 100)}%)
            </span>
            {current.reason && (
              <span className="text-violet-300/70">-- {current.reason}</span>
            )}
            {!current.in_cast && (
              <span className="text-amber-300">
                {current.speaker} is not in your cast yet
              </span>
            )}
          </p>

          <p className="mt-1 truncate text-[11px] italic text-zinc-300" title={current.quote}>
            {current.quote}
          </p>

          {!stillMatches && (
            <p className="mt-1 text-[10px] text-rose-300">
              The text changed since this was analysed, so this one cannot be
              applied. Skip it and run the pass again when you are done editing.
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input
              aria-label="Speaker name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") accept(); }}
              className="w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100"
            />
            <button
              onClick={accept}
              disabled={!stillMatches || !name.trim()}
              className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              <Check size={11} /> Accept
            </button>
            <button
              onClick={() => setIndex(i => i + 1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-600 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-zinc-400"
            >
              <SkipForward size={11} /> Keep narrator
            </button>
            <span className="text-[10px] text-violet-300/60">
              Edits go to the editor only -- nothing is saved until you press Save.
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close speaker review"
          className="shrink-0 rounded p-1 text-violet-400 hover:text-violet-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
