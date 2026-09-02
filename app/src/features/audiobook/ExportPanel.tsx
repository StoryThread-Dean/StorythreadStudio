// features/audiobook/ExportPanel.tsx
// ===================================
// The export block in the Narration rail: pick formats (chapter MP3s /
// combined MP3 / M4B), Export, watch mastering progress, then open the
// output folder. If the audio assembler (FFmpeg) isn't installed yet, an
// Install button appears first -- same component-manager flow as the
// narrator engine. Jewel semantics: emerald action, sapphire progress,
// ruby errors.

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, Package } from "lucide-react";

import {
  fetchExportStatus, fetchFfmpegStatus, fetchStorage, formatBytes, installFfmpeg,
  runCleanup, startExport,
} from "./api";
import type { ExportStatus, FfmpegStatus, StorageReport } from "./api";
import { StorageDialog } from "./StorageDialog";

// What "delete the intermediate audio" means in practice: the narrated
// segments plus the disposable leftovers. Never the source snapshot, and
// obviously never the exports that just succeeded.
const INTERMEDIATE = ["current_segments", "superseded", "previews", "failed_attempts"];

const FORMATS: { key: string; label: string; hint: string }[] = [
  { key: "chapter_mp3", label: "Chapter MP3s",
    hint: "One tagged MP3 per chapter (192 kbps, audiobook-store quality)" },
  { key: "combined_mp3", label: "Combined MP3",
    hint: "The whole book as a single MP3" },
  { key: "m4b", label: "M4B audiobook",
    hint: "The audiobook format: chapter markers, works in every audiobook player" },
];

