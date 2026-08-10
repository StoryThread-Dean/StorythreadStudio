// features/codex/WeaveScreen.tsx -- the Weave, opened
// ====================================================
// The shell that holds the two ways of reading a world: the map, and the
// list. They are peers, not a view and its fallback -- see WeaveList for
// why that distinction is load-bearing -- so the toggle between them is
// plain and neither is labelled "accessible mode".
//
// This is also where the Weave admits what state it is in. A project that
// has never been converted needs a different screen from one whose
// conversion died halfway, and both need a different screen from a working
// world. Guessing between them, or showing an empty map for all three,
// would be the most confusing thing this feature could do.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, List, Loader, Network, RefreshCw } from "lucide-react";

import { WhatsThis } from "../../components/learn/WhatsThis";
import { CONCEPTS } from "./lexicon";
import { MigrationPanel } from "./MigrationPanel";
import { WeaveList } from "./WeaveList";
import { WeaveMap } from "./WeaveMap";
import { fetchHealth, reindex, type WeaveHealth } from "./api";
import type { Point } from "./layout";

interface WeaveScreenProps {
  projectPath: string;
  /** Dragged node positions, from per-book UI state. Optional: the map works
   *  without them, it just cannot remember where you put things. */
  pinned?: Record<string, Point>;
  onPin?: (positions: Record<string, Point>) => void;
  onOpenThread?: (entityId: string) => void;
}

export function WeaveScreen({ projectPath, pinned, onPin, onOpenThread }: WeaveScreenProps) {
  const [view, setView] = useState<"map" | "list">("map");
  const [health, setHealth] = useState<WeaveHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await fetchHealth(projectPath));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the Weave.");
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void check(); }, [check]);

  async function rebuild() {
    setBusy(true);
    try {
      await reindex(projectPath);
      await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuild the index.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-6 text-xs text-faint">
        <Loader size={12} className="animate-spin" /> Opening the Weave...
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="weave-screen">

      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Network size={15} className="text-violet-300" />
          The Weave
        </h2>

        {/* Neither is the "real" one. Two ways of reading, plainly offered. */}
        <div className="flex overflow-hidden rounded border border-border" role="tablist">
          <button
            type="button" role="tab" aria-selected={view === "map"}
            onClick={() => setView("map")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] ${
              view === "map" ? "bg-violet-600 text-white" : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Network size={11} /> Map
          </button>
          <button
            type="button" role="tab" aria-selected={view === "list"}
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] ${
              view === "list" ? "bg-violet-600 text-white" : "text-text-muted hover:text-text-primary"
            }`}
          >
            <List size={11} /> List
          </button>
        </div>

        <div className="ml-auto">
          <WhatsThis label="What is the Weave?">
            {CONCEPTS.weave.whatsThis}
          </WhatsThis>
        </div>
      </header>

      {error && (
        <p className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle size={12} className="mr-1.5 inline" />{error}
        </p>
      )}

      {/* Each state gets its own screen, because each needs a different
          decision from the writer. */}
      {health?.registry_ok === false ? (
        <Broken health={health} />
      ) : health?.migration_state === "incomplete"
          || health?.migration_state === "none" ? (
        // Both states are the same conversation with the writer, and both
        // used to be a paragraph with nothing to press. The panel does the
        // dry run, itemises it, and offers the choice -- including resume or
        // restore when a previous attempt stopped part way.
        <MigrationPanel
          projectPath={projectPath}
          state={health.migration_state}
          onChanged={() => void check()}
        />
      ) : (
        <>
          {health?.index_dirty && (
            <p className="flex flex-wrap items-center gap-2 rounded border border-amber-700/60 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-200/90">
              <AlertTriangle size={11} className="text-amber-400/80" />
              Your files have changed since the Weave last read them, so it is
              re-reading as you look.
              <button type="button" onClick={() => void rebuild()} disabled={busy}
                      className="inline-flex items-center gap-1 rounded border border-amber-700/60 px-1.5 py-0.5 hover:text-amber-100 disabled:opacity-50">
                <RefreshCw size={10} className={busy ? "animate-spin" : ""} /> Re-read now
              </button>
            </p>
          )}

          {view === "map"
            ? <WeaveMap projectPath={projectPath} pinned={pinned} onPin={onPin}
                        onOpenThread={onOpenThread} />
            : <WeaveList projectPath={projectPath} onOpenThread={onOpenThread} />}
        </>
      )}
    </div>
  );
}




function Broken({ health }: { health: WeaveHealth }) {
  // The types file is the writer's own data once they customise it, so it is
  // never repaired or replaced -- only reported, with the line to look at.
  return (
    <div className="rounded border border-rose-800 bg-rose-950/40 px-4 py-4">
      <p className="flex items-center gap-2 text-sm text-rose-100">
        <AlertTriangle size={14} /> The Weave's types file could not be read.
      </p>
      <p className="mt-1 max-w-xl text-xs text-rose-200/80">
        It has been left exactly as it is -- nothing was changed or replaced.
        Fix the line named below and reopen.
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-black/40 px-2 py-1 text-[11px] text-rose-200">
        {health.registry_error}
      </pre>
    </div>
  );
}
