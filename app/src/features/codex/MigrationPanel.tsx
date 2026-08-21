// features/codex/MigrationPanel.tsx -- bringing a project into the Weave
// =======================================================================
// The most dangerous button in the programme. It reads the writer's profile
// files and writes a new folder from them, and it is the reason the whole
// Weave ships as one release rather than three: somebody who converts
// halfway cannot easily go back.
//
// SO THE SHAPE OF THIS SCREEN IS THE SAFETY, NOT A DIALOG AROUND IT
// -----------------------------------------------------------------
// 1. THE DRY RUN COMES FIRST AND IS NOT OPTIONAL. It runs on mount, touches
//    nothing, and its report IS this screen. There is no path to the real
//    conversion that does not pass through reading what it intends to do.
//
// 2. EVERY NUMBER IS ITEMISED. "Convert 14 files" is not consent. Which
//    folders, how many in each, what is being skipped and why, what cannot be
//    converted at all, and where the backup goes -- all before the button.
//
// 3. THE BACKUP IS NAMED BEFORE, NOT AFTER. A writer should be able to go and
//    look at the folder path with their own file manager while deciding.
//
// 4. AN INTERRUPTED RUN IS A CHOICE, NEVER A GUESS. Success is never inferred
//    from the codex folder existing -- a half-finished conversion produces
//    that too. The writer picks up or puts back; the app does not decide.
//
// 5. NOTHING IS PROMISED THAT WAS NOT DONE. The report afterwards states what
//    was converted and repeats every warning, including the ones that were
//    already on screen. A conversion that quietly dropped something the
//    preview mentioned would be the worst outcome here.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, FolderInput, Info, Loader, RotateCcw,
} from "lucide-react";

import { MigrationResults, type MigrationReport } from "./MigrationResults";

const API_BASE = "http://localhost:8000";

interface FolderPlan {
  folder: string;
  type?: string;
  count: number;
  files?: string[];
  reason?: string;
}

interface Plan {
  state: "none" | "incomplete" | "done";
  backup_path: string;
  convert: FolderPlan[];
  arcs: { type: string; count: number; files: string[] }[];
  skipped: FolderPlan[];
  unconvertible: { folder: string; file?: string; reason: string }[];
  warnings: string[];
  total: number;
}

interface Result {
  status: "migrated" | "already-migrated" | "incomplete" | "restored"
        | "nothing-to-restore";
  converted?: number;
  arcs_absorbed?: number;
  backup_path?: string | null;
  warnings?: string[];
  unconvertible?: { folder: string; file?: string; reason: string }[];
  entries?: { type: string; name: string; entity_id: string; filename: string;
              source: string; converted_to: string }[];
}

interface MigrationPanelProps {
  projectPath: string;
  /** Whether a previous run was interrupted, from /health. The panel does not
   *  work this out for itself -- one source of truth for that question. */
  state: "none" | "incomplete" | "done";
  /** Called after a successful conversion or restore, so the screen around
   *  this one can re-read the world. */
  onChanged: () => void;
}

