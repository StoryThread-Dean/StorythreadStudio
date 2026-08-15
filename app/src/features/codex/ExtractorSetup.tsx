// features/codex/ExtractorSetup.tsx -- what will be read, and what it costs
// =========================================================================
// The screen before the money. Three things have to happen here or the feature
// gets blamed for problems it did not cause:
//
//   1. IT SAYS WEAVING COMES FIRST. Not sequencing advice -- it is what makes
//      the pass work. The request carries a snippet of every entry the writer
//      already has, so the entries have to exist before there is anything to
//      build on. Run it on an empty world and it proposes one from scratch with
//      nothing to match against, which is the expensive way to get the noisiest
//      possible result. A writer who does that concludes the feature is bad
//      when they have simply run it too early.
//
//   2. IT SAYS WHAT IT IS. A draft to edit, not an answer. Nothing here is
//      checked against anything, and the screen says so in its own words rather
//      than in a footnote.
//
//   3. IT NEVER DESTROYS UNREVIEWED WORK QUIETLY. A new run supersedes the old
//      one, which is what the writer asked for. Doing it without saying how
//      many proposals they paid for are about to go is not.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Loader, Sparkles } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { ExtractorGuide } from "./ExtractorGuide";
import {
  fetchPlan, runExtraction,
  type ExtractionRun, type ExtractorPlan,
} from "./extractorApi";
import { CodexApiError } from "./api";

interface Props {
  projectPath: string;
  onExtracted: (run: ExtractionRun) => void;
  /** There is a saved run already; offer the way back to it. */
  onOpenCurrent?: () => void;
}

