// features/codex/TieEditor.tsx -- saying how two things relate
// ============================================================
// The case this exists for, from live testing:
//
//     "The Daughters of Pathicus are a faction. The word Cult means them.
//      Pathicus is a deity. A religion of Pathicus exists too, because the
//      Daughters worship him. The AI and app might not recognise any of these
//      connections directly, but the writer would."
//
// Four entries, three kinds, and every link obvious to the writer and
// invisible to any rule. Absorbing a word handles "Cult means the faction".
// This handles the rest, and there is no version of this feature where the
// app guesses it.
//
// FOUR THINGS THE SCREEN IS BUILT AROUND
// --------------------------------------
// 1. THE OTHER END FIRST, THEN HOW. A writer thinks "the Daughters and
//    Pathicus" before they think "worships". Asking for a relation first means
//    offering a vocabulary before there is anything to say it about.
//
// 2. ONLY WHAT MEANS SOMETHING BETWEEN THESE TWO KINDS. The registry knows
//    which connections run between a faction and a deity, so the list is short
//    and every item in it is true. A flat list of every relation in the world
//    would make the writer do that filtering in their head.
//
// 3. A CONNECTION IS ALLOWED TO BE UNTYPED, and that is the default. Requiring
//    a relation before two things can be joined gets the order of work wrong:
//    a writer knows Drizzt and Guenhwyvar belong together long before they want
//    to argue with themselves about whether that is a bond, a friendship or
//    ownership. Made to choose in that moment they will pick badly or stop. So
//    "just connected" sits at the top, on its own, and everything else is an
//    improvement to a connection that already exists.
//
// 4. "NOTHING ELSE FITS" IS NEVER A DEAD END. Two more honest answers: the pair
//    may need turning around, or the vocabulary is genuinely short and the
//    writer should name the connection themselves. Both are offered here,
//    because a screen that shrugs is a screen that stops being opened.
//
// 5. THE OTHER END MIGHT NOT EXIST YET, AND THAT MUST NOT END THE JOB.
//    Reported from live testing: "the path to the file doesn't exist
//    because it hasn't been created yet". Sending the writer off to make it
//    somewhere else loses their place and the half-made thought with it. So
//    it is made here, named and given a kind, and connected in the same
//    breath.
//
// 6. READ FROM THE END YOU ARE STANDING AT. An incoming "mentored by" reads as
//    "mentor of" from the other side. Showing the stored direction would make
//    the writer translate every line in their head.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, Check, Link2, Loader, Plus,
  Trash2, X,
} from "lucide-react";

import { TONE_CLASSES, kindChoices, threadTypeEntry } from "./lexicon";
import { nodeLabel, type GraphNode } from "./api";

const API_BASE = "http://localhost:8000";

/** The kinds a new entry can be, grouped as the sidebar groups them. */
const KIND_GROUPS = kindChoices();

interface Tie {
  src_id: string;
  dst_id: string;
  rel: string;
  incoming: boolean;
  other_id: string;
  other_name: string;
  other_type: string;
  /** How it reads from the end being looked at. */
  reads_as: string;
  at: string | null;
  until: string | null;
  at_label: string;
  until_label: string;
}

interface Relation {
  id: string;
  label: string;
  symmetric: boolean;
  cardinality: string;
  inverse_label: string;
  /** True when it runs the other way, so the pair has to be turned around. */
  flipped: boolean;
  /** Runs between any two kinds. There is one, and it is the plain one. */
  universal?: boolean;
}

interface TieEditorProps {
  projectPath: string;
  /** The entry being connected. */
  thread: GraphNode;
  /** Everything else, to connect it to. */
  candidates: GraphNode[];
  /**
   * Who the prose keeps putting in the same scene as this entry, strongest
   * first, straight from the free scan.
   *
   * Reported after the first version offered the whole world alphabetically:
   * "3 profiles and 1 location appear in a list." Asking the question is only
   * half the job -- the likely answers have to be within reach, and each one
   * has to say why it is near the top, or it is a guess with better manners.
   */
  likely?: { entity_id: string; scenes: number }[];
  onClose: () => void;
  /** Re-read the world, so the map redraws with the new edge. */
  onChanged: () => void;
}

