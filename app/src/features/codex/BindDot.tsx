// features/codex/BindDot.tsx -- saying what a bare dot actually is
// ================================================================
// Weaving offers one entry per NAME it finds in the prose, so a writer who
// accepts Lara, Croft and Lara Croft ends up with three dots where they meant
// one person. This is where they say so.
//
// IT IS NOT CALLED A MERGE, AND THAT IS NOT A WORDING CHOICE
// ---------------------------------------------------------
// Raised in review and it is the right objection: to a writer, watching the
// "Alexandra Langford" dot disappear reads as their profile being deleted. So
// nothing here talks about merging or removing. What happens is that a WORD
// moves:
//
//     Alexandra Langford, Alexandra, Langford, Lexi, Lexa, Drea
//     all mean her, so they all become words she answers to
//
// From then on a mention of any of them -- in the manuscript, in another
// profile, in a relationship, in a note -- finds her. The bare dot was only
// ever standing in for the word; once the word is hers it is standing in for
// nothing, so it goes. Her profile is untouched, and the screen says so in
// those terms rather than leaving the writer to hope.
//
// THE LABEL IS A SEPARATE QUESTION FROM THE NAME
// ----------------------------------------------
// Alexandra Langford can be the official name on the profile while the story,
// and everyone in it, only ever says Lexa. So the writer is asked whether the
// word they just moved should be what the map calls her. The name is what she
// IS; the label is what the story CALLS her, and losing the first to get the
// second would be a bad trade.
//
// THE OTHER ANSWER: IT IS ITS OWN THING, UNDER A FULLER NAME
// ----------------------------------------------------------
// The flow described in review, in the Ninja Turtles case: the manuscript
// says "The Foot", Weaving makes a placeholder for it, and the writer
// eventually wants a Faction called "The Foot Clan" that this word belongs
// to.
//
// Reached from the dot rather than from a create screen, because the dot is
// what the writer is looking at. It creates the entry, gives it the kind, and
// takes the word in -- so the connection is complete from both sides in one
// step, and "The Foot" still finds it.
//
// WHY THIS HAS TO BE MANUAL
// -------------------------
// No scan will infer that "Cult" means the Daughters of Pathicus, or that the
// faction, the deity and the religion of that name are three linked things.
// The writer knows. That is the whole argument for this screen existing.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader, Search, X } from "lucide-react";

import { TONE_CLASSES, kindChoices, threadTypeEntry } from "./lexicon";
import { absorb, nodeLabel, type GraphNode } from "./api";

const API_BASE = "http://localhost:8000";

/** The kinds an entry can be, grouped as the sidebar groups them -- Profiles
 *  and Other -- so the writer is choosing in the same terms twice rather than
 *  reading one flat list of fourteen words. */
const kindGroups = kindChoices();

interface BindDotProps {
  projectPath: string;
  /** The bare dot the writer clicked. */
  dot: GraphNode;
  /** Everything else on the map, to choose from. */
  candidates: GraphNode[];
  onClose: () => void;
  /** Re-read the world after a word moves. */
  onBound: () => void;
}

