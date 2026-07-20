// hooks/useProjectUiState.ts -- Per-Book Remembered UI State
// ============================================================
// Some sidebar details should follow the BOOK, not the machine: which
// sections the writer collapsed, whether Book Details is open, which acts
// are folded. This hook syncs a small state object with the backend's
// GET/PUT /api/projects/ui-state, which stores it inside the project folder
// (.storythread/ui-state.json) -- so it survives app restarts, app updates,
// and even moving the project folder to another machine.
//
// Design notes:
//   - Optimistic updates: update() merges the patch into local state
//     immediately, then schedules a debounced PUT (800ms). Rapid clicking
//     collapses into one write.
//   - The `loaded` guard: we NEVER PUT before the initial GET resolves.
//     Without it, a toggle during startup could overwrite the saved state
//     with the empty default -- wiping the writer's remembered layout.
//   - Deliberately NOT persisted here: expandedChapters/expandedSceneGroups.
//     Those Sets are keyed by chapter filename; renames and deletes would
//     strand stale keys. Session-only is the existing behavior and is fine.
//   - Errors are swallowed: UI-state is a nicety. If the backend is down
//     the app must behave exactly as if there were no saved state.

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

// The shape is intentionally loose (all optional): keys come and go with UI
// iterations, and unknown keys from a newer app version must not crash an
// older one. Garbage state degrades to defaults, never to an error.
export interface ProjectUiState {
  profilesCollapsed?: boolean;
  notesCollapsed?:    boolean;
  collapsedActs?:     string[];   // act ids from manuscript/structure.json
}

const DEBOUNCE_MS = 800;

export function useProjectUiState(projectPath: string | null): {
  uiState: ProjectUiState;
  loaded: boolean;
  update: (patch: Partial<ProjectUiState>) => void;
} {
  const [uiState, setUiState] = useState<ProjectUiState>({});
  const [loaded,  setLoaded]  = useState(false);

  // Refs mirror the pieces the debounced writer needs without making the
  // update() callback identity change on every state change.
  const stateRef  = useRef<ProjectUiState>({});
  const loadedRef = useRef(false);
  const pathRef   = useRef<string | null>(projectPath);
  const timerRef  = useRef<number | null>(null);

  stateRef.current  = uiState;
  loadedRef.current = loaded;
  pathRef.current   = projectPath;

  // ── Initial load: reset + GET whenever the project changes ──────────────
  useEffect(() => {
    // Switching books: drop the old book's state and pause writes until the
    // new book's saved state arrives (the `loaded` guard).
    setUiState({});
    setLoaded(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!projectPath) return;

    let cancelled = false;
    fetch(`${API_BASE}/api/projects/ui-state?root_path=${encodeURIComponent(projectPath)}`)
      .then(r => (r.ok ? r.json() : { state: {} }))
      .then(data => {
        if (cancelled) return;
        const state = data && typeof data.state === "object" && data.state !== null
          ? (data.state as ProjectUiState)
          : {};
        setUiState(state);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Backend unreachable: run with defaults, but mark loaded so the
        // writer's toggles this session still persist once it's back.
        setUiState({});
        setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [projectPath]);

  // ── Debounced writer ─────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const path = pathRef.current;
      if (!path || !loadedRef.current) return;
      fetch(`${API_BASE}/api/projects/ui-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_path: path, state: stateRef.current }),
      }).catch(() => {
        // Nicety only -- a failed save just means this toggle isn't
        // remembered next session. No error surface.
      });
    }, DEBOUNCE_MS);
  }, []);

  const update = useCallback((patch: Partial<ProjectUiState>) => {
    // Merge-not-replace so independent toggles never clobber each other.
    setUiState(prev => ({ ...prev, ...patch }));
    // Only write once the saved state has been read (see `loaded` guard).
    if (loadedRef.current) scheduleSave();
  }, [scheduleSave]);

  return { uiState, loaded, update };
}
