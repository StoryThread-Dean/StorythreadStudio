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


const API_BASE = "http://localhost:8000";

export type Theme = "dark" | "light";

// ── Module-level state ──────────────────────────────────────────────────────
// `currentTheme` is the live value. `subscribers` is the list of components
// that asked to be notified when the theme changes (each useTheme() adds one).

let currentTheme: Theme = "dark";
const subscribers = new Set<(t: Theme) => void>();


/**
 * Apply the theme to the DOM by setting data-theme on the <html> element.
 * App.css's [data-theme="light"] block overrides every CSS variable; the
 * absence of the attribute uses the :root (dark) defaults.
 */
function applyToDom(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
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
    const t: Theme = data.theme === "light" ? "light" : "dark";
    currentTheme = t;
    applyToDom(t);
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
