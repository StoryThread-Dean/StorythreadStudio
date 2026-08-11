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
// CONNECTING HAPPENS HERE, NOT SOMEWHERE ELSE
// -------------------------------------------
// Reported from live testing. "Open it and connect it" opened the entry's
// own page and abandoned the writer there:
//
//     "I'm at the profile, now what? No way to go back, no way to accept
//      the connection as the correct one. Nothing."
//
// Three things were missing and they are one thing really: the walk gave up
// its place. So a connection is now made INSIDE the walk. Pick the other end
// here, make it here if it does not exist yet, and carry on to the next stop
// without ever leaving. Getting it wrong is a step back rather than a
// navigation problem.
//
// Stops that genuinely need the writer to go and WRITE -- an entry with an
// empty Overview -- still send them to the editor, because there is nothing
// to type in here. Those close the walk on purpose, and reopening it resumes:
// the answers are kept per book, so nothing is lost by leaving.
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

import {
  STOP_KINDS, TONE_CLASSES, threadTypeEntry, type LexEntry, type Tone,
} from "./lexicon";
import { Explain } from "../../components/learn/Explain";
import { WhatsThis } from "../../components/learn/WhatsThis";
import { BindDot } from "./BindDot";
import { QuickEntry } from "./QuickEntry";
import { QuickFill } from "./QuickFill";
import { SnagFixer } from "./SnagFixer";
import { TieEditor } from "./TieEditor";
import { fetchGraph, type GraphNode } from "./api";
import {
  apply, defer, dismiss, fetchRuns, muteKind, scan, startRun,
  type Depth, type RunSummary, type ScanResult, type Stop,
} from "./weavingApi";

/** What the walk offers to DO about each kind, in the writer's words.
 *
 *  EVERY ONE RESOLVES INSIDE THE POPUP. This is the closed-world rule, given
 *  as the fundamental thing the interface was missing: "Writer enters a pop-up
 *  UI that they DO NOT LEAVE AT ANY POINT until the task is done or they X
 *  out." Advancing to another screen -- even a well-built one -- was reported
 *  as "good intentions, terrible execution": the walk closed behind the
 *  writer, and there was no way back to it.
 *
 *  The Weave builds BASE-LEVEL entries and connections only. Expanding them is
 *  the writer's later work, elsewhere. */
const PRIMARY_ACTION: Record<string, string> = {
  unspun: "Create the entry",
  // Empty or not: an entry's identity was settled when it was CREATED, so the
  // only open question about a thin one is its contents. There used to be a
  // separate "Say what this is" for empty stubs, and live testing showed why
  // that cannot stand -- see the frayed branch below.
  frayed: "Fill it in here",
  loose_thread: "Choose the connection",
  // Both ends already exist and the prose keeps putting them together. The
  // only open question is what the connection IS, which is the writer's.
  untied: "Say how they connect",
  snag: "Sort it out here",
  unplaced: "Place it",
  early_mention: "Decide here",
  unwoven: "Answer it here",
  // A pin is the writer's own question. If nothing answers to the phrase yet,
  // the useful next step is an entry; if something does, the entry exists and
  // the open question is what it connects to.
  pinned: "Create the entry",
};

/**
 * FOUR PASSES, WHICH REPLACED THREE SIZES.
 *
 * What was here was Full / Targeted / Quick -- three amounts of the same thing.
 * These are four different questions, named out of the same loom vocabulary as
 * the rest of the Weave, and the metaphor carries the dependency on purpose: you
 * cannot weave a weft without a warp.
 *
 * The order on screen IS the recommended order, and that is all it is. Dressing
 * the loom is never "finished" -- a world grows for the life of a book -- so a
 * lock would never open. Where a later pass needs something the first one
 * provides, it asks for it inline rather than sending the writer back here.
 */
const DEPTHS: { id: Depth; label: string; blurb: string; step?: string }[] = [
  { id: "warp", label: "Dress the Loom", step: "Start here",
    blurb: "What is here, and what relates to what. Names with no entry, "
      + "entries too thin to be useful, and entries connected to nothing." },
  { id: "weft", label: "Weave the Chapters", step: "Then, as you write",
    blurb: "One chapter at a time: did anything change here? Run it from the "
      + "chapter you are in and the app already knows when." },
  { id: "cloth", label: "Read the Cloth", step: "When you step back",
    blurb: "Where the book contradicts itself. Timeline problems, facts that "
      + "never take effect, and things named before the reader should know." },
  { id: "unwoven_pass", label: "Unwoven", step: "Any time",
    blurb: "The ground rules of your world, which is its own job: how power "
      + "passes, what magic costs, who inherits. Nothing here is wrong yet." },
];

