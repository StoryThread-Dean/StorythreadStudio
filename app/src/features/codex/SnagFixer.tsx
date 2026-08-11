// features/codex/SnagFixer.tsx -- sort out a contradiction without leaving
// ========================================================================
// Three stops used to end with "Open it" and a closed Weave: Snag (two facts
// disagree), Unplaced (a fact with no point in the story), and Early mention
// (named before the map says it appears). All three resolve here now, inside
// the popup, per the closed-world rule.
//
// What each mode offers:
//
//   Snag (facts)   both sides with their chapters. Keep one (the other is
//                  removed), EDIT one (text and chapter, in place), or say
//                  both are right ON PURPOSE -- much good fiction contradicts
//                  itself deliberately, and marking it so means it never
//                  re-fires. That mark is `intentional` on the fact, which the
//                  checkers have skipped since they were written.
//
//   Snag (ties)    the clashing connections listed; remove the one that is
//                  wrong. No "deliberate" here -- a cardinality clash that is
//                  the story (a disputed throne) is what the walk's permanent
//                  dismiss is for.
//
//   Unplaced       the fact and a chapter picker. Placing it is one choice.
//
//   Early mention  the entry's anchored facts, so the writer can move the
//                  earliest one to where the prose starts talking -- or say
//                  the early naming is deliberate foreshadowing, which is the
//                  walk's permanent dismiss.
//
// Edits go through PATCH /fact, which keeps the fact's id -- the thing other
// facts' `supersedes` point at. DELETE + re-create would quietly break
// orderings the writer already settled.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader, Pencil, Trash2, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { fetchAnchors, type ChapterAnchor } from "./api";
import type { Stop } from "./weavingApi";

const API_BASE = "http://localhost:8000";

interface Side {
  id?: string;
  at?: string;
  value?: string;
  where?: string;
  frame?: string;
  rel?: string;
  target?: string;
}

interface SnagFixerProps {
  projectPath: string;
  stop: Stop;
  onClose: () => void;
  /** Resolved -- advance the walk. */
  onDone: () => void;
}

