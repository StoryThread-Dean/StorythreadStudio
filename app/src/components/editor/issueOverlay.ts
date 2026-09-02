// components/editor/issueOverlay.ts -- Inline AI Issue Highlights
// =================================================================
// CodeMirror 6 extension that renders AI-flagged issues from a Smart Advisor
// pass as clickable highlights inside the manuscript editor. Each issue
// becomes a Decoration.mark() over its quoted passage; clicking the mark
// opens the IssuePopover with [Accept][Revise][Ignore] controls.
//
// Why a StateField (not a ViewPlugin like hrLinePlugin)?
//   hrLinePlugin recomputes its decorations from the document on every
//   change -- the visual marker for `---` lives in the text itself, so
//   it can be rederived. Issue highlights have no equivalent in the text;
//   they live entirely in side state seeded by an AI pass and persist
//   until the writer clicks Done. A StateField gives us:
//     1. Auto-mapping of decoration ranges through transactions. When the
//        writer accepts a suggestion (a 9-word delete, say), every other
//        issue's from/to position gets re-mapped automatically.
//     2. A place to drop decorations whose range collapsed to zero-length
//        (silent stale-issue removal -- per the design decision).
//     3. Effects we can dispatch (addIssues, clearIssues, removeIssue)
//        from React without rebuilding the whole editor.
//
// The decoration's `spec.attributes` carries `data-issue-id`, which a custom
// click handler reads to identify which issue the writer clicked. The handler
// emits a CustomEvent on the editor's DOM root; the React layer listens for
// it and opens the popover.

import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { StateField, StateEffect, RangeSet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorIssue, IssueCategory } from "../../types/ai";


// ── Effects ──────────────────────────────────────────────────────────────────
// Effects are how React talks to the StateField. Dispatching one of these
// triggers the field's update() to add, remove, or clear decorations.

// Seeds the field with a fresh batch of issues from a pass. The payload
// contains pre-located ranges -- we resolve quotes to (from, to) on the
// React side before dispatching, since that's where we have the chapter text.
export const addIssuesEffect = StateEffect.define<LocatedIssue[]>();

// Removes a single issue (Ignore button, or Accept after the suggestion has
// been applied). Other issues keep their auto-mapped positions.
export const removeIssueEffect = StateEffect.define<string>();

// Clears every issue (Done button, or category switch). The decoration set
// goes empty in one tick.
export const clearIssuesEffect = StateEffect.define<void>();


// A LocatedIssue is the same data as EditorIssue but with the editor offsets
// resolved. The frontend computes these by string-searching the chapter text
// for each issue's `quote`. Issues whose quote can't be found are dropped
// before dispatch; they never reach the StateField.
export interface LocatedIssue {
  issue:    EditorIssue;
  from:     number;
  to:       number;
  // The top-level pass category drives the highlight color.
  passCategory: IssueCategory;
}


// ── Theme ────────────────────────────────────────────────────────────────────
// CSS classes attached to issue marks. Tailwind doesn't reach inside
// CodeMirror's contenteditable, so we use plain CSS via EditorView.theme().
// Three category palettes -- amber for Readability, violet for Structure,
// teal for Context -- with a subtle underline + tinted background.
//
// Why background tint instead of a heavier color block? Heavy fills disrupt
// the writer's reading flow. A 10%-alpha tint signals "look here" without
// dominating the line. The underline carries the actual category cue.

export const issueOverlayTheme = EditorView.theme({
  // Shared base for every issue mark. Cursor changes to pointer so it's
  // obvious the highlight is interactive.
  ".cm-issue-mark": {
    cursor: "pointer",
    borderBottom: "2px solid",
    transition: "background-color 120ms ease",
  },
  ".cm-issue-mark:hover": {
    // Slightly stronger hover state. We don't change the underline color so
    // the category cue remains stable; only the background hint deepens.
    filter: "brightness(1.15)",
  },
  // Severity-specific styling. Praise gets a softer treatment so the writer
  // notices what's working without it competing visually with issues.
  ".cm-issue-praise": {
    fontStyle: "italic",
  },
  // Per-category colors. RGB values chosen to read well on both dark and
  // light themes; we lean on alpha rather than hue swaps so the same class
  // works in both modes.
  ".cm-issue-readability": {
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderBottomColor: "rgba(245, 158, 11, 0.85)",
  },
  ".cm-issue-structure": {
    backgroundColor: "rgba(139, 92, 246, 0.16)",
    borderBottomColor: "rgba(139, 92, 246, 0.85)",
  },
  ".cm-issue-context": {
    backgroundColor: "rgba(20, 184, 166, 0.18)",
    borderBottomColor: "rgba(20, 184, 166, 0.85)",
  },
  // Numeric stack badge for overlapping issues. Inline-block so it sits in
  // the text flow next to the highlighted span without breaking line wrap.
  ".cm-issue-stack-badge": {
    display: "inline-block",
    minWidth: "16px",
    padding: "0 4px",
    marginRight: "2px",
    borderRadius: "8px",
    fontSize: "0.625rem",
    fontWeight: "600",
    lineHeight: "14px",
    textAlign: "center",
    backgroundColor: "rgba(99, 102, 241, 0.85)",
    color: "white",
    verticalAlign: "middle",
    cursor: "pointer",
  },
});


