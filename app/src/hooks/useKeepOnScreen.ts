// hooks/useKeepOnScreen.ts -- a floating panel that stays readable
// =================================================================
// Extracted from Explain.tsx when a SECOND floating panel needed the same
// thing. Two copies of this arithmetic would drift, and the failure mode is a
// panel the writer cannot read -- which has now been reported twice, once for
// an off-screen edge and once for a panel that was part of the layout and
// distorted the card it lived in.
//
// The rule a floating panel has to obey, in two halves:
//
//   1. It is OUT OF FLOW. Absolutely positioned, over whatever is beneath it.
//      A disclosure that rearranges the screen around it is worse than no
//      disclosure -- opening one inside a wrapping flex row grows the row,
//      shoves its neighbours sideways and pushes the page down.
//
//   2. It is ON SCREEN. Being out of flow means nothing stops it hanging off
//      an edge, and a 30rem panel anchored to a 13px icon near the left of the
//      window has nowhere to go.
//
// This hook is the second half. The first half is a CSS choice at the call
// site, and no hook can enforce it.

import { useLayoutEffect, useRef, useState } from "react";

/** Clear space to leave between the panel and the window edge, in px. */
export const EDGE_MARGIN = 8;

/**
 * Keep an open floating panel inside the viewport.
 *
 * Attach `ref` to the panel and spread `style` onto it. While it is closed the
 * shift resets, so the next open measures fresh rather than compounding.
 *
 * `deps` re-measures when the panel's CONTENT changes size -- a help list that
 * expands, a different registry entry -- since the correction depends on how
 * tall and wide the thing actually rendered.
 */
export function useKeepOnScreen<T extends HTMLElement = HTMLDivElement>(
  open: boolean, deps: unknown[] = [],
) {
  const ref = useRef<T | null>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }

    // Corrects RELATIVE to the shift already applied, which is what makes this
    // safe to run more than once on the same open panel -- and therefore what
    // makes the resize listener a correction rather than an accumulation.
    function fit() {
      const panel = ref.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width === 0) return;      // jsdom, or not laid out yet

      const overLeft = EDGE_MARGIN - rect.left;
      const overRight = rect.right - (window.innerWidth - EDGE_MARGIN);

      // The LEFT edge wins when the panel is too wide for the window. Clipping
      // the far end costs the last few words; clipping the near end costs the
      // start of the sentence, which is the difference between hard to read and
      // useless.
      if (overLeft > 0) setShift(s => s + overLeft);
      else if (overRight > 0) setShift(s => s - overRight);
    }

    fit();
    // A writer who resizes or maximises with the panel open would otherwise
    // keep a correction computed for a window that no longer exists.
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);

  return {
    ref,
    // No transform at all when it already fits, rather than translateX(0px): a
    // correction that always fires is one nobody can reason about later.
    style: shift ? { transform: `translateX(${shift}px)` } : undefined,
  };
}
