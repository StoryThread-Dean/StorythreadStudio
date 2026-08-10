// features/codex/WeavingPanel.tsx -- the guided walk through your world
// ======================================================================
// Weaving reads the manuscript and the Weave together and takes the writer
// through what it found, one decision at a time.
//
// FOUR THINGS THIS PANEL IS BUILT TO DO
// -------------------------------------
// 1. SHOW ITS WORKING. Every stop carries the text that triggered it and the
//    rule that fired. A walkthrough that cannot say why it stopped teaches
//    the writer to click through it, and a walkthrough people click through
//    is worse than none -- it costs time and finds nothing.
//
// 2. QUOTE A REAL NUMBER. The scan is free and runs before the depth choice
//    is confirmed, so "this found 340 stops, that is many sessions of work"
//    is measured rather than estimated. An estimate that turns out wrong two
//    hours in is how a writer learns not to trust the app.
//
// 3. LET THEM SAY NO FOUR DIFFERENT WAYS. "Not a connection" and "not yet"
//    are not the same answer, and collapsing them means either nagging about
//    settled things or losing things that were only postponed.
//
// 4. NEVER DO IT FOR THEM. The only one-click action here creates an EMPTY
//    entry from a name the writer already wrote. Everything else opens the
//    thing and gets out of the way. Nothing is written by AI, and no stop is
//    resolved without the writer choosing it.
//
// WHY THERE IS NO "APPLIED" BOOKKEEPING FOR MOST KINDS
// ----------------------------------------------------
// Stops are re-derived from the book on every scan and never stored. A
// Thread whose Overview gets filled in stops being Frayed because the
// condition ended, not because a record says it was handled. So "open it and
// go and write" needs no follow-up state at all -- which is exactly why the
// scan was built to store nothing.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BellOff, Check, CircleHelp, Clock, Loader, Quote, Spool, X,
} from "lucide-react";

import { STOP_KINDS, TONE_CLASSES, type LexEntry } from "./lexicon";
import { WhatsThis } from "../../components/learn/WhatsThis";
import {
  apply, defer, dismiss, fetchRuns, muteKind, scan, startRun,
  type Depth, type RunSummary, type ScanResult, type Stop,
} from "./weavingApi";

/** What the walk offers to DO about each kind, in the writer's words.
 *
 *  Only Unspun has a one-click action, and it creates an EMPTY entry -- the
 *  writer still writes it. Everything else opens the thing, because filling
 *  in a character is writing, and this app does not write. */
const PRIMARY_ACTION: Record<string, string> = {
  unspun: "Create the entry",
  frayed: "Open it and fill it in",
  loose_thread: "Open it and connect it",
  snag: "Open it and sort it out",
  unplaced: "Open it and place it",
  early_mention: "Open it",
  // Unwoven has no Thread to open -- the answer does not exist yet. This
  // takes the writer to the KIND of entry it belongs in.
  unwoven: "Go and answer it",
  // A pin is the writer's own question. If nothing answers to the phrase yet,
  // the useful next step is an entry; if something does, the entry exists and
  // the open question is what it connects to.
  pinned: "Create the entry",
};

const DEPTHS: { id: Depth; label: string; blurb: string }[] = [
  { id: "full", label: "Full weave",
    blurb: "Everything, everywhere. Thorough, and long." },
  { id: "quick", label: "Quick pass",
    blurb: "Problems only. Nothing that asks you to invent anything." },
];

function lexFor(kind: string): LexEntry | undefined {
  return STOP_KINDS[kind];
}

/**
 * Kinds of entry that have an editor today.
 *
 * The Profile Builder covers four. Everything else in the Weave -- factions,
 * governments, concepts, events -- has no editor yet, and a button that
 * promises to open one leads the writer to a screen that cannot help them.
 * So the walk SAYS SO instead, and offers the answers that still make sense.
 * An honest "not yet" is worth more than a button that goes nowhere.
 */
const EDITABLE_KINDS = new Set(["character", "relationship", "location", "lore"]);

function target(stop: Stop): { type: string; filename: string } {
  return {
    type: String(stop.detail?.type ?? ""),
    filename: String(stop.detail?.filename ?? ""),
  };
}

