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
import { ExtractorModelPicker } from "./ExtractorModelPicker";
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
  // TICKED MEANS SEND, which is the opposite of how this was first built.
  // The writer's reaction to the first live version: "that was actually
  // confusing to me and unnatural. Generally one would want to CHECK all the
  // boxes they want to send and UNCHECK the ones they don't want."
  //
  // They are right, and it is worth being precise about why the first version
  // was wrong even though it matched the original decision. A tick reads as
  // "yes, this one", so a ticked list of names beside a Send button reads as
  // the things being sent. Inverting that means every writer has to hold a
  // negation in their head for the whole screen, and the cost of getting it
  // backwards is money.
  const [included, setIncluded] = useState<Set<string>>(new Set());
  // The count a new run would destroy, once the writer has asked to start one.
  const [confirmReplace, setConfirmReplace] = useState<number | null>(null);
  // MOUNTED HERE AND ON THE REVIEW SCREEN, both, and that is the R2.12f
  // lesson rather than duplication: a guide reachable only from the screen a
  // writer is not on is documentation. The order-of-operations page is the
  // one that saves them money, so it has to be reachable before they spend.
  const [guiding, setGuiding] = useState(false);
  // The model the picker last set, so the numbers below update at once
  // rather than after a round trip the writer has no reason to expect.
  const [chosenModel, setChosenModel] = useState<string>("");
  // Which batch is in flight, so a run that takes several minutes says what it
  // is doing rather than showing one spinner for ten minutes.
  const [batchAt, setBatchAt] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [partial, setPartial] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await fetchPlan(projectPath);
      setPlan(body);
      // The smart default, applied ONCE on load rather than enforced: every
      // tick is the writer's to change, and re-applying it would fight them.
      // Entries already written up start UNTICKED -- the suggestion is
      // unchanged, only the direction it is expressed in.
      setIncluded(new Set(body.known.filter(k => !k.suggest_exclude)
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
    setPartial("");

    const exclude = (plan?.known ?? [])
      .map(k => k.entity_id)
      .filter(id => !included.has(id));

    // ONE REQUEST PER BATCH, IN SEQUENCE, EACH SAVED AS IT LANDS.
    //
    // A novel cannot be answered in one reply, so the book is split. Walking
    // the batches here rather than looping inside one HTTP call is deliberate:
    // a ten-minute request that fails at minute nine loses everything, while
    // this keeps every batch that landed. Same rule Sweep.tsx follows -- a
    // partial failure keeps what worked and says how far it got.
    const wanted = chapters.size === 0
      ? null : (id: string) => chapters.has(id);
    const batches = (plan?.batches ?? [])
      .map(batch => wanted ? batch.filter(wanted) : batch)
      .filter(batch => batch.length > 0);
    const runs = batches.length > 0 ? batches : [[...chapters]];

    setBatchTotal(runs.length);
    // COUNTED IN A LOCAL, NOT FROM STATE. The catch below needs to know how far
    // the loop got, and reading `batchAt` there reads the value captured when
    // this callback was created -- always 0. Found by the test for a failing
    // batch, which is exactly the path where the number matters.
    let done = 0;
    try {
      let last = null;
      for (let index = 0; index < runs.length; index += 1) {
        setBatchAt(index + 1);
        const body = await runExtraction({
          project_path: projectPath,
          chapter_ids: runs[index],
          // The wire still speaks in exclusions, because that is what the
          // backend guarantees against. The screen speaks in inclusions. One
          // translation, in one place, rather than two vocabularies.
          exclude,
          replace_existing: replaceExisting,
          append: index > 0,
          batch_index: index,
          batch_count: runs.length,
        });
        last = body.run;
        done = index + 1;
      }
      setConfirmReplace(null);
      if (last) onExtracted(last);
    } catch (e) {
      if (e instanceof CodexApiError && e.code === "extraction_would_replace") {
        // Not an error: a question. The count comes back in `detail` so the
        // confirm can name what is about to be lost.
        setConfirmReplace(Number(e.detail) || 0);
      } else {
        setError(e instanceof Error ? e.message : "That did not run.");
      }
      // A BATCH THAT FAILS DOES NOT DISCARD THE ONES THAT WORKED. They are
      // already saved, so the writer keeps what they paid for and is told
      // where it stopped.
      if (done > 0) {
        setPartial(`Stopped after ${done} of ${runs.length}. What ${done === 1
                   ? "that part" : "those parts"} found is saved -- open it, `
                   + `or run the rest again.`);
      }
    } finally {
      setRunning(false);
      setBatchAt(0);
    }
  }, [projectPath, chapters, included, plan, onExtracted]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Loader size={12} className="animate-spin" /> Reading your project...
      </p>
    );
  }

  const selectedChapters = chapters.size === 0
    ? (plan?.chapters.length ?? 0) : chapters.size;
  const includedEntries = included.size;

  // LIVE, from the ticked chapters, because the whole point of the dashboard
  // is that unticking one changes the number in front of you. Computed here
  // rather than fetched: a round trip per tick would lag behind the clicking,
  // and the arithmetic is a sum of character counts the plan already sent.
  const selectedChars = (plan?.chapters ?? [])
    .filter(c => chapters.size === 0 || chapters.has(c.chapter_id))
    .reduce((total, c) => total + c.chars, 0);
  // The same rough 4-chars-per-token the backend uses. It does not need to be
  // exact -- it needs to tell a 69k run from a 20k one, and to move when the
  // writer ticks something.
  const estimatedTokens = Math.round(selectedChars / 4);
  const modelId = chosenModel || plan?.model_id || "";
  // A model chosen here has a window the plan did not know about, so its own
  // fit answer is stale the moment the picker is used.
  const contextTokens = chosenModel ? 0 : (plan?.context_tokens ?? 0);
  const fits = contextTokens === 0 || estimatedTokens < contextTokens * 0.8;
  const plannedBatches = (plan?.batches ?? [])
    .map(batch => chapters.size === 0
      ? batch : batch.filter(id => chapters.has(id)))
    .filter(batch => batch.length > 0).length;

  return (
    <div className="space-y-4" data-testid="extractor-setup">
      {guiding && <ExtractorGuide onClose={() => setGuiding(false)} />}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Sparkles size={14} className="text-weave-muted" /> Profile Extractor
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
                  className="rounded border border-border px-2 py-0.5 text-mini text-text-muted hover:text-text-primary">
            Show me how this works
          </button>
        </div>
      </div>

      {/* THE ORDER MATTERS, AND THE SCREEN SAYS SO. */}
      {plan && !plan.has_world && (
        <div className="rounded border border-warn-fill/60 bg-warn-soft/20 px-3 py-2"
             data-testid="extractor-run-weaving-first">
          <p className="flex items-center gap-2 text-xs font-semibold text-warn-strong">
            <AlertTriangle size={12} /> Run Weaving first.
          </p>
          <p className="mt-1 max-w-2xl text-mini text-warn-strong/80">
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
        <p className="text-mini text-text-muted">
          <span className="font-semibold text-text-primary">
            This is a first draft, not an answer.
          </span>{" "}
          Everything it proposes is written by a model reading your book, and
          none of it is checked against anything. Treat it as a starting point
          you will rewrite -- that is what it is for, and it is why nothing
          reaches a profile until you press a button on that exact piece.
        </p>
      </div>

      {/* THE MODEL, ON THIS SCREEN. Requested after the second live run:
          the Settings list sorts by price and never shows a limit, which is
          the wrong sort entirely when the request is a whole manuscript. */}
      <ExtractorModelPicker
        current={modelId}
        needed={estimatedTokens}
        onChosen={id => { setChosenModel(id); void load(); }}
      />

      {/* THE RUNNING TOTAL. It moves when a chapter is ticked, which is the
          point: "68,500 approximate, unchecking a chapter results in 59,900
          approximate". A number that only appears after the request is a
          receipt, not a decision. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-4"
           data-testid="extractor-dashboard">
        <Stat label="Chapters" value={`${selectedChapters} of ${plan?.chapters.length ?? 0}`} />
        <Stat label="Words" value={Math.round(selectedChars / 5.5).toLocaleString()} />
        <Stat label="Tokens, roughly" value={`~${estimatedTokens.toLocaleString()}`}
              testId="extractor-token-estimate" />
        <Stat
          label="Model holds"
          value={contextTokens ? contextTokens.toLocaleString() : "unknown"}
          tone={contextTokens && !fits ? "bad" : "plain"}
        />
      </div>

      {/* WHAT TO READ */}
      <section>
        <h4 className="text-xs font-semibold text-text-primary">What to read</h4>
        <p className="mt-0.5 text-mini text-faint">
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
                className={`rounded border px-2 py-0.5 text-mini ${
                  on ? "border-weave-fill bg-weave-fill/10 text-text-primary"
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
          <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-text-primary">
            Which entries to work on
            <button type="button" onClick={() => setIncluded(
                      new Set((plan?.known ?? []).map(k => k.entity_id)))}
                    className="rounded border border-border px-1.5 py-0.5 text-micro font-normal text-text-muted hover:text-text-primary">
              Tick all
            </button>
            <button type="button" onClick={() => setIncluded(new Set())}
                    className="rounded border border-border px-1.5 py-0.5 text-micro font-normal text-text-muted hover:text-text-primary">
              Tick none
            </button>
          </h4>
          <p className="mt-0.5 max-w-2xl text-mini text-faint">
            Ticked entries get proposals. The ones you have already written up
            start unticked, because you probably do not want a model's version
            of work you have finished -- tick any of them back on. A character
            who appeared once in chapter two and has now returned matters
            again, and nothing here can know that but you.
          </p>
          <p className="mt-0.5 max-w-2xl text-mini text-faint">
            Unticked entries are still shown to the model so it recognises them
            in your prose. It just will not propose anything for them.
          </p>
          <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto"
              data-testid="extractor-exclusions">
            {(plan?.known ?? []).map(entry => (
              <li key={entry.entity_id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-mini hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={included.has(entry.entity_id)}
                    onChange={() => setIncluded(prev => {
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
      <div className="rounded border border-border bg-surface px-3 py-2 text-mini text-text-muted"
           data-testid="extractor-summary">
        Reading <span className="text-text-primary">{selectedChapters}</span>{" "}
        {selectedChapters === 1 ? "chapter" : "chapters"}, proposing for{" "}
        <span className="text-text-primary">{includedEntries}</span>{" "}
        {includedEntries === 1 ? "entry" : "entries"}.
        {" "}This sends your manuscript to your AI provider and is the most
        expensive single request this app makes.
        {/* THE MODEL, NAMED, RESOLVED. The first live run was made by a model
            the writer did not think they were using: Long-context analysis was
            unassigned, so it fell through to the Default Model. Saying which
            role it comes from was not enough -- it has to say which MODEL. */}
        {modelId && (
          <>
            {" "}It will use{" "}
            <span className="text-text-primary">{modelId}</span>.
          </>
        )}
        {plannedBatches > 1 && (
          <>
            {" "}A book this size cannot be answered in one reply, so it goes
            up as <span className="text-text-primary">{plannedBatches}</span>{" "}
            requests and the results are combined into one list.
          </>
        )}
      </div>

      {/* WILL IT FIT. The first live run sent about 69,000 tokens to a model
          that holds 64,000, got an unreadable answer back, and spent the
          request finding that out. */}
      {plan && modelId && !fits && contextTokens > 0 && (
        <div className="rounded border border-danger-fill bg-danger-soft/30 px-3 py-2"
             data-testid="extractor-too-big">
          <p className="text-xs font-semibold text-danger-strong">
            This will not fit in {modelId}.
          </p>
          <p className="mt-1 text-mini text-danger-strong/80">
            Your selection is roughly{" "}
            {estimatedTokens.toLocaleString()} tokens and that model holds{" "}
            {contextTokens.toLocaleString()}. Tick fewer chapters, or
            assign a model with a bigger context window to Long-context
            analysis in Settings. Nothing will be sent or charged until it fits.
          </p>
        </div>
      )}

      {plan?.model_error && (
        <div className="rounded border border-warn-fill/60 bg-warn-soft/20 px-3 py-2"
             data-testid="extractor-model-error">
          <p className="text-mini text-warn-strong">
            No model can run this yet: {plan.model_error}
          </p>
        </div>
      )}

      {error && <p role="alert" className="text-mini text-danger">{error}</p>}

      {/* THE GUARD. Not an error -- a question, with the number in it. */}
      {confirmReplace !== null && (
        <div className="rounded border border-warn-fill/60 bg-warn-soft/20 px-3 py-2"
             data-testid="extractor-replace-confirm">
          <p className="text-xs text-warn-strong">
            You have {confirmReplace} proposal{confirmReplace === 1 ? "" : "s"}{" "}
            you have not looked at yet. Starting a new run throws{" "}
            {confirmReplace === 1 ? "it" : "them"} away.
          </p>
          <p className="mt-1 text-mini text-warn-strong/70">
            There is only ever one extraction at a time, so the new one replaces
            the old one entirely. You paid for those proposals.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void start(true)} disabled={running}
                    className="rounded bg-warn-fill px-2.5 py-1 text-xs font-semibold text-white hover:bg-warn-fill disabled:opacity-40">
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
            disabled={running || (plan?.chapters.length ?? 0) === 0
                      || (!!modelId && contextTokens > 0 && !fits)}
            data-testid="extractor-run"
            className="inline-flex items-center gap-1.5 rounded bg-weave-fill px-3 py-1.5 text-xs font-semibold text-white hover:bg-weave-fill disabled:opacity-40"
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
        <p className="text-mini text-faint" data-testid="extractor-progress-line">
          {batchTotal > 1
            ? `Reading part ${batchAt} of ${batchTotal}. Each part is saved as `
              + `it finishes, so nothing is lost if you stop.`
            : "A whole novel takes a few minutes. You can leave this screen open."}
        </p>
      )}

      {partial && (
        <p className="rounded border border-warn-fill/60 bg-warn-soft/20 px-3 py-2 text-mini text-warn-strong"
           data-testid="extractor-partial-run">
          {partial}
        </p>
      )}
    </div>
  );
}


/** One number in the dashboard. Small enough to live here rather than earn a
 *  file: it exists so four figures line up and read as one instrument. */
function Stat({ label, value, tone = "plain", testId }: {
  label: string;
  value: string;
  tone?: "plain" | "bad";
  testId?: string;
}) {
  return (
    <div className="bg-bg-primary px-2.5 py-1.5" data-testid={testId}>
      <p className="text-micro uppercase tracking-wide text-faint">{label}</p>
      <p className={`text-xs tabular-nums ${
        tone === "bad" ? "text-danger" : "text-text-primary"}`}>
        {value}
      </p>
    </div>
  );
}
