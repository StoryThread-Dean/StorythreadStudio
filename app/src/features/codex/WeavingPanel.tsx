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
// 3. LET THEM SAY NO THREE DIFFERENT WAYS. "Never this one" (permanent, in
//    the kind's own words), "not yet" (comes back), and "never ask about this
//    kind" (a reversible preference) are not the same answer, and collapsing
//    them means either nagging about settled things or losing things that
//    were only postponed.
//
// 4. NEVER DO IT FOR THEM. Every resolution is a form the WRITER fills in --
//    Quick Entry starts from their own sentence, never from generated prose.
//    Nothing is written by AI, and no stop is resolved without the writer
//    choosing it.
//
// EVERYTHING RESOLVES HERE, NOT SOMEWHERE ELSE (the closed world)
// ---------------------------------------------------------------
// Reported from live testing. "Open it and connect it" opened the entry's
// own page and abandoned the writer there:
//
//     "I'm at the profile, now what? No way to go back, no way to accept
//      the connection as the correct one. Nothing."
//
// Three things were missing and they are one thing really: the walk gave up
// its place. So EVERY stop resolves inside the walk -- connections in the
// inline TieEditor, new entries in Quick Entry, thin ones in Quick Fill,
// contradictions in the Snag fixer. No stop closes the walk; getting
// something wrong is a step back rather than a navigation problem. Reopening
// after an X-out resumes: the answers are kept per book.
//
// WHAT THE "APPLIED" RECORD IS FOR, KIND BY KIND
// ----------------------------------------------
// Condition-derived stops (Frayed, Loose, Untied, Snag...) are re-derived
// from the book on every scan: fill an Overview in and the Frayed stop ends
// because the CONDITION ended. For those, the applied record only keeps the
// stop quiet until the next scan can see the fix. A PIN is the exception --
// it is the writer's own mark, never re-derived away, and recording the
// apply is what removes it.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BellOff, Check, CircleHelp, Clock, Loader, Quote, Spool, X,
} from "lucide-react";

import {
  STOP_KINDS, TONE_CLASSES, threadTypeEntry, type LexEntry, type Tone,
} from "./lexicon";
import { Explain } from "../../components/learn/Explain";
import { useAttemptClose } from "../../components/learn/useAttemptClose";
import { DomainBoard } from "./DomainBoard";
import { StaleMark, StaleNotice } from "./StaleNotice";
import { UnwovenGuide } from "./UnwovenGuide";
import { WordFix } from "./WordFix";
import { PlaceStop } from "./PlaceStop";
import { WhatsThis } from "../../components/learn/WhatsThis";
import { BindDot } from "./BindDot";
import { QuickEntry } from "./QuickEntry";
import { QuickFill } from "./QuickFill";
import { SnagFixer } from "./SnagFixer";
import { TieEditor } from "./TieEditor";
import {
  fetchAnchors, fetchGraph, patchFact,
  type ChapterAnchor, type GraphNode,
  placeThread,
} from "./api";
import { SWEEPABLE, Sweep } from "./Sweep";
import {
  apply, defer, dismiss, fetchRuns, muteKind, resumeRun, scan, startRun,
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
  // Several Snags on one axis. Plural on purpose: the writer is about to be
  // shown a group, and a button reading "Sort it out" would understate what
  // they are agreeing to look at.
  tangle: "Sort them out here",
  unplaced: "Place it",
  early_mention: "Decide here",
  unwoven: "Answer it here",
  // A pin is the writer's own question. If nothing answers to the phrase yet,
  // the useful next step is an entry; if something does, the entry exists and
  // the open question is what it connects to.
  pinned: "Create the entry",
};

/**
 * What "never raise this again" is CALLED, in each kind's own terms.
 *
 * One label used to serve all nine kinds -- "Not a connection" -- which on a
 * Snag permanently retired a CONTRADICTION check under a sentence about
 * connections, and on an Unwoven question dismissed a piece of the world's
 * ground rules the same way. The permanence is unchanged (it is the writer's
 * "Don't ask again", from the original worked example); the words now say what
 * is actually being declined, so the writer can know what they are turning off.
 */
