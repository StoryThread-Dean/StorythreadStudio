// components/editor/IssuePopover.tsx -- Floating Issue Card
// ============================================================
// Renders the popover that appears when the writer clicks an inline issue
// highlight in the manuscript. Lists every issue stacked at the click point
// (multiple issues can overlap on the same passage). Each issue gets:
//   - severity badge + category label
//   - one-line explanation
//   - the current AI-suggested rewrite, rendered as a word-level DIFF
//     against the original quote (added words green, removed words red
//     strikethrough) so writers can see exactly what changed
//   - a row of "creative transformation" modifier buttons (Default, Rewrite,
//     Expand, Shorten, Describe, Rephrase, Add Sensory Detail, Change Tone)
//     with Default reverting the suggestion to the AI's original take and
//     the others calling /api/ai/revise-suggestion to replace it
//   - Accept (apply the suggestion as a CM6 transaction) and Ignore
//     (drop just this issue) buttons
//
// Positioning: the popover anchors to the bounding rect of the highlighted
// span (NOT the click point), so it appears centered horizontally below
// the highlight regardless of where the writer actually clicked. If the
// popover would overflow the viewport bottom, we dispatch a CodeMirror
// scrollIntoView effect that centers the highlight vertically; the
// popover then re-measures and lands under it cleanly.
//
// Each issue carries an `originalSuggestion` snapshot (captured when the
// pass came back) so the Default modifier can restore the AI's first take
// after the writer has clicked Rewrite/Shorten/etc. and changed their mind.

