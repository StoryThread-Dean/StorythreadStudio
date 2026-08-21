// components/update/UpdateBanner.tsx -- Slim "update available" notice
// =====================================================================
// A compact horizontal banner pinned to the top of the app whenever a new
// version is available on GitHub Releases. Two actions:
//
//   - View details: opens UpdateModal with the full Markdown release notes
//                   and a Download & Install button
//   - Later:        dismisses for this session (the banner stays gone until
//                   the next launch, when the launch-time check runs again
//                   and -- if the update is still pending -- re-shows it)
//
// The banner is intentionally low-contrast: it should communicate "there's
// something here for you" without breaking the writer's flow. The colored
// dot on the left is the only visually energetic element.

import { useState } from "react";
import type { AvailableUpdate } from "../../hooks/useAppUpdate";


export interface UpdateBannerProps {
  update:        AvailableUpdate;
  onViewDetails: () => void;
}


export function UpdateBanner({ update, onViewDetails }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex w-full items-center gap-2 border-b border-accent-fill/40 bg-accent-soft/40 px-4 py-1.5 text-xs text-accent-strong">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-muted" />
      <span>
        <span className="font-semibold">Storythread Studio v{update.version}</span> is available.
        <span className="ml-1 text-accent/80">
          You're on v{update.currentVersion}.
        </span>
      </span>
      <button
        onClick={onViewDetails}
        className="ml-2 rounded border border-accent-fill bg-accent-fill/40 px-2 py-0.5 text-mini text-accent-strong transition-colors hover:bg-accent-fill/60"
      >
        View details
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto rounded px-2 py-0.5 text-mini text-accent/70 hover:text-accent-strong"
        title="Hide for this session"
      >
        Later
      </button>
    </div>
  );
}