export function BindDot({
  projectPath, dot, candidates, onClose, onBound,
}: BindDotProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<GraphNode | null>(null);
  const [asLabel, setAsLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; words: string[] } | null>(null);
  // Making it its own entry: which kind, and under what fuller name.
  const [promoting, setPromoting] = useState(false);
  const [kind, setKind] = useState("");
  const [fullName, setFullName] = useState(dot.name);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Established entries only, and never itself. Offering another bare dot
  // would let the writer point a placeholder at a placeholder and be no
  // further forward.
  const options = useMemo(() => {
    const term = query.trim().toLowerCase();
    return candidates
      .filter(node => !node.placeholder && node.entity_id !== dot.entity_id)
      .filter(node => !term
        || nodeLabel(node).toLowerCase().includes(term)
        || node.name.toLowerCase().includes(term)
        || node.aliases.some(a => a.toLowerCase().includes(term)))
      .sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
  }, [candidates, dot.entity_id, query]);

  /**
   * Make this word its own entry, under a name of the writer's choosing.
   *
   * Two steps that have to look like one: create the entry, then take the word
   * into it. "The Foot" becomes a Faction called "The Foot Clan" that still
   * answers to "The Foot".
   */
  async function promote() {
    const name = fullName.trim();
    if (!kind || !name) return;
    setBusy(true);
    setError(null);
    try {
      const made = await fetch(`${API_BASE}/api/codex/thread/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, type: kind, name }),
      });
      const body = await made.json();
      if (!made.ok) {
        throw new Error(body?.detail?.message ?? "That entry could not be made.");
      }
      const created = body.thread.entity_id as string;

      // Only when the writer chose a DIFFERENT name. Absorbing "The Foot" into
      // an entry also called "The Foot" would be a no-op dressed up as a step.
      if (name.toLowerCase() !== dot.name.toLowerCase()) {
        const result = await absorb(projectPath, created, dot.entity_id, false);
        setDone({ label: result.display_name || result.name,
                  words: result.aliases });
      } else {
        setDone({ label: name, words: [name] });
      }
      onBound();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function bind() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await absorb(projectPath, chosen.entity_id,
                                  dot.entity_id, asLabel);
      setDone({
        label: result.display_name || result.name,
        words: result.aliases,
      });
      onBound();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label={`What is ${dot.name}?`}
        data-testid="bind-dot"
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            What is &ldquo;{dot.name}&rdquo;?
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        {done ? (
          // Said in terms of what MOVED, never what was removed.
          <div className="px-3 py-3">
            <p className="flex items-start gap-1.5 text-xs text-text-primary">
              <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" />
              <span>
                &ldquo;{dot.name}&rdquo; now means{" "}
                <span className="font-semibold">{done.label}</span>. Every
                mention of it -- in your manuscript, your other entries, your
                notes -- finds them from now on.
              </span>
            </p>
            <p className="mt-2 text-[11px] text-text-muted">
              {done.label} answers to:{" "}
              <span className="text-text-primary">{done.words.join(", ")}</span>
            </p>
            <p className="mt-2 text-[11px] text-faint">
              The bare dot has gone because it was only standing in for the
              word, and the word is theirs now. Nothing in{" "}
              {done.label}&rsquo;s own entry was changed.
            </p>
            <button
              onClick={onClose}
              className="mt-3 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="px-3 pt-2 text-[11px] text-text-muted">
              Weaving found this word in your writing and made a placeholder
              for it. If it means something you already have an entry for, say
              which -- the word becomes one of its names, and nothing in that
              entry changes.
            </p>

            {promoting ? (
              <div className="px-3 py-3">
                <p className="text-[11px] text-text-muted">
                  What kind of thing is it, and what is it really called? The
                  prose says &ldquo;{dot.name}&rdquo;; the entry can have a
                  fuller name and still answer to that.
                </p>

                <label className="mt-2 block text-[11px] text-text-muted">
                  What kind?
                </label>
                <select
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  aria-label="What kind"
                  className="mt-0.5 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                >
                  <option value="">Choose...</option>
                  {kindGroups.map(group => (
                    <optgroup key={group.group} label={group.group}>
                      {group.kinds.map(entry => (
                        <option key={entry.id} value={entry.id}>{entry.term}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                <label className="mt-2 block text-[11px] text-text-muted">
                  Called what?
                </label>
                <input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  aria-label="Called what"
                  className="mt-0.5 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                />
                <p className="mt-1 text-[10px] text-faint">
                  &ldquo;The Foot&rdquo; in the manuscript, &ldquo;The Foot
                  Clan&rdquo; as the entry. Both find it afterwards.
                </p>

                {error && (
                  <p role="alert" className="mt-2 text-[11px] text-rose-200">
                    {error}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void promote()}
                    disabled={!kind || !fullName.trim() || busy}
                    className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    {busy ? <Loader size={11} className="animate-spin" />
                          : <Check size={11} />}
                    Make the entry
                  </button>
                  <button
                    onClick={() => setPromoting(false)}
                    className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
            <>
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
              <Search size={11} className="shrink-0 text-faint" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find an entry"
                aria-label="Find an entry"
                className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-faint"
              />
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {options.length === 0 ? (
                /* NOTHING MATCHED, WHICH IS USUALLY THE ANSWER RATHER THAN A
                   PROBLEM. Reported as a dead end: a character named in the
                   manuscript, no entry anywhere to point the word at, and a
                   greyed "Pick an entry" button as the only thing on screen
                   that looked like a next step. The way forward was already
                   there -- it just read as a rejection rather than an answer,
                   so it says so now. */
                <li className="px-3 py-3 text-[11px] text-text-muted">
                  <p className="mb-1 text-text-primary">
                    {candidates.some(n => !n.placeholder)
                      ? "No entry matches that."
                      : "There are no entries to point this at yet."}
                  </p>
                  <p>
                    Then this is most likely its own thing -- a character,
                    place or faction the story has that your world does not
                    record yet. Use{" "}
                    <button
                      onClick={() => { setPromoting(true); setChosen(null); }}
                      className="text-violet-300 underline hover:text-violet-200"
                    >
                      It is its own thing
                    </button>{" "}
                    below and give it an entry.
                  </p>
                </li>
              ) : options.map(node => {
                const lex = threadTypeEntry(node.type);
                const Icon = lex.Icon;
                const picked = chosen?.entity_id === node.entity_id;
                return (
                  <li key={node.entity_id}>
                    <button
                      onClick={() => setChosen(picked ? null : node)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                        picked ? "bg-violet-500/15 text-text-primary"
                               : "text-text-muted hover:bg-bg-surface"
                      }`}
                    >
                      <Icon size={12}
                            className={`shrink-0 ${TONE_CLASSES[lex.tone].text}`} />
                      <span className="min-w-0 flex-1 truncate">
                        {nodeLabel(node)}
                        {node.display_name && node.display_name !== node.name && (
                          <span className="ml-1 text-faint">({node.name})</span>
                        )}
                      </span>
                      {picked && <Check size={12} className="shrink-0 text-emerald-400" />}
                    </button>
                  </li>
                );
              })}
            </ul>

            {chosen && (
              <div className="border-t border-border px-3 py-2">
                {/* The label question. Only worth asking once there is a
                    choice to make, which is why it appears here rather than
                    sitting greyed out from the start. */}
                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-text-muted">
                  <input
                    type="checkbox"
                    checked={asLabel}
                    onChange={e => setAsLabel(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Call them &ldquo;{dot.name}&rdquo; on the map.{" "}
                    <span className="text-faint">
                      Their entry stays {chosen.name} -- this only changes what
                      the map says, for a name the story uses more than the
                      official one.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {error && (
              <p role="alert"
                 className="mx-3 mb-2 flex items-start gap-1.5 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
              <button
                onClick={() => void bind()}
                disabled={!chosen || busy}
                className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {busy ? <Loader size={11} className="animate-spin" />
                      : <Check size={11} />}
                {chosen
                  ? `"${dot.name}" means ${nodeLabel(chosen)}`
                  : "Pick an entry above"}
              </button>
              {/* Standing on its own is a legitimate answer, not a failure to
                  bind -- and usually under a fuller name than the prose
                  happened to use. */}
              <button
                onClick={() => { setPromoting(true); setChosen(null); }}
                className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
              >
                It is its own thing
              </button>
            </footer>
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
