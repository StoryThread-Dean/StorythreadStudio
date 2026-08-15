// features/codex/ExtractorReview.tsx -- the proposal beside what you wrote
// =========================================================================
// The review surface, and it IS the feature. The pass is only raw material:
// the writer's own framing was that this exists "to give something to the
// writer for which he will edit / fine-tune / build from and hone", so speed
// and editability outrank precision and everything here is built for working
// through a list quickly without ever losing a word.
//
// ── THE TWO COLUMNS ARE THE POINT ───────────────────────────────────────────
//
// A proposal is never shown on its own. "Here is an overview" judged in the
// abstract is guesswork; "here is an overview, and here is the one you wrote"
// is a decision. It is also the only way Merge is comprehensible -- you cannot
// choose to append without seeing what it appends to.
//
// ── WHY THERE IS NO APPLY-ALL ───────────────────────────────────────────────
//
// This pass carries no evidence (roadmap decision 4). Nothing checked these
// proposals against anything, so the writer's click on THAT piece is the only
// safeguard there is. Every convenience that removes a click removes the whole
// protection, which is why the rail ticks entries off rather than accepting
// them, and why nothing is ever pre-selected.
//
// ── NOT A WALKTHROUGH ───────────────────────────────────────────────────────
//
// The Weave's closed-world rule ("the writer does not leave the popup until the
// task is done") is deliberately NOT applied here, and roadmap decision 10 says
// so explicitly, so nobody later "fixes" it by moving this inside the walk.
// That rule is about a WALK: answering a stop must not send you away
// mid-question, because the walk gives up its place. A review screen has no
// place to give up -- you arrive deliberately, work through a list, and leave
// when you choose.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, Loader, Plus, Sparkles, X,
} from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { ExtractorGuide } from "./ExtractorGuide";
import { CodexApiError, fetchThread, newThread, type ThreadDetail } from "./api";
import {
  applyPart, setEntryState,
  type ExtractionEntry, type ExtractionPart, type ExtractionProgress,
  type ExtractionRun,
} from "./extractorApi";

interface Props {
  projectPath: string;
  run: ExtractionRun;
  onChanged: (progress: ExtractionProgress) => void;
  /** Back to the setup screen to run a new pass. */
  onStartOver: () => void;
}

