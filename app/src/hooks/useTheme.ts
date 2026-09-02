// hooks/useTheme.ts -- App Theme (Dark / Light)
// =================================================
// Single source of truth for the UI theme. The theme drives every color in
// the app via CSS variables: setting `data-theme="light"` on the <html>
// element flips :root variables to the paper palette defined in App.css.
//
// Persistence: the theme is stored in the global ~/.storythread/settings.json
// file (key: "theme"), so the writer's choice carries across all projects.
//
// Why a module-level store instead of React Context?
//   We want ONE shared state across the whole app -- any number of components
//   can call useTheme() and they'll all stay in sync, without needing to wrap
//   the tree in a Provider. The theme also needs to be applied to the DOM
//   before React even renders (to avoid a "flash of dark theme" on light-mode
//   boot), which a module-level init function handles cleanly.
//
// Analogy: think of this like a thermostat in the hallway. Every room
// (component) checks the thermostat to know the temperature; when someone
// changes it, every room updates at once.

import { useEffect, useState } from "react";
import {
  THEME_TOKENS, sanitizeCustomTheme, type CustomTheme,
} from "../features/theme/themeTokens";
import { parseColor, isLightPalette } from "../features/theme/color";


const API_BASE = "http://localhost:8000";

/**
 * "custom" is the writer's own palette, added 2026-09-02.
 *
 * HOW IT WORKS, AND WHY THERE IS NO [data-theme="custom"] BLOCK IN App.css.
 * `:root` matches <html> whatever the data-theme attribute says, and only
 * `[data-theme="light"]` overrides it. So a custom theme starts from the dark
 * values for free, and the writer's choices are applied as INLINE custom
 * properties on <html> -- inline beats a stylesheet rule, which is the same
 * mechanism useUiScale already uses for --text-entry-size.
 *
 * That means no second copy of 56 values in the stylesheet to drift out of
 * step, and nothing to keep in sync when a token is added. The attribute is
 * still set, because `color-scheme` and any future structural rule need
 * something to hang off, and because the writer can see which theme they are
 * in from the DOM.
 *
 * The Audiobook Converter is unaffected, and that falls out rather than being
 * arranged: `.audiobook-theme` declares its own `--st-*` on a descendant, and
 * an element's own declaration wins over an inherited one. Charcoal in every
 * theme, including this one.
 */
export type Theme = "dark" | "light" | "custom";

// ── Module-level state ──────────────────────────────────────────────────────
// `currentTheme` is the live value. `subscribers` is the list of components
// that asked to be notified when the theme changes (each useTheme() adds one).

let currentTheme: Theme = "dark";
/** The writer's assigned colours. Empty until they build one. */
let currentCustom: CustomTheme = {};
/**
 * Which properties we last wrote inline, so they can be REMOVED again.
 *
 * Without this, switching custom back to dark would leave every custom
 * property sitting on <html>, where it beats the stylesheet: the writer would
 * pick Dark, watch nothing happen, and have no way back short of restarting.
 * Tracking what was applied is the whole difference between a theme switch and
 * a one-way door.
 */
let appliedProps: string[] = [];
const subscribers = new Set<(t: Theme) => void>();


/**
 * Apply the theme to the DOM by setting data-theme on the <html> element.
 * App.css's [data-theme="light"] block overrides every CSS variable; the
 * absence of the attribute uses the :root (dark) defaults.
 */
function applyToDom(theme: Theme, custom: CustomTheme = currentCustom): void {
  const root = document.documentElement;

  // Always clear what we wrote last time FIRST. See appliedProps above.
  for (const prop of appliedProps) root.style.removeProperty(prop);
  root.style.removeProperty("color-scheme");
  appliedProps = [];

  if (theme === "light") {
    root.setAttribute("data-theme", "light");
    return;
  }

  if (theme === "custom") {
    root.setAttribute("data-theme", "custom");
    for (const [name, value] of Object.entries(custom)) {
      root.style.setProperty(name, value);
      appliedProps.push(name);
    }

    // color-scheme is the one thing CSS variables cannot reach: native
    // scrollbars, <select> popups and context menus are drawn by the OS
    // OUTSIDE the page. Derive it from the window colour rather than asking,
    // because a writer choosing colours is not thinking about scrollbars --
    // and light mode shipped with exactly this bug before v2.0.2.
    const bg = parseColor(custom["--st-bg-primary"] ?? "");
    root.style.setProperty("color-scheme", bg && isLightPalette(bg) ? "light" : "dark");
    return;
  }

  root.removeAttribute("data-theme");
}


