// hooks/useAppUpdate.ts -- Auto-update orchestration
// =====================================================
// Wraps Tauri's @tauri-apps/plugin-updater into a React-friendly hook.
// On app launch (production builds only), checks the configured GitHub
// Releases endpoint for a new version. If one is available, exposes:
//   - the version, release date, and Markdown notes
//   - a downloadAndInstall() action the writer triggers explicitly
//   - download progress and lifecycle events
//
// We deliberately do NOT auto-download. Tauri's plugin makes that easy
// (a single call), but the product's principle is that updates require
// explicit consent. The hook surfaces availability; the UI decides when
// to prompt; the writer chooses when to download and install.
//
// Why production-only? In dev builds (`tauri dev`), the bundled binary
// isn't signed and the updater plugin will throw on the verify step.
// Skipping the check entirely keeps dev quiet.

import { useEffect, useState, useCallback, useRef } from "react";


// ── Types ────────────────────────────────────────────────────────────────────

// Mirrors the Update object returned by Tauri's plugin-updater. We keep our
// own narrowed type so the component code doesn't have to know about Tauri
// internals -- and so swapping out the underlying mechanism later (e.g. if
// we move off Tauri's bundled updater) doesn't ripple through every consumer.
export interface AvailableUpdate {
  version:      string;        // "1.2.0"
  currentVersion: string;      // "1.1.0" (what we're upgrading FROM)
  date:         string | null; // ISO release date, if the manifest had one
  notes:        string;        // Markdown body of the release notes
}

// Lifecycle state. The hook starts in "idle" before the first check, moves
// to "checking" on launch, then "available" / "up-to-date" / "error". The
// writer's click flips it to "downloading" -> "installing" -> "ready" (next
// step is a relaunch, which the hook does not perform autonomously).
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";


// Download progress in bytes. percent is 0..1; null when total size unknown
// (Tauri occasionally can't report contentLength on slow CDN responses).
export interface DownloadProgress {
  downloaded: number;
  total:      number | null;
  percent:    number | null;
}


export interface UseAppUpdateResult {
  status:              UpdateStatus;
  update:              AvailableUpdate | null;
  error:               string | null;
  progress:            DownloadProgress | null;
  // Manually re-check (e.g. from a "Check for updates" button in About).
  // The launch-time check fires automatically; this is for explicit user
  // request after that.
  checkAgain:          () => Promise<void>;
  // Begin the download + install. Throws if no update is available.
  // After this completes successfully, the caller should call relaunch().
  downloadAndInstall:  () => Promise<void>;
  // Trigger an app relaunch (post-install). Wraps the process plugin so
  // the consumer doesn't have to import it separately.
  relaunch:            () => Promise<void>;
}


// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAppUpdate(): UseAppUpdateResult {
  const [status, setStatus]     = useState<UpdateStatus>("idle");
  const [update, setUpdate]     = useState<AvailableUpdate | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // Hold the live Tauri Update object across calls. The downloadAndInstall
  // call below needs the same object that came back from check(), and we
  // can't store a non-serializable Tauri handle in React state without
  // tripping the dev-mode warning, so a ref is the right home.
  const tauriUpdateRef = useRef<{ downloadAndInstall: (cb?: (e: unknown) => void) => Promise<void> } | null>(null);


  // Wraps Tauri's updater.check() with our state transitions and the
  // production-only guard. Returns the parsed AvailableUpdate (or null).
  const runCheck = useCallback(async (): Promise<AvailableUpdate | null> => {
    setStatus("checking");
    setError(null);

    // Skip the check entirely in dev. The updater plugin throws on dev
    // builds because the binary isn't signed; we'd see "no signature"
    // errors in the console every launch otherwise.
    // import.meta.env.PROD is set by Vite; true in `tauri build`, false in dev.
    if (!import.meta.env.PROD) {
      setStatus("up-to-date");
      return null;
    }

    try {
      // Dynamic import so dev builds don't even load the plugin module.
      // (The module loads happily in dev too, but skipping the import
      // keeps the dev bundle leaner and the network panel quieter.)
      const { check } = await import("@tauri-apps/plugin-updater");
      const { getVersion } = await import("@tauri-apps/api/app");
      const currentVersion = await getVersion();
      const result = await check();

      if (result === null) {
        setStatus("up-to-date");
        return null;
      }

      // result.available is true; package the fields we care about.
      const parsed: AvailableUpdate = {
        version:        result.version,
        currentVersion,
        date:           result.date ?? null,
        notes:          result.body ?? "",
      };
      tauriUpdateRef.current = result;
      setUpdate(parsed);
      setStatus("available");
      return parsed;
    } catch (err) {
      // Common failure modes: GitHub URL 404 (no releases yet), network
      // error, signature verify failure (key mismatch). We surface a
      // human-readable message; the hook stays in "error" until the next
      // checkAgain() call.
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      return null;
    }
  }, []);


  // Run a single check on mount. Subsequent re-mounts (e.g. dev hot
  // reloads) will run again, but in production the app is mounted once
  // per launch so this fires exactly once.
  useEffect(() => {
    void runCheck();
  }, [runCheck]);


  const checkAgain = useCallback(async () => {
    setUpdate(null);
    tauriUpdateRef.current = null;
    await runCheck();
  }, [runCheck]);


  const downloadAndInstall = useCallback(async () => {
    const handle = tauriUpdateRef.current;
    if (!handle) {
      throw new Error("No update available to download.");
    }
    setStatus("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: null, percent: null });

    try {
      let downloaded = 0;
      let total: number | null = null;

      // Tauri's plugin emits three lifecycle events: Started (with optional
      // contentLength), Progress (chunkLength), Finished. We translate
      // those into our own DownloadProgress and UpdateStatus values.
      await handle.downloadAndInstall((eventRaw: unknown) => {
        const event = eventRaw as { event: string; data?: { contentLength?: number; chunkLength?: number } };
        if (event.event === "Started") {
          total = event.data?.contentLength ?? null;
          setProgress({ downloaded: 0, total, percent: total ? 0 : null });
        } else if (event.event === "Progress") {
          downloaded += event.data?.chunkLength ?? 0;
          const percent = total ? downloaded / total : null;
          setProgress({ downloaded, total, percent });
        } else if (event.event === "Finished") {
          setProgress({ downloaded, total, percent: 1 });
          setStatus("installing");
        }
      });

      // downloadAndInstall returns AFTER the installer applied the new
      // bundle; the binary on disk is now the new version. The next
      // step is a relaunch, but we leave that to the caller so they can
      // show a "Restart now" button rather than hard-cutting the user.
      setStatus("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
    }
  }, []);


  const relaunch = useCallback(async () => {
    if (!import.meta.env.PROD) return;
    const { relaunch: tauriRelaunch } = await import("@tauri-apps/plugin-process");
    await tauriRelaunch();
  }, []);


  return { status, update, error, progress, checkAgain, downloadAndInstall, relaunch };
}
