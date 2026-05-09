// hooks/useFreshVersion.ts -- Detect first run after an update
// =================================================================
// Compares the running app version with the most recently seen version
// in localStorage. If they differ, this is the first launch on a fresh
// version -- the writer should see the post-update "what's new" banner.
//
// Why a hook instead of a one-shot util? React mount ordering matters:
// the App.tsx tree mounts top-down, and we want the banner to appear
// as soon as we know the version mismatch. The hook fires once on mount,
// records the new version into localStorage atomically, and exposes
// `isFreshVersion` to consumers.
//
// In dev, `getVersion()` returns the version from package.json or
// tauri.conf.json depending on how Vite resolved it. We treat dev
// builds the same as prod for this purpose -- if a developer bumps
// the version locally and re-launches, the post-update banner fires
// just like it would for an end user, which is useful for testing the
// banner content without going through a full release.

import { useEffect, useState } from "react";


const LAST_SEEN_VERSION_KEY = "storythread.app.lastSeenVersion";


export interface UseFreshVersionResult {
  // The currently-running app version (e.g. "1.2.0"), or null until loaded.
  currentVersion: string | null;
  // The previous version the writer ran before this launch, or null if
  // this is a brand-new install with no record.
  previousVersion: string | null;
  // True when previousVersion exists, is different from currentVersion,
  // AND is older (semver-comparable). Stays true until acknowledge() is
  // called -- typically wired to the banner's "Got it" button.
  isFreshVersion: boolean;
  // Mark the new version as seen. Clears isFreshVersion. Idempotent.
  acknowledge:    () => void;
}


// Lightweight semver comparison. Handles "1.2.0" vs "1.10.0" correctly
// (numeric segments, not lexicographic). Returns -1/0/1. Treats invalid
// inputs as equal to avoid spurious banners.
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (Number.isNaN(va) || Number.isNaN(vb)) return 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}


export function useFreshVersion(): UseFreshVersionResult {
  const [currentVersion, setCurrentVersion]   = useState<string | null>(null);
  const [previousVersion, setPreviousVersion] = useState<string | null>(null);
  const [isFreshVersion, setIsFreshVersion]   = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      // Tauri ships getVersion(); in non-Tauri previews we fall back to a
      // hardcoded "0.0.0" so the hook doesn't crash. The fall-back is
      // unreachable in the normal app shell.
      let version = "0.0.0";
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        version = await getVersion();
      } catch {
        // Non-Tauri context. Leave default.
      }
      if (cancelled) return;

      const stored = window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
      setCurrentVersion(version);
      setPreviousVersion(stored);

      // Fresh version criteria:
      //   - We have a stored previous version (not a first-ever install).
      //     First install gets a clean welcome elsewhere; the post-update
      //     banner is for upgrades, not introductions.
      //   - The stored version differs from the current one.
      //   - The current one is NEWER (downgrades shouldn't fire the banner;
      //     they're rare but possible if a user installs an older release).
      if (stored && stored !== version && compareSemver(stored, version) < 0) {
        setIsFreshVersion(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);


  // The banner consumer calls this after the writer acknowledges. We update
  // localStorage so the banner doesn't reappear on the NEXT launch.
  const acknowledge = () => {
    if (typeof window === "undefined" || !currentVersion) return;
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
    setIsFreshVersion(false);
  };

  return { currentVersion, previousVersion, isFreshVersion, acknowledge };
}