function lexFor(kind: string): LexEntry | undefined {
  return STOP_KINDS[kind];
}

/** What a Pinned stop offers, which depends on whether it has an entry. */
function pinnedAction(stop: Stop): string {
  return stop.detail?.has_entry ? "Open it and connect it" : "Create the entry";
}

/** The other words a grouped Unspun stop covers: "Lara", "Croft". */
function alsoCalled(stop: Stop): string[] {
  const also = stop.detail?.also;
  return Array.isArray(also) ? also.map(String) : [];
}

/**
 * Stops answered by making a connection, which happens in the walk itself.
 *
 * A Loose thread IS the absence of a connection, so sending the writer to
 * the entry's own page to fix it was always indirect -- and it abandoned
 * them there. A pinned word with an entry is the same question.
 */
const CONNECT_HERE = new Set(["loose_thread", "untied"]);

function connectsHere(stop: Stop): boolean {
  if (CONNECT_HERE.has(stop.kind)) return true;
  return stop.kind === "pinned" && Boolean(stop.detail?.has_entry);
}

/**
 * The entry a stop is ABOUT, when there is one.
 *
 * Shown above the question so the writer starts from something they recognise
 * -- their own profile, with its own kind's icon -- rather than from a sentence
 * about it. Requested in exactly those terms: "Physically show the Character
 * profile Icon (the starting point) and then ask the question."
 */
function standingOn(stop: Stop): { name: string; type: string }[] {
  // Untied is about a PAIR, so both ends are shown. The question names them
  // too, but a Faction icon beside one and a Character icon beside the other
  // says in one glance what a sentence has to spell out.
  if (stop.kind === "untied") {
    return [stop.detail?.a, stop.detail?.b]
      .map(end => end as Record<string, unknown> | undefined)
      .filter(Boolean)
      .map(end => ({ name: String(end!.name ?? ""),
                     type: String(end!.type ?? "") }))
      .filter(end => end.name && end.type);
  }
  const name = String(stop.detail?.name ?? "");
  const type = String(stop.detail?.type ?? "");
  if (!name || !type || !stop.entity_id) return [];
  return [{ name, type }];
}

/** [type, section] an Unwoven answer belongs in. */
function landsIn(stop: Stop): string[] {
  const lands = stop.detail?.lands_as;
  return Array.isArray(lands) ? lands.map(String) : [];
}

/**
 * NO NAVIGATION CALLBACKS, ON PURPOSE. The panel used to take two open-this-
 * elsewhere callbacks, and five of nine stop kinds ended by calling one --
 * which closed the Weave behind the writer. Removing the props makes leaving
 * structurally impossible rather than merely avoided: a future branch cannot
 * navigate away, because there is nothing to call. (A source-read test bans
 * the old names from this file outright, which is why they are not written
 * here either.)
 */
interface WeavingPanelProps {
  projectPath: string;
  onClose: () => void;
}

