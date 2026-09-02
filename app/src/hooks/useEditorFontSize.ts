// hooks/useEditorFontSize.ts -- how big the writer's own prose is
// ================================================================
// The size of the text in the manuscript, the outline, notes and the two
// summary editors. NOT the menus, labels or dialogs around them -- that is
// Interface size, in useUiScale.ts, and they are deliberately two controls.
//
// WHY THIS EXISTS AT ALL, which is a bug story rather than a feature request.
//
// MarkdownEditor's CodeMirror theme contained a literal:
//
//     "&": { fontSize: "16px" }
//
// An absolute pixel value. useUiScale works by setting font-size on <html>,
// which moves rem-based utilities and nothing else, so the writer's prose sat
// at exactly 16px at every one of the Interface size steps. It had done since
// the day the editor was written.
//
// Nothing failed, because 16px is a perfectly ordinary size to read. It
// surfaced when a writer on a 4K display said the maximum font size was "way
// too small" and asked for the thing that would have made it obvious:
//
//     "the writing area should also have a separate control for the text font
//      size (vs UI font size which is more difficult to freely change without
//      triggering other window/tile/card issues)"
//
// They are right about the second half too, and it is the reason these are two
// controls rather than one. Chrome text shares its box with buttons, tables and
// cards, so growing it has consequences three panels away. Prose in a wrapping
// editor has no layout to break -- it just gets bigger.
//
// Worse than the missing control: three places in the codebase DOCUMENTED one
// that did not exist, all saying the editor font was handled "by the font
// picker in the editor toolbar". That picker chooses a font FAMILY, and does
// not even persist it. A false comment is why nobody went looking.
//
// WHY A SEPARATE STORE FROM useEditorSpacing.
// That module's own headline lesson is TWO MEASUREMENTS, NOT ONE -- conflating
// line spacing with paragraph spacing cost two rounds of "the line spacing
// doesn't work". Size is a third measurement, and folding it into the module
// whose reason for existing is that mistake would be repeating it in the same
// file. Its Value type is already four fields and it keeps two setters apart on
// purpose so one PUT never resends the other's value; a third would be a third
// chance to get that wrong. Nothing needs them atomically -- MarkdownEditor
// reads two hooks instead of one, which costs a line.
//
// The honest cost of splitting: this adds a FOURTH boot fetch of
// /api/settings, beside initTheme, initUiScale and initLineSpacing. That is a
// pre-existing smell rather than a new one; collapsing all four behind one
// memoised read is a separate change and a better-scoped one.
//
// WHY POINTS RATHER THAN PIXELS, which is the load-bearing decision here.
// At CSS's 96dpi, 12pt is EXACTLY 16px -- the literal this control replaces. So
// the default is not a new number the writer has to judge; it is "the editor
// has always been 12pt", which is also standard manuscript size. It also makes
// the Appearance section speak one unit for the writer's own prose: paragraph
// spacing directly below it is already in points, for the same reason.

import { useEffect, useState } from "react";


const API_BASE = "http://localhost:8000";


/**
 * 72 points to the inch, 96 CSS pixels to the inch.
 *
 * This is the SINGLE_BASIS of this module: one constant, used by the Settings
 * screen to print what it is about to apply and by CodeMirror to apply it, so
 * the label and the page cannot disagree.
 */
export const PX_PER_PT = 4 / 3;

/**
 * Bounds, in points.
 *
 * 9pt (12px) is a real floor rather than a shrug: this control exists to fix
 * eye strain, and it should not be able to make it worse than the app has ever
 * been. 24pt (32px) is where a manuscript line starts wrapping every five or
 * six words and the paragraph stops having a shape.
 */
export const EDITOR_PT_MIN = 9;
export const EDITOR_PT_MAX = 24;

/**
 * 12pt, which resolves to exactly 16px.
 *
 * NON-NEGOTIABLE, and for the same reason line spacing defaults to "1.5 lines"
 * (it resolves to 1.75, next to the 1.8 the editor used to hardcode): upgrading
 * must not silently reflow a manuscript. A writer who never opens this setting
 * must see the app they had yesterday.
 */
