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
//   Tangle         several Snags on one axis, worked through IN HERE one after
//                  another, plus one button that marks the whole group
//                  deliberate. R8.2: the grouping existed in the backend and
//                  nothing called it, so a moved date arrived as eleven
//                  questions. The group is one stop; the members are not
//                  separate stops, which is why the progress through them is
//                  state in this dialog rather than in the walk.
//
// Edits go through PATCH /fact, which keeps the fact's id -- the thing other
// facts' `supersedes` point at. DELETE + re-create would quietly break
// orderings the writer already settled.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader, Pencil, Trash2, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { useAttemptClose } from "../../components/learn/useAttemptClose";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { fetchAnchors, type ChapterAnchor } from "./api";
import type { Stop } from "./weavingApi";

const API_BASE = "http://localhost:8000";

/**
 * The thing this screen points at is no longer there.
 *
 * A stop is a SNAPSHOT from scan time. The writer may have fixed the same
 * contradiction through the editor, absorbed the entry, or answered another
 * stop that removed the fact -- and then every action here 404s. That is not
 * an error to argue with; it means the work is already done, and the screen
 * should say so and offer the way forward.
 */
class GoneError extends Error {}

/** Raise the right thing from a failed response: gone-ness is its own case. */
async function refusalFrom(response: Response, fallback: string):
    Promise<Error> {
  let message = fallback;
  let code = "";
  try {
    const body = await response.json();
    message = body?.detail?.message ?? fallback;
    code = String(body?.detail?.code ?? "");
  } catch {
    // A non-JSON body -- keep the fallback message.
  }
  return code.endsWith("not_found") ? new GoneError(message)
                                    : new Error(message);
}

interface Side {
  id?: string;
  at?: string;
  value?: string;
  where?: string;
  frame?: string;
  rel?: string;
  target?: string;
  /** Where the reader learns it, when the writer set one. Sent by the two R8.4
   *  checks, which are entirely about this anchor disagreeing with `at`. */
  revealed_at?: string | null;
  /** When a connection ends. Sent by the never-true tie check. */
  until?: string | null;
  /** The other end's NAME, sent by the scan alongside the raw id --
   *  "leads e-4f2a91" is not a sentence a writer can decide anything from. */
  target_name?: string;
}

/** One Snag inside a Tangle. The whole finding travels with the group, so
 *  working through them needs no further round trips. */