export function TieEditor({
  projectPath, thread, candidates, likely, onClose, onChanged,
}: TieEditorProps) {
  const [ties, setTies] = useState<Tie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [other, setOther] = useState<GraphNode | null>(null);
  const [options, setOptions] = useState<{
    forward: Relation[]; reverse: Relation[]; available: Relation[];
    // How long a reason may be. Sent by the backend, which is the thing that
    // enforces it -- a copy kept here is how silent truncation gets shipped.
    reason_limit?: number;
  } | null>(null);
  // Making the other end, when it does not exist yet.
  const [making, setMaking] = useState(false);
  const [madeName, setMadeName] = useState("");
  const [madeKind, setMadeKind] = useState("");
  const [naming, setNaming] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  // What the connection reads as from the OTHER end. Optional, because a
  // writer in the middle of a thought should not be made to answer two
  // questions -- but offered, because without it the other end reads as
  // "Race (the other way round)", which is honest and clumsy.
  const [newInverse, setNewInverse] = useState("");
  // WHY these two relate, and the one thing a connection cannot be saved
  // without. See the reason box below for the argument.
  const [reason, setReason] = useState("");
  const [reasonInverse, setReasonInverse] = useState("");
  const [showInverse, setShowInverse] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/codex/ties?project_path=${encodeURIComponent(projectPath)}`
        + `&entity_id=${encodeURIComponent(thread.entity_id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.detail?.message ?? "Could not read connections.");
      // Defaulted, not trusted. A response without the key would otherwise
      // crash the render rather than showing an empty list, and "no
      // connections" is a perfectly ordinary answer.
      setTies((body.ties ?? []) as Tie[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read connections.");
    }
  }, [projectPath, thread.entity_id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Which connections mean anything between these two kinds. Asked only once
  // the other end is chosen, because the answer depends on it.
  useEffect(() => {
    if (!other) { setOptions(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/codex/relations?project_path=${encodeURIComponent(projectPath)}`
          + `&src_type=${encodeURIComponent(thread.type)}`
          + `&dst_type=${encodeURIComponent(other.type)}`);
        const body = await response.json();
        if (!cancelled && response.ok) setOptions(body);
      } catch {
        if (!cancelled) setOptions({ forward: [], reverse: [], available: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath, thread.type, other]);

  /** entity_id -> shared scene count, for ordering and for the row label. */
  const sharedWith = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of likely ?? []) map.set(row.entity_id, row.scenes);
    return map;
  }, [likely]);

  const reachable = useMemo(() => {
    const term = query.trim().toLowerCase();
    const connected = new Set((ties ?? []).map(t => t.other_id));
    return candidates
      .filter(node => node.entity_id !== thread.entity_id)
      // BARE ENTRIES ARE OFFERED, and that reverses an earlier decision.
      //
      // The old reasoning was that a placeholder has not been said to BE
      // anything yet, so connecting to one records a relationship with a word
      // rather than with a thing. That was defensible when a connection was
      // just an edge -- and wrong now, for two reasons.
      //
      // The walk CREATES these on purpose, from names already in the prose, so
      // that the writing can carry on: "Weaving's purpose is to generate
      // connections. Period." Hiding them means the entry made thirty seconds
      // ago cannot be connected to, which is a dead end of the app's own making.
      //
      // And the reason line now carries the meaning. "She is hiding her theft
      // from him" says what Dean is to her whether or not Dean's entry has any
      // prose in it yet. They are marked as bare in the list so the writer is
      // not misled about what is behind the name.
      .filter(node => !term
        || nodeLabel(node).toLowerCase().includes(term)
        || node.aliases.some(a => a.toLowerCase().includes(term)))
      .sort((a, b) => {
        // Things not yet connected first: they are what the writer came to do.
        const ca = connected.has(a.entity_id) ? 1 : 0;
        const cb = connected.has(b.entity_id) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        // Then whoever the story keeps putting in the room, most shared
        // scenes first. This is the whole reason the scan counts them.
        const sa = sharedWith.get(a.entity_id) ?? 0;
        const sb = sharedWith.get(b.entity_id) ?? 0;
        if (sa !== sb) return sb - sa;
        return nodeLabel(a).localeCompare(nodeLabel(b));
      });
  }, [candidates, query, thread.entity_id, ties, sharedWith]);

  /**
   * Make the other end, then treat it as chosen.
   *
   * The writer came here to say two things are connected and discovered that
   * one of them is not written down. Making them leave to fix that costs them
   * the thought they arrived with.
   */
  async function makeOther() {
    const name = madeName.trim();
    if (!name || !madeKind) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/codex/thread/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, type: madeKind, name }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be made.");
      }
      setMaking(false);
      setMadeName("");
      // Chosen straight away, so the writer carries on rather than hunting for
      // the thing they just made in a list.
      setOther({
        entity_id: body.thread.entity_id, type: madeKind, name,
        display_name: "", aliases: [], placeholder: true,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be made.");
    } finally {
      setBusy(false);
    }
  }

  /** Nothing can be recorded without a reason -- the backend refuses it too. */
  const canConnect = reason.trim().length > 0;
  // The backend enforces this, so the backend states it. The fallback applies
  // only in the moment before the relations request lands.
  const reasonLimit = options?.reason_limit ?? 140;

  async function connect(relation: Relation) {
    if (!other || !canConnect) return;
    // An older project may not have the plain connection at all, since
    // types.json is the writer's file and is never modified behind their back.
    // Adopting it is silent here on purpose: "just connect them" should not
    // turn into a lecture about vocabulary.
    if (relation.universal && !options?.forward.some(r => r.id === relation.id)) {
      await fetch(`${API_BASE}/api/codex/relation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, adopt: relation.id }),
      }).catch(() => undefined);
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      // A flipped relation is stored from the OTHER end, because a Tie is
      // recorded once and read from both sides. Storing it backwards would
      // make the whole world read backwards.
      const src = relation.flipped ? other.entity_id : thread.entity_id;
      const dst = relation.flipped ? thread.entity_id : other.entity_id;
      const response = await fetch(`${API_BASE}/api/codex/tie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: projectPath, src_id: src,
          rel: relation.id, dst_id: dst,
          // A flipped relation is stored from the other end, so the reasons
          // have to swap with it or the connection reads backwards.
          reason: relation.flipped ? reasonInverse.trim() || reason : reason,
          reason_inverse: relation.flipped ? reason : reasonInverse,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be recorded.");
      }
      setWarnings(body.warnings ?? []);
      setAdding(false);
      setOther(null);
      setQuery("");
      // Cleared, because the next connection is a different connection. A
      // reason left in the box would be recorded against the wrong pair.
      setReason("");
      setReasonInverse("");
      setShowInverse(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function nameIt() {
    if (!other || !newLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/codex/relation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: projectPath, label: newLabel,
          source_types: [thread.type], target_types: [other.type],
          inverse_label: newInverse,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be added.");
      }
      setNaming(false);
      setNewLabel("");
      setNewInverse("");
      await connect({ id: body.id, label: body.label, symmetric: false,
                      cardinality: "many", inverse_label: "", flipped: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be added.");
      setBusy(false);
    }
  }

  async function adopt(relation: Relation) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/codex/relation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, adopt: relation.id }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body?.detail?.message ?? "That could not be added.");
      }
      await connect(relation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be added.");
      setBusy(false);
    }
  }

  async function remove(tie: Tie) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/codex/tie?project_path=${encodeURIComponent(projectPath)}`
        + `&src_id=${encodeURIComponent(tie.src_id)}`
        + `&rel=${encodeURIComponent(tie.rel)}`
        + `&dst_id=${encodeURIComponent(tie.dst_id)}`,
        { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body?.detail?.message ?? "That could not be removed.");
      }
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  // The plain connection is the default and belongs on its own. Everything
  // else is a way of saying more about one.
  const plain = options?.forward.find(r => r.universal)
    ?? options?.available.find(r => r.universal);
  const typed = (options?.forward ?? []).filter(r => !r.universal);

  const nothingFits = other && options
    && typed.length === 0
    && options.reverse.length === 0
    && options.available.filter(r => !r.universal).length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label={`Connections for ${nodeLabel(thread)}`}
        data-testid="tie-editor"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          {/* The entry being connected FROM, with its own kind's icon. The
              question only makes sense once the writer can see where they are
              standing. */}
          {(() => {
            const kind = threadTypeEntry(thread.type);
            const KindIcon = kind.Icon;
            return <KindIcon size={14}
                             className={`shrink-0 ${TONE_CLASSES[kind.tone].text}`} />;
          })()}
          <h2 className="flex-1 truncate text-xs font-semibold text-text-primary">
            How is {nodeLabel(thread)} connected?
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {/* ── What is already recorded ─────────────────────────────── */}
          {ties === null ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <Loader size={12} className="animate-spin" /> Reading connections...
            </p>
          ) : ties.length === 0 ? (
            <p className="text-[11px] text-faint">
              Nothing yet. Mentions of this name in your writing already find
              this entry, and that needs nothing from you -- what is missing is
              how it relates to the rest of your world. No scan can guess that:
              only you know that the Daughters worship Pathicus.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {ties.map(tie => {
                const lex = threadTypeEntry(tie.other_type);
                const Icon = lex.Icon;
                return (
                  <li key={`${tie.src_id}|${tie.rel}|${tie.dst_id}`}
                      className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-bg-surface">
                    <span className="shrink-0 text-[11px] text-emerald-300">
                      {tie.reads_as}
                    </span>
                    <ArrowRight size={10} className="shrink-0 text-faint" />
                    <Icon size={11}
                          className={`shrink-0 ${TONE_CLASSES[lex.tone].text}`} />
                    <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                      {tie.other_name}
                    </span>
                    {tie.at_label && (
                      <span className="shrink-0 text-[10px] text-faint">
                        from {tie.at_label}
                      </span>
                    )}
                    <button
                      onClick={() => void remove(tie)}
                      disabled={busy}
                      aria-label={`Remove ${tie.reads_as} ${tie.other_name}`}
                      className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {warnings.map(w => (
                <li key={w}
                    className="flex items-start gap-1.5 rounded border border-amber-700/60 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-200/90">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {/* Recorded anyway. Sometimes a disputed throne IS the story,
                      and the app is not entitled to decide. */}
                  <span>{w} It has been recorded either way.</span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert"
               className="mt-2 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          {/* ── Adding one ───────────────────────────────────────────── */}
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-violet-300 hover:text-violet-200"
            >
              <Plus size={11} /> Connect this to something
            </button>
          ) : (
            <div className="mt-3 rounded border border-border p-2">
              {!other ? (
                <>
                  <label className="mb-1 block text-[11px] text-text-muted">
                    What is it connected to?
                  </label>
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Find an entry"
                    aria-label="Find an entry"
                    className="mb-1 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                  />
                  <ul className="max-h-40 overflow-y-auto">
                    {reachable.length === 0 ? (
                      <li className="px-1 py-2 text-[11px] text-faint">
                        {query.trim()
                          ? "Nothing matches that."
                          : "Nothing to connect to yet."}
                      </li>
                    ) : reachable.map(node => {
                      const lex = threadTypeEntry(node.type);
                      const Icon = lex.Icon;
                      return (
                        <li key={node.entity_id}>
                          <button
                            onClick={() => setOther(node)}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-text-muted hover:bg-bg-surface hover:text-text-primary"
                          >
                            <Icon size={11}
                                  className={`shrink-0 ${TONE_CLASSES[lex.tone].text}`} />
                            <span className="min-w-0 flex-1 truncate">
                              {nodeLabel(node)}
                            </span>
                            {/* Offered, but not pretended to be more than it
                                is: a name the walk made an entry for, with
                                nothing written in it yet. */}
                            {node.placeholder && (
                              <span className="shrink-0 text-[10px] text-violet-300">
                                nothing in it yet
                              </span>
                            )}
                            {/* The evidence, on the row. A suggestion that
                                cannot show its reasoning is just a guess. */}
                            {sharedWith.has(node.entity_id) && (
                              <span className="shrink-0 text-[10px] text-emerald-300">
                                {sharedWith.get(node.entity_id) === 1
                                  ? "1 scene together"
                                  : `${sharedWith.get(node.entity_id)} scenes together`}
                              </span>
                            )}
                            <span className="shrink-0 text-[10px] text-faint">
                              {lex.term}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* It might not exist yet, and that must not end the job.
                      Prefilled from whatever they typed to search, because
                      that is usually its name. */}
                  {making ? (
                    <div className="mt-1.5 rounded border border-border p-2">
                      <label className="block text-[11px] text-text-muted">
                        What is it called?
                      </label>
                      <input
                        value={madeName}
                        onChange={e => setMadeName(e.target.value)}
                        aria-label="What is it called"
                        className="mt-0.5 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                      />
                      <label className="mt-1.5 block text-[11px] text-text-muted">
                        What kind of thing is it?
                      </label>
                      <select
                        value={madeKind}
                        onChange={e => setMadeKind(e.target.value)}
                        aria-label="What kind of thing is it"
                        className="mt-0.5 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                      >
                        <option value="">Choose...</option>
                        {KIND_GROUPS.map(group => (
                          <optgroup key={group.group} label={group.group}>
                            {group.kinds.map(kind => (
                              <option key={kind.id} value={kind.id}>{kind.term}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <p className="mt-1 text-[10px] text-faint">
                        It is made empty and you can fill it in whenever. What
                        matters now is the connection.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => void makeOther()}
                          disabled={!madeName.trim() || !madeKind || busy}
                          className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                        >
                          {busy ? <Loader size={11} className="animate-spin" />
                                : <Check size={11} />}
                          Make it
                        </button>
                        <button
                          onClick={() => setMaking(false)}
                          className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setMaking(true);
                        setMadeName(query.trim());
                      }}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
                    >
                      <Plus size={11} /> It is not here yet -- make it
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p data-testid="relation-prompt"
                     className="mb-1.5 text-[11px] text-text-muted">
                    How is{" "}
                    <span className="text-text-primary">{nodeLabel(thread)}</span>
                    {" "}connected to{" "}
                    <span className="text-text-primary">{nodeLabel(other)}</span>?
                  </p>

                  {/* WHY, AND IT COMES FIRST BECAUSE IT IS WORTH THE MOST.
                      ====================================================
                      This one sentence outperforms every other field on the
                      connection, including the relation type:

                        antagonist of              a label the model could
                                                   mostly have guessed
                        "she is hiding her theft
                         from him"                 the scene, the tension, and
                                                   the thing he must not notice

                      A single-line input rather than a textarea, deliberately.
                      A textarea invites paragraphs, and the shape of the box
                      teaches the rule before any counter has to scold anyone.
                      maxLength comes from the BACKEND, so the box can never be
                      wider than what will actually be kept. */}
                  <label htmlFor="tie-reason"
                         className="mb-1 block text-[11px] text-text-muted">
                    In one line, why?
                  </label>
                  <input
                    id="tie-reason"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={reasonLimit}
                    placeholder="taught her everything, then vanished"
                    aria-label="Why they are connected"
                    className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                  />
                  <p className="mt-1 text-[10px] text-faint">
                    This is what gets sent to AI when you ask for help with a
                    scene, so it is worth more than the label below -- and it is
                    why one line is the limit. Every connection in a scene costs
                    budget, and a wordy one gets left out.
                    {reason.length > reasonLimit - 25 && (
                      <span className="ml-1 text-amber-300">
                        {reasonLimit - reason.length} left
                      </span>
                    )}
                  </p>

                  {/* Offered, not demanded. "Alexandra is hiding her theft from
                      Dean" does not reverse cleanly -- from his end it is "does
                      not know she stole from him" -- but a writer in the middle
                      of a thought should not be made to answer twice. */}
                  {showInverse ? (
                    <>
                      <label htmlFor="tie-reason-inverse"
                             className="mb-1 mt-1.5 block text-[11px] text-text-muted">
                        And from {nodeLabel(other)}&apos;s side?{" "}
                        <span className="text-faint">optional</span>
                      </label>
                      <input
                        id="tie-reason-inverse"
                        value={reasonInverse}
                        onChange={e => setReasonInverse(e.target.value)}
                        maxLength={reasonLimit}
                        placeholder="does not know she stole from him"
                        aria-label="Why, from the other side"
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                      />
                    </>
                  ) : (
                    <button
                      onClick={() => setShowInverse(true)}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
                    >
                      <Plus size={9} /> It reads differently from{" "}
                      {nodeLabel(other)}&apos;s side
                    </button>
                  )}

                  {!canConnect && (
                    <p role="status" className="mt-1.5 text-[10px] text-amber-300">
                      Write that line and the buttons below wake up. A connection
                      with nothing but two names tells AI less than the prose
                      already does.
                    </p>
                  )}

                  <div className="my-2 border-t border-border" />

                  {options === null ? (
                    <p className="flex items-center gap-2 text-[11px] text-text-muted">
                      <Loader size={11} className="animate-spin" /> Looking...
                    </p>
                  ) : naming ? (
                    <div>
                      <label className="mb-1 block text-[11px] text-text-muted">
                        What would you call this connection?
                      </label>
                      <div className="flex items-start gap-2">
                        <input
                          value={newLabel}
                          onChange={e => setNewLabel(e.target.value)}
                          placeholder="worships"
                          aria-label="Connection name"
                          className="flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={() => void nameIt()}
                          disabled={!newLabel.trim() || busy}
                          className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                        >
                          {busy ? <Loader size={11} className="animate-spin" />
                                : <Check size={11} />}
                          Add
                        </button>
                      </div>
                      <label className="mt-1.5 block text-[11px] text-text-muted">
                        And from {nodeLabel(other)} back?{" "}
                        <span className="text-faint">optional</span>
                      </label>
                      <input
                        value={newInverse}
                        onChange={e => setNewInverse(e.target.value)}
                        placeholder="worshipped by"
                        aria-label="The other way round"
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-[10px] text-faint">
                        It becomes part of your world, so you can use it between
                        any {threadTypeEntry(thread.type).term} and{" "}
                        {threadTypeEntry(other.type).term} from now on. Without
                        the second half, this connection reads awkwardly when you
                        are standing at the other end.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* The plain one, first and on its own. The RELATION is
                          the optional half now -- it is what makes a connection
                          queryable and drawable, while the reason above is what
                          makes it USEFUL. So this records the reason with no
                          label attached, and a label can come on a later pass. */}
                      {plain && (
                        <button
                          onClick={() => void connect(plain)}
                          disabled={busy || !canConnect}
                          className="mb-1.5 flex w-full items-center gap-1.5 rounded border border-emerald-800 bg-emerald-950/30 px-2 py-1.5 text-left text-xs text-text-primary hover:bg-emerald-950/50 disabled:opacity-40"
                        >
                          {busy ? <Loader size={11} className="animate-spin" />
                                : <Link2 size={11} className="text-emerald-300" />}
                          <span className="flex-1">Record it</span>
                          <span className="text-[10px] text-faint">
                            label it later
                          </span>
                        </button>
                      )}


                      {typed.length > 0 && (
                        <p className="mb-0.5 text-[10px] uppercase tracking-wide text-faint">
                          or give it a label too
                        </p>
                      )}
                      {typed.map(rel => (
                        <RelButton key={rel.id} rel={rel} busy={busy}
                                   disabled={!canConnect}
                                   from={nodeLabel(thread)} to={nodeLabel(other)}
                                   onPick={() => void connect(rel)} />
                      ))}

                      {/* The pair may simply need turning around. Making the
                          writer work out that "governed by" is "governs"
                          backwards is work the app can do. */}
                      {options.reverse.length > 0 && (
                        <>
                          <p className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint">
                            <ArrowLeftRight size={9} /> the other way round
                          </p>
                          {options.reverse.map(rel => (
                            <RelButton key={rel.id} rel={rel} busy={busy}
                                       disabled={!canConnect}
                                       from={nodeLabel(other)} to={nodeLabel(thread)}
                                       onPick={() => void connect(rel)} />
                          ))}
                        </>
                      )}

                      {/* Shipped connections this world does not have. types.json
                          is the writer's file and is never modified behind their
                          back, so an older project is OFFERED them. */}
                      {options.available.filter(r => !r.universal).length > 0 && (
                        <>
                          <p className="mt-1.5 text-[10px] uppercase tracking-wide text-faint">
                            not in your world yet
                          </p>
                          {options.available.filter(r => !r.universal).map(rel => (
                            <button
                              key={rel.id}
                              onClick={() => void adopt(rel)}
                              disabled={busy || !canConnect}
                              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-text-muted hover:bg-bg-surface hover:text-text-primary disabled:opacity-40"
                            >
                              <Plus size={10} className="shrink-0 text-violet-300" />
                              {rel.label}
                              <span className="text-[10px] text-faint">
                                add and use
                              </span>
                            </button>
                          ))}
                        </>
                      )}

                      {nothingFits && (
                        <p className="text-[11px] text-text-muted">
                          Your world has no NAMED way to connect a{" "}
                          {threadTypeEntry(thread.type).term} to a{" "}
                          {threadTypeEntry(other.type).term} yet. A plain
                          connection still works.
                        </p>
                      )}

                      <button
                        onClick={() => setNaming(true)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
                      >
                        <Plus size={11} /> Name it yourself
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => { setOther(null); setNaming(false); }}
                    className="mt-2 text-[11px] text-faint hover:text-text-primary"
                  >
                    Pick something else
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/** One connection on offer, written as the sentence it will record. */
function RelButton({ rel, from, to, busy, disabled, onPick }: {
  rel: Relation; from: string; to: string; busy?: boolean; disabled?: boolean;
  onPick: () => void;
}) {
  // A BORDER, because this row IS the save action and did not look like one.
  // Reported as "none of the options below were clickable" -- they were, but a
  // borderless line of text reading "Alexandra mentored by Lara Croft" reads as
  // a label, and the writer was looking for something to press.
  return (
    <button
      onClick={onPick}
      disabled={busy || disabled}
      className="mb-1 flex w-full items-baseline gap-1.5 rounded border border-border px-2 py-1.5 text-left text-xs hover:border-emerald-800 hover:bg-bg-surface disabled:opacity-40"
    >
      <span className="min-w-0 flex-1 truncate text-text-primary">
        {from} <span className="text-emerald-300">{rel.label}</span> {to}
      </span>
      {rel.cardinality === "one" && (
        <span className="shrink-0 text-[10px] text-faint">one at a time</span>
      )}
    </button>
  );
}
