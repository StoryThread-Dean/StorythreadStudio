// components/ThemeToggle.tsx -- Sun/Moon Theme Switcher
// =======================================================
// A small, single-icon button that flips the app between dark and light
// themes. The icon shown reflects the theme the user would switch TO if
// they click (sun while in dark mode, moon while in light mode) -- this
// is the standard convention you'll see in VS Code, GitHub, etc.
//
// All state lives in the useTheme hook (see hooks/useTheme.ts), which
// persists the choice to the backend and updates every component using
// the theme. This component is purely the UI button.

import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";


export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="rounded p-1 text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
