// components/update/PostUpdateBanner.tsx -- "What's new" after an update
// =========================================================================
// Fires the FIRST time the writer launches a new version. Detected by
// useFreshVersion(): if localStorage's last-seen version is older than the
// running version, we show this banner.
//
// Content: a compact notice with the new version number, a link to view
// the full changelog on GitHub, and (when the user isn't already a donor)
// a soft donation nudge tied to the upgrade moment.
//
// One acknowledge() click writes the new version into localStorage so this
// banner doesn't reappear on the next launch.

import { useState } from "react";


export interface PostUpdateBannerProps {
  currentVersion:  string;
  previousVersion: string | null;   // For "from vX -> vY" framing
  hasDonated:      boolean;
  openLink:        (url: string) => void;
  onAcknowledge:   () => void;
}


export function PostUpdateBanner({
  currentVersion, previousVersion, hasDonated,
  openLink, onAcknowledge,
}: PostUpdateBannerProps) {

  // Local dismiss without acknowledging -- the banner returns next launch.
  // Keeping it as a separate option from "Got it" lets a writer who's busy
  // suppress the banner without committing to having read the changelog.
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="flex w-full items-center gap-3 border-b border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-200">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />

      <div className="flex-1">
        <p>
          <span className="font-semibold">Updated to v{currentVersion}.</span>
          {previousVersion && (
            <span className="ml-1 text-emerald-300/70">
              (from v{previousVersion})
            </span>
          )}
          <button
            onClick={() => openLink("https://github.com/dataguydpeterson-cmyk/StorythreadStudio/blob/main/CHANGELOG.md")}
            className="ml-2 text-emerald-300 underline hover:text-emerald-200"
          >
            View changelog
          </button>
        </p>

        {!hasDonated && (
          <p className="mt-0.5 text-[11px] text-emerald-300/80">
            Enjoying the updates? Consider{" "}
            <button
              onClick={() => openLink("https://github.com/sponsors/dataguydpeterson-cmyk")}
              className="underline hover:text-emerald-200"
            >
              sponsoring on GitHub
            </button>
            {" "}or{" "}
            <button
              onClick={() => openLink("https://ko-fi.com/storythreadstudio")}
              className="underline hover:text-emerald-200"
            >
              tipping on Ko-fi
            </button>
            {" "}-- it covers the Claude API costs of ongoing development.
          </p>
        )}
      </div>

      <button
        onClick={onAcknowledge}
        className="rounded border border-emerald-600 bg-emerald-700/40 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-700/60"
      >
        Got it
      </button>
      <button
        onClick={() => setHidden(true)}
        className="rounded px-1.5 py-0.5 text-[11px] text-emerald-300/70 hover:text-emerald-200"
        title="Hide for now (will return on next launch)"
      >
        ✕
      </button>
    </div>
  );
}
