// components/update/UpdateModal.tsx -- Update details + install flow
// ====================================================================
// Opens when the writer clicks "View details" on the UpdateBanner. Shows:
//   - Version number (current -> new)
//   - Release date (when present in the manifest)
//   - Markdown notes describing what changed
//   - A Download & Install button that triggers the actual download,
//     shows progress, then offers a Restart button when ready
//   - An optional donation nudge -- shown alongside but never blocking
//
// The donation nudge appears here intentionally: the writer is engaging
// with the project's improvement loop right now; this is the natural
// moment to surface "if this is useful, consider supporting development".
// Suppressed for users who marked themselves as donors.

import { ChatMarkdown } from "../ChatMarkdown";
import type { AvailableUpdate, UpdateStatus, DownloadProgress } from "../../hooks/useAppUpdate";


export interface UpdateModalProps {
  update:             AvailableUpdate;
  status:             UpdateStatus;
  progress:           DownloadProgress | null;
  error:              string | null;
  hasDonated:         boolean;
  // Open external links via Tauri's opener plugin -- handed in by App.tsx
  // so this component stays decoupled from the Tauri API surface.
  openLink:           (url: string) => void;
  onDownloadInstall:  () => void;
  onRelaunch:         () => void;
  onClose:            () => void;
}


// Format bytes as a human-friendly string (e.g. "12.3 MB"). Single-purpose
// helper -- kept inline rather than imported to avoid a tiny utils file.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}


export function UpdateModal({
  update, status, progress, error, hasDonated,
  openLink, onDownloadInstall, onRelaunch, onClose,
}: UpdateModalProps) {

  // Closed-over for cleaner conditional logic below.
  const isDownloading = status === "downloading";
  const isInstalling  = status === "installing";
  const isReady       = status === "ready";
  const isErrored     = status === "error";
  const isWorking     = isDownloading || isInstalling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded border border-accent-fill/60 bg-bg-panel shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-faint">Update available</p>
            <h2 className="mt-0.5 text-lg font-semibold text-accent">
              v{update.version}
              <span className="ml-2 text-sm font-normal text-text-muted">
                from v{update.currentVersion}
              </span>
            </h2>
            {update.date && (
              <p className="text-mini text-faint">Released {new Date(update.date).toLocaleDateString()}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isWorking}
            className="text-faint hover:text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            âœ•
          </button>
        </div>

        {/* Body: scrollable notes + (when working) progress + (when ready) donation nudge */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Release notes -- raw Markdown from the latest.json manifest.
              ChatMarkdown gives us the same rendering used elsewhere
              (bold, lists, blockquotes), keeping notes visually consistent
              with chat output. */}
          {update.notes ? (
            <div className="text-sm text-text-primary">
              <ChatMarkdown content={update.notes} />
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              No release notes provided. The full changelog is available at{" "}
              <button
                onClick={() => openLink("https://github.com/StoryThread-Dean/StorythreadStudio/blob/main/CHANGELOG.md")}
                className="text-accent underline hover:text-accent-strong"
              >
                CHANGELOG.md
              </button>.
            </p>
          )}

          {/* Donation nudge: shown when not actively downloading and the
              user hasn't already marked as a donor. Soft and dismissable
              -- it's a reminder, not a wall. */}
          {!isWorking && !hasDonated && (
            <div className="mt-4 rounded border border-accent-fill/40 bg-accent-soft/30 p-3">
              <p className="mb-2 text-xs text-accent-strong">
                Storythread Studio is free and stays free. If it's useful to your
                writing, consider supporting development -- donations cover the
                Claude API costs that power this app's AI features.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => openLink("https://github.com/sponsors/StoryThread-Dean")}
                  className="rounded border border-weave-fill bg-weave-soft/30 px-2 py-0.5 text-mini text-weave-strong hover:bg-weave-soft/50"
                >
                  GitHub Sponsors
                </button>
                <button
                  onClick={() => openLink("https://ko-fi.com/storythreadstudio")}
                  className="rounded border border-secondary-fill bg-secondary-soft/30 px-2 py-0.5 text-mini text-secondary-strong hover:bg-secondary-soft/50"
                >
                  Ko-fi
                </button>
              </div>
            </div>
          )}

          {/* Download progress. Only renders during the active download;
              the progress object disappears outside that window. */}
          {isWorking && progress && (
            <div className="mt-4 rounded border border-border bg-bg-primary p-3">
              <p className="mb-2 text-xs font-medium text-text-primary">
                {isInstalling ? "Installing..." : "Downloading..."}
              </p>
              <div className="h-2 w-full overflow-hidden rounded bg-bg-panel">
                <div
                  className="h-full bg-accent-fill transition-all"
                  style={{ width: progress.percent != null ? `${progress.percent * 100}%` : "100%" }}
                />
              </div>
              <p className="mt-1 text-mini text-faint">
                {formatBytes(progress.downloaded)}
                {progress.total != null && ` / ${formatBytes(progress.total)}`}
                {progress.percent != null && ` (${Math.round(progress.percent * 100)}%)`}
              </p>
            </div>
          )}

          {/* Ready-to-relaunch state. */}
          {isReady && (
            <div className="mt-4 rounded border border-success-fill/50 bg-success-soft/30 p-3 text-xs text-success-strong">
              Update installed. Restart the app to start using v{update.version}.
            </div>
          )}

          {/* Error display. Shown both for check failures and download failures. */}
          {isErrored && error && (
            <div className="mt-4 rounded border border-danger-fill/50 bg-danger-soft/30 p-3 text-xs text-danger">
              <p className="font-semibold">Update failed</p>
              <p className="mt-1">{error}</p>
              <p className="mt-1 text-danger-muted/70">
                You can keep using the current version. Try again from the About panel later.
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-bg-primary px-5 py-3">
          <button
            onClick={() => openLink(`https://github.com/StoryThread-Dean/StorythreadStudio/releases/tag/v${update.version}`)}
            className="text-mini text-accent underline hover:text-accent-strong"
          >
            View on GitHub
          </button>
          <div className="flex gap-2">
            {!isReady && (
              <button
                onClick={onClose}
                disabled={isWorking}
                className="rounded border border-border px-3 py-1 text-xs text-faint hover:text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Later
              </button>
            )}
            {!isReady && !isWorking && (
              <button
                onClick={onDownloadInstall}
                className="rounded border border-accent-fill bg-accent-fill/40 px-3 py-1 text-xs font-semibold text-accent-strong hover:bg-accent-fill/60"
              >
                Download &amp; Install
              </button>
            )}
            {isReady && (
              <button
                onClick={onRelaunch}
                className="rounded border border-success-fill bg-success-fill/40 px-3 py-1 text-xs font-semibold text-success-strong hover:bg-success-fill/60"
              >
                Restart now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
