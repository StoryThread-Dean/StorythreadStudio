// features/codex/Sweep.tsx -- forty of a thing, as a list rather than forty screens
// =================================================================================
// Ruling 8, from the 2026-08-11 audit, in the writer's own words:
//
//     "Forty unplaced facts should be a tick-list, not forty screens."
//
// The spec had said so from the start -- Unplaced is "a multi-select list, not a
// forced march: tick what to place now, leave the rest" -- and it shipped as a
// one-at-a-time walk anyway. The ruling was approved and then never became a
// task id, so nothing was comparing the build against it.
//
// WHY THESE TWO KINDS AND NOT THE OTHERS. A stop belongs here when the answer is
// the SAME SHAPE every time and the writer is mostly triaging:
//
//   Unplaced      one fact, one chapter. Forty of them is forty dropdowns, and a
//                 writer who knows their book can fill them faster than they can
//                 click Next.
//   Loose thread  the batch answer is the NO. Thirty entries that do not need a
//                 connection is one sentence ("these are fine"), and thirty
//                 screens each asking a question the writer has already answered
//                 in their head is how a walkthrough teaches them to click
//                 through it.
//
// A Snag is not here on purpose. Every one is a different argument, and a
// tick-list would invite settling them without reading them -- which is the one
// thing a contradiction checker must never make easy. Frayed is not here either:
// filling in prose is writing, not triage.
//
// NOTHING IS TICKED WHEN THIS OPENS. This writes to the writer's own files, and
// a screen that arrives with forty boxes ticked and a Place button is a bulk
// write they did not choose. Same rule the storage dialog follows.
//
// House style: no em dashes anywhere a writer reads.

