// features/codex/ExtractorWhoIsThis.tsx -- a new face, or a face you know
// ========================================================================
// What to do with a proposal for something the writer does not have an entry
// for. Reported from the first review session, using a character from the
// writer's own book:
//
//   "The Man in the Alley ... is the same character in the Chapter 5-Scene 3:
//    a hulking man. No name, just a description. He is the man who will
//    eventually be revealed to be Atlas, the major super-villain."
//
// Creating a second entry for him would be wrong. But the writer named a second
// case in the same breath, and it is what makes this subtle:
//
//   "We also want to be careful about TAGGING a character literally playing
//    someone else, Example: Tom the Barkeep in chapter 2 was really Donald
//    Morgan the arch wizard in disguise. But Tom the Barkeep is an established
//    character with a profile."
//
// ── THE RULE, AND IT IS THE WHOLE DESIGN OF THIS FILE ───────────────────────
//
//   AN ALIAS IS ABOUT WORDS. A TIE IS ABOUT THINGS.
//
// "The Man in the Alley" is a phrase the prose uses for Altas. One person, one
// entry, and the phrase becomes another word that finds him.
//
// Tom the Barkeep is a PERSON in the story: his own profile, his own scenes,
// his own connections. That he is Donald Morgan in disguise is a fact about the
// world, not a spelling. Folding Tom into Donald would delete a character the
// writer wrote, and nothing would bring back the connections that went with
// him.
//
// So this asks which, in those terms, and never guesses. Getting it wrong in
// the merge direction is unrecoverable, which is why the safe answer is the
// one presented first and the destructive one names what it would cost.

import { useEffect, useMemo, useState } from "react";
import { Loader, Search } from "lucide-react";

import {
  addAlias, fetchThreads, nodeLabel, type ThreadSummary,
} from "./api";

interface Props {
  projectPath: string;
  /** The proposal's name, e.g. "The Man in the Alley". */
  name: string;
  type: string;
  /** The pass's own guess at who this is, when it had one. */
  suggestedId?: string;
  onClose: () => void;
  /** They are the same entry: the phrase became an alias on `entityId`, and
   *  the proposal's parts now belong to it. */
  onAliased: (entityId: string) => void;
  /** They are two entries: the writer wants to record a connection instead.
   *  This screen does not build ties; it hands over to the one that does. */
  onWantsConnection: (entityId: string) => void;
}

export function ExtractorWhoIsThis({
  projectPath, name, type, suggestedId, onClose, onAliased, onWantsConnection,
}: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(suggestedId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchThreads(projectPath)
      .then(body => { if (!cancelled) setThreads(body.threads); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // SAME KIND FIRST, because a character is almost never revealed to be a
    // location. Not a filter though: the writer's own kinds are theirs, and a
    // search must be able to reach anything.
    const pool = needle
      ? threads.filter(t => t.name.toLowerCase().includes(needle))
      : threads.filter(t => t.type === type);
    return pool.slice(0, 60);
  }, [threads, query, type]);

  const target = threads.find(t => t.entity_id === chosen);

  const makeAlias = async () => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await addAlias(projectPath, target.entity_id, name);
      onAliased(target.entity_id);
    } catch (e) {
      // The most likely refusal is `alias_taken`: the word already means
      // something else. That is a real answer and its message names the entry
      // it collided with, so it is shown rather than flattened.
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
         onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Who is this?"
           data-testid="who-is-this-dialog"
           className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-border bg-bg-primary">
        <header className="border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold text-text-primary">
            Who is "{name}"?
          </h2>
          <p className="mt-0.5 text-mini text-text-muted">
            Your book describes this one without naming them. If they are
            somebody you already have, say so here rather than making a second
            entry for the same person.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1">
            <Search size={11} className="text-faint" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`Search your world (showing ${type}s)`}
              aria-label="Search your world"
              className="w-full bg-transparent text-mini text-text-primary outline-none"
            />
          </label>

          {loading ? (
            <p className="mt-2 flex items-center gap-1.5 text-mini text-text-muted">
              <Loader size={11} className="animate-spin" /> Reading your world...
            </p>
          ) : (
            <ul className="mt-1.5 max-h-52 space-y-0.5 overflow-y-auto"
                data-testid="who-is-this-list">
              {matches.map(thread => (
                <li key={thread.entity_id}>
                  <button
                    type="button"
                    onClick={() => setChosen(thread.entity_id)}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-mini ${
                      thread.entity_id === chosen
                        ? "bg-violet-500/15 text-text-primary"
                        : "text-text-muted hover:bg-white/5"}`}
                  >
                    <span className="truncate">{nodeLabel(thread)}</span>
                    <span className="ml-auto shrink-0 text-faint">{thread.type}</span>
                    {thread.entity_id === suggestedId && (
                      <span className="shrink-0 text-2xs text-violet-300">
                        suggested
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="mt-2 text-mini text-rose-300">{error}</p>}

          {/* THE TWO ANSWERS, and the difference stated in the writer's terms
              rather than the app's. Neither is "merge": one is about a word,
              the other is about the world. */}
          {target && (
            <div className="mt-3 space-y-2" data-testid="who-is-this-choices">
              <div className="rounded border border-border px-2.5 py-2">
                <p className="text-mini font-semibold text-text-primary">
                  "{name}" is just another way your book says{" "}
                  {nodeLabel(target)}.
                </p>
                <p className="mt-0.5 text-mini text-faint">
                  One person, one entry. The phrase is added as another name
                  that finds {nodeLabel(target)}, and everything proposed here
                  goes onto their page.
                </p>
                <button type="button" onClick={() => void makeAlias()} disabled={busy}
                        data-testid="who-is-this-alias"
                        className="mt-1.5 rounded bg-violet-600 px-2.5 py-1 text-mini font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
                  Use it as another name for {nodeLabel(target)}
                </button>
              </div>

              <div className="rounded border border-border px-2.5 py-2">
                <p className="text-mini font-semibold text-text-primary">
                  They are two people, and one is pretending to be the other.
                </p>
                <p className="mt-0.5 text-mini text-faint">
                  A barkeep who turns out to be a wizard in disguise is still a
                  barkeep in your book, with his own scenes and his own
                  connections. Keep both entries and record how they relate --
                  folding them together would delete one of them.
                </p>
                <button type="button"
                        onClick={() => onWantsConnection(target.entity_id)}
                        data-testid="who-is-this-connection"
                        className="mt-1.5 rounded border border-border px-2.5 py-1 text-mini text-text-muted hover:text-text-primary">
                  Keep both and connect them
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-4 py-2">
          <p className="text-micro text-faint">
            Neither of these fits? Close this and create a new entry instead.
          </p>
          <button type="button" onClick={onClose}
                  className="ml-auto rounded px-2.5 py-1 text-mini text-text-muted hover:text-text-primary">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