// ── Stack badge widget ───────────────────────────────────────────────────────
// When two or more issues overlap on the same starting offset, a small
// numeric badge ("2", "3", ...) renders inline at the start of the span.
// Click target is the underlying issue mark; the badge is purely visual.

class StackBadgeWidget extends WidgetType {
  constructor(readonly count: number) {
    super();
  }
  // CodeMirror calls this only when the widget is added to the DOM; we
  // don't have to manage React lifecycle here.
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-issue-stack-badge";
    span.textContent = String(this.count);
    span.title = `${this.count} issues here -- click to view`;
    return span;
  }
  // CodeMirror reuses widgets across renders when the spec is equal. Two
  // badges with the same count are interchangeable.
  eq(other: StackBadgeWidget): boolean {
    return this.count === other.count;
  }
}


// ── State field ──────────────────────────────────────────────────────────────
// The single source of truth for what's currently decorated. The decoration
// set is also CodeMirror's source of truth for what it renders, so this
// field IS the visible state.

interface IssueFieldValue {
  // The issues themselves, keyed by id, so we can look up category/severity
  // when rendering and so removeIssueEffect can find one to drop.
  issuesById: Record<string, LocatedIssue>;
  // The decoration set CodeMirror renders. Maintained in sync with issuesById
  // -- after every transaction we rebuild this from the surviving issues.
  decorations: DecorationSet;
}


function buildDecorations(issuesById: Record<string, LocatedIssue>): DecorationSet {
  // Group by start position so we can detect overlapping starts and emit
  // one stack badge per stack. We do not try to detect partially overlapping
  // ranges (different starts, overlapping middles) -- the badge only fires
  // on identical starts, which is the common case from AI passes that
  // flag the same passage twice.
  const issues = Object.values(issuesById);
  const stacksByStart: Record<number, LocatedIssue[]> = {};
  for (const li of issues) {
    if (li.from >= li.to) continue;  // Defensive: zero-length ranges shouldn't render.
    if (!stacksByStart[li.from]) stacksByStart[li.from] = [];
    stacksByStart[li.from].push(li);
  }

  // RangeSet.of needs a sorted-by-from list; we'll build a flat array and
  // hand it to RangeSet.of with sort=true.
  const ranges: { from: number; to: number; value: Decoration }[] = [];

  for (const li of issues) {
    if (li.from >= li.to) continue;
    const cls = [
      "cm-issue-mark",
      `cm-issue-${li.passCategory}`,
      `cm-issue-${li.issue.severity}`,
    ].join(" ");
    ranges.push({
      from: li.from,
      to:   li.to,
      // Decoration.mark wraps the range in an inline span we can style and
      // click. data-issue-id is the hook our DOM click handler reads.
      value: Decoration.mark({
        class: cls,
        attributes: { "data-issue-id": li.issue.id },
        // inclusiveStart/End:false means user typing right at the boundary
        // doesn't accidentally extend the highlight. The auto-mapping
        // through transactions still keeps the original range alive.
        inclusiveStart: false,
        inclusiveEnd:   false,
      }),
    });
  }

  // Add stack badges for overlapping starts. Widget decorations need a
  // zero-length range; CodeMirror renders them inline at that position.
  for (const start of Object.keys(stacksByStart)) {
    const startNum = Number(start);
    const stack = stacksByStart[startNum];
    if (stack.length > 1) {
      ranges.push({
        from: startNum,
        to:   startNum,
        value: Decoration.widget({
          widget: new StackBadgeWidget(stack.length),
          // Place the badge BEFORE the underlying mark so it reads
          // naturally as a prefix to the highlighted text.
          side: -1,
        }),
      });
    }
  }

  return RangeSet.of(
    ranges.map(r => r.value.range(r.from, r.to)),
    /* sort */ true,
  );
}