/** Whether the primary action can actually take the writer anywhere. */
function hasSomewhereToGo(stop: Stop): boolean {
  if (stop.kind === "unspun") return true;          // it CREATES the entry
  if (stop.kind === "unwoven") return EDITABLE_KINDS.has(landsIn(stop)[0] ?? "");
  if (stop.kind === "pinned") {
    // No entry yet: creating one is always available. With an entry, it opens
    // only if that kind has an editor.
    return !stop.detail?.has_entry || EDITABLE_KINDS.has(target(stop).type);
  }
  return EDITABLE_KINDS.has(target(stop).type);
}

/** What a Pinned stop offers, which depends on whether it has an entry. */
function pinnedAction(stop: Stop): string {
  return stop.detail?.has_entry ? "Open it and connect it" : "Create the entry";
}

/** [type, section] an Unwoven answer belongs in. */
function landsIn(stop: Stop): string[] {
  const lands = stop.detail?.lands_as;
  return Array.isArray(lands) ? lands.map(String) : [];
}

interface WeavingPanelProps {
  projectPath: string;
  onClose: () => void;
  /**
   * Take the writer to a Thread. The walk gets out of the way.
   *
   * `target` carries the KIND and the FILE, because "open it" has to open the
   * thing it names. Without them the app can only switch to some screen and
   * leave the writer to find the entry again, which is a different promise.
   */
  onOpenThread?: (entityId: string,
                  target?: { type: string; filename: string }) => void;
  /** Take the writer to a KIND of entry -- where an Unwoven answer belongs,
   *  which has no Thread yet by definition. */
  onOpenKind?: (typeId: string) => void;
}

