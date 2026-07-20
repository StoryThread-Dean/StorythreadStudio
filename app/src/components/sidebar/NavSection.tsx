// components/sidebar/NavSection.tsx -- Left-Nav Section Wrapper
// ==============================================================
// A labeled group in the left sidebar ("Manuscript", "Notes", "Profiles").
// Extracted from App.tsx as part of the sidebar overhaul so the nav pieces
// live together in components/sidebar/ instead of the bottom of a 4,000-line
// file. Pure presentational component -- no state, no fetches.

import type { ReactNode } from "react";

export function NavSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}
