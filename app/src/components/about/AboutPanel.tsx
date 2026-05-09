// components/about/AboutPanel.tsx -- About + donation modal
// ============================================================
// Single modal accessed from the Settings screen (or an About menu entry)
// that surfaces:
//   - App name, version, license
//   - GitHub repo + changelog links
//   - Donation buttons: GitHub Sponsors + Ko-fi
//   - Donor flag: writer can mark/unmark themselves as a donor; when set,
//     a "Thank you for donating!" badge appears and donation prompts are
//     suppressed throughout the app
//   - Manual "Check for updates" trigger that re-runs the launch check
//
// All external links open via Tauri's opener plugin (passed in as openLink)
// rather than window.open so they go to the system browser cleanly.

import { Heart, ExternalLink } from "lucide-react";
import type { UpdateStatus } from "../../hooks/useAppUpdate";


export interface AboutPanelProps {
  version:        string;
  hasDonated:     boolean;
  updateStatus:   UpdateStatus;
  openLink:       (url: string) => void;
  onMarkDonated:  () => void;
  onUnmarkDonated: () => void;
  onCheckUpdates: () => void;
  onClose:        () => void;
}


export function AboutPanel({
  version, hasDonated, updateStatus,
  openLink, onMarkDonated, onUnmarkDonated, onCheckUpdates, onClose,
}: AboutPanelProps) {

  const checking = updateStatus === "checking";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded border border-indigo-700/60 bg-bg-panel shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-indigo-300">About</h2>
          <button onClick={onClose} className="text-faint hover:text-text-muted">✕</button>
        </div>

        {/* Identity block: app name, version, donor badge */}
        <div className="border-b border-border px-5 py-4 text-center">
          <p className="text-lg font-semibold text-text-primary">Storythread Studio</p>
          <p className="text-xs text-text-muted">Version {version}</p>
          {hasDonated && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-pink-700 bg-pink-900/30 px-2.5 py-0.5 text-[11px] text-pink-200">
              <Heart size={11} fill="currentColor" />
              Thank you for donating!
            </div>
          )}
        </div>

        {/* Donations */}
        <div className="border-b border-border px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Support development
          </p>
          <p className="mb-3 text-xs text-text-primary">
            Storythread Studio is free and open-source. Donations cover the Claude
            API costs of ongoing development. If donations exceed monthly costs, a
            code-signing certificate gets purchased so the SmartScreen warning goes
            away for everyone.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => openLink("https://github.com/sponsors/dataguydpeterson-cmyk")}
              className="flex items-center justify-center gap-2 rounded border border-pink-700 bg-pink-900/30 px-3 py-1.5 text-xs font-medium text-pink-200 hover:bg-pink-900/50"
            >
              <Heart size={12} fill="currentColor" />
              GitHub Sponsors
              <ExternalLink size={10} />
            </button>
            <button
              onClick={() => openLink("https://ko-fi.com/storythreadstudio")}
              className="flex items-center justify-center gap-2 rounded border border-cyan-700 bg-cyan-900/30 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-900/50"
            >
              ☕ Ko-fi
              <ExternalLink size={10} />
            </button>
          </div>

          {/* Donor self-attest. Honor system. Toggling clears all donation
              prompts in the app and lights up the badge above. */}
          <div className="mt-3 rounded border border-border bg-bg-primary p-2.5 text-[11px] text-text-muted">
            {hasDonated ? (
              <div className="flex items-center justify-between gap-2">
                <span>Marked as donor.</span>
                <button
                  onClick={onUnmarkDonated}
                  className="text-faint underline hover:text-text-muted"
                  title="Remove donor flag (e.g. if set by mistake)"
                >
                  Unmark
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span>Already donated?</span>
                <button
                  onClick={onMarkDonated}
                  className="rounded border border-pink-700 bg-pink-900/30 px-2 py-0.5 text-pink-200 hover:bg-pink-900/50"
                >
                  Mark me as a donor
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Updates */}
        <div className="border-b border-border px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Updates
          </p>
          <button
            onClick={onCheckUpdates}
            disabled={checking}
            className="rounded border border-border bg-bg-primary px-3 py-1 text-xs text-text-primary hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? "Checking..." : "Check for updates"}
          </button>
          <p className="mt-1.5 text-[11px] text-faint">
            Storythread checks for updates on launch. You always confirm before
            anything downloads or installs.
          </p>
        </div>

        {/* Links + license */}
        <div className="px-5 py-4 text-xs">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Project
          </p>
          <div className="space-y-1">
            <button
              onClick={() => openLink("https://github.com/dataguydpeterson-cmyk/StorythreadStudio")}
              className="flex items-center gap-1 text-indigo-300 underline hover:text-indigo-200"
            >
              GitHub repository <ExternalLink size={10} />
            </button>
            <button
              onClick={() => openLink("https://github.com/dataguydpeterson-cmyk/StorythreadStudio/blob/main/CHANGELOG.md")}
              className="flex items-center gap-1 text-indigo-300 underline hover:text-indigo-200"
            >
              Changelog <ExternalLink size={10} />
            </button>
            <button
              onClick={() => openLink("https://github.com/dataguydpeterson-cmyk/StorythreadStudio/issues")}
              className="flex items-center gap-1 text-indigo-300 underline hover:text-indigo-200"
            >
              Report a bug or request a feature <ExternalLink size={10} />
            </button>
            <button
              onClick={() => openLink("https://github.com/dataguydpeterson-cmyk/StorythreadStudio/blob/main/LICENSE")}
              className="flex items-center gap-1 text-indigo-300 underline hover:text-indigo-200"
            >
              Apache License 2.0 <ExternalLink size={10} />
            </button>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Built with Tauri, React, CodeMirror, FastAPI, and OpenRouter.
          </p>
        </div>
      </div>
    </div>
  );
}
