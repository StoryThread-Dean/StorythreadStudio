// hooks/useBackendHealth.ts -- Backend Reachability Hook
// =========================================================
// Returns whether the FastAPI backend is reachable on http://localhost:8000.
//
// Why this exists: when the backend isn't running, every API call the app
// makes fails with a generic "TypeError: Failed to fetch" that surfaces as
// a cryptic red banner in whichever feature the writer happened to click.
// This hook lets a top-level component show ONE clear, actionable banner
// ("The backend service isn't responding, is it running?") instead of the
// writer hunting through per-feature error messages.
//
// How it works:
//   - Pings GET /health every `intervalMs` milliseconds (default 10s).
//   - Also pings once immediately on mount so the banner can appear before
//     the writer clicks anything.
//   - When a ping succeeds after a prior failure, the banner auto-clears.
//
// The ping has a short per-request timeout via AbortController so a slow
// backend doesn't pile up pending requests. The fetch is kept lightweight
// so this hook is safe to mount for the entire lifetime of the app.

import { useEffect, useState } from "react";


const API_BASE = "http://localhost:8000";


export interface BackendHealth {
  /** True once at least one successful ping has completed. Lets the app wait
   *  before the first render, if desired, to avoid a flash of the banner on
   *  cold start when the backend takes a moment to come up. */
  hasEverConnected: boolean;

  /** True when the most recent ping failed (or hasn't happened yet). */
  isDown: boolean;

  /** Timestamp (ms) of the most recent successful ping. null if never. */
  lastSeen: number | null;
}


export function useBackendHealth(intervalMs: number = 10_000): BackendHealth {
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [isDown,           setIsDown]           = useState(true);
  const [lastSeen,         setLastSeen]         = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer:    ReturnType<typeof setTimeout> | null = null;

    const ping = async () => {
      // Per-request timeout: abort after 3s so we don't pile up slow requests
      // when the backend is genuinely gone.
      const ac = new AbortController();
      const cutoff = setTimeout(() => ac.abort(), 3000);
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: ac.signal });
        if (!cancelled && res.ok) {
          setIsDown(false);
          setLastSeen(Date.now());
          setHasEverConnected(true);
        } else if (!cancelled) {
          setIsDown(true);
        }
      } catch {
        if (!cancelled) setIsDown(true);
      } finally {
        clearTimeout(cutoff);
      }

      // Schedule the next ping only if we're still mounted.
      if (!cancelled) {
        timer = setTimeout(ping, intervalMs);
      }
    };

    // Fire the first ping immediately, then let it reschedule itself.
    void ping();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { hasEverConnected, isDown, lastSeen };
}