export function WeavingPanel({ projectPath, onClose }: WeavingPanelProps) {
  const [depth, setDepth] = useState<Depth>("warp");
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<RunSummary[]>([]);
  // Connecting happens in the walk, so the walk needs to know what there is
  // to connect to. Fetched once the writer asks, not on mount: most stops
  // are not about connections.
  const [connecting, setConnecting] = useState(false);
  const [world, setWorld] = useState<GraphNode[]>([]);
  // An empty stub, waiting to be told what it is.
  const [naming, setNaming] = useState(false);
  // The other three inline resolutions -- creating an entry, filling a thin
  // one in, sorting out a disagreement. One flag each, same overlay-swap
  // pattern as naming/connecting above.
  const [entering, setEntering] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fixing, setFixing] = useState(false);

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

  /** What there is to point at. Fetched when the writer asks, not on mount:
   *  most stops are not about other entries. */
  async function loadWorld() {
    try {
      const graph = await fetchGraph(projectPath, { hideSpoilers: false });
      setWorld(graph.nodes);
    } catch {
      setWorld([]);          // the picker says so rather than crashing
    }
  }

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
  /**
   * Record an answer and move on.
   *
   * An action returns whether the stop is FINISHED. Most are: they wrote
   * something or the writer said no. One is not -- opening the connector keeps
   * the writer on this stop until they are done with it -- so "advance" is a
   * return value rather than something inferred.
   *
   * Errors keep the stop on screen. Losing the writer's place because a write
   * failed would be its own small betrayal.
   */
  async function answerAndAdvance(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      // Only an explicit false keeps the writer here. Every other answer --
      // including whatever an endpoint happened to return -- means done.
      if (await action() !== false) setAt(i => i + 1);
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
        {/* ONE control for this screen. What it is, whether they have to, what
            it spends, and which depth to pick -- all of which the writer needs
            before pressing Start next to a count in the hundreds. It used to be
            two of these stacked, which read as clutter rather than as help. */}
        <div className="mt-1">
          <Explain of="weaving.what" />
        </div>

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
              <span className="flex w-full items-baseline gap-2">
                <span className="text-xs font-semibold text-text-primary">
                  {option.label}
                </span>
                {/* WHEN this one is for. The order of these four is the order
                    they are worth doing in, and saying so out loud teaches the
                    dependency without locking anything: dressing the loom is
                    never finished, so a gate would never open. */}
                {option.step && (
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-violet-300/80">
                    {option.step}
                  </span>
                )}
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

  if (naming && stop) {
    return (
      <BindDot
        projectPath={projectPath}
        dot={{
          entity_id: stop.entity_id,
          type: String(stop.detail?.type ?? ""),
          name: String(stop.detail?.name ?? ""),
          display_name: "", aliases: [], placeholder: true,
        }}
        candidates={world}
        // Back to the same stop. The scan re-derives it next pass, so an entry
        // that has become something stops being asked about on its own.
        onClose={() => setNaming(false)}
        onBound={() => { /* re-derived by the next scan */ }}
      />
    );
  }

  if (entering && stop) {
    // Quick Entry: the base level, made without leaving. Unwoven fixes the
    // kind and the section (the question knows where its answer lands);
    // Unspun brings the name and its own sentence from the manuscript.
    const unwoven = stop.kind === "unwoven";
    const lands = landsIn(stop);
    return (
      <QuickEntry
        projectPath={projectPath}
        name={unwoven ? "" : String(stop.detail?.name ?? "")}
        aliases={alsoCalled(stop)}
        kind={unwoven ? (lands[0] ?? "concept") : "character"}
        kindLocked={unwoven}
        section={unwoven ? lands[1] : undefined}
        prefill={unwoven ? undefined : stop.quote || undefined}
        asking={unwoven ? stop.title : undefined}
        candidates={world}
        onClose={() => setEntering(false)}
        // Finished: record the answer and move on. The ledger is what lets a
        // created entry never be asked about again even before the next scan.
        onDone={() => {
          setEntering(false);
          void (async () => {
            if (runId) await apply(projectPath, runId, stop).catch(() => undefined);
            setAt(i => i + 1);
          })();
        }}
      />
    );
  }

  if (filling && stop) {
    return (
      <QuickFill
        projectPath={projectPath}
        entityId={stop.entity_id}
        missing={Array.isArray(stop.detail?.missing)
          ? (stop.detail.missing as unknown[]).map(String) : []}
        // The one case where identity IS still open: the word got its own
        // placeholder but really means an entry that already exists ("Croft"
        // when Lara Croft has a page). A side path, never the question.
        wordName={stop.detail?.placeholder
          ? String(stop.detail?.name ?? "") : undefined}
        onAbsorbInstead={() => {
          void (async () => {
            await loadWorld();
            setFilling(false);
            setNaming(true);
          })();
        }}
        onClose={() => setFilling(false)}
        onDone={() => {
          setFilling(false);
          void (async () => {
            if (runId) await apply(projectPath, runId, stop).catch(() => undefined);
            setAt(i => i + 1);
          })();
        }}
      />
    );
  }

  if (fixing && stop) {
    return (
      <SnagFixer
        projectPath={projectPath}
        stop={stop}
        onClose={() => setFixing(false)}
        onDone={() => {
          setFixing(false);
          void (async () => {
            if (runId) await apply(projectPath, runId, stop).catch(() => undefined);
            setAt(i => i + 1);
          })();
        }}
      />
    );
  }

  if (connecting && stop) {
    // An Untied stop is about a PAIR, so the entry being connected is its
    // first end and the second is already the likeliest answer. Every other
    // connect-here stop is about one entry, and detail carries it directly.
    const pair = stop.kind === "untied"
      ? (stop.detail?.a as Record<string, unknown> | undefined)
      : undefined;
    const from = pair ?? stop.detail ?? {};
    const otherEnd = stop.kind === "untied"
      ? (stop.detail?.b as Record<string, unknown> | undefined)
      : undefined;
    const shortList = otherEnd
      ? [{ entity_id: String(otherEnd.entity_id ?? ""),
           scenes: Number(stop.detail?.scenes ?? 0) }]
      : ((stop.detail?.likely as { entity_id: string; scenes: number }[]) ?? []);
    return (
      <TieEditor
        projectPath={projectPath}
        thread={{
          entity_id: String(from.entity_id ?? stop.entity_id),
          type: String(from.type ?? ""),
          name: String(from.name ?? ""),
          display_name: "", aliases: [], placeholder: false,
        }}
        candidates={world}
        likely={shortList}
        // Closing comes straight back to the same stop, which is the whole
        // point: the walk never lost its place.
        onClose={() => setConnecting(false)}
        // FINISHED WITH THIS ENTRY, so the walk moves on. Without this the
        // writer recorded a connection, landed back on a screen that asked them
        // nothing, and had no way forward -- "Now what? there is nothing to take
        // me to the next page."
        //
        // The stop is not marked answered: it is RE-DERIVED next scan, and an
        // entry that now has a connection stops being asked about because the
        // condition ended. Advancing here only moves the writer along.
        onDone={() => { setConnecting(false); setAt(i => i + 1); }}
        onChanged={() => { /* the scan re-derives it on the next pass */ }}
      />
    );
  }

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

      {/* WHAT THE QUESTION IS ABOUT, shown before the question itself.
          Reported from live testing: a stop reading "Nothing connects to
          Alexandra Langford" was read as the app having lost track of a
          profile that plainly exists. The fix asked for was to start from
          something the writer recognises -- her own entry, with its own kind's
          icon -- so the starting point is never in doubt and the question can
          be about what is missing rather than about what is not. */}
      {standingOn(stop).length > 0 && (
        <p data-testid="standing-on"
           className="mb-1 flex items-center gap-1.5 text-[11px] text-text-muted">
          {standingOn(stop).map((on, i) => {
            const kind = threadTypeEntry(on.type);
            const KindIcon = kind.Icon;
            const tint = TONE_CLASSES[kind.tone as Tone].text;
            return (
              <span key={`${on.name}-${i}`}
                    className="flex items-center gap-1.5">
                {i > 0 && <span className="text-faint">and</span>}
                <KindIcon size={13} className={`shrink-0 ${tint}`} />
                <span className="font-medium text-text-primary">{on.name}</span>
                <span className="text-faint">{kind.term}</span>
              </span>
            );
          })}
        </p>
      )}

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

      {/* One entry covering several words is the part a writer would
          otherwise be surprised by, so it is shown before the button and not
          only explained behind "why am I seeing this?". */}
      {alsoCalled(stop).length > 0 && (
        <p className="mt-2 text-[11px] text-text-muted">
          One entry, answering to{" "}
          <span className="text-text-primary">
            {[String(stop.detail.name ?? ""), ...alsoCalled(stop)].join(", ")}
          </span>.
        </p>
      )}

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

            <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => void answerAndAdvance(async () => {
            if (!runId) return;
            // EVERY BRANCH RETURNS false: each opens an inline resolution and
            // the walk keeps its place until the writer finishes there. The
            // resolutions advance it themselves, through their onDone.
            if (stop.kind === "unspun"
                || (stop.kind === "pinned" && !stop.detail?.has_entry)
                || stop.kind === "unwoven") {
              // Quick Entry: name, kind, one starter line -- the base level,
              // created without leaving. The world is loaded first so the
              // connect step that follows has something to offer.
              await loadWorld();
              setEntering(true);
              return false;
            } else if (connectsHere(stop) && stop.entity_id) {
              // Stays here. The walk keeps its place, and a wrong choice is a
              // step back rather than a navigation problem.
              await loadWorld();
              setConnecting(true);
              return false;
            } else if (stop.kind === "frayed" && stop.entity_id) {
              // The missing sections, as text boxes, right here -- EMPTY STUBS
              // INCLUDED. There used to be an identity question here first
              // ("Say what this is"), built when the walk had nowhere to type,
              // and live testing showed what it does once that reason is gone:
              //
              //   "We have established what Dean is, Dean is a Character
              //    Profile. ... Why is it asking me this? ... I'm literally
              //    stuck with zero places to go."
              //
              // Every answer it offered was wrong for Dean: binding absorbs
              // him into someone else, and "it is its own thing" would CREATE
              // A SECOND DEAN. Identity is asked once, at creation, and never
              // again. The one real leftover case -- this word is actually
              // another name for an entry I already have -- survives as a
              // side path inside the fill-in form.
              setFilling(true);
              return false;
            } else if (stop.entity_id) {
              // Snag, Unplaced, Early mention: settled in place.
              setFixing(true);
              return false;
            }
          })}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {busy ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
          {stop.kind === "pinned"
            ? pinnedAction(stop)
            : PRIMARY_ACTION[stop.kind] ?? "Sort it out here"}
        </button>

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