const DISMISS_ACTION: Record<string, string> = {
  unspun: "Never make this an entry",
  frayed: "Leave it as it is",
  loose_thread: "Not a connection",
  untied: "Not a connection",
  snag: "Not a problem",
  // Plural, and it means all of them: the group is one stop, so the permanent
  // no covers the whole cause rather than one symptom of it.
  tangle: "None of these are problems",
  unplaced: "Leave it unplaced",
  early_mention: "It is fine where it is",
  unwoven: "Never ask this",
  pinned: "Remove the mark",
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
  // The blurb must not promise chapter scoping: the pass reads the whole
  // book today (nothing sends chapter ids yet). "Run it from the chapter you
  // are in" described a design, not the build -- see docs/roadmap.
  { id: "weft", label: "Weave the Chapters", step: "Then, as you write",
    blurb: "Did anything change as you wrote? Pairs your scenes keep putting "
      + "together that nothing records a connection between yet." },
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

/** What a Pinned stop offers, which depends on whether it has an entry.
 *  "Choose the connection" -- nothing is opened elsewhere; the connector is
 *  inline, like every other resolution in the closed world. */
function pinnedAction(stop: Stop): string {
  return stop.detail?.has_entry ? "Choose the connection" : "Create the entry";
}

/** What a narrow mute would be ABOUT, in words the writer recognises. The
 *  entry's own name where the stop carries it; a plain fallback where it does
 *  not, since "About e-4f2a91 only" is not a choice anyone can make. */
function muteTargetName(stop: Stop): string {
  const name = String(stop.detail?.name ?? "").trim();
  return name || "this one";
}

/** The findings a Tangle gathered, each a whole Snag. Empty for anything else. */
function tangleMembers(stop: Stop): { key: string; summary: string }[] {
  const members = stop.detail?.members;
  if (!Array.isArray(members)) return [];
  return members.map(m => ({
    key: String((m as Record<string, unknown>).key ?? ""),
    summary: String((m as Record<string, unknown>).summary ?? ""),
  }));
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
  // Which part of the world this sitting is about, on the Unwoven pass only.
  // Null means all of it, which is what the walk sends by default.
  const [domain, setDomain] = useState<string | null>(null);
  const [guiding, setGuiding] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A quieter channel than error: the writer's WORK landed, but the walk's
  // own bookkeeping did not. Shown on the next stop, cleared by the next
  // answer. See recordApplied.
  const [notice, setNotice] = useState<string | null>(null);
  // WHAT WAS ANSWERED THIS SITTING, keyed by stop key, holding the label the
  // writer chose. The stop list is a SNAPSHOT from Start and is never
  // refetched mid-walk, so the panel itself has to remember -- without this,
  // Back re-showed answered stops as live questions (answering again re-fired
  // the write and duplicated the work), and "Never ask" muted a kind on the
  // server while the snapshot kept asking for the rest of the walk.
  const [answeredHere, setAnsweredHere] = useState<Record<string, string>>({});
  const [mutedHere, setMutedHere] = useState<Set<string>>(new Set());
  // Whether this walk carried on an earlier sitting. Said out loud on the
  // first stop, because a writer who chose "carry on" is entitled to see that
  // it worked -- and because a resumed walk is shorter than they might expect.
  const [resumed, setResumed] = useState(false);
  // R8.1. Which chapters the walk is narrowed to, or null for the whole book.
  // Set from the stale banner's "re-check just those": the scan is free, so
  // narrowing costs nothing and turns "the book changed under me somewhere"
  // into a list short enough to actually work through.
  const [scope, setScope] = useState<string[] | null>(null);
  const [earlier, setEarlier] = useState<RunSummary[]>([]);
  // Connecting happens in the walk, so the walk needs to know what there is
  // to connect to. Fetched once the writer asks, not on mount: most stops
  // are not about connections.
  const [connecting, setConnecting] = useState(false);
  const [world, setWorld] = useState<GraphNode[]>([]);
  // The absorb side path (a minted word turns out to be another name for an
  // entry that already exists). `naming` shows the dialog; `bound` remembers
  // that the word actually MOVED, so closing the receipt finishes the stop
  // instead of returning to a question about an entry that no longer exists.
  const [naming, setNaming] = useState(false);
  const [bound, setBound] = useState(false);
  // The other three inline resolutions -- creating an entry, filling a thin
  // one in, sorting out a disagreement. One flag each, same overlay-swap
  // pattern as naming/connecting above.
  const [entering, setEntering] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fixing, setFixing] = useState(false);
  // "Never ask" asks how widely before it writes anything (R8.3).
  const [muting, setMuting] = useState(false);
  // Ruling 8: the tick-list. Set to a kind while the writer is sweeping it.
  const [sweeping, setSweeping] = useState<string | null>(null);
  // The flagged word is wrong, or it is already somebody's. Open on an Unspun
  // stop, and the two answers that stop could not previously give.
  const [fixingWord, setFixingWord] = useState(false);
  // What the writer corrected it TO, carried into Quick Entry when they decide
  // it is new after all so they do not type it twice.
  const [correctedName, setCorrectedName] = useState("");
  // The book's chapters, for the sweep's per-row chapter pickers. Fetched once
  // on mount rather than when the sweep opens: it is one small request, and
  // loading it on open would put a spinner in front of a list whose whole point
  // is being faster than the walk.
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);

  // The scan runs on mount and on every depth change, BEFORE anything is
  // confirmed. That is what makes the count real -- see the header.
  const runScan = useCallback(async (which: Depth, existing: string | null,
                                     part: string | null,
                                     chapters: string[] | null) => {
    setScanning(true);
    setError(null);
    try {
      setResult(await scan(projectPath, {
        depth: which, runId: existing,
        domains: part ? [part] : [],
        // Empty means the whole book, which is what every pass sends until the
        // writer narrows to the chapters that moved under them.
        chapterIds: chapters ?? [],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan could not run.");
    } finally {
      setScanning(false);
    }
  }, [projectPath]);

  useEffect(() => { void runScan(depth, runId, domain, scope); },
            [runScan, depth, runId, domain, scope]);

  useEffect(() => {
    fetchRuns(projectPath)
      .then(r => setEarlier(r.runs))
      .catch(() => setEarlier([]));      // a missing list is not worth an error
  }, [projectPath]);

  useEffect(() => {
    fetchAnchors(projectPath)
      .then(r => setChapters(r.chapters))
      // An empty list is survivable: the sweep's rows still triage, they just
      // cannot place. Better than refusing to open the walk over it.
      .catch(() => setChapters([]));
  }, [projectPath]);

  // A half-made decision does not travel. Stepping Back with the mute scope
  // open would leave "About Elara only" sitting under a question about someone
  // else, and the button would then do exactly what it said about the wrong
  // entry.
  useEffect(() => { setMuting(false); }, [at]);

  const stops = result?.stops ?? [];
  const stop: Stop | undefined = stops[at];

  /**
   * What closing the walk would cost right now, in words, or "" for nothing.
   *
   * NOT "unsaved changes". Every answer is written as it is made, so the thing
   * at risk is the writer's PLACE -- and on a long pass that is the expensive
   * part. Resuming exists and works, but it is a second decision on the setup
   * screen rather than being where you were.
   *
   * The setup screen guards nothing: there is nothing behind it yet, and a
   * confirm on the way out of a screen with no work on it is how a writer
   * learns to dismiss confirms without reading them.
   */
  const walkGuard = walking && stop
    ? `You are ${at + 1} of ${stops.length} through this pass. `
      + "Close Weaving and lose your place?"
    : "";

  /** Which stops in THIS list are about text that has moved since the writer
   *  put them off. A Set because the walk asks the question once per card. */
  const staleKeys = useMemo(
    () => new Set(result?.resumed?.stale_keys ?? []),
    [result],
  );

  /**
   * Narrow the walk to the chapters that changed, or widen it back.
   *
   * `at` goes back to the start because the list is a different list -- keeping
   * the index would land the writer in the middle of a walk they did not begin.
   * The scan itself runs from the effect above, on the scope change.
   */
  function narrow(chapters: string[] | null) {
    setScope(chapters);
    setAt(0);
  }

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

  /**
   * Start walking -- either carrying on the last sitting or opening a new one.
   *
   * RESUMING IS NOT COSMETIC. Applied and dismissed answers live in the book
   * and come back either way, which is why nobody noticed this was missing.
   * What a RUN holds is what was put off and which kinds were silenced in that
   * sitting -- both per-session on purpose. Starting fresh throws those away,
   * so a writer who closed the app mid-walk was handed back every question
   * they had already said "not yet" to.
   */
  async function begin(carryOn = false) {
    setBusy(true);
    try {
      const existing = carryOn ? (await resumeRun(projectPath)).run : null;
      // A resume that finds nothing is not a failure -- it means there was
      // nothing to carry on, and a new run is the right answer.
      const run = existing ?? await startRun(projectPath, { depth });
      setRunId(run.run_id);
      setResumed(Boolean(existing));
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
  /**
   * Record that a stop's work was DONE, and say so if the recording fails.
   *
   * The inline resolutions used to end in `.catch(() => undefined)` -- the
   * writer's save had landed, the ledger write silently had not, and the same
   * stop came back next session looking like the save never happened. The work
   * is real either way, so the walk still advances; what cannot happen is the
   * failure being swallowed. The notice says exactly what state things are in.
   */
  async function recordApplied(answered: Stop) {
    if (!runId) return;
    try {
      await apply(projectPath, runId, answered);
    } catch {
      setNotice(
        "Your work is saved, but the walk could not record the answer -- "
        + "this stop may be asked once more next session.");
    }
  }

  /**
   * Remember what was answered and move to the next stop that still NEEDS an
   * answer. The freshly-answered key (and a freshly-muted kind) ride along as
   * arguments because React state has not applied yet when this runs.
   */
  function recordAnswer(answered: Stop, label: string, mutedKind?: string) {
    const known = { ...answeredHere, [answered.key]: label };
    const muted = mutedKind
      ? new Set([...mutedHere, mutedKind]) : mutedHere;
    setAnsweredHere(known);
    if (mutedKind) setMutedHere(muted);
    let i = at + 1;
    while (i < stops.length
           && (known[stops[i].key] || muted.has(stops[i].kind))) {
      i += 1;
    }
    setAt(i);
  }

  /**
   * Ruling 8. Every still-open stop of one kind, for the tick-list.
   *
   * Read off the SAME snapshot the walk is using, so the list the writer sweeps
   * and the list the walk would have marched them through are the same list --
   * a sweep assembled from a fresh scan could contain stops they answered five
   * minutes ago.
   */
  const sweepable = useMemo(() => {
    const tally: Record<string, Stop[]> = {};
    for (const s of stops) {
      if (!SWEEPABLE.has(s.kind)) continue;
      if (answeredHere[s.key] || mutedHere.has(s.kind)) continue;
      (tally[s.kind] ??= []).push(s);
    }
    return tally;
  }, [stops, answeredHere, mutedHere]);

  /**
   * Everything the sweep settled, recorded at once, and the walk moved past all
   * of it.
   *
   * `recordAnswer` advances by ONE and takes one key. Calling it in a loop would
   * work off stale state on every iteration but the first, so the batch builds
   * the whole map and then finds the next open stop once.
   */
  function recordSwept(keys: string[], label: string) {
    const known = { ...answeredHere };
    for (const key of keys) known[key] = label;
    setAnsweredHere(known);
    let i = at;
    while (i < stops.length
           && (known[stops[i].key] || mutedHere.has(stops[i].kind))) {
      i += 1;
    }
    setAt(i);
  }

  /** Forward from an answered stop the writer walked Back onto: land on the
   *  next thing still open, which is wherever they were before going back. */
  function carryOn() {
    let i = at + 1;
    while (i < stops.length
           && (answeredHere[stops[i].key] || mutedHere.has(stops[i].kind))) {
      i += 1;
    }
    setAt(i);
  }

  async function answerAndAdvance(label: string, action: () => Promise<unknown>,
                                  mutedKind?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Only an explicit false keeps the writer here. Every other answer --
      // including whatever an endpoint happened to return -- means done.
      if (await action() !== false && stop) {
        recordAnswer(stop, label, mutedKind);
      }
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
    // The count the writer decides with is what the walk will actually ASK --
    // `total` includes stops answered for good in earlier sessions, and
    // quoting it here inflated the work: "This found 40 things" over a walk
    // that would ask 3 questions and end.
    const total = result?.total ?? 0;
    const open = stops.length;
    const settled = Math.max(0, total - open);
    return (
      <Shell onClose={onClose}>
        {/* Above everything, because it is a dialog rather than a section of
            this screen. Mounted here and on the stop card so it is reachable
            from both places a writer wonders what this pass is for. */}
        {guiding && <UnwovenGuide onClose={() => setGuiding(false)} />}
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

        {/* THE WHOLE WORLD, on the one pass where a bounded sitting would
            otherwise be the only thing the writer could see. Unwoven asks a
            dozen questions at a time out of a hundred, and without this the
            other eighty-eight are invisible: no way to tell four questions left
            from ninety, no way to choose to spend an evening on your religion,
            and a part of the world you FINISHED just quietly stopped appearing.
            The board answers all three. */}
        {depth === "unwoven_pass" && (
          <DomainBoard
            domains={result?.domains ?? []}
            chosen={domain}
            onChoose={setDomain}
            onShowGuide={() => setGuiding(true)}
          />
        )}

        {/* The real number, and what it means in hours rather than in units.
            "340" is information; "many sessions" is the thing a writer
            actually needs to decide with. */}
        <p className="mt-3 text-xs text-text-primary" data-testid="weaving-count">
          {scanning
            ? "Counting..."
            : total === 0
              ? "This pass found nothing to ask about."
              : open === 0
                ? "Everything this pass finds has already been answered."
                : `This found ${open} ${open === 1 ? "thing" : "things"} to look at.`}
        </p>

        {/* WHY BOTH BUTTONS ARE GREY, AND WHAT THIS PASS CANNOT SEE.
            ────────────────────────────────────────────────────────────────
            Reported from live testing after a walk through chapters 1 to 5:
            "I can't click Start Fresh or Carry on where you left off because
            it's greyed out. Not sure if this is a bug or it didn't pick up the
            names? The impression I get is that the walkthrough process stopped
            at 5 and didn't ever continue."

            It had not stopped. There was nothing left it could raise, and both
            buttons are disabled at zero because a walk with no stops is an
            empty popup. But a disabled button explains nothing, and the line
            above it used to say "Your world and your book agree" -- which is a
            claim this pass is in no position to make. It reads names. Chapter 6
            of that book has three men described rather than named ("the hulking
            figure", "the tall man") and two names revealed once each in
            dialogue, and it could not see any of the five.

            So at zero the screen now says what the pass looks for and what it
            does not, because a writer cannot tell "finished" from "broken" from
            a grey button, and the wrong one of those is a reason to distrust
            everything else the walk said. Per the flow rule, it also names the
            next step rather than leaving a dead end. */}
        {!scanning && open === 0 && (
          <div
            className="mt-2 rounded border border-border bg-surface px-2.5 py-2"
            data-testid="weaving-nothing-open"
          >
            <p className="text-[11px] text-text-muted">
              {total === 0
                ? "That does not mean your book and your world agree. It means this pass has run out of things it can find."
                : "Nothing new since your last session, so there is nothing to walk."}
            </p>
            <p className="mt-1.5 text-[11px] text-faint">
              This pass reads NAMES: a capitalised name your prose uses more
              than once, and names you wrote in your outline or notes. Three
              things it cannot see, all of them normal in a novel:
            </p>
            <ul className="mt-1 space-y-0.5 pl-3 text-[11px] text-faint">
              <li>
                A character described rather than named. "The tall man" and
                "the hulking figure" are characters, and to this pass they are
                ordinary words.
              </li>
              <li>
                A name said only once. One mention is the floor, and it is
                there because without it a book produces hundreds of stops
                that are not names at all.
              </li>
              <li>
                A name that only ever appears where a capital was required
                anyway, at the start of a sentence or a line of dialogue.
              </li>
            </ul>
            <p className="mt-1.5 text-[11px] text-faint">
              What to do next: try another pass above, since each one asks a
              different question. For characters your prose describes without
              naming, that is the Profile Extractor's job rather than this one.
            </p>
          </div>
        )}
        {!scanning && open > 0 && settled > 0 && (
          <p className="mt-1 text-[11px] text-faint">
            {settled} more {settled === 1 ? "was" : "were"} answered for good
            in earlier sessions and will not be asked again.
          </p>
        )}
        {!scanning && open > 60 && (
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

        {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}

        {/* CARRY ON, OR START FRESH -- and the difference stated, because it
            is not obvious. Anything applied or permanently declined lives in
            the BOOK and survives either way. What only a session holds is what
            you put off and which kinds you silenced, so starting fresh hands
            all of that back. Before this there was one Start button, which
            always meant "start fresh", and a writer who closed the app
            mid-walk met every question they had already deferred. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {earlier.length > 0 && (
            <button
              onClick={() => void begin(true)}
              disabled={busy || scanning || open === 0}
              className="inline-flex flex-col items-start rounded bg-violet-600 px-3 py-1.5 text-left text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-1.5">
                {busy ? <Loader size={12} className="animate-spin" /> : null}
                Carry on where you left off
              </span>
              <span className="text-[10px] font-normal text-violet-100/80">
                keeps what you put off last time
              </span>
            </button>
          )}
          <button
            onClick={() => void begin(false)}
            disabled={busy || scanning || open === 0}
            className={`inline-flex flex-col items-start rounded px-3 py-1.5 text-left text-xs font-semibold disabled:opacity-40 ${
              earlier.length > 0
                ? "border border-border text-text-muted hover:text-text-primary"
                : "bg-violet-600 text-white hover:bg-violet-500"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {busy && earlier.length === 0
                ? <Loader size={12} className="animate-spin" /> : null}
              {earlier.length > 0 ? "Start fresh" : "Start"}
            </span>
            {earlier.length > 0 && (
              <span className="text-[10px] font-normal text-faint">
                asks again about anything you put off
              </span>
            )}
          </button>
        </div>

        {earlier.length > 0 && (
          <p className="mt-2 text-[11px] text-faint">
            You have {earlier.length} earlier session
            {earlier.length === 1 ? "" : "s"}. Either way, nothing you have
            already applied or permanently declined comes back.
          </p>
        )}
      </Shell>
    );
  }

  // ── The walk is over ────────────────────────────────────────────────────
  if (!stop) {
    return (
      <Shell onClose={onClose}>
        <p className="text-xs text-text-primary">
          {/* A narrowed walk that runs out has NOT finished the pass, and
              saying it has would be the same class of lie R8.1 exists to fix.
              The way back out is offered below. */}
          {scope
            ? "That is everything in the chapters you narrowed to."
            : "That is everything this pass found."}
        </p>
        <p className="mt-1.5 text-[11px] text-text-muted">
          Anything you put off comes back next time. Anything you applied, or
          said was not a connection, does not. Nothing here is stored about
          your book itself -- it is worked out fresh every time, so as you
          write, this list changes on its own.
        </p>
        {scope && (
          <button
            onClick={() => narrow(null)}
            data-testid="widen-again"
            className="mt-3 mr-2 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            Look at the whole book again
          </button>
        )}
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

  // Walked Back onto something already answered this sitting. Shown as a
  // receipt instead of live buttons: re-showing the live question was how an
  // answer got re-fired and duplicated work -- and it read as the walk having
  // forgotten what the writer just did.
  const settledAs = answeredHere[stop.key]
    ?? (mutedHere.has(stop.kind)
        ? `Never ask (${lex?.term ?? stop.kind} is turned off)`
        : null);

  // Ruling 8: forty of a thing as a list. Inside the Shell rather than as a
  // full-screen overlay of its own, because it is a VIEW OF THE WALK -- the
  // writer is still in the same sitting, working through the same snapshot, and
  // the progress line above it is still true.
  if (sweeping && sweepable[sweeping]?.length) {
    return (
      // The list holds ticks and chapter picks that are not written yet, so the
      // guard says so rather than talking about a place in the walk.
      <Shell onClose={onClose}
             guard={"You are part-way through this list. Close Weaving and lose "
                    + "the rows you have ticked?"}>
        <Sweep
          stops={sweepable[sweeping]}
          kind={sweeping}
          chapters={chapters}
          onPlace={async (target, anchor) => {
            const fact = (target.detail?.sides as { id?: string }[] | undefined)?.[0];
            if (!fact?.id) throw new Error("That fact could not be identified.");
            await patchFact(projectPath, target.entity_id, String(fact.id),
                            { at: anchor });
            // The file is written, so the answer is permanent -- the same
            // two-phase rule the one-at-a-time path follows.
            if (runId) await apply(projectPath, runId, target);
          }}
          onRecordPlace={async (target, anchors) => {
            // Same two-phase rule the one-at-a-time path follows: the file is
            // written first, and only then is the stop answered for good.
            await placeThread(projectPath, target.entity_id, anchors);
            if (runId) await apply(projectPath, runId, target);
          }}
          onDismiss={async target => {
            if (runId) await dismiss(projectPath, runId, target);
          }}
          onDone={settled => {
            setSweeping(null);
            recordSwept(settled, "Done in the list");
          }}
          onClose={() => setSweeping(null)}
        />
      </Shell>
    );
  }

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
        // Closing BEFORE anything moved goes back to the same stop. Closing
        // AFTER the absorb finishes the stop: the placeholder this stop points
        // at was deleted by the move, so returning to it would show a question
        // about an entry that no longer exists -- with buttons that 404.
        onClose={() => {
          setNaming(false);
          if (bound) {
            setBound(false);
            void (async () => {
              await recordApplied(stop);
              recordAnswer(stop, "Done here");
            })();
          }
        }}
        onBound={() => setBound(true)}
      />
    );
  }

  // The two answers an Unspun stop could not give: the flagged word is WRONG,
  // or it belongs to something the writer already has. Placed before Quick
  // Entry because it is the step that decides whether Quick Entry is even the
  // right destination.
  if (fixingWord && stop) {
    const flagged = String(stop.detail?.name ?? "");
    return (
      <WordFix
        projectPath={projectPath}
        word={flagged}
        candidates={world}
        onCreateInstead={corrected => {
          // Their wording travels with them rather than being typed twice.
          setCorrectedName(corrected);
          setFixingWord(false);
          setEntering(true);
        }}
        onDone={retire => {
          setFixingWord(false);
          void (async () => {
            // A corrected word means the phrase the scan found was not a thing,
            // so it is retired -- otherwise the same wrong grouping is offered
            // again on the next scan, which is the loop this screen exists to
            // break. `dismiss` carries the phrase; the receipt already said so.
            if (runId) {
              await dismiss(projectPath, runId, stop, retire || undefined);
            }
            recordAnswer(stop, retire ? "Corrected and attached" : "Attached");
          })();
        }}
        onClose={() => setFixingWord(false)}
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
        name={unwoven ? ""
                      : correctedName || String(stop.detail?.name ?? "")}
        aliases={alsoCalled(stop)}
        kind={unwoven ? (lands[0] ?? "concept") : "character"}
        kindLocked={unwoven}
        section={unwoven ? lands[1] : undefined}
        prefill={unwoven ? undefined : stop.quote || undefined}
        asking={unwoven ? stop.title : undefined}
        questionId={unwoven ? String(stop.detail?.question_id ?? "") : undefined}
        candidates={world}
        onClose={() => setEntering(false)}
        // Finished: record the answer and move on. The ledger is what lets a
        // created entry never be asked about again even before the next scan.
        onDone={() => {
          setEntering(false);
          void (async () => {
            await recordApplied(stop);
            recordAnswer(stop, "Done here");
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
            await recordApplied(stop);
            recordAnswer(stop, "Done here");
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
            await recordApplied(stop);
            recordAnswer(stop, "Done here");
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
        // Loose and Untied stops are not marked answered: they are RE-DERIVED
        // next scan, and an entry that now has a connection stops being asked
        // about because the condition ended. A PIN is different -- it is the
        // writer's own mark and stays raised until ANSWERED, never re-derived
        // away. Recording the apply is what unpins it server-side; without it
        // the same pin returned on every future walk, forever.
        onDone={() => {
          setConnecting(false);
          void (async () => {
            if (stop.kind === "pinned") await recordApplied(stop);
            recordAnswer(stop, "Done here");
          })();
        }}
        onChanged={() => { /* the scan re-derives it on the next pass */ }}
      />
    );
  }

  return (
    <Shell onClose={onClose} guard={walkGuard}>
      {/* MOUNTED ON THE WALK TOO, and it was not. The Unwoven stop card offers
          "Show me how this works" and the guide was rendered only in the setup
          branch above, so on a stop the button set a flag and drew nothing --
          a dead control in the middle of the walk, which is the same failure as
          R2.12f (a guide nothing offers) with the halves the other way round.
          Found by reading the two mount points against the two callers. */}
      {guiding && <UnwovenGuide onClose={() => setGuiding(false)} />}

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

      {/* A Tangle has no quote, because its evidence is a LIST: the findings it
          gathered. Shown before the button for the same reason every other
          stop's quote is -- a decision made without seeing what prompted it is
          not a decision, and "5 problems" without the five is a number. */}
      {tangleMembers(stop).length > 0 && (
        <ol className="mt-2 space-y-0.5 rounded border-l-2 border-rose-900/70 bg-bg-surface px-2 py-1.5"
            data-testid="tangle-members">
          {tangleMembers(stop).map((m, i) => (
            <li key={m.key ?? i} className="text-[11px] text-text-muted">
              {i + 1}. {m.summary}
            </li>
          ))}
        </ol>
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
          <button
            onClick={() => setGuiding(true)}
            className="text-[11px] text-violet-300 underline-offset-2 hover:underline"
          >
            Show me how this works
          </button>
          {/* WHAT THIS SITTING IS NOT ASKING. A bounded list that presents
              itself as the whole list is a lie the writer cannot see, and this
              walk's entire job is to be believable about how much is left. */}
          {Number(stop.detail.domain_open ?? 0) > 1 && (
            <p data-testid="unwoven-remaining">
              {String(stop.detail.domain_label ?? "This part")} has{" "}
              {Number(stop.detail.domain_open) - 1} more question
              {Number(stop.detail.domain_open) === 2 ? "" : "s"} open. They are
              not going anywhere.
            </p>
          )}
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
      {notice && (
        <p role="status" className="mt-2 text-[11px] text-amber-200/90">
          {notice}
        </p>
      )}
      {/* Said once, on the first stop of a resumed walk. A writer who chose
          "carry on" should see that it took -- and a resumed walk is shorter
          than a fresh one, which would otherwise look like something missing. */}
      {resumed && at === 0 && (
        <p className="mt-2 text-[11px] text-violet-300" data-testid="resumed-note">
          Carrying on from your last sitting -- anything you put off then is
          still put off.
        </p>
      )}

      {/* THE BOOK CHANGED UNDER THE WALK. Shown on the first stop, with the
          count, where it came from, and the offer to look at just that. The
          backend has always known this and nothing has ever said it. */}
      {at === 0 && (
        <StaleNotice
          report={result?.resumed}
          onRecheck={narrow}
          scoped={scope !== null}
          busy={scanning}
        />
      )}

      {/* And on the card itself, for the one the writer is looking at. The
          banner explains the situation once; this answers "is this one of
          them?" at the moment that question can actually be acted on. */}
      {staleKeys.has(stop.key) && <StaleMark />}

      {/* THE TWO ANSWERS AN UNSPUN STOP COULD NOT GIVE, offered before the
          buttons because they are about whether the QUESTION is right. Weaving
          guesses where one name ends and the next begins; when it guesses wrong
          the writer used to have two wrong answers and no right one -- make a
          profile you know is wrong, or permanently silence a word that is a
          real name in a form you would have accepted.

          Reported with an example that had both faults at once: "Blaskowitz
          Sideburn" is part of a surname glued to part of a nickname, and
          "there was no way for me to edit the text it flagged ... I couldn't
          CONNECT that name to an existing profile for Newton." */}
      {/* WHERE THIS APPEARS. The offer half of declared presence: the scan
          read the manuscript for free and can see which chapters name this
          entry, so it asks rather than making the writer find out. Answering
          is what lets the AI brief carry this chapter's part of the world
          instead of all of it. */}
      {stop.kind === "place" && (
        <PlaceStop
          name={String(stop.detail?.name ?? "this entry")}
          found={(stop.detail?.found as string[]) ?? []}
          already={(stop.detail?.already as string[]) ?? []}
          chapters={chapters}
          busy={busy}
          onSave={appearsIn => void answerAndAdvance(
            appearsIn.length
              ? `Recorded in ${appearsIn.length} ${appearsIn.length === 1
                  ? "chapter" : "chapters"}`
              : "Cleared where it appears",
            () => placeThread(projectPath, stop.entity_id, appearsIn))}
          onSkip={() => void answerAndAdvance("Not yet", () =>
            runId ? defer(projectPath, runId, stop) : Promise.resolve())}
        />
      )}

      {stop.kind === "unspun" && (
        <button
          onClick={() => void (async () => {
            await loadWorld();
            setFixingWord(true);
          })()}
          data-testid="word-fix-offer"
          className="mt-2 w-full rounded border border-violet-800 bg-violet-950/25 px-2.5 py-1.5 text-left text-[11px] text-violet-100 hover:border-violet-600"
        >
          <span className="font-medium">
            Not right? Fix the word, or say who it belongs to
          </span>
          <span className="block text-[10px] text-faint">
            correct what was flagged, or make it another name for an entry you
            already have
          </span>
        </button>
      )}

      {/* RULING 8, OFFERED RATHER THAN IMPOSED. The spec's words are "not a
          forced march", and a list that replaced the walk would be a different
          forced march. So the walk still works, and when there is more than one
          of a kind whose answer is the same shape every time, the card says so
          and offers the list. Below the threshold it says nothing: "work through
          all 1 at once" is a button that does nothing but cost a click. */}
      {SWEEPABLE.has(stop.kind) && (sweepable[stop.kind]?.length ?? 0) > 1 && (
        <button
          onClick={() => setSweeping(stop.kind)}
          data-testid="sweep-offer"
          className="mt-2 w-full rounded border border-violet-800 bg-violet-950/25 px-2.5 py-1.5 text-left text-[11px] text-violet-100 hover:border-violet-600"
        >
          <span className="font-medium">
            Work through all {sweepable[stop.kind].length} at once
          </span>
          <span className="block text-[10px] text-faint">
            {stop.kind === "unplaced"
              ? "one list, a chapter each, rather than one screen each"
              : "tick the ones that are fine unconnected and say so in one go"}
          </span>
        </button>
      )}

      {settledAs ? (
        <div data-testid="already-answered"
             className="mt-3 rounded border border-emerald-800 bg-emerald-950/20 p-2.5">
          <p className="flex items-start gap-1.5 text-[11px] text-emerald-200">
            <Check size={12} className="mt-0.5 shrink-0" />
            <span>
              You answered this one this sitting:{" "}
              <span className="font-medium text-text-primary">{settledAs}</span>.
            </span>
          </p>
          <button
            onClick={carryOn}
            className="mt-2 inline-flex flex-col items-start rounded border border-border px-2.5 py-1 text-left text-xs text-text-muted hover:border-text-muted hover:text-text-primary"
          >
            <span>Carry on</span>
            <span className="text-[10px] text-faint">
              back to the next thing still waiting
            </span>
          </button>
        </div>
      ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => void answerAndAdvance("Done here", async () => {
            if (!runId) return false;
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
            // NOTHING MATCHED. A stale stop can point at an entry that no
            // longer exists (absorbed, renamed, deleted since the scan). The
            // old fall-through ADVANCED here -- the button pressed, nothing
            // opened, and the walk moved on as if something had been done.
            setError(
              "This cannot be opened: the entry it points at is no longer in "
              + "your world -- likely absorbed or removed since the walk "
              + "started. \"Not yet\" and the permanent no below still work.");
            return false;
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
          onClick={() => void answerAndAdvance(
            DISMISS_ACTION[stop.kind] ?? "Never raise this again", () =>
            runId ? dismiss(projectPath, runId, stop,
                            stop.kind === "unspun"
                              ? String(stop.detail.name ?? "")
                              : undefined)
                  : Promise.resolve())}
          disabled={busy}
          title="Permanently. This will not be raised again."
          className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {DISMISS_ACTION[stop.kind] ?? "Never raise this again"}
        </button>

        <button
          onClick={() => void answerAndAdvance("Not yet", () =>
            runId ? defer(projectPath, runId, stop) : Promise.resolve())}
          disabled={busy}
          title="It comes back next time."
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          <Clock size={11} /> Not yet
        </button>

        {/* R8.3. This used to be one button that meant the WHOLE BOOK and did
            not say so. The spec's word was "for this target", and the two wants
            are genuinely different: a deliberately unreliable narrator should
            stop being asked about contradictions, and a writer with only that
            entry in mind used to turn the check off everywhere to get it. So the
            button asks which, and neither choice is written until it is made. */}
        <button
          onClick={() => setMuting(true)}
          disabled={busy}
          title={`Stop being asked about ${lex?.term ?? stop.kind}. You choose how widely.`}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-faint hover:text-text-primary disabled:opacity-40"
        >
          <BellOff size={11} /> Never ask
        </button>
      </div>
      )}

      {muting && (
        <div className="mt-2 rounded border border-border bg-bg-surface p-2"
             data-testid="mute-scope">
          <p className="text-[11px] text-text-primary">
            Stop being asked about {lex?.term ?? stop.kind} -- how widely?
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {/* Only when there IS a target. An Unspun name has no entry yet, so
                "about this one" would name nothing and silence nothing. */}
            {stop.entity_id && (
              <button
                onClick={() => {
                  setMuting(false);
                  void answerAndAdvance(
                    `Never ask about ${muteTargetName(stop)}`,
                    () => runId
                      ? muteKind(projectPath, runId, stop.kind, true,
                                 stop.entity_id)
                      : Promise.resolve());
                }}
                disabled={busy}
                data-testid="mute-this-one"
                className="inline-flex flex-col items-start rounded border border-violet-700 bg-violet-500/10 px-2.5 py-1 text-left text-xs text-text-primary hover:border-violet-500 disabled:opacity-40"
              >
                <span>About {muteTargetName(stop)} only</span>
                <span className="text-[10px] font-normal text-faint">
                  the rest of your book is still checked
                </span>
              </button>
            )}
            <button
              onClick={() => {
                setMuting(false);
                // The kind rides along so every LATER stop of it is skipped in
                // this sitting too -- the server already knew, but the stop list
                // is a snapshot, and a mute the current walk ignores reads as a
                // button that does not work.
                void answerAndAdvance("Never ask anywhere",
                  () => runId ? muteKind(projectPath, runId, stop.kind)
                              : Promise.resolve(),
                  stop.kind);
              }}
              disabled={busy}
              data-testid="mute-everywhere"
              className="inline-flex flex-col items-start rounded border border-border px-2.5 py-1 text-left text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              <span>Anywhere in the book</span>
              <span className="text-[10px] font-normal text-faint">
                this kind of question stops entirely
              </span>
            </button>
            <button
              onClick={() => setMuting(false)}
              className="self-start rounded px-2 py-1 text-[11px] text-faint hover:text-text-primary"
            >
              Back
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-faint">
            Either one is reversible. It is a preference about what you want to
            be asked, not a judgement about your book.
          </p>
        </div>
      )}

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
function Shell({ children, onClose, guard }: {
  children: React.ReactNode;
  onClose: () => void;
  /** What closing would cost right now, or "" for nothing. The OUTERMOST
   *  backdrop, and the one the writer reported hitting repeatedly: "very
   *  sensitive to accidental clicking outside the field causing the entire
   *  window to Exit prematurely. Then having to start over again where the
   *  weaving left off." */
  guard?: string;
}) {
  const attemptClose = useAttemptClose(
    Boolean(guard), onClose, guard || "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
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
          {/* The X goes through the same guard as the backdrop and Escape. A
              deliberate press still confirms when there is work to lose, which
              is right: the X is one pixel from the corner of the panel. */}
          <button onClick={attemptClose} aria-label="Close Weaving"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={14} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
