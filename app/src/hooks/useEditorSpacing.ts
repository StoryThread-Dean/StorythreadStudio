// hooks/useEditorSpacing.ts -- how far apart the writer's lines sit
// =================================================================
// Line spacing for the Markdown editors, named the way a word processor names
// it: Single, 1.5 lines, Double, Multiple. A writer who has spent years in
// Word already knows what those mean, and "1.5 lines" is a more useful thing
// to offer than a raw number nobody has a feel for.
//
// WHY THERE IS A BASIS NUMBER AT ALL
// ----------------------------------
// Word does not measure Single as "1.0". It reads the font's own metrics --
// ascender + descender + line gap -- which for the faces writers use works
// out around 116% of the font size. Everything else is a multiple of THAT:
// 1.5 lines is 1.5 single line heights, not 1.5 em.
//
// CSS has the same idea in `line-height: normal`, and it would be the honest
// translation, except that `normal` cannot be multiplied. There is no way to
// say "one and a half times whatever normal is". So the app pins one explicit
// basis and derives the rest from it, which keeps the named options in the
// same proportion to each other that they have in Word.
//
// Persistence mirrors useTheme and useUiScale exactly: a module-level store
// with a subscriber set, saved to ~/.storythread/settings.json through the
// backend, so the choice carries across every project.
//
// TWO MEASUREMENTS, NOT ONE, and conflating them cost two rounds of "the line
// spacing doesn't work":
//
//   LINE SPACING  the gap between the wrapped lines INSIDE a paragraph.
//   PARAGRAPH     the gap BETWEEN one paragraph and the next, in points,
//   SPACING       0pt before and 8pt after by default, as a word processor.
//
// A manuscript that ends paragraphs with a single newline -- which is how real
// ones are written -- has no blank line for line spacing to stretch. So no
// amount of it will ever separate two paragraphs, and a writer reasonably
// reads that as the control being broken. It was the missing measurement.
//
// SCOPE. This spaces PROSE -- the manuscript editor, the outline, notes, and
// the summary editors, all of which are MarkdownEditor. It deliberately does
// not touch the chrome (that is Interface size) and it does not touch Reader
// Mode, which has its own spacing controls for a different job: reading a
// finished page rather than editing a draft.

import { useEffect, useState } from "react";


const API_BASE = "http://localhost:8000";

export type LineSpacing = "single" | "one_half" | "double" | "multiple";

/**
 * What "Single" means, as a plain CSS line-height.
 *
 * 1.166 rather than 1.0, because Single is a font-metric measurement and not
 * a bare em. This value is what makes the named steps land on the figures a
 * word processor reports: 1.5 lines becomes 1.75 and Double becomes 2.33.
 *
 * Changing it moves every option at once, which is the intent -- it is the
 * one knob that says how generous this app's idea of "single" is.
 */
export const SINGLE_BASIS = 1.166;

/**
 * Paragraph spacing bounds, in typography points.
 *
 * 72pt is an inch, which is far more than anyone wants and still a real
 * answer; the point of the ceiling is that a typo cannot push the next
 * paragraph off the screen.
 */
export const PARAGRAPH_PT_MIN = 0;
export const PARAGRAPH_PT_MAX = 72;

/** Word's defaults, and therefore ours. */
export const PARAGRAPH_BEFORE_DEFAULT = 0;
export const PARAGRAPH_AFTER_DEFAULT = 8;

/** Keep a typed-in paragraph gap inside the usable range. */
export function clampParagraphPt(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(PARAGRAPH_PT_MAX, Math.max(PARAGRAPH_PT_MIN, value));
}

/** Hard floor and ceiling for a custom multiple. */
export const MULTIPLE_MIN = 0.8;   // below this, descenders collide
export const MULTIPLE_MAX = 5.0;

/** How many single line heights each named option is worth. */
const STEPS: Record<Exclude<LineSpacing, "multiple">, number> = {
  single:   1.0,
  one_half: 1.5,
  double:   2.0,
};

/** The order the dropdown offers them in. */
export const LINE_SPACING_OPTIONS: { id: LineSpacing; label: string }[] = [
  { id: "single",   label: "Single" },
  { id: "one_half", label: "1.5 lines" },
  { id: "double",   label: "Double" },
  { id: "multiple", label: "Multiple" },
];

/** Keep a typed-in multiple inside the usable range. */
export function clampMultiple(value: number): number {
  // NaN is the only value with no sensible clamp -- it is "the writer typed
  // something that is not a number", so fall back to single spacing. Infinity
  // DOES have a sensible clamp and gets one from Math.min below; treating it
  // as garbage would quietly reset a writer who held a key down.
  if (Number.isNaN(value)) return 1.0;
  return Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, value));
}

/**
 * The actual CSS line-height for a choice.
 *
 * This is the number the Settings screen shows in brackets next to each
 * option, so the writer can see what they are picking rather than trusting a
 * label -- and it is the same number handed to CodeMirror, so what the
 * dropdown says and what the editor does cannot drift apart.
 */
export function resolveLineHeight(
  spacing: LineSpacing,
  multiple: number,
): number {
  const steps = spacing === "multiple" ? clampMultiple(multiple) : STEPS[spacing];
  // Two decimals: the display and the applied value are the SAME rounded
  // number, so a writer reading "1.75" is not looking at a rounded version
  // of some longer figure actually in force.
  return Math.round(steps * SINGLE_BASIS * 100) / 100;
}