import { useEffect, useState, useMemo, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import type {
  ContextChip, ReviseModifier, ReviseSuggestionRequest, ReviseSuggestionResponse,
} from "../../types/ai";
import {
  removeIssueEffect, getIssuesById, type LocatedIssue,
} from "./issueOverlay";
import { wordDiff, type DiffSegment } from "./wordDiff";


// Backend base URL. Re-declared here rather than imported from App.tsx so
// the component stays self-contained.
const API_BASE = "http://localhost:8000";

// Geometry constants. POPOVER_WIDTH is fixed so the centered-on-highlight
// math is straightforward; max height is generous because the diff view
// can take 2-3 lines per suggestion when revisions get long.
const POPOVER_WIDTH      = 420;
const POPOVER_MAX_HEIGHT = 480;
const ANCHOR_GAP         = 8;     // px between highlight bottom and popover top
const SCREEN_MARGIN      = 12;    // minimum distance from viewport edges


// Display labels for each subcategory key. Kept inline rather than imported
// from a shared registry so we don't add a sync surface; the keys match
// EDITOR_PASS_SUBCATEGORIES in backend/app/ai/prompts.py.
const CATEGORY_LABELS: Record<string, string> = {
  grammar:               "Grammar",
  clarity:               "Clarity",
  redundancy:            "Redundancy",
  descriptive:           "Descriptive",
  dialogue:              "Dialogue",
  pov:                   "POV",
  tone:                  "Tone",
  character:             "Character",
  pacing:                "Pacing",
  character_consistency: "Character Consistency",
  relationships:         "Relationship",
  setting:               "Setting",
  lore:                  "Lore",
};


// The seven creative-transformation modifiers plus Default. Default is a
// pure client-side revert -- it doesn't call the backend; the others ask
// /api/ai/revise-suggestion for a fresh suggestion shaped by the modifier.
const MODIFIERS: { key: ReviseModifier; label: string; help: string }[] = [
  { key: "default",             label: "Default",             help: "Restore the AI's original suggestion" },
  { key: "rewrite",             label: "Rewrite",             help: "Same meaning, fresh phrasing" },
  { key: "expand",              label: "Expand",              help: "Add detail or interiority" },
  { key: "shorten",             label: "Shorten",             help: "Trim filler, keep the load-bearing detail" },
  { key: "describe",            label: "Describe",            help: "Replace vague language with specifics" },
  { key: "rephrase",            label: "Rephrase",            help: "Same length, different rhythm" },
  { key: "add sensory detail",  label: "Add Sensory Detail",  help: "Sight, sound, smell, touch, or taste" },
  { key: "change tone",         label: "Change Tone",         help: "Shift atmosphere or mood" },
];


// Severity badge colors. Praise = subtle green; issue = red; suggestion =
// indigo. The colors don't carry meaning beyond visual sorting at a glance.
function severityClass(sev: string): string {
  if (sev === "praise") return "bg-emerald-700/40 text-emerald-200 border-emerald-700";
  if (sev === "suggestion") return "bg-indigo-700/40 text-indigo-200 border-indigo-700";
  return "bg-rose-700/40 text-rose-200 border-rose-700";
}


// Render a diff segment list as inline JSX. Added text gets a green wash;
// removed text shows as red strikethrough so the writer can visualize what
// was there. We don't omit removed text -- showing it inline keeps tiny
// edits (one inserted word) immediately readable AND makes large rewrites
// honest about how much changed.
function renderDiff(segments: DiffSegment[]) {
  return segments.map((seg, i) => {
    if (seg.type === "kept") {
      return <span key={i}>{seg.text}</span>;
    }
    if (seg.type === "added") {
      return (
        <span
          key={i}
          className="rounded-sm bg-emerald-700/40 px-0.5 text-emerald-200"
          title="Added"
        >
          {seg.text}
        </span>
      );
    }
    // Removed: strikethrough. We render the original word inline at its
    // position so the diff reads like a redline rather than a side-by-side.
    return (
      <span
        key={i}
        className="rounded-sm bg-rose-900/30 px-0.5 text-rose-300 line-through"
        title="Removed"
      >
        {seg.text}
      </span>
    );
  });
}


// Anchor rect from the highlight's bounding coords. When the highlight
// spans multiple lines (long sentence wrapped onto a second line), we
// anchor to the END line so the popover appears underneath the visual
// end of the highlight rather than crossing the wrap.
function computeAnchorRect(view: EditorView, item: LocatedIssue): DOMRect | null {
  const fromCoords = view.coordsAtPos(item.from);
  const toCoords   = view.coordsAtPos(item.to);
  if (!fromCoords || !toCoords) return null;
  const sameLine = Math.abs(fromCoords.top - toCoords.top) < 2;
  if (sameLine) {
    // Synthesize a DOMRect-like object covering the span.
    return new DOMRect(
      fromCoords.left,
      fromCoords.top,
      toCoords.right - fromCoords.left,
      fromCoords.bottom - fromCoords.top,
    );
  }
  // Multi-line: use the END line only. The popover ends up under the tail
  // of the highlight rather than crossing the line break, which is the
  // less-confusing of the two options for the writer.
  return new DOMRect(
    toCoords.left,
    toCoords.top,
    Math.max(40, toCoords.right - toCoords.left),
    toCoords.bottom - toCoords.top,
  );
}


export interface IssuePopoverProps {
  view:           EditorView;          // The editor that issued the click
  issueIds:       string[];            // From the click event
  contextChips:   ContextChip[];       // Same chips currently attached to chat
  modelId:        string | null;
  contentMode:    string;
  projectPath:    string | null;
  // Fired once per Accept or Ignore so the parent can decrement its
  // tracking count. The popover doesn't know what the parent is counting,
  // it just promises to call this exactly once per resolved issue.
  onIssueResolved?: () => void;
  onClose:        () => void;          // Dismiss the popover
}


// Per-issue local state. We snapshot the AI's first suggestion as
// `originalSuggestion` so Default can revert to it after the writer has
// clicked Rewrite/Shorten/etc. The `current` suggestion is what's shown
// and what Accept will paste.
interface IssueViewState {
  located:            LocatedIssue;
  originalSuggestion: string;
  current:            string;
}


export function IssuePopover({
  view, issueIds,
  contextChips, modelId, contentMode, projectPath,
  onIssueResolved,
  onClose,
}: IssuePopoverProps) {

  // Initialize per-issue state from the view's StateField. The original
  // suggestion is captured ONCE at popover-open time so subsequent revises
  // don't move the revert target.
  const [items, setItems] = useState<IssueViewState[]>(() => {
    const byId = getIssuesById(view);
    return issueIds
      .map(id => byId[id])
      .filter((li): li is LocatedIssue => Boolean(li))
      .map(located => {
        const first = located.issue.suggestions[0] ?? "";
        return { located, originalSuggestion: first, current: first };
      });
  });

  // Per-issue loading state for the modifier buttons. Keyed by issue id;
  // value is the modifier currently being requested. null when idle.
  const [busy, setBusy] = useState<Record<string, ReviseModifier | null>>({});

  // Per-issue error from a failed revise call. Cleared on the next attempt.
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // Popover position. Recomputed on mount and whenever the underlying view
  // scrolls or the window resizes. Initialized to off-screen so we don't
  // flash at (0, 0) before the first measurement.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Track whether we've already auto-scrolled the editor to fit the popover.
  // Without this guard, repeated layout passes keep firing scrollIntoView,
  // which turns into an infinite shimmy.
  const didScrollRef = useRef(false);

  // Dismiss on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // If the underlying issue set drops to zero (writer accepted/ignored all
  // visible issues), close. Defensive -- normal usage closes before this.
  useEffect(() => {
    if (items.length === 0) onClose();
  }, [items, onClose]);


  // Position the popover under the first issue's highlight, centered
  // horizontally on the span. If the popover would overflow the viewport
  // bottom, scroll the editor so the highlight is roughly centered, then
  // re-measure.
  //
  // useLayoutEffect (not useEffect) so the position is computed before the
  // browser paints the popover -- avoids a single-frame flash at (0, 0).
  useLayoutEffect(() => {
    if (items.length === 0) return;
    const anchor = computeAnchorRect(view, items[0].located);
    if (!anchor) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const centerX = anchor.left + anchor.width / 2;
    let left = centerX - POPOVER_WIDTH / 2;
    // Clamp to viewport edges. Margin keeps the popover off the screen
    // edge by a few px so it doesn't visually butt against window chrome.
    left = Math.max(SCREEN_MARGIN, Math.min(left, vw - POPOVER_WIDTH - SCREEN_MARGIN));

    let top = anchor.bottom + ANCHOR_GAP;

    // If the popover would extend below the viewport, ask CodeMirror to
    // scroll the highlight into the upper portion of the editor so the
    // popover fits underneath. We only do this once -- the recomputation
    // after scroll picks the now-valid position naturally.
    if (top + POPOVER_MAX_HEIGHT > vh - SCREEN_MARGIN && !didScrollRef.current) {
      didScrollRef.current = true;
      view.dispatch({
        effects: EditorView.scrollIntoView(items[0].located.from, {
          y: "start",
          // yMargin keeps a buffer above the highlight so the popover
          // header isn't jammed against the editor's top edge.
          yMargin: 80,
        }),
      });
      // Defer the position update one frame so the scroll has applied.
      requestAnimationFrame(() => {
        const after = computeAnchorRect(view, items[0].located);
        if (!after) return;
        const newTop = after.bottom + ANCHOR_GAP;
        const newLeft = Math.max(
          SCREEN_MARGIN,
          Math.min(after.left + after.width / 2 - POPOVER_WIDTH / 2,
                   window.innerWidth - POPOVER_WIDTH - SCREEN_MARGIN),
        );
        setPos({ top: newTop, left: newLeft });
      });
      return;
    }

    // If we still overflow even after the scroll attempt (very tall
    // popover or very short viewport), flip above the highlight as the
    // last-resort fallback.
    if (top + POPOVER_MAX_HEIGHT > vh - SCREEN_MARGIN) {
      const flipped = anchor.top - POPOVER_MAX_HEIGHT - ANCHOR_GAP;
      if (flipped >= SCREEN_MARGIN) top = flipped;
    }

    setPos({ top, left });
  }, [view, items]);


  // Apply a suggestion: dispatch a CM6 transaction replacing the issue's
  // range with the chosen suggestion text, then drop the issue from the
  // overlay. Other issues' positions auto-map through the changeset.
  function acceptIssue(state: IssueViewState) {
    const suggestion = state.current;
    if (!suggestion) return;
    view.dispatch({
      changes: { from: state.located.from, to: state.located.to, insert: suggestion },
      effects: removeIssueEffect.of(state.located.issue.id),
    });
    setItems(prev => prev.filter(x => x.located.issue.id !== state.located.issue.id));
    onIssueResolved?.();
  }


  // Drop just this issue. The ranges of other issues stay intact.
  function ignoreIssue(state: IssueViewState) {
    view.dispatch({
      effects: removeIssueEffect.of(state.located.issue.id),
    });
    setItems(prev => prev.filter(x => x.located.issue.id !== state.located.issue.id));
    onIssueResolved?.();
  }


  // Default modifier: pure client-side revert to the AI's original
  // suggestion. No backend call. Useful when the writer clicked Rewrite
  // (or any other modifier) and didn't like the result.
  function revertToDefault(state: IssueViewState) {
    setItems(prev => prev.map(x =>
      x.located.issue.id === state.located.issue.id
        ? { ...x, current: x.originalSuggestion }
        : x
    ));
  }


  // Ask the backend for a new suggestion shaped by the chosen modifier.
  // Replaces only the current visible suggestion; the originalSuggestion
  // snapshot stays unchanged so Default can still revert.
  async function reviseIssue(state: IssueViewState, modifier: ReviseModifier) {
    if (modifier === "default") {
      revertToDefault(state);
      return;
    }
    const id = state.located.issue.id;
    setBusy(prev => ({ ...prev, [id]: modifier }));
    setErrors(prev => ({ ...prev, [id]: null }));

    const payload: ReviseSuggestionRequest = {
      quote:              state.located.issue.quote,
      current_suggestion: state.current || state.located.issue.quote,
      modifier,
      context_chips:      contextChips,
      model_id:           modelId ?? undefined,
      content_mode:       contentMode,
      project_path:       projectPath ?? null,
    };

    try {
      const res = await fetch(`${API_BASE}/api/ai/revise-suggestion`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail ?? `Server returned ${res.status}.`);
      }
      const data: ReviseSuggestionResponse = await res.json();
      if (!data.suggestion) {
        throw new Error("The model returned an empty suggestion.");
      }
      setItems(prev => prev.map(x =>
        x.located.issue.id === id
          ? { ...x, current: data.suggestion }
          : x
      ));
    } catch (err) {
      setErrors(prev => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Revise failed.",
      }));
    } finally {
      setBusy(prev => ({ ...prev, [id]: null }));
    }
  }


  // Render via portal so the popover sits at the top of the DOM and isn't
  // clipped by the editor's overflow rules.
  return createPortal(
    <div
      // Backdrop captures clicks-outside to dismiss. Transparent so the
      // editor stays visible behind it.
      className="fixed inset-0 z-50"
      onClick={onClose}
    >
      <div
        className="absolute rounded-lg border border-indigo-700/60 bg-bg-panel shadow-xl text-sm text-text-primary"
        style={{
          // Hidden until the first layout pass has measured the anchor.
          // Avoids a one-frame flash at (0, 0) on mount.
          left:       pos ? `${pos.left}px` : "-9999px",
          top:        pos ? `${pos.top}px`  : "-9999px",
          width:      `${POPOVER_WIDTH}px`,
          maxHeight:  `${POPOVER_MAX_HEIGHT}px`,
          overflowY:  "auto",
          opacity:    pos ? 1 : 0,
          transition: "opacity 80ms ease",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-indigo-300">
            {items.length === 1 ? "1 issue here" : `${items.length} issues here`}
          </p>
          <button onClick={onClose} className="text-faint hover:text-text-muted">✕</button>
        </div>

        <div className="space-y-3 p-3">
          {items.map(state => (
            <IssueCard
              key={state.located.issue.id}
              state={state}
              isBusy={busy[state.located.issue.id] != null}
              busyModifier={busy[state.located.issue.id] ?? null}
              error={errors[state.located.issue.id] ?? null}
              onAccept={() => acceptIssue(state)}
              onIgnore={() => ignoreIssue(state)}
              onRevise={(modifier) => reviseIssue(state, modifier)}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}


// One issue's card. Pulled out so the parent's render method stays lean
// and so the diff memoization is keyed naturally to a single issue.
interface IssueCardProps {
  state:        IssueViewState;
  isBusy:       boolean;
  busyModifier: ReviseModifier | null;
  error:        string | null;
  onAccept:     () => void;
  onIgnore:     () => void;
  onRevise:     (modifier: ReviseModifier) => void;
}

function IssueCard({
  state, isBusy, busyModifier, error,
  onAccept, onIgnore, onRevise,
}: IssueCardProps) {
  const issue = state.located.issue;
  const sev   = issue.severity;
  const cat   = issue.category;
  const label = CATEGORY_LABELS[cat] ?? cat;

  // Word-level diff between the original quote and the current suggestion.
  // Memoized so we don't re-tokenize and re-LCS on every render -- the
  // diff is stable until the suggestion changes.
  const diff = useMemo(
    () => state.current ? wordDiff(issue.quote, state.current) : [],
    [issue.quote, state.current],
  );

  // Whether the current suggestion equals the AI's original. Used to
  // disable the Default button when there's nothing to revert to.
  const atDefault = state.current === state.originalSuggestion;

  return (
    <div className="rounded border border-border p-2">

      {/* Header row: severity badge + category label. */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${severityClass(sev)}`}>
          {sev}
        </span>
        <span className="text-xs font-semibold text-indigo-200">{label}</span>
      </div>

      {/* Explanation. Short paragraph, no markdown rendering -- the AI is
          instructed to keep it to 1-3 sentences. */}
      <p className="mb-2 text-xs text-text-primary">{issue.explanation}</p>

      {/* Suggested rewrite, rendered with the diff highlighted inline.
          Skip when the entry is praise (no suggestion to show). */}
      {state.current && (
        <blockquote className="mb-2 whitespace-pre-wrap break-words border-l-2 border-indigo-600/50 pl-2 text-xs italic text-text-primary">
          {renderDiff(diff)}
        </blockquote>
      )}

      {/* Modifier buttons -- the creative transformations + Default revert.
          Hidden for praise entries (no suggestion to revise). */}
      {state.current && (
        <>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">
            Try a different angle
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {MODIFIERS.map(m => {
              const disabled =
                isBusy ||
                // Default has nothing to do when we're already at the
                // original suggestion.
                (m.key === "default" && atDefault);
              return (
                <button
                  key={m.key}
                  onClick={() => onRevise(m.key)}
                  disabled={disabled}
                  title={m.help}
                  className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-primary transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyModifier === m.key ? "..." : m.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Inline error from a failed revise call. */}
      {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}

      {/* Action row: Accept / Ignore. Praise entries get only Dismiss. */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onIgnore}
          disabled={isBusy}
          className="rounded border border-border px-2 py-0.5 text-xs text-faint hover:text-text-muted disabled:opacity-40"
        >
          {sev === "praise" ? "Dismiss" : "Ignore"}
        </button>
        {state.current && (
          <button
            onClick={onAccept}
            disabled={isBusy}
            className="rounded border border-indigo-600 bg-indigo-700/40 px-2 py-0.5 text-xs text-indigo-100 hover:bg-indigo-700/60 disabled:opacity-40"
          >
            Accept
          </button>
        )}
      </div>
    </div>
  );
}