interface TangleMember {
  key: string;
  snag: string;
  summary: string;
  axis: string;
  sides: Side[];
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
  // The stop turned out to be STALE: what it points at is already gone.
  const [gone, setGone] = useState(false);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  // Which side is being edited, and its draft.
  const [editing, setEditing] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftAt, setDraftAt] = useState("");
  // R8.4. The reveal point, which the edit form had no control for -- so the two
  // new checks (a fact told before it is true, a correction that reaches the
  // reader first) could be FOUND and not fixed without leaving the walk, which
  // is the one thing the closed-world rule forbids.
  const [draftRevealed, setDraftRevealed] = useState("");
  // Early mention: the entry's Run, fetched because the stop's detail does not
  // carry it -- the scan knows the mention, not which anchor makes it late.
  const [run, setRun] = useState<Side[] | null>(null);
  // Tangle: which of the group is on screen. The group is ONE stop, so this
  // progress belongs to the dialog and not to the walk -- the walk's index
  // would make each member look like a stop the ledger should remember.
  const [memberAt, setMemberAt] = useState(0);

  /** A Tangle's members, each a whole Snag. Empty for every other kind. */
  const members = useMemo(
    () => ((stop.detail?.members as TangleMember[] | undefined) ?? []), [stop]);
  const tangle = stop.kind === "tangle" && members.length > 0;
  const member: TangleMember | undefined = tangle ? members[memberAt] : undefined;

  // A Tangle shows one member's sides at a time; everything else shows its own.
  const sides = useMemo(
    () => (member?.sides
           ?? ((stop.detail?.sides as Side[] | undefined) ?? [])),
    [member, stop]);
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
        if (cancelled) return;
        if (!response.ok) {
          // A refusal used to leave `run` null FOREVER -- the reading spinner
          // never ended and the screen was a dead end. A missing entry means
          // the stop is stale; anything else is an error worth reading.
          const refusal = await refusalFrom(
            response, "The entry could not be read.");
          if (refusal instanceof GoneError) setGone(true);
          else setError(refusal.message);
          setRun([]);
          return;
        }
        const body = await response.json();
        setRun(((body.run ?? []) as Side[]).filter(f => f.at));
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

  /**
   * Do the work, then move on.
   *
   * "On" means the next member of a Tangle if there is one, and the next stop in
   * the walk otherwise. `all` is for the group-level action, which settles every
   * member at once and so finishes the stop however many are left.
   */
  async function act(work: () => Promise<void>, { all = false } = {}) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (!all && tangle && memberAt < members.length - 1) {
        // Still inside the group. Reset the editing state with it, or the next
        // member opens with the previous one's draft text in the box.
        setMemberAt(i => i + 1);
        setEditing(null);
        setDraftValue("");
        setDraftAt("");
        setDraftRevealed("");
      } else {
        onDone();
      }
    } catch (e) {
      if (e instanceof GoneError) {
        // Already resolved somewhere else. Not a failure -- the screen flips
        // to saying so, with the way forward, instead of stranding the writer
        // on an error about a fact that no longer exists.
        setGone(true);
      } else {
        setError(e instanceof Error ? e.message : "That could not be recorded.");
      }
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
      throw await refusalFrom(response, "That could not be changed.");
    }
  }

  /**
   * `missingOk` is for the keep-one loop, which deletes SEVERAL facts: if an
   * earlier attempt got half-way, the already-deleted ones must read as done
   * rather than as an error -- otherwise the retry that would finish the job
   * is the very thing that fails it.
   */
  async function deleteFact(factId: string, missingOk = false) {
    const response = await fetch(
      `${API_BASE}/api/codex/fact?project_path=${encodeURIComponent(projectPath)}`
      + `&entity_id=${encodeURIComponent(stop.entity_id)}`
      + `&fact_id=${encodeURIComponent(factId)}`, { method: "DELETE" });
    if (!response.ok) {
      const refusal = await refusalFrom(response, "That could not be removed.");
      if (missingOk && refusal instanceof GoneError) return;
      throw refusal;
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
      throw await refusalFrom(response, "That could not be removed.");
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

  // Mid-edit on one side of a contradiction: a corrected value, and possibly a
  // chapter or a reveal point chosen for it. `editing` is the whole condition --
  // the form is only open when the writer opened it.
  const attemptClose = useAttemptClose(
    editing !== null, onClose,
    "You are part-way through fixing this. Close and lose the correction?");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
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

        {gone ? (
          // ── Already resolved somewhere else ─────────────────────────────
          // The walk's list is from scan time; this one got fixed since --
          // through the editor, an absorb, or another stop. Said plainly,
          // with the way forward, because the first version surfaced it as a
          // 404 error and left the writer stranded on it.
          <div className="p-3" data-testid="snag-gone">
            <p className="text-xs text-text-primary">
              This was already sorted out somewhere else.
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              The walk&apos;s list is from when the scan ran, and what this
              pointed at is no longer there -- fixed through the editor,
              absorbed, or settled by another stop. The next scan will not
              raise it again.
            </p>
            <button
              onClick={onDone}
              className="mt-2 inline-flex flex-col items-start rounded border border-emerald-800 bg-emerald-950/30 px-2.5 py-1 text-left text-xs font-semibold text-text-primary hover:bg-emerald-950/50"
            >
              <span>Carry on</span>
              <span className="text-[10px] font-normal text-faint">
                takes you to the next thing in the walk
              </span>
            </button>
          </div>
        ) : (
        <div className="p-3">
          <div className="mb-2">
            <Explain of="weaving.snag-fixer" />
          </div>

          {/* ── Tangle: say what the group IS before showing one of it ──── */}
          {tangle && (
            <div className="mb-2 rounded border border-rose-900/60 bg-rose-950/20 p-2"
                 data-testid="tangle-group">
              <p className="text-[11px] text-rose-100">
                {members.length} problems here all concern{" "}
                <span className="font-medium text-text-primary">
                  {String(stop.detail?.axis ?? "one thing")}
                </span>
                . That is usually one mistake seen from different angles, so they
                are gathered rather than asked one at a time.
              </p>
              <ol className="mt-1.5 space-y-0.5">
                {members.map((m, i) => (
                  <li key={m.key}
                      className={`text-[11px] ${
                        i === memberAt ? "text-text-primary"
                        : i < memberAt ? "text-faint line-through"
                        : "text-text-muted"
                      }`}>
                    {i + 1}. {m.summary}
                  </li>
                ))}
              </ol>
              <p className="mt-1.5 text-[10px] text-faint"
                 data-testid="tangle-progress">
                Working on {memberAt + 1} of {members.length}.
              </p>
              {/* THE REASON THE GROUPING PAYS. Marking five deliberate one at a
                  time is the five questions this stop exists to avoid. Only
                  offered when every member is fact-based: a tie clash has no
                  fact to carry the mark, and the walk's permanent dismiss is
                  what covers that case. */}
              {members.every(m => m.sides.every(s => s.target === undefined)) && (
                <button
                  onClick={() => void act(async () => {
                    for (const m of members) {
                      for (const side of m.sides) {
                        await patchFact(String(side.id), { intentional: true });
                      }
                    }
                  }, { all: true })}
                  disabled={busy}
                  data-testid="tangle-all-deliberate"
                  className="mt-2 rounded border border-border px-2.5 py-1 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-40"
                >
                  All {members.length} are deliberate -- never ask about any of
                  them again
                </button>
              )}
            </div>
          )}

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
          {(stop.kind === "snag" || tangle) && tieBased && (
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
                      {side.target_name ?? side.target}
                    </span>
                    {side.where && (
                      <span className="shrink-0 text-[10px] text-faint">{side.where}</span>
                    )}
                    <button
                      onClick={() => void act(() => deleteTie(side))}
                      disabled={busy}
                      aria-label={`Remove ${side.target_name ?? side.target}`}
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
          {(stop.kind === "snag" || tangle) && !tieBased && (
            <>
              {/* ONE SIDE IS A DIFFERENT SENTENCE. The R8.4 checks can fire on a
                  single fact whose own two anchors disagree, and "These
                  disagree. Keep the right one" offers a choice that is not
                  there. */}
              <p className="mb-1.5 text-[11px] text-text-muted">
                {sides.length > 1
                  ? "These disagree. Keep the right one, fix one in place, or "
                    + "say the disagreement is deliberate:"
                  : "Fix it in place, or say it is deliberate:"}
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
                          {/* Offered only where the writer has actually SET a
                              reveal point. Two chapter pickers on every fact
                              would turn a two-field edit into a form, and the
                              ordinary fact becomes known where it happens. */}
                          {side.revealed_at !== undefined
                            && side.revealed_at !== null && (
                            <>
                              <span className="text-[10px] text-faint">
                                reader learns it in
                              </span>
                              {chapterPicker(draftRevealed, setDraftRevealed,
                                             "The chapter the reader learns it")}
                            </>
                          )}
                          <button
                            onClick={() => void act(() => patchFact(String(side.id), {
                              value: draftValue,
                              ...(draftAt ? { at: draftAt } : {}),
                              ...(draftRevealed ? { revealed_at: draftRevealed } : {}),
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
                        {/* Only when there is something to keep it INSTEAD
                            of. A one-sided snag has no "other" to remove, so
                            this button would delete nothing, record the stop
                            applied, and permanently silence a live problem
                            while looking like a fix. */}
                        {sides.length > 1 && (
                          <button
                            onClick={() => void act(async () => {
                              // Keeping one means the OTHERS go. One at a
                              // time, and already-gone ones count as done, so
                              // a retry after a half-way failure finishes the
                              // job instead of tripping over its own progress.
                              for (const other of sides) {
                                if (other.id !== side.id) {
                                  await deleteFact(String(other.id), true);
                                }
                              }
                            })}
                            disabled={busy}
                            className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40"
                          >
                            Keep this one
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditing(i);
                            setDraftValue(String(side.value ?? ""));
                            setDraftAt(String(side.at ?? ""));
                            setDraftRevealed(String(side.revealed_at ?? ""));
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
                {sides.length > 1
                  ? "Both are right on purpose -- never ask about this again"
                  : "That is deliberate -- never ask about this again"}
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
        )}
      </div>
    </div>
  );
}