/**
 * Read the colours the app is rendering RIGHT NOW, for every role token.
 *
 * This is how a custom theme is seeded, and reading the live stylesheet rather
 * than keeping a copy of the defaults in TypeScript is deliberate: there is
 * then no second list of 56 values to drift from App.css, and a token added to
 * the stylesheet is picked up with no further work.
 *
 * Every token is seeded, not only the ones the writer later changes. A theme
 * with holes in it falls back to the shipped DARK value for whatever is
 * missing, so a writer building a light palette would get one or two stubborn
 * dark patches with no control on screen explaining them.
 */
export function readCurrentTokens(from?: Element | null): CustomTheme {
  // Reading from an ELEMENT rather than always from <html> is what lets the
  // same function seed the Audiobook Converter's palette: inside
  // `.audiobook-theme` these tokens resolve to the charcoal (or paper) ramp,
  // so a computed read taken there returns that side's colours.
  const computed = getComputedStyle(from ?? document.documentElement);
  const out: CustomTheme = {};
  for (const token of THEME_TOKENS) {
    const value = computed.getPropertyValue(token.name).trim();
    if (value) out[token.name] = value;
  }
  return out;
}


/** The writer's stored palette. */
export function getCustomTheme(): CustomTheme {
  return { ...currentCustom };
}


/**
 * Paint a palette on screen WITHOUT saving it.
 *
 * The editor needs this because picking colours blind is not something anyone
 * can do, but "Manual save only" is a locked product rule. So the DOM follows
 * every keystroke and the FILE follows only Save. Closing without saving
 * repaints from the stored theme, which is what makes Cancel mean something.
 */
export function previewCustomTheme(custom: CustomTheme): void {
  applyToDom("custom", custom);
}


/** Repaint from what is actually stored, discarding any preview. */
export function revertPreview(): void {
  applyToDom(currentTheme, currentCustom);
}


/**
 * Save a palette and switch to it.
 *
 * Notifies subscribers even when the theme string is already "custom", because
 * the COLOURS changed and a component showing a swatch has no other way to
 * know that.
 */
export async function setCustomTheme(custom: CustomTheme): Promise<void> {
  currentCustom = sanitizeCustomTheme(custom);
  currentTheme = "custom";
  applyToDom("custom", currentCustom);
  subscribers.forEach(fn => fn("custom"));

  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ theme: "custom", custom_theme: currentCustom }),
    });
  } catch {
    // Non-fatal: what the writer sees is already right, and the next
    // successful save reconciles.
  }
}


/**
 * Initialize the theme from the backend settings file. Call this ONCE at app
 * boot (App.tsx top-level useEffect). If the fetch fails (backend down on
 * cold start), we keep the default "dark" -- the next successful settings
 * load will reconcile.
 */
export async function initTheme(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();
    currentCustom = sanitizeCustomTheme(data.custom_theme);
    // A stored "custom" with nothing in it would paint the app from an empty
    // map, which is dark -- silently, with the writer's Custom button lit.
    // Fall back to dark honestly instead.
    const stored = data.theme;
    const t: Theme =
      stored === "light" ? "light" :
      stored === "custom" && Object.keys(currentCustom).length > 0 ? "custom" :
      "dark";
    currentTheme = t;
    applyToDom(t, currentCustom);
    // Notify any components that mounted before init finished.
    subscribers.forEach((fn) => fn(t));
  } catch {
    // Silent fail: backend offline. Default dark theme already applied.
  }
}


/**
 * Change the theme. Updates the DOM immediately (so the UI reacts without
 * waiting for the network), then persists the choice to the backend. Any
 * components using useTheme() re-render with the new value.
 */
export async function setTheme(theme: Theme): Promise<void> {
  if (theme === currentTheme) return;
  currentTheme = theme;
  applyToDom(theme);
  subscribers.forEach((fn) => fn(theme));

  // Persist asynchronously. We don't await/block the UI on the network --
  // if the PUT fails, the user's session still uses the new theme; next
  // boot will re-read whatever the backend has.
  try {
    await fetch(`${API_BASE}/api/settings`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ theme }),
    });
  } catch {
    // Network issues are non-fatal; the in-memory + DOM state is what users see.
  }
}


/**
 * React hook: returns [theme, setTheme]. Components re-render automatically
 * whenever the theme changes anywhere in the app.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setLocal] = useState<Theme>(currentTheme);

  useEffect(() => {
    // Subscribe to global changes so every consumer stays in sync.
    subscribers.add(setLocal);
    // In case the theme changed between render and effect (e.g. initTheme
    // resolved during render), reconcile to current value.
    if (currentTheme !== theme) setLocal(currentTheme);

    return () => {
      subscribers.delete(setLocal);
    };
    // Intentionally empty deps: we want to subscribe once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [theme, (t) => void setTheme(t)];
}
