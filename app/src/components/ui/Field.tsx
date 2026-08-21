// Field.tsx -- a label, a control, and room to say why
// =====================================================
// Roughly two hundred inputs repeat the same class string, and the repetition
// hid two gaps: most of them had no focus ring at all, and the hint text was
// sometimes above the control and sometimes below it.
//
// `hint` sits ABOVE the control on purpose. It usually says what the field is
// for or what leaving it blank does, and that is worth reading before typing
// rather than after.

import type { ReactNode } from "react";

/** The shared input styling, for controls that cannot be children here --
 *  a <select> the caller needs to own, for instance. */
export const fieldInputClass =
  "w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm "
  + "text-text-primary placeholder-faint outline-none transition-colors "
  + "focus:border-focus focus:ring-1 focus:ring-focus";

interface FieldProps {
  label: string;
  /** What the field is for. Above the control, because it informs the answer. */
  hint?: ReactNode;
  /** A problem with what was entered. Replaces nothing; sits underneath. */
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className="mb-3">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium text-text-primary"
      >
        {label}
      </label>
      {hint && <p className="mb-1 text-xs text-faint">{hint}</p>}
      {children}
      {error && <p className="mt-1 text-mini text-danger">{error}</p>}
    </div>
  );
}