import { useState } from "react";
import { ArrowRight, Check, Loader, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import type { ChapterAnchor } from "./api";
import type { Stop } from "./weavingApi";

/** The kinds that read better as a list. Everything else stays a walk. */
export const SWEEPABLE = new Set(["unplaced", "loose_thread", "place"]);

/** What one row can carry, per kind. */
interface Row {
  stop: Stop;
  /** The writer-facing text of the thing being triaged. */
  what: string;
  /** Unplaced only: which chapter this fact would be placed at. */
  at: string;
}

interface SweepProps {
  /** Every stop of ONE kind, in the order the scan produced them. */
  stops: Stop[];
  kind: string;
  chapters: ChapterAnchor[];
  /** Place a fact. Resolves when written. */
  onPlace: (stop: Stop, anchor: string) => Promise<void>;
  /** `place` only: record where an entry appears. A LIST, not one anchor --
   *  the question here is "which chapters is this in", and the scan has
   *  already answered it. Ticking a row accepts that answer wholesale; a
   *  writer who wants to change it deals with the stop one at a time, where
   *  the chapters are individually tickable. */
  onRecordPlace?: (stop: Stop, anchors: string[]) => Promise<void>;
  /** The permanent no, for the ticked rows. */
  onDismiss: (stop: Stop) => Promise<void>;
  /** Finished with these -- the walk skips every one of them. `settled` is the
   *  stop keys that were actually dealt with, so the ones left alone come back. */
  onDone: (settled: string[]) => void;
  /** Back to one at a time, having changed nothing. */
  onClose: () => void;
  /**
   * Deal with THIS one properly: leave the list and land the walk on this
   * exact stop.
   *
   * Reported from live testing, about the Loose thread sweep: the writer
   * expected the batch screen to be where connections get made, found it
   * offered only "these need no connection" and a way out, and read the whole
   * screen as purposeless.
   *
   * The batch answer really is the NO -- see the header of this file, and note
   * that a Tie REQUIRES a reason line, so seven connections cannot be seven
   * ticks without seven reasons. But two of the three header sentences here
   * already told the writer to "deal with one properly" / "deal with that one
   * on its own", and there was no control that did it. The only way out was
   * "Go one at a time instead", which abandons the list and drops the walk
   * back at the top of the kind.
   *
   * Same shape as R8.1 and R11.6: words describing an action with nothing
   * behind them. This is the something.
   *
   * Stays INSIDE the closed world -- it moves the walk's own position and
   * calls nothing that could send the writer out of the panel.
   */
  onDealWith?: (stop: Stop) => void;
}

/** What a row says it is, per kind. Unplaced carries the fact's own words; a
 *  Loose thread is about the ENTRY, so it carries the entry's name. */
function describe(stop: Stop, kind: string): string {
  if (kind === "unplaced") {
    const sides = stop.detail?.sides;
    const first = Array.isArray(sides) ? sides[0] : undefined;
    const value = String((first as { value?: string } | undefined)?.value ?? "");
    return value.trim() || String(stop.detail?.name ?? "(nothing written)");
  }
  return String(stop.detail?.name ?? stop.title);
}

export function Sweep({ stops, kind, chapters, onPlace, onRecordPlace,
                        onDismiss, onDone, onClose, onDealWith }: SweepProps) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>(
    () => stops.map(stop => ({ stop, what: describe(stop, kind), at: "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What has actually been dealt with, so a failure part way through does not
  // claim the whole list was settled.
  const [settled, setSettled] = useState<Set<string>>(new Set());

  const unplaced = kind === "unplaced";
  const placing = kind === "place";
  const open = rows.filter(r => !settled.has(r.stop.key));

  function toggle(key: string) {
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function setAnchor(key: string, anchor: string) {
    setRows(prev => prev.map(r =>
      r.stop.key === key ? { ...r, at: anchor } : r));
    // Choosing a chapter IS the intent to place it, so the row ticks itself.
    // Asking for the chapter and then asking again with a checkbox is two
    // clicks for one decision.
    setTicked(prev => new Set(prev).add(key));
  }

  const chosen = open.filter(r => ticked.has(r.stop.key));
  // A ticked Unplaced row with no chapter cannot be placed. Counted rather than
  // silently skipped, because "Place 12" that places 9 is the kind of quiet
  // arithmetic that makes a writer stop trusting a count.
  const missingAnchor = unplaced ? chosen.filter(r => !r.at).length : 0;
  const placeable = unplaced ? chosen.filter(r => r.at) : chosen;

  /** The chapters the scan found for one row, plus what was already recorded --
   *  which is what accepting means: add to the writer's statement rather than
   *  replace it, or accepting a suggestion about chapter six would silently
   *  drop chapter one. */
  const anchorsFor = (row: Row): string[] => {
    const found = (row.stop.detail?.found as string[]) ?? [];
    const already = (row.stop.detail?.already as string[]) ?? [];
    return [...new Set([...already, ...found])];
  };

  async function run(work: (row: Row) => Promise<void>, rowsToDo: Row[]) {
    setBusy(true);
    setError(null);
    const done = new Set(settled);
    try {
      for (const row of rowsToDo) {
        await work(row);
        done.add(row.stop.key);
      }
      setSettled(done);
      setTicked(new Set());
      // Everything gone means the sweep is finished. Anything left and the
      // writer stays here to keep going.
      if (rows.every(r => done.has(r.stop.key))) onDone([...done]);
    } catch (e) {
      // PARTIAL PROGRESS IS KEPT. Half of forty writes landing and the screen
      // resetting would make the writer redo work that is already on disk.
      setSettled(done);
      setError(e instanceof Error
        ? `${e.message} ${done.size} of ${rowsToDo.length} were done.`
        : "Some of those could not be written.");
    } finally {
      setBusy(false);
    }
  }

  // What the per-row escape is FOR, in the writer's terms rather than one
  // generic word. On a Loose thread it is the action the batch cannot do at
  // all; on the other two it is the exception to a batch that usually fits.
  const rowAction = unplaced ? "Open" : placing ? "Change" : "Connect";

  const label = unplaced ? "unplaced fact"
    : placing ? "entry to place"
    : "unconnected entry";
  const plural = open.length === 1 ? label : `${label}s`;

  return (
    <div
      role="dialog"
      aria-label={`All ${open.length} ${plural}`}
      data-testid="sweep"
      className="flex max-h-[80vh] flex-col"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold text-text-primary">
          All {open.length} {plural}
        </h3>
        <span className="ml-auto shrink-0">
          <Explain of={unplaced ? "weaving.sweep-unplaced"
                       : placing ? "weaving.sweep-place"
                       : "weaving.sweep-loose"} />
        </span>
      </div>

      <p className="mt-1 text-mini text-faint">
        {unplaced
          ? "Tick the ones you want to place and choose a chapter for each. "
            + "Leave the rest; they come back next time."
          : placing
            ? "Your writing puts each of these in the chapters listed beside "
              + "it. Tick the ones that look right and record them in one go. "
              + "To change which chapters, open that one on its own."
            : "These entries connect to nothing yet. Ticking is how you say a "
              + "batch of them are fine unconnected. A connection needs a "
              + "reason of its own, so it is made one at a time -- open any "
              + "row to make one now."}
      </p>

      {settled.size > 0 && (
        <p className="mt-1 text-mini text-success" data-testid="sweep-done">
          {settled.size} settled. {open.length} left.
        </p>
      )}

      <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {open.map(row => {
          const type = threadTypeEntry(String(row.stop.detail?.type ?? ""));
          const KindIcon = type.Icon;
          return (
            <li key={row.stop.key}
                className="flex items-start gap-2 rounded border border-border px-2 py-1.5">
              <input
                type="checkbox"
                checked={ticked.has(row.stop.key)}
                onChange={() => toggle(row.stop.key)}
                aria-label={row.what}
                className="mt-0.5 shrink-0 accent-weave-fill"
              />
              <KindIcon size={12}
                        className={`mt-0.5 shrink-0 ${TONE_CLASSES[type.tone].text}`} />
              <span className="min-w-0 flex-1 text-mini text-text-primary">
                {row.what}
                {/* Which entry an unplaced fact belongs to. Without it a list of
                    forty fact texts is forty sentences with no owner. */}
                {unplaced && row.stop.detail?.name ? (
                  <span className="text-faint"> on {String(row.stop.detail.name)}</span>
                ) : null}
              </span>
              {/* WHICH CHAPTERS, on the row. The whole decision here is
                  "does that look right", and it cannot be made without seeing
                  the answer being offered. */}
              {placing && (
                <span className="shrink-0 text-micro text-accent-strong/90"
                      data-testid="sweep-place-chapters">
                  {anchorsFor(row).map(anchor =>
                    chapters.find(c => c.anchor === anchor)?.title ?? anchor)
                    .join(", ")}
                </span>
              )}
              {unplaced && (
                <select
                  value={row.at}
                  onChange={e => setAnchor(row.stop.key, e.target.value)}
                  aria-label={`Chapter for ${row.what}`}
                  className="shrink-0 rounded border border-border bg-bg-surface px-1 py-0.5 text-mini text-text-primary outline-none focus:border-accent-fill"
                >
                  <option value="">chapter ...</option>
                  {chapters.map(c => (
                    <option key={c.anchor} value={c.anchor}>{c.title}</option>
                  ))}
                </select>
              )}
              {/* DEAL WITH THIS ONE PROPERLY. On every row, because all three
                  header sentences send the writer here for the case the batch
                  cannot answer, and until now none of them could be obeyed.
                  For a Loose thread that case is the whole point: a connection
                  carries a reason, so it is made on its own screen. */}
              {onDealWith && (
                <button
                  type="button"
                  onClick={() => onDealWith(row.stop)}
                  disabled={busy}
                  data-testid="sweep-deal-with"
                  aria-label={`${rowAction} ${row.what}`}
                  title={"Leave the list on this one and deal with it properly."
                         + " The rows you have ticked but not yet saved are"
                         + " dropped."}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-micro text-text-muted hover:border-weave-fill hover:text-text-primary disabled:opacity-40"
                >
                  {rowAction} <ArrowRight size={9} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-mini text-danger">{error}</p>
      )}

      {missingAnchor > 0 && (
        <p className="mt-1.5 text-mini text-warn-strong" data-testid="sweep-no-chapter">
          {missingAnchor} ticked {missingAnchor === 1 ? "row has" : "rows have"} no
          chapter chosen, so {missingAnchor === 1 ? "it" : "they"} cannot be
          placed yet.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {unplaced && (
          <button
            onClick={() => void run(r => onPlace(r.stop, r.at), placeable)}
            disabled={busy || placeable.length === 0}
            data-testid="sweep-place"
            className="inline-flex items-center gap-1 rounded bg-weave-fill px-2.5 py-1 text-xs font-semibold text-white hover:bg-weave-fill disabled:opacity-40"
          >
            {busy ? <Loader size={11} className="animate-spin" />
                  : <Check size={11} />}
            Place {placeable.length}
          </button>
        )}
        {placing && onRecordPlace && (
          <button
            onClick={() => void run(
              r => onRecordPlace(r.stop, anchorsFor(r)), chosen)}
            disabled={busy || chosen.length === 0}
            data-testid="sweep-record-place"
            className="inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
          >
            {busy ? <Loader size={11} className="animate-spin" />
                  : <Check size={11} />}
            Record {chosen.length}
          </button>
        )}
        <button
          onClick={() => void run(r => onDismiss(r.stop), chosen)}
          disabled={busy || chosen.length === 0}
          data-testid="sweep-dismiss"
          className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {unplaced
            ? `Leave ${chosen.length} unplaced for good`
            : placing
              ? `Do not place ${chosen.length}`
              : `${chosen.length} need no connection`}
        </button>
        <span className="flex-1" />
        {/* THE WAY BACK, always. The spec's words are "not a forced march", and
            a list the writer cannot leave is a longer march than the walk. */}
        <button
          onClick={onClose}
          data-testid="sweep-one-at-a-time"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-mini text-faint hover:text-text-primary"
        >
          <X size={10} /> Go one at a time instead
        </button>
      </div>

      {/* Nothing left, but the sweep is still open because the writer settled
          the last row rather than the list emptying under them. */}
      {open.length === 0 && (
        <button
          onClick={() => onDone([...settled])}
          data-testid="sweep-finished"
          className="mt-2 rounded border border-success-fill bg-success-soft/30 px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-success-soft/50"
        >
          That is all of them. Carry on.
        </button>
      )}
    </div>
  );
}