export function SnagFixer({ projectPath, stop, onClose, onDone }: SnagFixerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  // Which side is being edited, and its draft.
  const [editing, setEditing] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftAt, setDraftAt] = useState("");
  // Early mention: the entry's Run, fetched because the stop's detail does not
  // carry it -- the scan knows the mention, not which anchor makes it late.
  const [run, setRun] = useState<Side[] | null>(null);

  const sides = useMemo(
    () => ((stop.detail?.sides as Side[] | undefined) ?? []), [stop]);
  // Tie-based snags carry a `target` and no fact id -- their `id` is a
  // synthetic "rel:target" that no fact endpoint knows.
  const tieBased = sides.length > 0 && sides.every(s => s.target !== undefined);
  const early = stop.kind === "early_mention";
  const unplaced = stop.kind === "unplaced";

  useEffect(() => {
    fetchAnchors(projectPath)
      .then(r => setChapters(r.chapters))
      .catch(() => setChapters([]));
  }, [projectPath]);

  useEffect(() => {
    if (!early || !stop.entity_id) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/codex/entity?project_path=${encodeURIComponent(projectPath)}`
          + `&entity_id=${encodeURIComponent(stop.entity_id)}`);
        const body = await response.json();
        if (!cancelled && response.ok) {
          setRun(((body.run ?? []) as Side[]).filter(f => f.at));
        }
      } catch {
        if (!cancelled) setRun([]);
      }
    })();
    return () => { cancelled = true; };
  }, [early, projectPath, stop.entity_id]);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of chapters) map.set(c.anchor, c.title);
    return map;
  }, [chapters]);

  function chapterLabel(anchor?: string): string {
    if (!anchor) return "no chapter";
    return titles.get(anchor) ?? anchor;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function patchFact(factId: string, set: Record<string, unknown>) {
    const response = await fetch(`${API_BASE}/api/codex/fact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_path: projectPath,
                             entity_id: stop.entity_id,
                             fact_id: factId, set }),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body?.detail?.message ?? "That could not be changed.");
    }
  }

  async function deleteFact(factId: string) {
    const response = await fetch(
      `${API_BASE}/api/codex/fact?project_path=${encodeURIComponent(projectPath)}`
      + `&entity_id=${encodeURIComponent(stop.entity_id)}`
      + `&fact_id=${encodeURIComponent(factId)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body?.detail?.message ?? "That could not be removed.");
    }
  }

  async function deleteTie(side: Side) {
    const rel = side.rel ?? String(side.id ?? "").split(":")[0];
    const response = await fetch(
      `${API_BASE}/api/codex/tie?project_path=${encodeURIComponent(projectPath)}`
      + `&src_id=${encodeURIComponent(stop.entity_id)}`
      + `&rel=${encodeURIComponent(rel)}`
      + `&dst_id=${encodeURIComponent(String(side.target ?? ""))}`,
      { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body?.detail?.message ?? "That could not be removed.");
    }
  }

  const kind = threadTypeEntry(String(stop.detail?.type ?? ""));
  const KindIcon = kind.Icon;

  const chapterPicker = (value: string, onChange: (v: string) => void,
                         label: string) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={label}
      className="rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
    >
      <option value="">choose a chapter ...</option>
      {chapters.map(c => (
        <option key={c.anchor} value={c.anchor}>{c.title}</option>
      ))}
    </select>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label={stop.title}
        data-testid="snag-fixer"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <KindIcon size={14}
                    className={`shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            {String(stop.detail?.name ?? stop.title)}
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="p-3">
          <div className="mb-2">
            <Explain of="weaving.snag-fixer" />
          </div>

          {/* ── Unplaced: one fact, one picker ─────────────────────────── */}
          {unplaced && sides[0] && (
            <>
              <p className="mb-1.5 text-[11px] text-text-muted">
                This never takes effect, because nothing says when it became
                true:
              </p>
              <p className="mb-2 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                {sides[0].value}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {chapterPicker(draftAt, setDraftAt, "The chapter it becomes true")}
                <button
                  onClick={() => void act(() =>
                    patchFact(String(sides[0].id), { at: draftAt }))}
                  disabled={busy || !draftAt}
                  className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                  {busy ? <Loader size={11} className="animate-spin" />
                        : <Check size={11} />}
                  Place it there
                </button>
              </div>
            </>
          )}

          {/* ── Early mention: move an anchor to where the prose starts ── */}
          {early && (
            <>
              <p className="mb-1.5 text-[11px] text-text-muted">
                The prose names this in {chapterLabel(stop.chapter_id)}, and
                everything recorded about it happens later. If the prose is
                right, the earliest of these should move:
              </p>
              {run === null ? (
                <p className="flex items-center gap-2 text-[11px] text-text-muted">
                  <Loader size={11} className="animate-spin" /> Reading the entry...
                </p>
              ) : run.length === 0 ? (
                <p className="mb-2 text-[11px] text-text-muted">
                  Nothing anchored was found on the entry -- the timing may come
                  from a connection. If the early naming is deliberate
                  foreshadowing, use{" "}
                  <span className="text-text-primary">It is fine where it is</span>{" "}
                  on the stop and it will not be raised again.
                </p>
              ) : (
                <ul className="mb-2 space-y-1">
                  {run.map(fact => (
                    <li key={fact.id}
                        className="flex items-center gap-2 rounded border border-border px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {fact.value}
                      </span>
                      <span className="shrink-0 text-[10px] text-faint">
                        {chapterLabel(fact.at)}
                      </span>
                      <button
                        onClick={() => void act(() =>
                          patchFact(String(fact.id), { at: stop.chapter_id }))}
                        disabled={busy}
                        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary disabled:opacity-40"
                      >
                        Move to {chapterLabel(stop.chapter_id)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ── Snag over connections: remove the wrong one ────────────── */}
          {stop.kind === "snag" && tieBased && (
            <>
              <p className="mb-1.5 text-[11px] text-text-muted">
                These connections clash. Remove the one that is wrong -- or if
                the clash IS the story (a disputed throne, a marriage nobody
                annulled), dismiss the stop and it stays.
              </p>
              <ul className="space-y-1">
                {sides.map((side, i) => (
                  <li key={i}
                      className="flex items-center gap-2 rounded border border-border px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                      {side.rel ? `${side.rel.replace(/_/g, " ")} ` : ""}
                      {side.target}
                    </span>
                    {side.where && (
                      <span className="shrink-0 text-[10px] text-faint">{side.where}</span>
                    )}
                    <button
                      onClick={() => void act(() => deleteTie(side))}
                      disabled={busy}
                      aria-label={`Remove ${side.target}`}
                      className="shrink-0 rounded border border-border p-1 text-faint hover:text-rose-300 disabled:opacity-40"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* ── Snag over facts: keep one, edit one, or both on purpose ── */}
          {stop.kind === "snag" && !tieBased && (
            <>
              <p className="mb-1.5 text-[11px] text-text-muted">
                These disagree. Keep the right one, fix one in place, or say the
                disagreement is deliberate:
              </p>
              <ul className="space-y-1.5">
                {sides.map((side, i) => (
                  <li key={side.id ?? i}
                      className="rounded border border-border px-2 py-1.5">
                    {editing === i ? (
                      <>
                        <textarea
                          value={draftValue}
                          onChange={e => setDraftValue(e.target.value)}
                          rows={2}
                          aria-label="The corrected text"
                          className="mb-1.5 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          {chapterPicker(draftAt, setDraftAt, "Its chapter")}
                          <button
                            onClick={() => void act(() => patchFact(String(side.id), {
                              value: draftValue,
                              ...(draftAt ? { at: draftAt } : {}),
                            }))}
                            disabled={busy || !draftValue.trim()}
                            className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                          >
                            <Check size={10} /> Save the fix
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
                          >
                            Back
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                          {side.value}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">
                          {side.where ?? chapterLabel(side.at)}
                        </span>
                        <button
                          onClick={() => void act(async () => {
                            // Keeping one means the OTHERS go. One at a time,
                            // so a failure part-way leaves a smaller mess.
                            for (const other of sides) {
                              if (other.id !== side.id) {
                                await deleteFact(String(other.id));
                              }
                            }
                          })}
                          disabled={busy}
                          className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40"
                        >
                          Keep this one
                        </button>
                        <button
                          onClick={() => {
                            setEditing(i);
                            setDraftValue(String(side.value ?? ""));
                            setDraftAt(String(side.at ?? ""));
                          }}
                          disabled={busy}
                          aria-label={`Edit ${side.value}`}
                          className="shrink-0 rounded border border-border p-1 text-faint hover:text-text-primary disabled:opacity-40"
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => void act(async () => {
                  // Both stand, on purpose. Marked on EVERY side: the checkers
                  // skip intentional facts, and marking only one would leave
                  // the other free to clash with a third fact later and re-open
                  // the same argument under a different pairing.
                  for (const side of sides) {
                    await patchFact(String(side.id), { intentional: true });
                  }
                })}
                disabled={busy}
                className="mt-2 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
              >
                Both are right on purpose -- never ask about this again
              </button>
            </>
          )}

          {error && (
            <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>
          )}

          <button
            onClick={onClose}
            className="mt-3 block text-[11px] text-faint hover:text-text-primary"
          >
            Back to the stop
          </button>
        </div>
      </div>
    </div>
  );
}
