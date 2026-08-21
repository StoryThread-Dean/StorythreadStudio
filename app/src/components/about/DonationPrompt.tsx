// components/about/DonationPrompt.tsx -- Periodic "consider donating" nudge
// =============================================================================
// Triggered by useDonationState's shouldShowPrompt flag, which fires every
// 30-50 launches (random per-installation cadence) when the writer hasn't
// marked themselves as a donor.
//
// Style: a small floating card at the bottom-right of the window. NOT modal --
// the writer can keep typing while it's visible, and it dismisses with a click
// or Escape. The whole point of the nudge is to be ignorable.

import { useEffect } from "react";
import { Heart } from "lucide-react";


export interface DonationPromptProps {
  appOpenCount: number;
  openLink:     (url: string) => void;
  onDismiss:    () => void;
  onMarkDonated: () => void;
}


export function DonationPrompt({
  appOpenCount, openLink, onDismiss, onMarkDonated,
}: DonationPromptProps) {

  // Escape closes the prompt -- the writer might never look at it visually
  // and just hit Esc to clear distractions.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);


  return (
    <div
      // Bottom-right corner, above any normal status bars. Limited width
      // so it never crowds the writing surface; the entire card is
      // dismissable with the X button.
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-weave-fill/60 bg-bg-panel shadow-e3"
    >
      <div className="flex items-start justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-weave">
          <Heart size={12} fill="currentColor" />
          A small ask
        </div>
        <button
          onClick={onDismiss}
          className="text-faint hover:text-text-muted"
          title="Dismiss (won't show again for a while)"
        >
          âœ•
        </button>
      </div>

      <div className="px-3 py-3 text-xs text-text-primary">
        <p className="mb-2">
          You've launched Storythread Studio{" "}
          <span className="font-semibold text-weave">{appOpenCount}</span> times.
          If it's helping your writing, consider chipping in to keep development going.
        </p>
        <p className="mb-3 text-mini text-faint">
          Donations cover the Claude API costs of ongoing development. The app stays
          free for everyone either way -- this is purely optional.
        </p>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => openLink("https://github.com/sponsors/StoryThread-Dean")}
            className="rounded border border-weave-fill bg-weave-soft/30 px-2 py-1 text-mini font-medium text-weave-strong hover:bg-weave-soft/50"
          >
            Support on GitHub Sponsors
          </button>
          <button
            onClick={() => openLink("https://ko-fi.com/storythreadstudio")}
            className="rounded border border-secondary-fill bg-secondary-soft/30 px-2 py-1 text-mini font-medium text-secondary-strong hover:bg-secondary-soft/50"
          >
            Tip on Ko-fi
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-mini">
          <button
            onClick={() => { onMarkDonated(); onDismiss(); }}
            className="text-weave underline hover:text-weave-strong"
            title="If you've already donated, this stops these reminders"
          >
            Already donated
          </button>
          <button
            onClick={onDismiss}
            className="text-faint hover:text-text-muted"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