export const issueField = StateField.define<IssueFieldValue>({
  create(): IssueFieldValue {
    return { issuesById: {}, decorations: Decoration.none };
  },

  update(value, tr): IssueFieldValue {
    let issuesById = value.issuesById;
    let dirty = false;

    // Step 1: apply effects. Effects can add, remove, or clear -- we
    // accumulate the result in a local copy of issuesById.
    for (const effect of tr.effects) {
      if (effect.is(addIssuesEffect)) {
        const additions = effect.value;
        // Shallow-copy the existing map and merge the new issues in. New
        // issues with the same id replace older ones (rare; only matters
        // if a pass returns a duplicate uuid).
        issuesById = { ...issuesById };
        for (const li of additions) {
          issuesById[li.issue.id] = li;
        }
        dirty = true;
      } else if (effect.is(removeIssueEffect)) {
        if (issuesById[effect.value]) {
          issuesById = { ...issuesById };
          delete issuesById[effect.value];
          dirty = true;
        }
      } else if (effect.is(clearIssuesEffect)) {
        if (Object.keys(issuesById).length > 0) {
          issuesById = {};
          dirty = true;
        }
      }
    }

    // Step 2: if the document changed, map every range through the changeset
    // so positions stay aligned with the text. CodeMirror exposes
    // tr.changes.mapPos() which returns the new position after the change.
    // Issues whose range collapses to zero-length after mapping get dropped
    // (that's the silent stale-issue auto-removal we promised).
    if (tr.docChanged) {
      const mapped: Record<string, LocatedIssue> = {};
      for (const id of Object.keys(issuesById)) {
        const li = issuesById[id];
        // mapPos with assoc=1 (default for ends) and -1 for starts so insertions
        // at the boundary don't accidentally swallow the highlight.
        const newFrom = tr.changes.mapPos(li.from, -1);
        const newTo   = tr.changes.mapPos(li.to,    1);
        if (newTo > newFrom) {
          mapped[id] = { ...li, from: newFrom, to: newTo };
        }
        // else: the range was consumed by a replace -- silent drop.
      }
      issuesById = mapped;
      dirty = true;
    }

    if (!dirty) return value;

    return {
      issuesById,
      decorations: buildDecorations(issuesById),
    };
  },

  // Tells CodeMirror "ask this field for its decorations" so they render.
  provide: f => EditorView.decorations.from(f, v => v.decorations),
});


// ── Click handler ────────────────────────────────────────────────────────────
// CodeMirror routes mouse events to the editor's DOM. We attach a handler
// that walks up from the click target looking for a data-issue-id attribute.
// When we find one, we dispatch a CustomEvent on the editor root so the
// React layer can read it and open the popover.
//
// Why a CustomEvent rather than a callback prop? CodeMirror extensions are
// constructed once and need to be stable across re-renders; passing a
// closure into the extension factory creates a new identity each render,
// which CodeMirror treats as "rebuild me". Decoupling via DOM event keeps
// the extension immutable and lets the React side own the popover state.

export const ISSUE_CLICK_EVENT = "storythread:issue-click";

// Detail payload for the CustomEvent. The React layer hands this to
// IssuePopover which looks up the issue ranges in the view's StateField
// and positions itself centered below the highlight. We deliberately
// don't pass click coordinates here -- the popover anchors to the
// highlight's bounding rect, not the click point, so the position is
// stable regardless of where in the span the writer clicks.
export interface IssueClickDetail {
  issueIds: string[];
}


export const issueClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target) return false;

    // Walk up from the click target looking for an issue mark. Stop at the
    // editor root so we don't escape into the rest of the page.
    let el: HTMLElement | null = target;
    let issueId: string | null = null;
    while (el && el !== view.dom) {
      const id = el.getAttribute?.("data-issue-id");
      if (id) {
        issueId = id;
        break;
      }
      el = el.parentElement;
    }

    if (!issueId) return false;

    // The user might have clicked an overlapping stack. Look up the field
    // value to find every issue covering this position and emit them all.
    const fieldValue = view.state.field(issueField, /* require */ false);
    if (!fieldValue) return false;

    // Use the click position to find the document offset so we can match
    // against issue ranges. posAtCoords gives us a doc position from a
    // screen point.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    let issueIds: string[];
    if (pos != null) {
      // Collect every issue whose range covers `pos`. Multiple overlapping
      // marks all hand us their data-issue-id, but we only have ONE on the
      // clicked DOM node. So we walk the field instead.
      issueIds = Object.values(fieldValue.issuesById)
        .filter(li => li.from <= pos && pos < li.to)
        .map(li => li.issue.id);
      // If no overlap was found by position (rare, e.g. clicking the badge),
      // fall back to the single id from the DOM walk.
      if (issueIds.length === 0) issueIds = [issueId];
    } else {
      issueIds = [issueId];
    }

    const detail: IssueClickDetail = { issueIds };
    view.dom.dispatchEvent(new CustomEvent(ISSUE_CLICK_EVENT, { detail, bubbles: true }));

    // Returning true tells CodeMirror we handled the event. We DO want it
    // to also place the cursor (returning true cancels that), so we return
    // false -- the popover and the cursor placement coexist nicely.
    return false;
  },
});


