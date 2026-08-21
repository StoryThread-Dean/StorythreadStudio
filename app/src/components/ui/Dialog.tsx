// Dialog.tsx -- one overlay, one scrim, one way out
// ==================================================
// Thirty-nine `fixed inset-0` overlays were hand-rolled across thirty-five
// files, with three different scrim opacities between them and no agreement
// on whether Escape closed, whether the backdrop closed, or whether either
// asked first. This is that shape, once.
//
// IT CALLS useAttemptClose RATHER THAN REPLACING IT. That hook is a locked
// product rule (R11.5): backdrop, X and Escape all go through ONE guard, and
// it asks only when there is something to lose. A confirm on every close is
// one the writer learns to dismiss without reading, which is worse than no
// confirm at all. Seven codex screens already call the hook directly and can
// hand their `dirty` and `message` straight to this instead.
//
// `dirty` defaults to false, so adopting this in a dialog that never guarded
// its close reproduces exactly what that dialog did before. Adoption is a
// styling change, never a behaviour change.
//
// ONE CONSTRAINT WORTH KNOWING BEFORE YOU REFACTOR THIS. The overlay div must
// stay the IMMEDIATE parent of the role="dialog" node -- no portal, no extra
// wrapper. WeavingPanel.test.tsx reads `dialog.parentElement` and expects to
// find `fixed` on it. That is a free constraint today, since all 39 overlays
// already have that shape, but it is not obvious from reading this file.

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useAttemptClose } from "../learn/useAttemptClose";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

interface DialogProps {
  /** Names the dialog for screen readers, and for tests. */
  label: string;
  onClose: () => void;
  /**
   * Closing right now would lose something the writer typed.
   *
   * Leave it false unless that is true. The guard exists so the ONE confirm
   * a writer sees is a confirm worth reading.
   */
  dirty?: boolean;
  /**
   * What is at stake, named as a thing rather than as "unsaved changes".
   *
   * The Weaving walk says "you are 3 of 12 through this pass", because the
   * expensive thing there is the place, not the text.
   */
  confirmMessage?: string;
  /** Off where this dialog is nested inside one that already owns Escape. */
  escapes?: boolean;
  size?: keyof typeof SIZES;
  testId?: string;
  /** Shown in the header bar, left of the close button. */
  title?: ReactNode;
  /** Pinned under the header, above the scrolling body. */
  toolbar?: ReactNode;
  /** Pinned to the bottom. Actions go here. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Dialog({
  label,
  onClose,
  dirty = false,
  confirmMessage = "You have unsaved changes. Close anyway?",
  escapes = true,
  size = "md",
  testId,
  title,
  toolbar,
  footer,
  children,
}: DialogProps) {
  const attemptClose = useAttemptClose(dirty, onClose, confirmMessage, { escapes });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      // The backdrop goes through the same guard as the X and Escape. Before
      // this existed, seven overlays wired the backdrop straight to onClose
      // and five of those held typed text.
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        className={`flex max-h-[85vh] w-full ${SIZES[size]} flex-col rounded-lg border border-border-strong bg-bg-panel shadow-e4`}
      >
        {(title || testId !== undefined) && (
          <header className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
              {title}
            </div>
            <button
              type="button"
              onClick={attemptClose}
              aria-label="Close"
              className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </header>
        )}

        {toolbar && (
          <div className="border-b border-border px-4 py-2">{toolbar}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>

        {footer && (
          <footer className="flex items-center gap-2 border-t border-border px-4 py-2">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
