// Button.tsx -- the five shapes a button in this app actually takes
// ==================================================================
// Buttons were styled inline at every call site, which meant a primary action
// was filled indigo in one place, violet in another and emerald in a third,
// and nothing said which was correct. Those spellings are gone now -- the
// whole app names roles -- but they are what this component was written to
// replace. Deliberately described rather than quoted: Tailwind scans source
// for class names, comments included, and App.css.test.ts bans the raw ones.
//
// THE ONE THAT IS NOT A STYLE CHOICE: a filled accent button uses
// `text-on-accent`, NEVER `text-white`. The accent is #90CAF9, a light blue.
// White text on it is unreadable. There are 92 `text-white` call sites in the
// app written when every filled button had a dark ground, and the reason this
// component exists at all is so that assumption is made in one place instead
// of ninety-two.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader } from "lucide-react";

const VARIANTS = {
  /** The action the writer came here to take. One per screen, usually. */
  primary:
    "bg-accent-fill text-on-accent hover:bg-accent-muted",
  /** A real alternative, not a discouraged one. Has a surface and a border,
   *  because a bare ghost beside a filled button reads as disabled -- which
   *  is exactly how "Start fresh" was reported. */
  secondary:
    "border border-border-strong bg-bg-surface text-text-primary "
    + "hover:border-accent hover:bg-bg-raised",
  /** Quieter. For actions that are available but not being suggested. */
  ghost:
    "border border-border text-text-muted hover:border-border-strong "
    + "hover:text-text-primary",
  /** Destructive. Announces itself on hover rather than permanently, so a
   *  row of buttons is not one third red. */
  danger:
    "border border-border text-text-muted hover:border-danger hover:text-danger",
  /** No chrome at all. Toolbar icons, inline links. */
  bare:
    "text-text-muted hover:text-text-primary",
} as const;

const SIZES = {
  sm: "px-2 py-0.5 text-mini",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Swaps for a spinner and disables the button. */
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={
        "inline-flex items-center gap-1.5 rounded font-medium transition-colors "
        + "disabled:cursor-not-allowed disabled:opacity-40 "
        + `${VARIANTS[variant]} ${SIZES[size]} ${className}`
      }
      {...rest}
    >
      {loading ? <Loader size={12} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