export function MigrationPanel({ projectPath, state, onChanged }: MigrationPanelProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "convert" | "resume" | "restore">("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);

  const preview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // dry_run defaults to true server-side as well. Sent explicitly anyway:
      // a client that forgot it must not be the reason a project is rewritten.
      const response = await fetch(
        `${API_BASE}/api/codex/migrate?project_path=${encodeURIComponent(projectPath)}`
        + "&dry_run=true", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail?.message ?? "Could not read the project.");
      setPlan(body as Plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the project.");
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void preview(); }, [preview]);

  async function act(what: "convert" | "resume" | "restore") {
    setBusy(what);
    setError(null);
    try {
      const path = what === "restore"
        ? `/api/codex/migrate/restore?project_path=${encodeURIComponent(projectPath)}`
        : `/api/codex/migrate?project_path=${encodeURIComponent(projectPath)}`
          + `&dry_run=false${what === "resume" ? "&resume=true" : ""}`;
      const response = await fetch(`${API_BASE}${path}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be completed.");
      }
      setResult(body as Result);
      setConfirming(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be completed.");
    } finally {
      setBusy("");
    }
  }

  // ── Afterwards ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div data-testid="migration-report"
           className="rounded border border-border bg-bg-primary px-4 py-4">
        {result.status === "migrated" ? (
          // ITEMISED, not summed. "It converted 5 profiles" is a number, not
          // an account, and a writer who cannot see what happened to their own
          // words has to take the rewrite on faith.
          <MigrationResults projectPath={projectPath}
                            report={result as MigrationReport} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <Check size={14} className="text-emerald-400" />
            {result.status === "restored"
              ? "Your profiles are back the way they were."
              : "This project was already in the Weave. Nothing changed."}
          </p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-4 py-6 text-xs text-text-muted">
        <Loader size={13} className="animate-spin" />
        Reading your profiles to see what this would do...
      </p>
    );
  }

  // ── A previous run did not finish ────────────────────────────────────────
  if (state === "incomplete") {
    return (
      <div data-testid="migration-interrupted"
           className="rounded border border-amber-700/60 bg-amber-950/20 px-4 py-4">
        <p className="flex items-center gap-2 text-sm text-amber-100">
          <AlertTriangle size={14} className="text-amber-400/80" />
          A previous conversion did not finish.
        </p>
        <p className="mt-1 max-w-xl text-xs text-amber-200/80">
          Nothing has been lost. Your original profiles were copied before any
          change was made, and that copy is still there. You can carry on from
          where it stopped, or put everything back the way it was.
        </p>
        {plan?.backup_path && (
          <p className="mt-1 text-mini text-amber-200/70">
            The copy is at <span className="text-amber-100">{plan.backup_path}</span>.
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-mini text-rose-300">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void act("resume")} disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {busy === "resume" ? <Loader size={12} className="animate-spin" />
                               : <ArrowRight size={12} />}
            Carry on from where it stopped
          </button>
          <button
            onClick={() => void act("restore")} disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded border border-amber-700/60 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/30 disabled:opacity-40"
          >
            {busy === "restore" ? <Loader size={12} className="animate-spin" />
                                : <RotateCcw size={12} />}
            Put it back the way it was
          </button>
        </div>
      </div>
    );
  }

  // ── The preview, which is the whole screen ──────────────────────────────
  const nothingToDo = (plan?.total ?? 0) === 0 && (plan?.arcs.length ?? 0) === 0;

  return (
    <div data-testid="migration-preview"
         className="rounded border border-border bg-bg-primary px-4 py-4">
      <p className="flex items-center gap-2 text-sm text-text-primary">
        <FolderInput size={14} className="text-violet-300" />
        This project has not been brought into the Weave yet.
      </p>
      <p className="mt-1 max-w-xl text-xs text-text-muted">
        Converting copies your profiles into the Weave, where they can carry
        connections and change across the story. Here is exactly what it would
        do. Nothing has happened yet.
      </p>

      {error && (
        <p role="alert" className="mt-2 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-mini text-rose-200">
          {error}
        </p>
      )}

      {nothingToDo ? (
        <p className="mt-3 text-xs text-text-muted">
          There is nothing to convert -- this project has no profiles yet. You
          can start the Weave empty and add entries as you go.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <Section title="Would become Weave entries">
            <ul className="space-y-0.5">
              {plan!.convert.map(item => (
                <li key={item.folder} className="text-xs text-text-primary">
                  <span className="text-text-muted">{item.count}</span>{" "}
                  from <span className="font-medium">profiles/{item.folder}/</span>
                </li>
              ))}
            </ul>
          </Section>

          {plan!.arcs.length > 0 && (
            <Section title="Series arcs, which become dated facts">
              <ul className="space-y-0.5">
                {plan!.arcs.map(arc => (
                  <li key={arc.type} className="text-xs text-text-primary">
                    <span className="text-text-muted">{arc.count}</span>{" "}
                    from <span className="font-medium">profiles/arcs/{arc.type}/</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan!.skipped.length > 0 && (
            <Section title="Left where they are">
              <ul className="space-y-0.5">
                {plan!.skipped.map(item => (
                  <li key={item.folder} className="text-xs text-text-muted">
                    <span className="text-text-primary">profiles/{item.folder}/</span>
                    {" -- "}{item.reason}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan!.unconvertible.length > 0 && (
            <Section title="Cannot be converted" tone="rose">
              <ul className="space-y-0.5">
                {plan!.unconvertible.map(u => (
                  <li key={`${u.folder}/${u.file ?? ""}`} className="text-xs text-rose-200/80">
                    <span className="text-rose-100">
                      profiles/{u.folder}{u.file ? `/${u.file}` : ""}
                    </span>
                    {" -- "}{u.reason}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {plan!.warnings.length > 0 && (
            <Section title="Worth knowing first" tone="amber">
              <ul className="space-y-0.5">
                {plan!.warnings.map(w => (
                  <li key={w} className="text-xs text-amber-200/80">{w}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* Named BEFORE the button, so the writer can go and look at the
              folder with their own file manager while deciding. */}
          <p className="flex items-start gap-1.5 rounded border border-border bg-bg-surface px-2 py-1.5 text-mini text-text-muted">
            <Info size={11} className="mt-0.5 shrink-0 text-violet-300" />
            <span>
              Your profiles are copied to{" "}
              <span className="text-text-primary">{plan!.backup_path}</span>{" "}
              before anything is written, and that copy is never deleted. Your
              existing <span className="text-text-primary">profiles/</span>{" "}
              folder is left in place too.
            </span>
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={nothingToDo}
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            <ArrowRight size={12} />
            Convert {plan!.total} {plan!.total === 1 ? "entry" : "entries"}
          </button>
        ) : (
          <>
            {/* The second click repeats the count and the destination. A
                confirmation that says only "are you sure?" adds a click and
                no information. */}
            <span className="text-xs text-text-primary">
              Convert {plan!.total} {plan!.total === 1 ? "entry" : "entries"},
              keeping a copy in {plan!.backup_path}?
            </span>
            <button
              onClick={() => void act("convert")} disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              {busy === "convert" ? <Loader size={12} className="animate-spin" />
                                  : <Check size={12} />}
              Yes, convert
            </button>
            <button
              onClick={() => setConfirming(false)} disabled={busy !== ""}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              Not yet
            </button>
          </>
        )}
      </div>
    </div>
  );
}


function Section({ title, tone = "zinc", children }: {
  title: string;
  tone?: "zinc" | "amber" | "rose";
  children: React.ReactNode;
}) {
  const colour = tone === "amber" ? "text-amber-200/90"
    : tone === "rose" ? "text-rose-200/90" : "text-faint";
  return (
    <div>
      <p className={`text-mini font-semibold uppercase tracking-wide ${colour}`}>
        {title}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