// ── Quote locator ────────────────────────────────────────────────────────────
// Resolves an issue's verbatim `quote` to a (from, to) range in the editor
// document. Lives in the extension module rather than App.tsx because the
// matching strategy is tightly coupled to the overlay's needs (handling
// whitespace tolerance, picking the first match, etc.).

// Tolerant string match. The AI is asked to copy quotes verbatim, but in
// practice it sometimes normalizes whitespace (multiple spaces -> one,
// non-breaking space -> regular). We do an exact-match-first pass; if that
// fails, we collapse whitespace in both sides and retry. The returned range
// is in the ORIGINAL document offsets, so highlights line up with what the
// writer actually sees.
export function locateQuoteInDoc(doc: string, quote: string): { from: number; to: number } | null {
  if (!quote) return null;
  const trimmed = quote.trim();
  if (!trimmed) return null;

  // Strategy 1: exact substring match. Cheap, common case.
  const exact = doc.indexOf(trimmed);
  if (exact >= 0) {
    return { from: exact, to: exact + trimmed.length };
  }

  // Strategy 2: collapse whitespace runs in BOTH sides and search the
  // collapsed haystack. We then map the match back to the original offsets
  // by re-scanning. This handles AI quotes that lost a non-breaking space
  // or doubled space the writer originally typed.
  const collapsedNeedle = trimmed.replace(/\s+/g, " ");
  // Build a parallel array mapping collapsed index -> original index. As we
  // walk the document, every run of whitespace contributes ONE space at the
  // current collapsed position; the first whitespace char's original offset
  // is recorded.
  const collapsedChars: string[] = [];
  const originalIndexOf: number[] = [];
  let i = 0;
  while (i < doc.length) {
    const ch = doc[i];
    if (/\s/.test(ch)) {
      collapsedChars.push(" ");
      originalIndexOf.push(i);
      // Skip the rest of the whitespace run.
      while (i < doc.length && /\s/.test(doc[i])) i++;
    } else {
      collapsedChars.push(ch);
      originalIndexOf.push(i);
      i++;
    }
  }
  const collapsed = collapsedChars.join("");
  const matchIdx = collapsed.indexOf(collapsedNeedle);
  if (matchIdx < 0) return null;

  const fromOrig = originalIndexOf[matchIdx];
  // The end is the original index of the LAST collapsed character of the
  // match plus one (or, if the match consumes whitespace at its tail, the
  // point right after that whitespace run).
  const lastCollapsed = matchIdx + collapsedNeedle.length - 1;
  // Find the end position in the original doc. We need to walk forward from
  // the last matched original index by however many original chars the
  // last collapsed slot represented.
  let endOrig = originalIndexOf[lastCollapsed];
  // Advance past the run of equivalent chars in the original (mostly the
  // single non-whitespace character; or, if the last collapsed char was a
  // space, the entire whitespace run).
  if (/\s/.test(doc[endOrig])) {
    while (endOrig < doc.length && /\s/.test(doc[endOrig])) endOrig++;
  } else {
    endOrig += 1;
  }
  return { from: fromOrig, to: endOrig };
}


// Combined extension consumers can drop into their CodeMirror extension list.
// Bundles the field, the click handler, and the theme so callers don't have
// to remember to add three things.
export function issueOverlayExtension(): Extension {
  return [issueField, issueClickHandler, issueOverlayTheme];
}


// ── React-side helper ────────────────────────────────────────────────────────
// Read the current issue map from a view. Used by the popover to look up
// every issue id it received from a click event.

export function getIssuesById(view: EditorView): Record<string, LocatedIssue> {
  const v = view.state.field(issueField, false);
  return v ? v.issuesById : {};
}


// Suppress unused warning: ViewUpdate is exported by @codemirror/view but
// we only reference it in this comment. Keep the type-import explicit for
// future maintenance even if the runtime code doesn't use it.
export type _UnusedViewUpdate = ViewUpdate;