export const EDITOR_PT_DEFAULT = 12;

/** The sizes offered as buttons, plus the escape hatch. */
export const EDITOR_FONT_OPTIONS: { id: number | "custom"; label: string }[] = [
  { id: 10,       label: "10 pt" },
  { id: 11,       label: "11 pt" },
  { id: 12,       label: "12 pt" },
  { id: 14,       label: "14 pt" },
  { id: 16,       label: "16 pt" },
  { id: 18,       label: "18 pt" },
  { id: "custom", label: "Custom" },
];

/**
 * Keep a typed-in size inside the usable range.
 *
 * NaN falls back to the DEFAULT rather than to 0 or to MIN. It means "the
 * writer typed something that is not a number", and the least surprising answer
 * to that is the size they started with. Infinity is NOT garbage -- it has a
 * perfectly sensible clamp and gets one from Math.min below, which is the bug
 * clampMultiple had in useEditorSpacing and the reason this is spelled out.
 */
export function clampEditorPt(value: number): number {
  if (Number.isNaN(value)) return EDITOR_PT_DEFAULT;
  return Math.min(EDITOR_PT_MAX, Math.max(EDITOR_PT_MIN, value));
}

/**
 * The actual CSS pixel size for a point value.
 *
 * This is the number the Settings screen prints beside each option AND the
 * number handed to CodeMirror. Rounded to 2dp so 11pt reads as 14.67px rather
 * than 14.666666666666666.
 */
export function resolveEditorFontPx(pt: number): number {
  return Math.round(clampEditorPt(pt) * PX_PER_PT * 100) / 100;
}


// -- Module-level state ------------------------------------------------------
// Mirrors useTheme, useUiScale and useEditorSpacing: one shared value plus the
// set of components that asked to hear about changes. No Context, no Provider.

let currentPt: number = EDITOR_PT_DEFAULT;
const subscribers = new Set<(pt: number) => void>();

function notify(): void {
  subscribers.forEach(fn => fn(currentPt));
}


/** The live size in points, for anything that needs it outside React. */
export function currentEditorPt(): number {
  return currentPt;
}

/** The live size in CSS pixels, for anything that needs it outside React. */
export function currentEditorFontPx(): number {
  return resolveEditorFontPx(currentPt);
}


/**
 * Read the writer's choice from the backend at boot. Call once, alongside
 * initTheme, initUiScale and initLineSpacing. On failure the default stands --
 * and the default is the size the editor has always rendered, so a cold start
 * with the backend down looks like nothing happened rather than like the
 * setting was lost.
 */
export async function initEditorFontSize(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();

    const raw = Number(data.editor_font_pt);
    const pt = Number.isFinite(raw) ? clampEditorPt(raw) : currentPt;

    if (pt !== currentPt) {
      currentPt = pt;
      notify();
    }
  } catch {
    // Silent: backend offline on a cold start. The default already stands.
  }
}


/**
 * Change the size. Applies in memory immediately so the manuscript resizes
 * while the writer is still looking at the control, then persists.
 */
export async function setEditorFontSize(pt: number): Promise<void> {
  const next = clampEditorPt(pt);
  if (next === currentPt) return;

  currentPt = next;
  notify();

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ editor_font_pt: next }),
    });
  } catch {
    // Network issues are non-fatal; what the writer sees is already right.
  }
}


/**
 * React hook. Returns the size in BOTH units, already resolved, so no caller
 * has to know about PX_PER_PT: `pt` is what the writer chose and what the
 * control shows, `px` is what CodeMirror is handed.
 */
export function useEditorFontSize(): {
  pt: number;
  px: number;
  set: (pt: number) => void;
} {
  const [pt, setLocal] = useState<number>(currentPt);

  useEffect(() => {
    subscribers.add(setLocal);
    if (currentPt !== pt) setLocal(currentPt);
    return () => {
      subscribers.delete(setLocal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pt,
    px: resolveEditorFontPx(pt),
    set: (next: number) => void setEditorFontSize(next),
  };
}