export function ExtractorSetup({ projectPath, onExtracted, onOpenCurrent }: Props) {
  const [plan, setPlan] = useState<ExtractorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whole manuscript is the recommended path; per-chapter is for addenda,
  // fixes and additions afterwards. Empty set means everything.
  const [chapters, setChapters] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // The count a new run would destroy, once the writer has asked to start one.
  const [confirmReplace, setConfirmReplace] = useState<number | null>(null);
  // MOUNTED HERE AND ON THE REVIEW SCREEN, both, and that is the R2.12f
  // lesson rather than duplication: a guide reachable only from the screen a
  // writer is not on is documentation. The order-of-operations page is the
  // one that saves them money, so it has to be reachable before they spend.
  const [guiding, setGuiding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await fetchPlan(projectPath);
      setPlan(body);
      // The smart default, applied ONCE on load rather than enforced: every
      // tick is the writer's to change, and re-applying it would fight them.
      setExcluded(new Set(body.known.filter(k => k.suggest_exclude)
                                    .map(k => k.entity_id)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this project.");
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void load(); }, [load]);

  const start = useCallback(async (replaceExisting: boolean) => {
    setRunning(true);
    setError(null);
    try {
      const body = await runExtraction({
        project_path: projectPath,
        chapter_ids: [...chapters],
        exclude: [...excluded],
        replace_existing: replaceExisting,
      });
      setConfirmReplace(null);
      onExtracted(body.run);
    } catch (e) {
      if (e instanceof CodexApiError && e.code === "extraction_would_replace") {
        // Not an error: a question. The count comes back in `detail` so the
        // confirm can name what is about to be lost.
        setConfirmReplace(Number(e.detail) || 0);
      } else {
        setError(e instanceof Error ? e.message : "That did not run.");
      }
    } finally {
      setRunning(false);
    }
  }, [projectPath, chapters, excluded, onExtracted]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Loader size={12} className="animate-spin" /> Reading your project...
      </p>
    );
  }

  const selectedChapters = chapters.size === 0
    ? (plan?.chapters.length ?? 0) : chapters.size;
  const includedEntries = (plan?.known.length ?? 0) - excluded.size;

  return (
    <div className="space-y-4" data-testid="extractor-setup">
      {guiding && <ExtractorGuide onClose={() => setGuiding(false)} />}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Sparkles size={14} className="text-violet-400" /> Profile Extractor
        </h3>
        <p className="mt-1 max-w-2xl text-xs text-text-muted">
          This reads your manuscript and proposes what your entries should say:
          an overview, physical and personality traits, motivations, notes. You
          then keep, merge or throw away each piece one at a time.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Explain of="extractor.what" />
          <button type="button" onClick={() => setGuiding(true)}
                  data-testid="extractor-show-me"
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary">
            Show me how this works
          </button>
        </div>
      </div>

      {/* THE ORDER MATTERS, AND THE SCREEN SAYS SO. */}
      {plan && !plan.has_world && (
        <div className="rounded border border-amber-700/60 bg-amber-950/20 px-3 py-2"
             data-testid="extractor-run-weaving-first">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
            <AlertTriangle size={12} /> Run Weaving first.
          </p>
          <p className="mt-1 max-w-2xl text-[11px] text-amber-200/80">
            You have no entries yet. This pass works by building on what you
            already have -- it sends a short extract of each entry so it can
            add to them rather than start over. With nothing to build on it will
            propose a world from scratch, which costs the most and gives you the
            noisiest result. Weaving finds the names for free; come back here
            afterwards and this fills them in.
          </p>
        </div>
      )}

      {/* WHAT THIS IS, said before it is bought rather than after. */}
      <div className="rounded border border-border bg-surface px-3 py-2">
        <p className="text-[11px] text-text-muted">
          <span className="font-semibold text-text-primary">
            This is a first draft, not an answer.
          </span>{" "}
          Everything it proposes is written by a model reading your book, and
          none of it is checked against anything. Treat it as a starting point
          you will rewrite -- that is what it is for, and it is why nothing
          reaches a profile until you press a button on that exact piece.
        </p>
      </div>

      {/* WHAT TO READ */}
      <section>
        <h4 className="text-xs font-semibold text-text-primary">What to read</h4>
        <p className="mt-0.5 text-[11px] text-faint">
          The whole book is the recommended run, and the ticked chapters go up
          as ONE request either way -- that is what lets it notice a character
          from chapter two coming back in chapter eleven. Pick chapters when you
          are adding to a pass you already did.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="extractor-chapters">
          {(plan?.chapters ?? []).map(chapter => {
            const on = chapters.size === 0 || chapters.has(chapter.chapter_id);
            return (
              <button
                key={chapter.chapter_id}
                type="button"
                onClick={() => setChapters(prev => {
                  // First click on a full book means "only this one".
                  const next = prev.size === 0
                    ? new Set((plan?.chapters ?? []).map(c => c.chapter_id))
                    : new Set(prev);
                  if (next.has(chapter.chapter_id)) next.delete(chapter.chapter_id);
                  else next.add(chapter.chapter_id);
                  return next.size === (plan?.chapters.length ?? 0)
                    ? new Set() : next;
                })}
                className={`rounded border px-2 py-0.5 text-[11px] ${
                  on ? "border-violet-600 bg-violet-500/10 text-text-primary"
                     : "border-border text-faint hover:text-text-muted"}`}
              >
                {chapter.title}
              </button>
            );
          })}
        </div>
      </section>

      {/* WHO TO LEAVE ALONE */}
      {(plan?.known.length ?? 0) > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-text-primary">
            Entries to leave alone
          </h4>
          <p className="mt-0.5 max-w-2xl text-[11px] text-faint">
            Ticked ones are skipped. The ones you have already written up are
            ticked to start with, because you probably do not want a model's
            version of work you have finished. Untick any of them -- a character
            who appeared once in chapter two and has come back matters again,
            and nothing here can know that but you.
          </p>
          <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto"
              data-testid="extractor-exclusions">
            {(plan?.known ?? []).map(entry => (
              <li key={entry.entity_id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={excluded.has(entry.entity_id)}
                    onChange={() => setExcluded(prev => {
                      const next = new Set(prev);
                      if (next.has(entry.entity_id)) next.delete(entry.entity_id);
                      else next.add(entry.entity_id);
                      return next;
                    })}
                  />
                  <span className="text-text-primary">{entry.name}</span>
                  <span className="text-faint">{entry.type}</span>
                  {entry.suggest_exclude && (
                    <span className="text-faint">(already written up)</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* WHAT IT WILL DO, in counts, before the button. */}
      <div className="rounded border border-border bg-surface px-3 py-2 text-[11px] text-text-muted"
           data-testid="extractor-summary">
        Reading <span className="text-text-primary">{selectedChapters}</span>{" "}
        {selectedChapters === 1 ? "chapter" : "chapters"} against{" "}
        <span className="text-text-primary">{includedEntries}</span>{" "}
        {includedEntries === 1 ? "entry" : "entries"}.
        {" "}This sends your manuscript to your AI provider and is the most
        expensive single request this app makes. It uses the model you assigned
        to <span className="text-text-primary">Long-context analysis</span> in
        Settings.
      </div>

      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}

      {/* THE GUARD. Not an error -- a question, with the number in it. */}
      {confirmReplace !== null && (
        <div className="rounded border border-amber-700/60 bg-amber-950/20 px-3 py-2"
             data-testid="extractor-replace-confirm">
          <p className="text-xs text-amber-100">
            You have {confirmReplace} proposal{confirmReplace === 1 ? "" : "s"}{" "}
            you have not looked at yet. Starting a new run throws{" "}
            {confirmReplace === 1 ? "it" : "them"} away.
          </p>
          <p className="mt-1 text-[11px] text-amber-200/70">
            There is only ever one extraction at a time, so the new one replaces
            the old one entirely. You paid for those proposals.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void start(true)} disabled={running}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
              Replace them and run again
            </button>
            {onOpenCurrent && (
              <button type="button" onClick={onOpenCurrent}
                      className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary">
                Go back to what I have
              </button>
            )}
            <button type="button" onClick={() => setConfirmReplace(null)}
                    className="rounded px-2.5 py-1 text-xs text-faint hover:text-text-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmReplace === null && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void start(false)}
            disabled={running || (plan?.chapters.length ?? 0) === 0}
            data-testid="extractor-run"
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {running ? <Loader size={12} className="animate-spin" />
                     : <BookOpen size={12} />}
            {running ? "Reading your book..." : "Read the manuscript"}
          </button>
          {plan?.has_current && onOpenCurrent && (
            <button type="button" onClick={onOpenCurrent}
                    className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary">
              Open what I already have
            </button>
          )}
        </div>
      )}

      {running && (
        <p className="text-[11px] text-faint">
          A whole novel takes a few minutes. You can leave this screen open.
        </p>
      )}
    </div>
  );
}