export function ExportPanel({ workspacePath }: { workspacePath: string }) {
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [formats, setFormats] = useState<string[]>(["chapter_mp3", "combined_mp3", "m4b"]);
  const [exportState, setExportState] = useState<ExportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  // The completion prompt (spec 25.2). Only ever set for a book whose
  // retention is "ask", and cleared the moment the writer answers.
  const [prompt, setPrompt] = useState<StorageReport | null>(null);
  const [reclaimed, setReclaimed] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  // One prompt per finished export, not one per poll tick.
  const promptedFor = useRef<string>("");

  const refreshFfmpeg = useCallback(async () => {
    try { setFfmpeg(await fetchFfmpegStatus()); } catch { /* banner covers it */ }
  }, []);

  useEffect(() => { void refreshFfmpeg(); }, [refreshFfmpeg]);

  // Poll the assembler install while it runs.
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(async () => {
      try {
        const fresh = await fetchFfmpegStatus();
        setFfmpeg(fresh);
        if (fresh.install.state === "done" || fresh.installed) {
          window.clearInterval(timer);
          setInstalling(false);
        } else if (fresh.install.state === "error") {
          window.clearInterval(timer);
          setInstalling(false);
          setError(fresh.install.error ?? "Assembler install failed.");
        }
      } catch { /* keep polling */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [installing]);

  // Poll the export while it runs.
  const exportActive = exportState?.state === "starting" || exportState?.state === "running";
  useEffect(() => {
    if (!exportActive) {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    pollTimer.current = window.setInterval(async () => {
      try { setExportState(await fetchExportStatus()); } catch { /* banner */ }
    }, 1000);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [exportActive]);

  // ── After a successful export (spec 25.1-25.2) ─────────────────────────
  // Retention is the writer's standing answer to "do I still need the
  // segment files?". Keep = say nothing. Delete = act, then REPORT it,
  // because silently reclaiming gigabytes is indistinguishable from a bug.
  // Ask = show the size and let them decide with the number in front of
  // them.
  const deleteIntermediate = useCallback(async () => {
    setPrompt(null);
    try {
      const result = await runCleanup(workspacePath, INTERMEDIATE);
      setReclaimed(`Segment files deleted -- ${formatBytes(result.freed_bytes)} reclaimed. `
        + `The exported audiobook is untouched.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the segment files.");
    }
  }, [workspacePath]);

  useEffect(() => {
    if (exportState?.state !== "done") return;
    const stamp = exportState.outputs.join("|");
    if (promptedFor.current === stamp) return;
    promptedFor.current = stamp;
    void (async () => {
      try {
        const report = await fetchStorage(workspacePath);
        if (report.retention === "ask_after_export") setPrompt(report);
        else if (report.retention === "delete_after_export") await deleteIntermediate();
      } catch { /* the export itself succeeded; this is a follow-up */ }
    })();
  }, [exportState, workspacePath, deleteIntermediate]);

  const handleInstall = useCallback(async () => {
    setError(null);
    try {
      await installFfmpeg();
      setInstalling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed to start.");
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (busy || formats.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await startExport(workspacePath, formats);
      setExportState(await fetchExportStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed to start.");
    } finally {
      setBusy(false);
    }
  }, [busy, formats, workspacePath]);

  const openOutputFolder = useCallback(async () => {
    // Tauri's opener plugin routes the folder to Explorer. openPath
    // needs the opener:allow-open-path capability (live bug: the
    // default opener permission covers URLs only, and the old silent
    // catch made the button a no-op). Failures now SAY so -- the output
    // paths are listed below as the fallback either way.
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openPath(`${workspacePath}\\output`);
    } catch (e) {
      setError("Could not open the folder"
        + (e instanceof Error && e.message ? ` (${e.message})` : "")
        + " -- the exported files are at the paths listed above.");
    }
  }, [workspacePath]);

  const install = ffmpeg?.install;
  const installBusy = installing && install &&
    ["starting", "downloading", "verifying", "extracting"].includes(install.state);

  return (
    <div className="rounded-lg border border-border bg-bg-panel/40 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-mini font-semibold uppercase tracking-wider text-secondary">
        <Package size={12} /> Export
      </h4>

      {/* Assembler missing: install first (one time, any audiobook). */}
      {ffmpeg && !ffmpeg.installed && (
        installBusy ? (
          <>
            <p className="mb-1 text-mini text-secondary">
              {install.state === "downloading"
                ? `Downloading audio assembler... ${Math.round(install.progress * 100)}%`
                : install.state === "verifying" ? "Verifying download..."
                : "Installing..."}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-surface">
              <div className="h-full bg-secondary-fill"
                   style={{ width: `${Math.round((install.progress ?? 0) * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-mini text-text-muted">
              Exporting needs the audio assembler (FFmpeg) -- a one-time free
              download.
            </p>
            <button
              onClick={() => void handleInstall()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-fill"
            >
              Install Audio Assembler
              <span className="font-normal">(~{Math.round(ffmpeg.download_size_mb)} MB)</span>
            </button>
          </>
        )
      )}

      {/* Assembler present: formats + export. */}
      {ffmpeg?.installed && (
        <>
          <div className="mb-2 space-y-1">
            {FORMATS.map(format => (
              <label key={format.key} className="flex cursor-pointer items-start gap-2 text-mini text-text-primary"
                     title={format.hint}>
                <input
                  type="checkbox"
                  checked={formats.includes(format.key)}
                  onChange={e => setFormats(prev =>
                    e.target.checked ? [...prev, format.key]
                                     : prev.filter(f => f !== format.key))}
                  className="mt-0.5"
                />
                {format.label}
              </label>
            ))}
          </div>

          {!exportActive && (
            <button
              onClick={() => void handleExport()}
              disabled={busy || formats.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-fill px-4 py-2 text-xs font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Export Audiobook
            </button>
          )}

          {exportState && exportState.state !== "idle" && (
            <div className="mt-2">
              {exportActive && (
                <>
                  <p className="mb-1 text-mini text-secondary">{exportState.message}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-surface">
                    <div className="h-full bg-secondary-fill"
                         style={{ width: `${Math.round(exportState.progress * 100)}%` }} />
                  </div>
                </>
              )}
              {exportState.state === "done" && (
                <>
                  <p className="mb-1 text-mini text-accent">{exportState.message}</p>
                  <ul className="mb-2 space-y-0.5">
                    {exportState.outputs.map(path => (
                      <li key={path} className="truncate text-micro text-faint" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => void openOutputFolder()}
                    className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-mini text-text-primary hover:border-accent-fill hover:text-accent"
                  >
                    <FolderOpen size={12} /> Open Output Folder
                  </button>
                </>
              )}
              {exportState.state === "error" && (
                <p className="rounded border border-danger-fill bg-danger-soft px-2 py-1.5 text-micro text-danger">
                  {exportState.error}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Spec 25.2: the completion prompt, shown only when the writer
          asked to be asked. The size leads, because that is the whole
          reason anyone considers deleting. */}
      {prompt && (
        <div className="mt-2 rounded border border-secondary-fill bg-secondary-soft px-2.5 py-2">
          <p className="text-mini font-medium text-secondary-strong">
            Export complete.
          </p>
          <p className="mt-1 text-micro leading-relaxed text-secondary-strong/80">
            Intermediate generation files use{" "}
            {formatBytes(prompt.categories
              .filter(c => INTERMEDIATE.includes(c.key))
              .reduce((sum, c) => sum + c.bytes, 0))}
            . Keeping them lets you fix one paragraph, or re-export in
            another format, without narrating the book again.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => setPrompt(null)}
              className="rounded bg-accent-fill px-2.5 py-1 text-mini font-semibold text-white hover:bg-accent-fill"
            >
              Keep Files
            </button>
            <button
              onClick={() => void deleteIntermediate()}
              className="rounded border border-border-strong px-2.5 py-1 text-mini text-text-primary hover:border-danger-fill hover:text-danger"
            >
              Delete Segment Files
            </button>
            <button
              onClick={() => { setPrompt(null); setStorageOpen(true); }}
              className="rounded border border-border px-2.5 py-1 text-mini text-text-primary hover:border-secondary-fill hover:text-secondary"
            >
              Review Storage
            </button>
          </div>
        </div>
      )}

      {reclaimed && (
        <p className="mt-2 rounded border border-border bg-bg-panel px-2 py-1.5 text-micro leading-relaxed text-text-primary">
          {reclaimed}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded border border-danger-fill bg-danger-soft px-2 py-1.5 text-micro text-danger">
          {error}
        </p>
      )}

      {storageOpen && (
        <StorageDialog
          workspacePath={workspacePath}
          onClose={() => setStorageOpen(false)}
        />
      )}
    </div>
  );
}
