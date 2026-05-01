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

import { useEffect, useRef, useState } from "react";


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

  // Track the *previous* up/down state in a ref so we can detect transitions
  // without triggering a re-render every poll. Without this, calling
  // setLastSeen(Date.now()) on every successful ping fires a state update
  // every 10s, which cascades a full App re-render and tears down DOM nodes
  // in the AI chat panel -- killing any text the writer had selected to copy.
  // We only need to bump state when the up/down status actually changes.
  const wasDownRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let timer:    ReturnType<typeof setTimeout> | null = null;

    const ping = async () => {
      // Per-request timeout: abort after 3s so we don't pile up slow requests
      // when the backend is genuinely gone.
      const ac = new AbortController();
      const cutoff = setTimeout(() => ac.abort(), 3000);
      let ok = false;
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: ac.signal });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(cutoff);
      }

      if (!cancelled) {
        if (ok) {
          // Successful ping. Only flip state on a real down -> up transition.
          // If the backend has been up the whole time, do nothing -- this is
          // the steady-state path and must not re-render.
          if (wasDownRef.current) {
            wasDownRef.current = false;
            setIsDown(false);
            setLastSeen(Date.now());
            setHasEverConnected(true);
          }
        } else {
          // Failed ping. Only flip on the up -> down transition.
          if (!wasDownRef.current) {
            wasDownRef.current = true;
            setIsDown(true);
          }
        }

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
