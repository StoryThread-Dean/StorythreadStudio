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
  fetchExportStatus, fetchFfmpegStatus, installFfmpeg, startExport,
} from "./api";
import type { ExportStatus, FfmpegStatus } from "./api";

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
    // Tauri's opener plugin routes the folder to Explorer; in a plain
    // browser (dev preview) we just do nothing beyond showing paths.
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openPath(`${workspacePath}\\output`);
    } catch { /* paths are listed below either way */ }
  }, [workspacePath]);

  const install = ffmpeg?.install;
  const installBusy = installing && install &&
    ["starting", "downloading", "verifying", "extracting"].includes(install.state);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
        <Package size={12} /> Export
      </h4>

      {/* Assembler missing: install first (one time, any audiobook). */}
      {ffmpeg && !ffmpeg.installed && (
        installBusy ? (
          <>
            <p className="mb-1 text-[11px] text-blue-300">
              {install.state === "downloading"
                ? `Downloading audio assembler... ${Math.round(install.progress * 100)}%`
                : install.state === "verifying" ? "Verifying download..."
                : "Installing..."}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-blue-500"
                   style={{ width: `${Math.round((install.progress ?? 0) * 100)}%` }} />
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-zinc-400">
              Exporting needs the audio assembler (FFmpeg) -- a one-time free
              download.
            </p>
            <button
              onClick={() => void handleInstall()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Install Audio Assembler
              <span className="font-normal opacity-75">(~{Math.round(ffmpeg.download_size_mb)} MB)</span>
            </button>
          </>
        )
      )}

      {/* Assembler present: formats + export. */}
      {ffmpeg?.installed && (
        <>
          <div className="mb-2 space-y-1">
            {FORMATS.map(format => (
              <label key={format.key} className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-300"
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
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Export Audiobook
            </button>
          )}

          {exportState && exportState.state !== "idle" && (
            <div className="mt-2">
              {exportActive && (
                <>
                  <p className="mb-1 text-[11px] text-blue-300">{exportState.message}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full bg-blue-500"
                         style={{ width: `${Math.round(exportState.progress * 100)}%` }} />
                  </div>
                </>
              )}
              {exportState.state === "done" && (
                <>
                  <p className="mb-1 text-[11px] text-emerald-300">{exportState.message}</p>
                  <ul className="mb-2 space-y-0.5">
                    {exportState.outputs.map(path => (
                      <li key={path} className="truncate text-[10px] text-zinc-500" title={path}>
                        {path}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => void openOutputFolder()}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-200 hover:border-emerald-600 hover:text-emerald-300"
                  >
                    <FolderOpen size={12} /> Open Output Folder
                  </button>
                </>
              )}
              {exportState.state === "error" && (
                <p className="rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
                  {exportState.error}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
