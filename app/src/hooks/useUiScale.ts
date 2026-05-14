// hooks/useUiScale.ts -- App UI Font Scale (Chrome only)
// =========================================================
// Single source of truth for how big the app's chrome text is rendered:
// menus, sidebars, chat box, Settings, About, profile labels, etc.
//
// HOW IT WORKS
// The scale is applied by setting `font-size` on the root <html> element.
// Tailwind's text-xs / text-sm / text-base utilities use `rem` units, so
// every chrome label scales proportionally with the root. The CodeMirror
// manuscript editor uses absolute `16px` (see MarkdownEditor.tsx's
// `editorTheme`) and therefore IS NOT affected by this setting -- writers
// control editor font via the existing font picker in the editor toolbar.
//
// Persistence: lives in the global ~/.storythread/settings.json file
// (key: "ui_scale"), so the choice carries across projects.
//
// Why a module-level store (not React Context):
//   Mirrors useTheme. ONE shared state, no Provider wrapping required, and
//   it can be applied to the DOM before React renders (avoids a "flash of
//   default size" on boot when the user has picked a larger size).
//
// Why not a slider:
//   The writer asked for "subtle" steps. Discrete sizes prevent the
//   in-between values that visibly break layout (lines wrapping mid-button,
//   tables overflowing). Four steps cover the useful range.

import { useEffect, useState } from "react";


const API_BASE = "http://localhost:8000";


export type UiScale = "default" | "larger" | "larger_plus" | "largest";


// Pixel values applied at each scale. Two parallel maps:
//   UI_SCALE_PX -- root <html> font-size; drives chrome (menus, labels,
//   buttons, Settings, About). Subtle +1px increments keep button layouts
//   from breaking and let writers nudge legibility without distortion.
//
//   TEXT_ENTRY_PX -- writes the --text-entry-size CSS variable. Applied
//   to writer-facing text entry surfaces (chat boxes, profile description
//   textareas, scene summary editing) via the .text-entry class. Larger
//   jumps because these are the surfaces the writer types into; +1px
//   increments here were imperceptible in practice. Tops out at 22px,
//   the practical ceiling before textarea wrapping starts to cramp.
export const UI_SCALE_PX: Record<UiScale, number> = {
  default:      16,
  larger:       17,
  larger_plus:  18,
  largest:      19,
};

export const TEXT_ENTRY_PX: Record<UiScale, number> = {
  default:      16,
  larger:       17,
  larger_plus:  19,
  largest:      22,
};


// ── Module-level state ──────────────────────────────────────────────────────
// `currentScale` is the live value. `subscribers` is the list of components
// that asked to be notified when the scale changes (each useUiScale() adds one).

let currentScale: UiScale = "default";
const subscribers = new Set<(s: UiScale) => void>();


/**
 * Apply the scale to the DOM by setting an inline font-size on <html>
 * (drives chrome via Tailwind rem-based utilities) AND a CSS custom
 * property --text-entry-size (drives text-entry surfaces via the
 * .text-entry class declared in App.css). Inline styles beat stylesheet
 * declarations, so this overrides any default the browser would apply.
 */
function applyToDom(scale: UiScale): void {
  document.documentElement.style.fontSize = `${UI_SCALE_PX[scale]}px`;
  document.documentElement.style.setProperty(
    "--text-entry-size",
    `${TEXT_ENTRY_PX[scale]}px`,
  );
}


/**
 * Initialize the scale from the backend settings file. Call this ONCE at
 * app boot (alongside initTheme). On failure (backend down on cold start)
 * we keep "default"; the next successful settings load reconciles.
 */
export async function initUiScale(): Promise<void> {
  // Apply the default immediately so we always have a defined font-size
  // on <html>, even if the settings fetch hasn't returned yet.
  applyToDom(currentScale);
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();
    const raw = data.ui_scale;
    const s: UiScale =
      raw === "larger"        ? "larger"       :
      raw === "larger_plus"   ? "larger_plus"  :
      raw === "largest"       ? "largest"      :
                                "default";
    if (s !== currentScale) {
      currentScale = s;
      applyToDom(s);
      subscribers.forEach((fn) => fn(s));
    }
  } catch {
    // Silent fail: backend offline. Default scale already applied.
  }
}


/**
 * Change the scale. Updates the DOM immediately so the writer sees the
 * size change without waiting for the network, then persists to settings.
 */
export async function setUiScale(scale: UiScale): Promise<void> {
  if (scale === currentScale) return;
  currentScale = scale;
  applyToDom(scale);
  subscribers.forEach((fn) => fn(scale));

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ui_scale: scale }),
    });
  } catch {
    // Network issues are non-fatal; in-memory + DOM state is what the user sees.
  }
}


/**
 * React hook: returns [scale, setScale]. Components re-render automatically
 * whenever the scale changes anywhere in the app.
 */
export function useUiScale(): [UiScale, (s: UiScale) => void] {
  const [scale, setLocal] = useState<UiScale>(currentScale);

  useEffect(() => {
    subscribers.add(setLocal);
    if (currentScale !== scale) setLocal(currentScale);
    return () => {
      subscribers.delete(setLocal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [scale, (s) => void setUiScale(s)];
}