export function WeavingPanel({
  projectPath, onClose, onOpenThread, onOpenKind,
}: WeavingPanelProps) {
  const [depth, setDepth] = useState<Depth>("full");
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<RunSummary[]>([]);

  // The scan runs on mount and on every depth change, BEFORE anything is
  // confirmed. That is what makes the count real -- see the header.
  const runScan = useCallback(async (which: Depth, existing: string | null) => {
    setScanning(true);
    setError(null);
    try {
      setResult(await scan(projectPath, { depth: which, runId: existing }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan could not run.");
    } finally {
      setScanning(false);
    }
  }, [projectPath]);

  useEffect(() => { void runScan(depth, runId); }, [runScan, depth, runId]);

  useEffect(() => {
    fetchRuns(projectPath)
      .then(r => setEarlier(r.runs))
      .catch(() => setEarlier([]));      // a missing list is not worth an error
  }, [projectPath]);

  const stops = result?.stops ?? [];
  const stop: Stop | undefined = stops[at];

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const s of stops) tally[s.kind] = (tally[s.kind] ?? 0) + 1;
    return tally;
  }, [stops]);

  async function begin() {
    setBusy(true);
    try {
      const run = await startRun(projectPath, { depth });
      setRunId(run.run_id);
      setWalking(true);
      setAt(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  }

  /** Record an answer and move on. Errors keep the stop on screen -- losing
   *  the writer's place because a write failed would be its own small
   *  betrayal. */
  async function answerAndAdvance(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setAt(i => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (scanning && !result) {
    return (
      <Shell onClose={onClose}>
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Loader size={13} className="animate-spin" />
          Reading your book and your world...
        </p>
      </Shell>
    );
  }

  // ── Before anything starts ──────────────────────────────────────────────
  if (!walking) {
    const total = result?.total ?? 0;
    return (
      <Shell onClose={onClose}>
        <p className="text-xs text-text-muted">
          Weaving reads what you have written and what your world says, and
          shows you where they do not line up yet. Nothing is changed without
          you choosing it, and you can stop anywhere.
        </p>

        <div className="mt-3 space-y-1.5">
          {DEPTHS.map(option => (
            <button
              key={option.id}
              onClick={() => setDepth(option.id)}
              className={`flex w-full flex-col items-start rounded border px-2.5 py-2 text-left ${
                depth === option.id
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-border hover:border-text-muted"
              }`}
            >
              <span className="text-xs font-semibold text-text-primary">
                {option.label}
              </span>
              <span className="text-[11px] text-faint">{option.blurb}</span>
            </button>
          ))}
        </div>

        {/* The real number, and what it means in hours rather than in units.
            "340" is information; "many sessions" is the thing a writer
            actually needs to decide with. */}
        <p className="mt-3 text-xs text-text-primary" data-testid="weaving-count">
          {scanning
            ? "Counting..."
            : total === 0
              ? "Nothing to look at. Your world and your book agree."
              : `This found ${total} ${total === 1 ? "thing" : "things"} to look at.`}
        </p>
        {!scanning && total > 60 && (
          <p className="mt-1 text-[11px] text-amber-200/90">
            That is many sessions of work. Your answers save as you go, and
            you can stop anywhere and come back.
          </p>
        )}

        {result?.unreadable?.length ? (
          <p className="mt-2 text-[11px] text-amber-200/90">
            {result.unreadable.length} chapter
            {result.unreadable.length === 1 ? "" : "s"} could not be read and
            {result.unreadable.length === 1 ? " was" : " were"} left out:{" "}
            {result.unreadable.join(", ")}.
          </p>
        ) : null}

        {earlier.length > 0 && (
          <p className="mt-2 text-[11px] text-faint">
            You have {earlier.length} earlier session
            {earlier.length === 1 ? "" : "s"}. Starting a new one does not
            undo anything you already applied.
          </p>
        )}

        {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}

        <button
          onClick={() => void begin()}
          disabled={busy || scanning || total === 0}
          className="mt-3 inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? <Loader size={12} className="animate-spin" /> : null}
          Start
        </button>
      </Shell>
    );
  }

  // ── The walk is over ────────────────────────────────────────────────────
  if (!stop) {
    return (
      <Shell onClose={onClose}>
        <p className="text-xs text-text-primary">
          That is everything this pass found.
        </p>
        <p className="mt-1.5 text-[11px] text-text-muted">
          Anything you put off comes back next time. Anything you applied, or
          said was not a connection, does not. Nothing here is stored about
          your book itself -- it is worked out fresh every time, so as you
          write, this list changes on its own.
        </p>
        <button
          onClick={onClose}
          className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          Close
        </button>
      </Shell>
    );
  }

  // ── One stop ────────────────────────────────────────────────────────────
  const lex = lexFor(stop.kind);
  const Icon = lex?.Icon ?? CircleHelp;
  const tone = TONE_CLASSES[lex?.tone ?? "zinc"];

  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <button
          onClick={() => setAt(i => Math.max(0, i - 1))}
          disabled={at === 0}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-text-primary disabled:opacity-30"
        >
          <ArrowLeft size={11} /> Back
        </button>
        <span className="flex-1 text-right" data-testid="weaving-progress">
          {at + 1} of {stops.length}
          {result && result.total !== stops.length
            ? ` (${result.total} found in all)`
            : ""}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <Icon size={18} className={`mt-0.5 shrink-0 ${tone.text}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-faint">
            {lex?.term ?? stop.kind}
            {lex && (
              <span className="ml-1 normal-case tracking-normal">
                <WhatsThis>{lex.whatsThis}</WhatsThis>
              </span>
            )}
          </p>
          <h3 className="text-xs font-semibold text-text-primary">{stop.title}</h3>
        </div>
      </div>

      {/* The evidence. Shown before the buttons, because a decision made
          without seeing what prompted it is not a decision. */}
      {stop.quote && (
        <p className="mt-2 flex gap-1.5 rounded border-l-2 border-border bg-bg-surface px-2 py-1.5 text-[11px] italic text-text-muted">
          <Quote size={10} className="mt-0.5 shrink-0 text-faint" />
          <span>{stop.quote}</span>
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-violet-300 hover:text-violet-200">
          Why am I seeing this?
        </summary>
        <p className="mt-1 text-[11px] text-text-muted">{stop.why}</p>
      </details>

      {/* Where the answer goes. Without this, "answer it" is an instruction
          with no address -- and an answer that lands nowhere in particular is
          a note, not part of the world. */}
      {stop.kind === "unwoven" && (
        <div className="mt-2 space-y-1 text-[11px] text-faint">
          <p>
            Your answer belongs in{" "}
            <span className="text-text-muted">
              {landsIn(stop).map(part => part.replace(/_/g, " ")).join(" > ")}
            </span>.
          </p>
          {Array.isArray(stop.detail.touches) && stop.detail.touches.length > 0 && (
            // A world is a web. Saying what else this reaches is the thing
            // that stops it feeling like a form.
            <p>
              This also touches something you have already decided:{" "}
              <span className="text-text-muted">
                {String((stop.detail.touches as string[])[0])}
              </span>
            </p>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}

      {!hasSomewhereToGo(stop) && (
        <p className="mt-2 rounded border border-border bg-bg-surface px-2 py-1.5 text-[11px] text-text-muted">
          There is no editor for this kind of entry yet, so there is nowhere
          for this to send you. You can put it off, or stop being asked --
          both are remembered.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {hasSomewhereToGo(stop) && (
        <button
          onClick={() => void answerAndAdvance(async () => {
            if (!runId) return;
            // Only Unspun writes anything, and what it writes is EMPTY -- a
            // named entry with nothing in it, for the writer to fill.
            if (stop.kind === "unspun"
                || (stop.kind === "pinned" && !stop.detail?.has_entry)) {
              await createThread(projectPath, String(stop.detail.name ?? ""));
              await apply(projectPath, runId, stop);
            } else if (stop.kind === "unwoven") {
              // Nothing to open and nothing to record: the question stops
              // being asked when its answer is written, because the scan
              // works that out fresh every time.
              onOpenKind?.(landsIn(stop)[0]);
            } else if (stop.entity_id) {
              onOpenThread?.(stop.entity_id, target(stop));
            }
          })}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
          {stop.kind === "pinned"
            ? pinnedAction(stop)
            : PRIMARY_ACTION[stop.kind] ?? "Open it"}
        </button>
        )}

        <button
          onClick={() => void answerAndAdvance(() =>
            runId ? dismiss(projectPath, runId, stop,
                            stop.kind === "unspun"
                              ? String(stop.detail.name ?? "")
                              : undefined)
                  : Promise.resolve())}
          disabled={busy}
          title="Permanently. This will not be raised again."
          className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {stop.kind === "pinned" ? "Remove the mark" : "Not a connection"}
        </button>

        <button
          onClick={() => void answerAndAdvance(() =>
            runId ? defer(projectPath, runId, stop) : Promise.resolve())}
          disabled={busy}
          title="It comes back next time."
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          <Clock size={11} /> Not yet
        </button>

        <button
          onClick={() => void answerAndAdvance(() =>
            runId ? muteKind(projectPath, runId, stop.kind) : Promise.resolve())}
          disabled={busy}
          title={`Stop showing ${lex?.term ?? stop.kind} at all. You can turn it back on.`}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-faint hover:text-text-primary disabled:opacity-40"
        >
          <BellOff size={11} /> Never ask
        </button>
      </div>

      {/* What else is waiting, by kind. Its job is to make the shape of the
          work visible -- "most of this is one kind of problem" is worth
          knowing before answering forty of them one at a time. */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
        {Object.entries(counts).sort().map(([kind, n]) => {
          const entry = lexFor(kind);
          const KindIcon = entry?.Icon ?? CircleHelp;
          return (
            <li key={kind} className="flex items-center gap-1 text-[11px] text-faint"
                title={entry?.short}>
              <KindIcon size={12}
                        className={TONE_CLASSES[entry?.tone ?? "zinc"].text} />
              {entry?.term ?? kind} {n}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}


/** Create an EMPTY character entry from a name in the prose.
 *
 *  Type is fixed to character: a bare capitalised name in a manuscript is
 *  overwhelmingly a person, and offering a type picker at this moment turns
 *  a one-click yes into a small form. Getting it wrong costs one edit; being
 *  asked forty times costs the walkthrough. */
async function createThread(projectPath: string, name: string): Promise<void> {
  const response = await fetch("http://localhost:8000/api/codex/thread/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, type: "character", name }),
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => null))?.detail?.message;
    throw new Error(message || "That entry could not be created.");
  }
}


/**
 * The walkthrough sits OVER the manuscript, not beside it.
 *
 * It began as a third column and that was the wrong shape. The editor was
 * already between a sidebar and the Writing Companion; a third panel left
 * the writer's own prose as the narrowest thing on screen, which is exactly
 * backwards for an app whose stated rule is that the writer's text is the
 * visual focus.
 *
 * A dialog is also what this app already does for a guided walk -- the
 * audiobook's formatting walkthrough is the same shape, so the interaction
 * is one the writer has already learned. And a stop carries its own quoted
 * evidence, so the manuscript rarely needs to be visible at the same moment.
 *
 * A top bar was the other candidate and loses on room: a stop is a quote
 * plus a reason plus four choices plus what is left, and squeezing that into
 * a horizontal strip would either truncate the evidence or push the editor
 * down the screen on every stop.
 */
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-label="Weaving"
        data-testid="weaving-panel"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel p-4 shadow-2xl"
      >
        <header className="mb-3 flex items-center gap-2">
          <Spool size={15} className="text-violet-300" />
          <h2 className="flex-1 text-sm font-semibold text-text-primary">Weaving</h2>
          <button onClick={onClose} aria-label="Close Weaving"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={14} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
