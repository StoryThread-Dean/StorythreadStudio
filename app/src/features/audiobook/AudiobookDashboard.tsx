// features/audiobook/AudiobookDashboard.tsx
// ==========================================
// The Audiobook Converter's landing screen, redesigned (spec 5.1.1,
// user-designed): the FIRST look teaches what this tool is and how the
// workflow runs. Left column: headline, the five-step workflow strip
// (hover a step to expand its plain-terms explanation; step 5 carries
// pricing honesty), one primary [Let's Get Started] action, and a quiet
// More menu hiding Open Existing Workspace. Right column: Recent
// Activity -- returning writers just click their book.
//
// Visual identity per spec 5.0: deep jewel tones on dark charcoal --
// emerald = actions/success, sapphire = information/progress, ruby =
// costs/warnings/failures. Deliberately distinct from the writing app's
// palette so the writer always knows which side of the app they're in.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookHeadphones, ChevronDown, FolderOpen, RefreshCw, Sparkles, X,
} from "lucide-react";

import { fetchProject, fetchRecents, removeRecent } from "./api";
import type { AudiobookProjectPayload, RecentAudiobook } from "./types";
import { AUDIOBOOK_STATUS_LABELS } from "./types";

// The five-step workflow strip: each step names itself; hovering (or
// focusing) expands the plain-terms detail. Wording kept simple on
// purpose -- this is the new writer's first thirty seconds.
const WORKFLOW_STEPS: Array<{ title: string; detail: string }> = [
  { title: "Load your book",
    detail: "Pick one of your Storythread books, or import a manuscript "
      + "from anywhere (DOCX, EPUB, Markdown, TXT). Your original file "
      + "is copied in and never modified." },
  { title: "Set up your workspace",
    detail: "The audiobook gets its own folder -- suggested "
      + "automatically, right next to a Storythread book. Text, audio, "
      + "and exports all live there." },
  { title: "Prepare your manuscript",
    detail: "A narration copy opens in the editor: add pauses and "
      + "pacing, fix pronunciations, let the Formatting Walkthrough "
      + "find the beats. Audible examples teach every marker." },
  { title: "Generate the free local version",
    detail: "The built-in narrator reads the whole book on your own "
      + "computer. Free, private, and unlimited -- draft until it "
      + "sounds right, then export MP3s and an M4B audiobook." },
  { title: "(Optional) Print a professional HQ version",
    detail: "When the draft is right, print the final audiobook with "
      + "premium AI voices. Honest pricing: hosted draft voices run "
      + "about half a dollar for a whole book; top-tier voices cost "
      + "meaningfully more. Arriving in the premium update -- you "
      + "will always see the price before anything is spent." },
];

interface AudiobookDashboardProps {
  /** Start the import wizard (New Audiobook). */
  onNewAudiobook: () => void;
  /** A workspace was opened (from Recents or the folder picker). */
  onOpenWorkspace: (payload: AudiobookProjectPayload) => void;
}

/** Status pill color by meaning: emerald done, sapphire active, ruby bad. */
function statusClasses(status: string): string {
  if (status === "completed") return "border-emerald-700 bg-emerald-950/60 text-emerald-300";
  if (status === "failed" || status === "export_only") return "border-rose-800 bg-rose-950/60 text-rose-300";
  if (status === "generating" || status === "paused") return "border-blue-800 bg-blue-950/60 text-blue-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

export function AudiobookDashboard({ onNewAudiobook, onOpenWorkspace }: AudiobookDashboardProps) {
  const [recents, setRecents] = useState<RecentAudiobook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadRecents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecents(await fetchRecents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load recent audiobooks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecents(); }, [loadRecents]);

  // Open a workspace: fetch its manifest + chapters, hand the payload up.
  const openWorkspacePath = useCallback(async (workspacePath: string) => {
    setBusyPath(workspacePath);
    setError(null);
    try {
      onOpenWorkspace(await fetchProject(workspacePath));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that workspace.");
    } finally {
      setBusyPath(null);
    }
  }, [onOpenWorkspace]);

  // "Open Existing Audiobook Workspace": native folder picker, then open.
  const handleOpenExisting = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Open an audiobook workspace folder",
    });
    if (typeof selected === "string" && selected) {
      await openWorkspacePath(selected);
    }
  }, [openWorkspacePath]);

  const handleRemove = useCallback(async (workspacePath: string) => {
    // Index row only -- the backend guarantees no files are touched.
    await removeRecent(workspacePath);
    void loadRecents();
  }, [loadRecents]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap gap-10 px-8 py-10">
      {/* Left: what this is, how it works, and the one way in. */}
      <div className="min-w-[20rem] flex-1">
        <div className="mb-6 flex items-center gap-3">
          <BookHeadphones size={28} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Audiobook Generator</h1>
            <p className="text-xs text-zinc-500">
              Turns your written book into AI-narrated audio.
            </p>
          </div>
        </div>

        {/* The five-step workflow strip: hover a step to expand it. */}
        <ol className="mb-6 space-y-1">
          {WORKFLOW_STEPS.map((step, index) => (
            <li key={step.title} className="group rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 transition-colors hover:border-blue-800 hover:bg-blue-950/20">
              <p className="flex items-center gap-2 text-sm text-zinc-200">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-blue-300 transition-colors group-hover:bg-blue-900 group-hover:text-blue-100">
                  {index + 1}
                </span>
                {step.title}
              </p>
              <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-28 group-hover:opacity-100 group-focus-within:max-h-28 group-focus-within:opacity-100">
                <p className="pb-1 pl-7 pt-1.5 text-xs leading-relaxed text-zinc-400">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* One primary action: the guided walkthrough that builds the
            workspace. Open Existing lives under the quiet More menu. */}
        <div className="flex items-start gap-3">
          <div>
            <button
              onClick={onNewAudiobook}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <Sparkles size={16} /> Let's Get Started
            </button>
            <p className="mt-1.5 text-[11px] text-zinc-500">
              A guided walkthrough -- it builds the workspace for you.
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setMoreOpen(v => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-3 py-3 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
            >
              More <ChevronDown size={12} />
            </button>
            {moreOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
                <button
                  onClick={() => { setMoreOpen(false); void handleOpenExisting(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800 hover:text-emerald-300"
                >
                  <FolderOpen size={13} /> Open Existing Workspace
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Recent Activity -- returning writers click their book. */}
      <div className="w-80 shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-blue-300">
            Recent Activity
          </h2>
          <button
            onClick={() => void loadRecents()}
            title="Refresh the list"
            className="rounded p-1 text-zinc-500 transition-colors hover:text-blue-300"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : recents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No audiobooks yet. Let's Get Started walks you through your
            first one.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/60">
            {recents.map(r => (
              <li key={r.workspace_path} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => void openWorkspacePath(r.workspace_path)}
                  disabled={busyPath !== null}
                  className="min-w-0 flex-1 text-left disabled:opacity-50"
                  title={r.workspace_path}
                >
                  <p className="truncate text-sm font-medium text-zinc-100 hover:text-emerald-300">
                    {r.title || "Untitled Audiobook"}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {r.author ? `${r.author} · ` : ""}{r.workspace_path}
                  </p>
                </button>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClasses(r.status)}`}>
                  {AUDIOBOOK_STATUS_LABELS[r.status] ?? r.status}
                </span>
                <button
                  onClick={() => void handleRemove(r.workspace_path)}
                  title="Remove from Recents (keeps all files on disk)"
                  className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:text-rose-400"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
