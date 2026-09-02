// features/theme/useAudiobookTheme.ts -- the Converter's own theme
// ==================================================================
// The Audiobook Converter has its own Dark / Light / Custom, independent of
// the writing app's. Added 2026-09-02 on the writer's ruling; spec 5.0 is
// amended in the same change.
//
// WHY INDEPENDENT RATHER THAN FOLLOWING THE APP'S THEME.
// Spec 5.0 argued charcoal in both app themes was the point -- the writer
// should always know which side of the app they are standing in -- and that
// is still a good DEFAULT. What changed is that it became the writer's call.
// Keying it to `[data-theme="light"]` would have made the app's own theme
// switch silently restyle a feature the writer was not looking at, and would
// have forbidden a dark writing app beside a paper Converter, which is a
// perfectly reasonable thing to want.
//
// HOW IT REACHES THE SCREEN, and this differs from the writing app's custom
// theme for a reason worth knowing. The app's palette is applied as inline
// custom properties on <html>. That CANNOT work here: `.audiobook-theme`
// declares its own `--st-*` on a descendant element, and an element's own
// declaration beats an inherited one -- which is exactly what keeps the
// Converter charcoal while the writing app goes light. So the Converter's
// palette is applied as an inline style on the audiobook ROOT element itself,
// through React, by whichever component renders that root.
//
// That also means no DOM poking: the store holds the values, the root renders
// them, and preview is just a state change.

import { useEffect, useState } from "react";
import { sanitizeCustomTheme, type CustomTheme } from "./themeTokens";
import { parseColor, isLightPalette } from "./color";


const API_BASE = "http://localhost:8000";

export type AudiobookTheme = "dark" | "light" | "custom";


// -- Module-level state ------------------------------------------------------
// Same shape as useTheme and useUiScale: one shared value, a subscriber set,
// no Provider.

let currentTheme: AudiobookTheme = "dark";
let currentPalette: CustomTheme = {};
/**
 * A palette being edited but not saved.
 *
 * Null means "show what is stored". The colour editor sets this on every
 * keystroke and clears it when it closes, which is how live preview coexists
 * with "Manual save only" -- the screen follows the draft, the file follows
 * Save, and cancelling simply drops this back to null.
 */
let previewPalette: CustomTheme | null = null;

const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach(fn => fn());
}


/** What the Converter should render with right now. */
export function audiobookPalette(): CustomTheme {
  return previewPalette ?? currentPalette;
}

/** The stored palette, ignoring any preview. */
export function storedAudiobookPalette(): CustomTheme {
  return { ...currentPalette };
}

export function currentAudiobookTheme(): AudiobookTheme {
  return currentTheme;
}


/**
 * Turn a palette into a React style object for the audiobook root.
 *
 * `color-scheme` rides along because it is the one thing custom properties
 * cannot deliver: native scrollbars, `<select>` popups and context menus are
 * drawn by the OS outside the page. Derived from the window colour rather than
 * asked, because a writer choosing colours is not thinking about scrollbars.
 */
export function audiobookStyle(
  theme: AudiobookTheme,
  palette: CustomTheme,
): React.CSSProperties | undefined {
  if (theme !== "custom") return undefined;
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(palette)) style[name] = value;
  const bg = parseColor(palette["--st-bg-primary"] ?? "");
  style.colorScheme = bg && isLightPalette(bg) ? "light" : "dark";
  return style as React.CSSProperties;
}


export async function initAudiobookTheme(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();

    currentPalette = sanitizeCustomTheme(data.audiobook_custom_theme);
    const stored = data.audiobook_theme;
    // A stored "custom" with an empty palette would render the Converter from
    // nothing -- which is charcoal, silently, with the Custom button lit.
    currentTheme =
      stored === "light" ? "light" :
      stored === "custom" && Object.keys(currentPalette).length > 0 ? "custom" :
      "dark";
    notify();
  } catch {
    // Silent: backend offline on a cold start. Charcoal already stands.
  }
}


export async function setAudiobookTheme(theme: AudiobookTheme): Promise<void> {
  if (theme === currentTheme && previewPalette === null) return;
  currentTheme = theme;
  previewPalette = null;
  notify();

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ audiobook_theme: theme }),
    });
  } catch {
    // Non-fatal; what the writer sees is already right.
  }
}


/** Paint a palette in the Converter without saving it. */
export function previewAudiobookPalette(palette: CustomTheme): void {
  previewPalette = palette;
  notify();
}

/** Drop any preview and go back to what is stored. */
export function revertAudiobookPreview(): void {
  previewPalette = null;
  notify();
}


export async function setAudiobookPalette(palette: CustomTheme): Promise<void> {
  currentPalette = sanitizeCustomTheme(palette);
  currentTheme = "custom";
  previewPalette = null;
  notify();

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        audiobook_theme: "custom",
        audiobook_custom_theme: currentPalette,
      }),
    });
  } catch {
    // Non-fatal, as above.
  }
}


/**
 * React hook. Returns what the Converter root needs to render itself, plus the
 * setter for the theme control.
 */
export function useAudiobookTheme(): {
  theme: AudiobookTheme;
  palette: CustomTheme;
  /** For `data-ab-theme`; undefined in dark, which is the attribute-absent default. */
  attr: "light" | "custom" | undefined;
  style: React.CSSProperties | undefined;
  set: (t: AudiobookTheme) => void;
} {
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump(n => n + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);

  const theme = currentTheme;
  const palette = audiobookPalette();

  return {
    theme,
    palette,
    attr: theme === "dark" ? undefined : theme,
    style: audiobookStyle(theme, palette),
    set: (t) => void setAudiobookTheme(t),
  };
}
