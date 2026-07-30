// features/audiobook/InsertWalkthrough.tsx
// =========================================
// The Guided Insert Walkthrough (spec 18.4, user-designed): starting at
// the cursor, walk DOWN the manuscript stop by stop -- every spot where
// a pause or a marker repair could improve the narration. At each stop
// the writer applies a proposal, picks a different one, or skips.
// Modeless strip pinned above the editor; edits land in the BUFFER like
// typing (manual save still owns persistence).
//
// Keyboard (works even while the editor has focus, so the writer can
// hand-edit between stops): Ctrl+Enter apply, Ctrl+Right skip,
// Ctrl+Left back, Esc close.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Wand2, X } from "lucide-react";

import { applyStop, scanForStops, STOP_KIND_LABELS } from "./insertScan";
import type { InsertOption, InsertStop, StopKind } from "./insertScan";

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
}

const ALL_KINDS = Object.keys(STOP_KIND_LABELS) as StopKind[];

export function InsertWalkthrough({
  content, startOffset, onApplyEdit, onHighlight, onClose,
}: InsertWalkthroughProps) {
  // Scanned ONCE on open; offsets shift locally after each apply. If the
  // buffer changes some other way (the writer typed), we rescan from the
  // current stop so the walk stays honest.
  const [stops, setStops] = useState<InsertStop[]>(() => scanForStops(content, startOffset));
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState<Set<StopKind>>(new Set());
  const [applied, setApplied] = useState(0);
  const expectedContent = useRef(content);

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

  // Global keys so the flow works while the editor keeps focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!e.ctrlKey) return;
      if (e.key === "Enter" && current) {
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

  // Context snippet around the stop, proposal rendered inline.
  const context = current ? {
    before: content.slice(Math.max(0, current.offset - 90), current.offset),
    replaced: content.slice(current.offset, current.offset + current.length),
    after: content.slice(current.offset + current.length,
                         current.offset + current.length + 90),
  } : null;

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
          <Wand2 size={12} /> Insert Walkthrough
        </span>
        <span className="text-[11px] text-zinc-500">
          {visible.length === 0
            ? (applied > 0 ? `all done -- ${applied} applied` : "nothing to suggest from here")
            : `stop ${index + 1} of ${visible.length}${applied > 0 ? ` -- ${applied} applied` : ""}`}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {ALL_KINDS.map(kind => (
            <label key={kind}
                   className="flex cursor-pointer items-center gap-1 text-[10px] text-zinc-500"
                   title={`Suggest ${STOP_KIND_LABELS[kind].toLowerCase()} stops`}>
              <input type="checkbox" checked={!muted.has(kind)}
                     onChange={() => toggleKind(kind)} />
              {STOP_KIND_LABELS[kind]} ({countOf(kind)})
            </label>
          ))}
          <button onClick={onClose} aria-label="Close walkthrough"
                  className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={13} />
          </button>
        </span>
      </div>

      {current && context && (
        <>
          <p className="mb-1 text-xs font-medium text-zinc-200">{current.title}</p>
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">{current.detail}</p>
          <p className="mb-2 overflow-hidden whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-400">
            {"..."}{context.before}
            {context.replaced
              ? <s className="text-rose-400">{context.replaced}</s>
              : null}
            <span className="rounded bg-blue-950 px-0.5 font-semibold text-blue-300">
              {current.options[0].text || "(removed)"}
            </span>
            {context.after}{"..."}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {current.options.map((option, i) => (
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
        </>
      )}
    </div>
  );
}