function whenMade(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function ExtractorReview({ projectPath, run, onChanged, onStartOver }: Props) {
  const [entries, setEntries] = useState<ExtractionEntry[]>(run.entries);
  const [selectedId, setSelectedId] = useState<string>(
    run.entries[0]?.item_id ?? "");
  const [openKinds, setOpenKinds] = useState<Set<string>>(
    new Set(run.entries.map(e => e.type)));
  const [guiding, setGuiding] = useState(false);

  useEffect(() => {
    setEntries(run.entries);
    setSelectedId(prev => prev || run.entries[0]?.item_id || "");
  }, [run]);

  const selected = entries.find(e => e.item_id === selectedId) ?? null;

  // Grouped by kind for the rail, in the order the pass returned them so a
  // writer who scrolled to the bottom finds the same thing there next time.
  const byKind = useMemo(() => {
    const groups = new Map<string, ExtractionEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.type) ?? [];
      list.push(entry);
      groups.set(entry.type, list);
    }
    return groups;
  }, [entries]);

  const patchEntry = useCallback((itemId: string,
                                  change: Partial<ExtractionEntry>) => {
    setEntries(prev => prev.map(e =>
      e.item_id === itemId ? { ...e, ...change } : e));
  }, []);

  return (
    <div className="flex min-h-0 gap-4" data-testid="extractor-review">
      {guiding && <ExtractorGuide onClose={() => setGuiding(false)} />}
      {/* ── The rail ─────────────────────────────────────────────────────── */}
      <nav className="w-56 shrink-0 overflow-y-auto" data-testid="extractor-rail">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">
          Found in your book
        </p>
        {[...byKind.entries()].map(([kind, kindEntries]) => {
          const open = openKinds.has(kind);
          const done = kindEntries.filter(e => e.state === "done").length;
          return (
            <div key={kind} className="mb-1">
              <button
                type="button"
                onClick={() => setOpenKinds(prev => {
                  const next = new Set(prev);
                  if (next.has(kind)) next.delete(kind); else next.add(kind);
                  return next;
                })}
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-text-primary hover:bg-white/5"
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span className="capitalize">{kind}</span>
                <span className="ml-auto text-[10px] text-faint">
                  {done}/{kindEntries.length}
                </span>
              </button>
              {open && (
                <ul className="ml-3 space-y-0.5">
                  {kindEntries.map(entry => (
                    <li key={entry.item_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.item_id)}
                        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] ${
                          entry.item_id === selectedId
                            ? "bg-violet-500/15 text-text-primary"
                            : "text-text-muted hover:bg-white/5"}`}
                      >
                        <span className="truncate">{entry.name}</span>
                        {!entry.entity_id && !entry.created_entity_id && (
                          <span className="ml-auto shrink-0 text-[9px] text-violet-300">
                            new
                          </span>
                        )}
                        {entry.state === "done" && (
                          <Check size={10} className="ml-auto shrink-0 text-emerald-400" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── The body ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <Sparkles size={13} className="text-violet-400" /> Profile Extractions
          </h3>
          <Explain of="extractor.review" />
          <button type="button" onClick={() => setGuiding(true)}
                  data-testid="extractor-show-me"
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-text-muted hover:text-text-primary">
            Show me how this works
          </button>
          {/* WHEN, not whether it is stale. The manuscript may have moved under
              a long review and nothing here will flag it -- that is the direct
              consequence of there being one saved run, and it is the writer's
              call rather than an oversight. Saying the date lets them make it. */}
          <span className="text-[10px] text-faint" data-testid="extractor-when">
            Read on {whenMade(run.created_at)}
            {run.model_used ? ` by ${run.model_used}` : ""}
          </span>
          <button type="button" onClick={onStartOver}
                  className="ml-auto rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary">
            Run it again
          </button>
        </header>

        {selected ? (
          <EntryPanel
            key={selected.item_id}
            projectPath={projectPath}
            entry={selected}
            onPatch={change => patchEntry(selected.item_id, change)}
            onProgress={onChanged}
          />
        ) : (
          /* NOTHING CAME BACK, AND THE SCREEN MUST NOT GUESS WHY.
             The first version of this said an empty result "usually means the
             book already says what your entries say" -- a confident,
             reassuring explanation offered with no evidence behind it. The
             first real run hit it, and the actual cause was that the request
             overflowed the model's context window and the answer came back
             unreadable. A wrong reason is worse than none: it sends the writer
             away satisfied while the feature is broken. */
          <div className="space-y-2" data-testid="extractor-empty">
            <p className="text-xs text-text-primary">Nothing came back that
              could be used.</p>
            {(run.dropped ?? []).length > 0 && (
              <div className="rounded border border-amber-700/60 bg-amber-950/20 px-2.5 py-2">
                <p className="text-[11px] font-semibold text-amber-200">
                  What happened:
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/80">
                  {(run.dropped ?? []).slice(0, 8).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {run.estimated_tokens && run.context_tokens ? (
              <p className="text-[11px] text-text-muted">
                That run sent about {run.estimated_tokens.toLocaleString()}{" "}
                tokens to {run.model_used}, which holds{" "}
                {run.context_tokens.toLocaleString()}.
              </p>
            ) : null}
            {run.raw_excerpt && (
              <details className="rounded border border-border px-2.5 py-1.5">
                <summary className="cursor-pointer text-[11px] text-text-muted">
                  What the model actually said
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-faint">
                  {run.raw_excerpt}
                </pre>
              </details>
            )}
            <p className="text-[11px] text-text-muted">
              Try fewer chapters, or a model with a larger context window
              assigned to Long-context analysis in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


// ── One entry: the proposal, and what you already wrote ─────────────────────

function EntryPanel({ projectPath, entry, onPatch, onProgress }: {
  projectPath: string;
  entry: ExtractionEntry;
  onPatch: (change: Partial<ExtractionEntry>) => void;
  onProgress: (progress: ExtractionProgress) => void;
}) {
  const [current, setCurrent] = useState<ThreadDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetId = entry.created_entity_id || entry.entity_id;

  useEffect(() => {
    let cancelled = false;
    if (!targetId) { setCurrent(null); return; }
    void fetchThread(projectPath, targetId)
      .then(thread => { if (!cancelled) setCurrent(thread); })
      .catch(() => { if (!cancelled) setCurrent(null); });
    return () => { cancelled = true; };
  }, [projectPath, targetId]);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      // BASE LEVEL, exactly what Quick Entry makes: a name, a kind, and
      // nothing else. The proposed pieces then go in one at a time, each by
      // its own click. Slower on purpose -- writing a whole profile in one
      // press would be the largest unreviewed write in the app.
      const { thread } = await newThread({
        project_path: projectPath,
        type: entry.type,
        name: entry.name,
        character_kind: entry.character_kind || undefined,
        aliases: entry.aliases,
      });
      await setEntryState({
        project_path: projectPath, item_id: entry.item_id,
        state: "open", created_entity_id: thread.entity_id,
      });
      onPatch({ created_entity_id: thread.entity_id });
      setCurrent(thread);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That entry could not be made.");
    } finally {
      setCreating(false);
    }
  }, [projectPath, entry, onPatch]);

  const tick = useCallback(async (state: "open" | "done") => {
    try {
      const body = await setEntryState({
        project_path: projectPath, item_id: entry.item_id, state,
      });
      onPatch({ state });
      onProgress(body.progress);
    } catch { /* a failed tick is not worth an alert; the row just stays */ }
  }, [projectPath, entry.item_id, onPatch, onProgress]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-text-primary">{entry.name}</h4>
        {entry.unnamed && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-faint"
                data-testid="extractor-unnamed">
            described, not named
          </span>
        )}
        <span className="text-[11px] text-faint capitalize">{entry.type}</span>
        <button
          type="button"
          onClick={() => void tick(entry.state === "done" ? "open" : "done")}
          data-testid="extractor-tick"
          className={`ml-auto rounded border px-2 py-0.5 text-[11px] ${
            entry.state === "done"
              ? "border-emerald-700 text-emerald-300"
              : "border-border text-text-muted hover:text-text-primary"}`}
        >
          {entry.state === "done" ? "Done" : "Mark done"}
        </button>
      </div>

      {/* A character the prose describes without naming. The description IS
          the name; the app never invents one. */}
      {entry.unnamed && (
        <p className="text-[11px] text-text-muted">
          Your book describes this person without naming them, so the
          description is the name. Rename it whenever you decide who they are.
        </p>
      )}

      {/* A reveal: an OFFER, never a merge. Two labels becoming one person is
          the writer's call, and the app does not act on a hunch. */}
      {entry.same_as && (
        <p className="rounded border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-muted"
           data-testid="extractor-same-as">
          The book seems to reveal this is someone you already have. If it is,
          add the description to that entry as another name it answers to,
          rather than keeping two entries for one person. That is yours to
          decide -- nothing has been merged.
        </p>
      )}

      {!targetId && (
        <div className="rounded border border-violet-800 bg-violet-500/5 px-3 py-2">
          <p className="text-[11px] text-text-muted">
            You do not have an entry for this yet. Make one and its pieces
            become available below, one at a time.
          </p>
          <button type="button" onClick={() => void create()} disabled={creating}
                  data-testid="extractor-create"
                  className="mt-1.5 inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
            {creating ? <Loader size={11} className="animate-spin" />
                      : <Plus size={11} />}
            Add to {entry.type}
          </button>
          {entry.character_kind === "side" && (
            <p className="mt-1 text-[10px] text-faint">
              It arrives as a Side character. Most names a book mentions are;
              you can make it a Main from its own page whenever you want.
            </p>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}

      <ul className="space-y-2">
        {entry.parts.map(part => (
          <PartRow
            key={part.part_id}
            projectPath={projectPath}
            itemId={entry.item_id}
            part={part}
            entityId={targetId}
            current={current}
            onProgress={onProgress}
          />
        ))}
      </ul>
    </div>
  );
}


// ── One clickable proposal ──────────────────────────────────────────────────

function PartRow({ projectPath, itemId, part, entityId, current, onProgress }: {
  projectPath: string;
  itemId: string;
  part: ExtractionPart;
  entityId: string;
  current: ThreadDetail | null;
  onProgress: (progress: ExtractionProgress) => void;
}) {
  const [state, setState] = useState(part.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState("");

  const section = current?.sections?.[part.section_id];
  const existingProse = (section?.content ?? "").trim();
  const existingTraits = section?.trait_blocks ?? [];

  const act = useCallback(async (
    action: "overwrite" | "merge" | "add" | "merge_trait" | "dismiss",
  ) => {
    setBusy(true);
    setError(null);
    try {
      const body = await applyPart({
        project_path: projectPath, item_id: itemId, part_id: part.part_id,
        action, entity_id: entityId || undefined,
        merge_into: action === "merge_trait" ? mergeInto : undefined,
      });
      setState(action === "dismiss" ? "dismissed" : "applied");
      onProgress(body.progress);
    } catch (e) {
      setError(e instanceof CodexApiError ? e.message
               : e instanceof Error ? e.message : "That did not apply.");
    } finally {
      setBusy(false);
    }
  }, [projectPath, itemId, part.part_id, entityId, mergeInto, onProgress]);

  if (state !== "open") {
    return (
      <li className="rounded border border-border px-2.5 py-1.5 text-[11px] text-faint"
          data-testid="extractor-part-settled">
        {part.form === "trait" ? part.trait_name : part.heading}{" "}
        {state === "applied" ? "added to the entry" : "thrown away"}.
      </li>
    );
  }

  return (
    <li className="rounded border border-border" data-testid="extractor-part">
      <p className="border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-faint">
        {part.heading}
        {part.form === "trait" && (
          <span className="ml-1 normal-case tracking-normal text-text-muted">
            / {part.trait_name}
          </span>
        )}
      </p>

      {/* THE TWO COLUMNS. Never the proposal alone. */}
      <div className="grid gap-px bg-border sm:grid-cols-2">
        <div className="bg-bg-primary px-2.5 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300">
            Proposed
          </p>
          <p className="whitespace-pre-wrap text-[11px] text-text-primary">
            {part.content}
          </p>
        </div>
        <div className="bg-bg-primary px-2.5 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">
            What you have now
          </p>
          {part.form === "prose" ? (
            <p className="whitespace-pre-wrap text-[11px] text-text-muted">
              {existingProse || <span className="text-faint">Nothing yet.</span>}
            </p>
          ) : existingTraits.length ? (
            <ul className="space-y-0.5 text-[11px] text-text-muted">
              {existingTraits.map((trait, index) => (
                <li key={index}>{trait.trait || trait.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-faint">No traits here yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2.5 py-1.5">
        {!entityId ? (
          <span className="text-[10px] text-faint">
            Make the entry above first.
          </span>
        ) : part.form === "prose" ? (
          <>
            <button type="button" disabled={busy} onClick={() => void act("merge")}
                    data-testid="extractor-merge"
                    className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
              Add to what I wrote
            </button>
            <button type="button" disabled={busy} onClick={() => void act("overwrite")}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-40">
              Replace mine
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void act("add")}
                    data-testid="extractor-add-trait"
                    className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
              Add as its own trait
            </button>
            {existingTraits.length > 0 && (
              <span className="flex items-center gap-1">
                {/* THE PICKER IS REQUIRED. Merging into a trait the app chose
                    is how a writer's own wording gets overwritten, and a
                    mangled trait is easy to miss because it still carries
                    their label. */}
                <select
                  value={mergeInto}
                  onChange={event => setMergeInto(event.target.value)}
                  aria-label="Fold into which of your traits"
                  data-testid="extractor-merge-into"
                  className="rounded border border-border bg-bg-primary px-1 py-0.5 text-[11px] text-text-primary"
                >
                  <option value="">fold into...</option>
                  {existingTraits.map((trait, index) => (
                    <option key={index} value={trait.trait || trait.name || ""}>
                      {trait.trait || trait.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || !mergeInto}
                        onClick={() => void act("merge_trait")}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-40">
                  Fold in
                </button>
              </span>
            )}
          </>
        )}
        <button type="button" disabled={busy} onClick={() => void act("dismiss")}
                data-testid="extractor-dismiss"
                className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-faint hover:text-text-muted disabled:opacity-40">
          <X size={10} /> Not this
        </button>
      </div>

      {error && (
        <p role="alert" className="border-t border-border px-2.5 py-1 text-[11px] text-rose-300">
          {error}
        </p>
      )}
    </li>
  );
}
