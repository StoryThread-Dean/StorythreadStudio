// components/sidebar/NavSection.tsx -- Left-Nav Section Wrapper
// ==============================================================
// A labeled group in the left sidebar ("Manuscript", "Notes", "Profiles").
//
// Two modes:
//   - Static (no onToggle prop): the label is plain text, children always
//     visible. Identical to the original behavior.
//   - Collapsible (onToggle provided): the label becomes a full-width
//     button with a caret ('>' collapsed / 'v' expanded -- same glyph
//     convention as ChapterNavRow). The PARENT owns the collapsed state so
//     it can persist it per book via useProjectUiState.
//
// Pure presentational component -- no state, no fetches.

import type { ReactNode } from "react";

export function NavSection({
  label,
  children,
  collapsed = false,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="mb-5">
      {onToggle ? (
        <button
          onClick={onToggle}
          className="mb-1 flex w-full items-center gap-1 rounded px-2 text-left text-xs font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-primary"
          title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          aria-expanded={!collapsed}
        >
          <span aria-hidden="true" className="w-3 text-center normal-case">
            {collapsed ? ">" : "v"}
          </span>
          <span>{label}</span>
        </button>
      ) : (
        <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </p>
      )}
      {!collapsed && children}
    </div>
  );
}
