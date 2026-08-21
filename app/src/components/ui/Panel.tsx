// Panel.tsx -- a card, at a stated level
// =======================================
// The same bordered box is repeated across ProjectHome, Settings, Book
// Details, the Profile Builder and every codex sub-screen, and it drifted:
// some had a border, some a background, some both, some neither.
//
// `level` is the point. Surfaces in this app ALTERNATE rather than climb --
// a grey-blue panel holds charcoal insets, which hold grey-blue cards again.
// Saying which one you want is more honest than picking a colour, and it is
// what keeps a nested card from vanishing into the thing it sits on.

import type { ReactNode } from "react";

const LEVELS = {
  /** A card on the page. Grey-blue in dark, near-white on paper. */
  raised: "bg-bg-panel",
  /** An inset well: inputs, code blocks, a card INSIDE a raised one. */
  inset:  "bg-bg-surface",
  /** No fill. For grouping with a border only. */
  plain:  "",
} as const;

interface PanelProps {
  level?: keyof typeof LEVELS;
  /** Drops the border, for a panel that is separated some other way. */
  borderless?: boolean;
  /** A heading bar with a bottom rule. */
  header?: ReactNode;
  padding?: "none" | "sm" | "md";
  className?: string;
  testId?: string;
  children: ReactNode;
}

const PADDING = { none: "", sm: "p-2.5", md: "p-4" } as const;

export function Panel({
  level = "raised",
  borderless = false,
  header,
  padding = "md",
  className = "",
  testId,
  children,
}: PanelProps) {
  return (
    <div
      data-testid={testId}
      className={
        `overflow-hidden rounded ${LEVELS[level]} `
        // A raised card gets the first rung of the elevation ladder. An inset
        // deliberately does not: it is a well, and a shadow would argue with
        // the thing it is sunk into.
        + (level === "raised" ? "shadow-e1 " : "")
        + (borderless ? "" : "border border-border ")
        + className
      }
    >
      {header && (
        <div className="border-b border-border px-3 py-1.5 text-micro font-semibold uppercase tracking-label text-text-muted">
          {header}
        </div>
      )}
      <div className={PADDING[padding]}>{children}</div>
    </div>
  );
}
