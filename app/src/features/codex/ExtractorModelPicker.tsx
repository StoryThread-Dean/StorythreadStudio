// features/codex/ExtractorModelPicker.tsx -- choosing a model by its LIMITS
// ==========================================================================
// A second picker for the Long-context role, on the screen where the choice
// actually bites. It writes the same app-wide setting the Settings screen
// writes -- this is a different VIEW of one choice, never a second copy of it.
//
// WHY IT EXISTS. Reported after the second live run:
//
//   "the long analysis options currently do not list the limits at all from the
//    dropdown menu of choices. Only the recommended are at the top listed as
//    budget, pricier, etc. We need a way for the Writer to be able to choose
//    from a more detailed list for just this screen so they don't run into
//    selection problems that require adjustments due to the large scale nature
//    of uploading the entire manuscript."
//
// That is exactly right, and it is a difference in what the two screens are
// FOR. Everywhere else in the app a request is one chapter, a few thousand
// tokens, and any model will hold it -- so grouping by price is the useful
// sort. Here the request is the whole book, and the context window is not a
// detail, it is whether the thing works at all. Sorting by price on this screen
// puts the models that cannot do the job at the top of the list.
//
// So: biggest window first, the number shown, the cost beside it, and reasoning
// models flagged -- because a reasoning model spends its reply budget thinking
// and can return an empty answer, which is how the second live run failed.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader, Search } from "lucide-react";

import {
  chooseModel, fetchModels, type ExtractorModel,
} from "./extractorApi";

interface Props {
  /** The model currently resolved for the role, so the list can mark it. */
  current: string;
  /** Tokens this run would send, so a model too small to hold it says so. */
  needed: number;
  onChosen: (modelId: string) => void;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function money(perMillion: number): string {
  if (perMillion <= 0) return "free";
  if (perMillion < 1) return `$${perMillion.toFixed(2)}/M`;
  return `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}/M`;
}

export function ExtractorModelPicker({ current, needed, onChosen }: Props) {
  const [models, setModels] = useState<ExtractorModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchModels()
      .then(body => {
        if (cancelled) return;
        setModels(body.models);
        setError(body.error);
      })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Only models that can actually hold this run, unless the writer searches --
  // 400 entries sorted by a number they cannot use is not a choice, it is a
  // list. The same 0.8 slack the backend refuses on: the manuscript is not the
  // whole request, and an answer that truncates halfway is a wasted request.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? models.filter(m => m.id.toLowerCase().includes(needle)
                        || m.name.toLowerCase().includes(needle))
      : models.filter(m => needed === 0
                        || m.context_length >= needed / 0.8);
    return matching.slice(0, 40);
  }, [models, query, needed]);

  const pick = async (modelId: string) => {
    setSaving(modelId);
    try {
      await chooseModel(modelId);
      onChosen(modelId);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setSaving("");
    }
  };

  const currentModel = models.find(m => m.id === current);
  const tooSmall = currentModel && needed > 0
    && currentModel.context_length < needed / 0.8;

  return (
    <section className="rounded border border-border bg-surface px-3 py-2"
             data-testid="extractor-model-picker">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-text-primary">
          Which model reads your book
        </h4>
        <span className="text-mini text-text-muted" data-testid="extractor-current-model">
          {current || "none chosen"}
          {currentModel ? ` (holds ${tokens(currentModel.context_length)})` : ""}
        </span>
        {currentModel?.supports_reasoning && (
          <span className="rounded border border-amber-700/60 px-1.5 py-0.5 text-micro text-amber-200"
                title="Reasoning models spend part of their reply budget thinking before they write, and can return an empty answer.">
            reasoning
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          data-testid="extractor-change-model"
          className="ml-auto rounded border border-border px-2 py-0.5 text-mini text-text-muted hover:text-text-primary"
        >
          {open ? "Close" : "Change"}
        </button>
      </div>

      <p className="mt-1 text-micro text-faint">
        This sets Long-context analysis for the whole app, the same as Settings
        does. Listed biggest first, because on this screen the limit is the
        thing that decides whether it works.
      </p>

      {tooSmall && (
        <p className="mt-1 flex items-center gap-1.5 text-mini text-rose-300"
           data-testid="extractor-model-too-small">
          <AlertTriangle size={11} />
          This one holds {tokens(currentModel!.context_length)} and the run needs
          about {tokens(needed)}. Pick a bigger one or send fewer chapters.
        </p>
      )}

      {open && (
        <div className="mt-2">
          <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1">
            <Search size={11} className="text-faint" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search all models, or pick from the ones that fit"
              aria-label="Search models"
              className="w-full bg-transparent text-mini text-text-primary outline-none"
            />
          </label>

          {loading && (
            <p className="mt-1.5 flex items-center gap-1.5 text-mini text-text-muted">
              <Loader size={11} className="animate-spin" /> Reading the model list...
            </p>
          )}
          {error && <p className="mt-1.5 text-mini text-rose-300">{error}</p>}

          {!loading && !error && (
            <>
              <p className="mt-1.5 text-micro text-faint">
                {query
                  ? `${shown.length} matching`
                  : `${shown.length} that can hold this run`}
                . Window, then what it costs per million tokens in and out.
              </p>
              <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto"
                  data-testid="extractor-model-list">
                {shown.map(model => {
                  const fits = needed === 0 || model.context_length >= needed / 0.8;
                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        onClick={() => void pick(model.id)}
                        disabled={saving !== ""}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-mini hover:bg-white/5 disabled:opacity-40"
                      >
                        {model.id === current
                          ? <Check size={11} className="shrink-0 text-emerald-400" />
                          : <span className="w-[11px] shrink-0" />}
                        <span className="min-w-0 flex-1 truncate text-text-primary">
                          {model.id}
                        </span>
                        <span className={`shrink-0 tabular-nums ${
                          fits ? "text-text-muted" : "text-rose-300"}`}>
                          {tokens(model.context_length)}
                        </span>
                        <span className="w-24 shrink-0 text-right text-faint">
                          {model.is_free
                            ? "free"
                            : `${money(model.cost_input_per_million)} / ${money(model.cost_output_per_million)}`}
                        </span>
                        {model.supports_reasoning && (
                          <span className="shrink-0 text-2xs text-amber-300/80">
                            reasoning
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!query && (
                <p className="mt-1 text-micro text-faint">
                  Models too small for this run are hidden. Search to see all of
                  them.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
