// components/learn/useAttemptClose.ts -- one way out, and it asks first
// ======================================================================
// A dialog closes three ways: the X, the Escape key, and a click that lands on
// the backdrop. The third is the one nobody means to press, and in the Weave it
// was wired straight to `onClose` on seven surfaces, five of which held text the
// writer had typed and not yet saved. Reported plainly:
//
//     "The interface UI for this screen is very sensitive to accidental
//      clicking outside the field causing the entire window to Exit
//      prematurely. Then having to start over again where the weaving left
//      off. Its happened multiple times to me already."
//
// The app's own locked rule already covers this -- "Manual save only ... Confirm
// before closing" -- and the audiobook has obeyed it for two releases
// (`CastPanel`, `AudiobookSettingsDialog`). The Weave never did.
//
// So the pattern is a hook rather than a seventh copy: every route out goes
// through one function, and that function asks when there is something to lose.
//
// WHEN IT IS NOT DIRTY IT DOES NOT ASK. A confirm on every close is a confirm
// the writer learns to dismiss without reading, which is worse than none -- it
// trains away the reflex on the one occasion it matters.

import { useCallback, useEffect } from "react";

/**
 * One guarded way out of a dialog.
 *
 * @param dirty   whether closing now would lose something the writer typed.
 * @param onClose what to do when they mean it.
 * @param message what they are being asked, in terms of what is at stake.
 *                Name the thing, not the operation: "your connection reason"
 *                tells them what they are about to lose, "unsaved changes" does
 *                not.
 * @param escapes whether Escape should also be guarded by this. Off where a
 *                dialog is nested inside another that owns the key.
 */
export function useAttemptClose(
  dirty: boolean,
  onClose: () => void,
  message: string,
  { escapes = true }: { escapes?: boolean } = {},
): () => void {
  const attemptClose = useCallback(() => {
    if (dirty && !window.confirm(message)) return;
    onClose();
  }, [dirty, onClose, message]);

  useEffect(() => {
    if (!escapes) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") attemptClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attemptClose, escapes]);

  return attemptClose;
}
