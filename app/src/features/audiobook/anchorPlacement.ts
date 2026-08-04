// features/audiobook/anchorPlacement.ts
// ======================================
// Where a popout that points at a word is allowed to sit.
//
// The [say] editor opens beside the word it is editing, and it GROWS:
// the tips accordion, the occurrence counter and the preview player all
// expand it downward after it opens. A popout anchored near the bottom
// of the editor therefore expands off the screen, and the writer cannot
// reach the controls they opened it for.
//
// So the rule is not "clamp it into view" -- that still leaves it flush
// with the bottom edge with nowhere to grow. It is: never place it below
// the halfway line. Above that, it sits at the word. Below it, it stops
// at the middle and points up at the word instead. Predictable beats
// pixel-perfect for something that changes size after you look at it.

export interface Anchor {
  top: number;
  left: number;
}

export interface PlacementBox {
  /** The positioned container the popout lives inside. */
  height: number;
  width: number;
  /** How wide the popout is, so it never hangs off the right edge. */
  popoutWidth: number;
}

/** Keep at least this much clear of the container's edges. */
const MARGIN = 8;

/**
 * Clamp a raw "just under the word" position into somewhere the popout
 * can actually open AND expand.
 */
export function clampAnchor(raw: Anchor, box: PlacementBox): Anchor {
  // The halfway line, but never so tight that a short editor pins the
  // popout to the very top.
  const lowest = Math.max(MARGIN, box.height / 2);
  const widest = Math.max(MARGIN, box.width - box.popoutWidth - MARGIN);
  return {
    top: Math.min(Math.max(MARGIN, raw.top), lowest),
    left: Math.min(Math.max(MARGIN, raw.left), widest),
  };
}
