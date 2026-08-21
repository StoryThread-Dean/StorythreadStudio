// features/codex/StaleNotice.tsx -- the walk admitting its evidence moved
// ========================================================================
// R8.1, and it closes a gap that existed for one dull reason: the backend
// computed staleness correctly from the first day, returned the count, and no
// screen ever read it. So a stop the writer had put off -- about a sentence
// they have since rewritten -- came back quoting the NEW sentence with no sign
// that the question was older than the words in it.
//
// The spec's line is "nothing is silently shown as current when it is not".
// Two things are needed for that and neither is a count on its own:
//
//   the banner   how many, why, and what the writer can do about it
//   the mark     on the individual card, so they know WHICH one they are
//                looking at while they look at it
//
// Both live here. The banner offers the scoped re-check, which is a plain scan
// narrowed to the chapters that moved -- free, like every scan, and worth
// offering because "re-read the whole book" is a different-sized decision from
// "look at the two chapters I edited last night".
//
// House style: no em dashes anywhere a writer reads.

import { History, RefreshCw } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import type { ResumeReport } from "./weavingApi";

interface StaleNoticeProps {
  report: ResumeReport | undefined;
  /** Re-scan narrowed to the chapters that changed. Null clears the narrowing
   *  and goes back to the whole book. */
  onRecheck: (chapterIds: string[] | null) => void;
  /** Whether the walk is currently narrowed, so the notice can offer the way
   *  back rather than the way in. A narrowing with no exit is a trap. */
  scoped: boolean;
  busy?: boolean;
}

export function StaleNotice({ report, onRecheck, scoped,
                              busy = false }: StaleNoticeProps) {
  const stale = report?.stale ?? 0;
  const chapters = report?.chapters ?? [];
  const elsewhere = report?.stale_elsewhere ?? 0;

  // Nothing changed under this sitting, so there is nothing to admit. A banner
  // that appears on every resume saying "0 stale" is noise that teaches the
  // writer to stop reading banners.
  if (stale === 0 && !scoped) return null;

  return (
    <div
      data-testid="stale-notice"
      className="mt-2 rounded border border-amber-900/70 bg-amber-950/20 p-2"
    >
      <p className="flex items-start gap-1.5 text-mini text-amber-100">
        <History size={12} className="mt-0.5 shrink-0 text-amber-300" />
        <span>
          {stale > 0 ? (
            <>
              {stale} {stale === 1 ? "question" : "questions"} you put off
              {stale === 1 ? " is" : " are"} about text that has changed since.
              {stale === 1 ? " It is" : " They are"} being asked again about the
              new wording, not the old.
            </>
          ) : (
            <>Looking at what changed only.</>
          )}
        </span>
        <span className="ml-auto shrink-0">
          <Explain of="weaving.stale" />
        </span>
      </p>

      {/* WHERE. Named rather than counted, because "2 chapters" is not
          something a writer can recognise and "Chapter 4 and Chapter 11" is. */}
      {stale > 0 && chapters.length > 0 && (
        <p className="mt-1 text-mini text-faint" data-testid="stale-where">
          In {chapters.join(", ")}.
          {elsewhere > 0 && (
            <>
              {" "}
              {elsewhere} more {elsewhere === 1 ? "is" : "are"} not about a
              chapter, so narrowing to these leaves{" "}
              {elsewhere === 1 ? "it" : "them"} out.
            </>
          )}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {scoped ? (
          <button
            onClick={() => onRecheck(null)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-mini text-text-muted hover:text-text-primary disabled:opacity-40"
          >
            <RefreshCw size={10} /> Look at all of it again
          </button>
        ) : chapters.length > 0 ? (
          <button
            onClick={() => onRecheck(chapters)}
            disabled={busy}
            data-testid="stale-recheck"
            className="inline-flex items-center gap-1 rounded border border-amber-800 px-2 py-0.5 text-mini text-amber-100 hover:border-amber-600 disabled:opacity-40"
          >
            <RefreshCw size={10} />
            Re-check just{" "}
            {chapters.length === 1 ? "that chapter" : `those ${chapters.length} chapters`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The mark on one card. Small on purpose: the banner has already explained the
 * situation, and this only has to answer "is this one of them?".
 */
export function StaleMark() {
  return (
    <p
      data-testid="stale-mark"
      className="mt-2 flex items-start gap-1.5 rounded border border-amber-900/70 bg-amber-950/20 px-2 py-1 text-mini text-amber-100"
    >
      <History size={11} className="mt-0.5 shrink-0 text-amber-300" />
      <span>
        You put this one off before, and the text it was about has been
        rewritten since. What is quoted above is the new wording.
      </span>
    </p>
  );
}
