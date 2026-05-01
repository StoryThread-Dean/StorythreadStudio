// components/RightPanelResizer.tsx -- Shared width toggle for right-side panels
// ==============================================================================
// The Main Editor's Writing Companion and the Profile Builder's chat panel both
// live on the right edge of their screens. Their previous fixed 380px width
// felt cramped, especially for long AI responses or heavy context. This module
// provides:
//
//   - `useRightPanelWidth(storageKey)`: React hook that tracks the chosen
//     width as one of two discrete sizes ("compact" or "wide") and persists
//     it to localStorage so the writer's preference survives app restarts.
//
//   - `<RightPanelResizer>`: two small buttons pinned to the left edge of a
//     panel. Top button expands, bottom button shrinks. The panel itself is
//     responsible for actually applying the width via its className.
//
// Why discrete sizes rather than drag-to-resize?
//   Free resize adds a drag handle, mouse-event plumbing, and a saved pixel
//   preference that has to cope with different monitor sizes. Two fixed
//   options cover the writer's stated need (roomier vs snugger) with a single
//   click and no layout math.

import { useCallback, useState } from "react";


// The two available panel widths. Tailwind picks the class off these so we
// can't use arbitrary pixel values here without also ensuring the classes
// appear somewhere Tailwind will compile them; we use the `w-[<px>]` arbitrary
// value syntax below, which Tailwind JIT does pick up.
export type RightPanelWidth = "compact" | "wide";

// compact = slightly larger than the old 380px (~500 for breathing room)
// wide    = meaningfully bigger for long AI replies and multi-profile reads
export const RIGHT_PANEL_PIXELS: Record<RightPanelWidth, number> = {
  compact: 480,
  wide:    720,
};

// Tailwind arbitrary-value classes. These exact strings must appear in the
// source so Tailwind's content scanner generates them at build time.
export const RIGHT_PANEL_CLASS: Record<RightPanelWidth, string> = {
  compact: "w-[480px]",
  wide:    "w-[720px]",
};


/**
 * Read the persisted width preference from localStorage once, on hook init.
 * Falls back to "compact" when nothing is saved or the value is corrupt.
 * Storage keys are caller-supplied so the two panels can have independent
 * preferences (writer might want the Writing Companion wide but the Profile
 * Builder chat compact, or vice versa).
 */
function readInitialWidth(storageKey: string): RightPanelWidth {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "compact" || saved === "wide") return saved;
  } catch {
    // localStorage can throw in private-browsing modes; fall through.
  }
  return "compact";
}


export function useRightPanelWidth(storageKey: string) {
  const [width, setWidthState] = useState<RightPanelWidth>(() => readInitialWidth(storageKey));

  // One setter that both updates React state and persists to localStorage,
  // so every call site doesn't have to remember to save. The persisted value
  // becomes the default on the next app start.
  const setWidth = useCallback((next: RightPanelWidth) => {
    setWidthState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Silent: if localStorage is unavailable we still honor the in-session
      // change, we just won't remember it next time.
    }
  }, [storageKey]);

  return { width, setWidth };
}


interface RightPanelResizerProps {
  width:    RightPanelWidth;
  setWidth: (next: RightPanelWidth) => void;
}

/**
 * Two stacked buttons pinned to the LEFT edge of a right-side panel. The
 * parent panel must be `position: relative` (or an equivalent containing
 * block) so the absolute-positioned wrapper here anchors correctly.
 *
 * Position: vertically centered on the panel, horizontally straddling the
 * border so the buttons read as an affordance on the seam between editor
 * and panel. Matches the placement indicated in the writer's screenshot.
 */
export function RightPanelResizer({ width, setWidth }: RightPanelResizerProps) {
  const canExpand = width !== "wide";
  const canShrink = width !== "compact";

  return (
    <div
      className="absolute left-0 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1"
      // title applied on the container is visible when hovering between the
      // buttons; individual buttons have their own more specific titles.
    >
      {/* Expand (Larger). Chevrons point LEFT because the panel grows leftward
          into the editor area when expanded. */}
      <button
        onClick={() => setWidth("wide")}
        disabled={!canExpand}
        title="Larger (expand this panel)"
        aria-label="Expand right panel"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-panel text-[11px] text-indigo-300 shadow transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-indigo-300"
      >
        {"\u00AB"}
      </button>

      {/* Shrink (Smaller). Chevrons point RIGHT because the panel contracts
          rightward toward its default edge when shrunk. */}
      <button
        onClick={() => setWidth("compact")}
        disabled={!canShrink}
        title="Smaller (shrink this panel)"
        aria-label="Shrink right panel"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-panel text-[11px] text-indigo-300 shadow transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-indigo-300"
      >
        {"\u00BB"}
      </button>
    </div>
  );
}
