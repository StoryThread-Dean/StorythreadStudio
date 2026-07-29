// features/audiobook/AudiobookDashboard.tsx
// ==========================================
// The Audiobook Converter's landing screen: New Audiobook, Open Existing
// Workspace, and the Recent Activity list. Visual identity per the spec
// (section 5.0): deep jewel tones on dark charcoal, each color carrying a
// meaning -- emerald = actions/success, sapphire = information/progress,
// ruby = costs/warnings/failures. Deliberately distinct from the writing
// app's palette so the writer always knows which side of the app they're in.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookHeadphones, FolderOpen, Plus, RefreshCw, X } from "lucide-react";

import { fetchProject, fetchRecents, removeRecent } from "./api";
import type { AudiobookProjectPayload, RecentAudiobook } from "./types";
import { AUDIOBOOK_STATUS_LABELS } from "./types";

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
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <BookHeadphones size={28} className="text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Audiobook Converter</h1>
          <p className="text-xs text-zinc-500">
            Convert manuscripts into MP3 and M4B audiobooks. Draft free with the
            local narrator; print with a premium voice when the book is final.
          </p>
        </div>
      </div>

      {/* Primary actions -- emerald = the main path forward */}
      <div className="mb-10 flex flex-wrap gap-3">
        <button
          onClick={onNewAudiobook}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          <Plus size={16} /> New Audiobook
        </button>
        <button
          onClick={() => void handleOpenExisting()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm text-zinc-200 transition-colors hover:border-emerald-600 hover:text-emerald-300"
        >
          <FolderOpen size={16} /> Open Existing Workspace
        </button>
      </div>

      {/* Recent activity */}
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
          No audiobooks yet. Import a manuscript to get started.
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
  );
}