// ── Module-level state ──────────────────────────────────────────────────────

let currentSpacing:  LineSpacing = "one_half";
let currentMultiple: number      = 1.15;
let currentBefore:   number      = PARAGRAPH_BEFORE_DEFAULT;
let currentAfter:    number      = PARAGRAPH_AFTER_DEFAULT;

interface Value {
  spacing:  LineSpacing;
  multiple: number;
  /** Points above each paragraph. */
  before:   number;
  /** Points below each paragraph. */
  after:    number;
}
const subscribers = new Set<(v: Value) => void>();

function snapshot(): Value {
  return {
    spacing:  currentSpacing,
    multiple: currentMultiple,
    before:   currentBefore,
    after:    currentAfter,
  };
}

function notify(): void {
  const v = snapshot();
  subscribers.forEach(fn => fn(v));
}

/** The live line-height, for anything that needs it outside React. */
export function currentLineHeight(): number {
  return resolveLineHeight(currentSpacing, currentMultiple);
}


/**
 * Read the writer's choice from the backend at boot. Call once, alongside
 * initTheme and initUiScale. On failure the defaults stand -- which are the
 * spacing the editor has always had, so a cold start looks like nothing
 * happened rather than like the setting was lost.
 */
export async function initLineSpacing(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();

    const raw = data.line_spacing;
    const spacing: LineSpacing =
      raw === "single"   ? "single"   :
      raw === "double"   ? "double"   :
      raw === "multiple" ? "multiple" :
                           "one_half";

    const rawMultiple = Number(data.line_spacing_multiple);
    const multiple = Number.isFinite(rawMultiple)
      ? clampMultiple(rawMultiple)
      : currentMultiple;

    const before = Number.isFinite(Number(data.paragraph_space_before))
      ? clampParagraphPt(Number(data.paragraph_space_before)) : currentBefore;
    const after = Number.isFinite(Number(data.paragraph_space_after))
      ? clampParagraphPt(Number(data.paragraph_space_after)) : currentAfter;

    if (spacing !== currentSpacing || multiple !== currentMultiple
        || before !== currentBefore || after !== currentAfter) {
      currentSpacing  = spacing;
      currentMultiple = multiple;
      currentBefore   = before;
      currentAfter    = after;
      notify();
    }
  } catch {
    // Silent: backend offline on a cold start. Defaults already stand.
  }
}


/**
 * Change the spacing. Applies in memory immediately so the editor reflows
 * while the writer is still looking at the dropdown, then persists.
 *
 * `multiple` is sent whenever it is supplied, even when the selected option
 * is not "multiple" -- that is what lets the writer type a number, switch to
 * Double to compare, and switch back to find their number still there.
 */
export async function setLineSpacing(
  spacing: LineSpacing,
  multiple?: number,
): Promise<void> {
  const nextMultiple = multiple === undefined
    ? currentMultiple
    : clampMultiple(multiple);

  if (spacing === currentSpacing && nextMultiple === currentMultiple) return;

  currentSpacing  = spacing;
  currentMultiple = nextMultiple;
  notify();

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        line_spacing:          spacing,
        line_spacing_multiple: nextMultiple,
      }),
    });
  } catch {
    // Non-fatal: the session keeps the new spacing, next boot re-reads.
  }
}


/**
 * Change the paragraph gaps, in points.
 *
 * Separate from setLineSpacing because they are separate decisions: a writer
 * picks "1.5 lines" once and then fiddles with the space after a paragraph,
 * and making one call carry both would mean every paragraph tweak re-sent a
 * line-spacing choice nobody touched.
 */
export async function setParagraphSpacing(
  before: number,
  after: number,
): Promise<void> {
  const b = clampParagraphPt(before);
  const a = clampParagraphPt(after);
  if (b === currentBefore && a === currentAfter) return;

  currentBefore = b;
  currentAfter  = a;
  notify();

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        paragraph_space_before: b,
        paragraph_space_after:  a,
      }),
    });
  } catch {
    // Non-fatal: the session keeps the new spacing, next boot re-reads.
  }
}


/**
 * React hook. Returns the choice, the resolved line-height, and the setter.
 *
 * `lineHeight` is handed back already resolved so no caller has to know about
 * SINGLE_BASIS -- there is one place that arithmetic happens.
 */
export function useEditorSpacing(): {
  spacing:    LineSpacing;
  multiple:   number;
  lineHeight: number;
  /** Points above each paragraph. */
  before:     number;
  /** Points below each paragraph. */
  after:      number;
  set:        (spacing: LineSpacing, multiple?: number) => void;
  setParagraph: (before: number, after: number) => void;
} {
  const [value, setValue] = useState<Value>(snapshot);

  useEffect(() => {
    subscribers.add(setValue);
    // Reconcile in case init resolved between render and effect.
    const now = snapshot();
    if (now.spacing !== value.spacing || now.multiple !== value.multiple
        || now.before !== value.before || now.after !== value.after) {
      setValue(now);
    }
    return () => { subscribers.delete(setValue); };
    // Subscribe once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    spacing:    value.spacing,
    multiple:   value.multiple,
    lineHeight: resolveLineHeight(value.spacing, value.multiple),
    before:     value.before,
    after:      value.after,
    set:         (spacing, multiple) => void setLineSpacing(spacing, multiple),
    setParagraph: (before, after) => void setParagraphSpacing(before, after),
  };
}
