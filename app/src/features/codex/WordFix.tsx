// features/codex/WordFix.tsx -- the flagged word is wrong, or it is already yours
// ===============================================================================
// The two answers an Unspun stop could not give. Reported from live testing, in
// one example that had both problems at once:
//
//     "Blaskowitz Sideburn was flagged. First issue is, this is PART of one of
//      Newton's nicknames and by part, I mean literal part. His full name is
//      Newton Blaskowitz. He goes by The Sideburn Swindler as one of his many
//      nicknames. So I'm not going to assign it a new profile because its wrong
//      in how it was flagged. Second issue, there was no way for me to EDIT the
//      text it flagged so that I could correct it. Third, I couldn't CONNECT
//      that name to an existing profile for Newton."
//
// The stop offered "Create the entry" and "Never make this an entry" and nothing
// else. So a mis-grouped phrase had two wrong answers and no right one: make a
// profile you know is wrong, or permanently silence a word that IS a real name
// in a form you would have accepted.
//
// THE WORD IS EDITABLE FIRST, BEFORE ANY DESTINATION IS CHOSEN. That is the
// order the writer asked for and it is the right one: what the scan found is a
// guess about where one name ends and the next begins, and every answer below is
// wrong if the guess is wrong. It was previously editable only INSIDE the create
// form, so correcting a word meant first agreeing to make a profile you did not
// want.
//
// AND CORRECTING IT RETIRES THE ORIGINAL. By editing "Blaskowitz Sideburn" down
// to "Blaskowitz" the writer has said the longer phrase is not a thing; leaving
// it live would raise it again on the next scan, which is the loop this screen
// exists to break. Said out loud on the receipt rather than done quietly.
//
// House style: no em dashes anywhere a writer reads.

import { useMemo, useState } from "react";
import { Check, Loader, Search, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { useAttemptClose } from "../../components/learn/useAttemptClose";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { addAlias, nodeLabel, type GraphNode } from "./api";

interface WordFixProps {
  projectPath: string;
  /** The phrase the scan found, as it found it. */
  word: string;
  /** Everything already in the world, to attach it to. */
  candidates: GraphNode[];
  /** The writer corrected the word and wants to make an entry after all, so the
   *  create form opens with their wording rather than the scan's. */
  onCreateInstead: (corrected: string) => void;
  /** Recorded. `retire` is the original phrase when it was corrected, so the
   *  walk can stop it being raised again. */
  onDone: (retire: string) => void;
  onClose: () => void;
}

export function WordFix({ projectPath, word, candidates, onCreateInstead,
                          onDone, onClose }: WordFixProps) {
  const [text, setText] = useState(word);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<GraphNode | null>(null);
  const [asLabel, setAsLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; added: string } | null>(null);

  const corrected = text.trim() !== word.trim();
  const attemptClose = useAttemptClose(
    done === null && (corrected || chosen !== null), onClose,
    "You have not recorded this yet. Close and lose the correction?");

  // Placeholders are left out: attaching a word to an empty stub made from
  // another word records nothing the writer could use, and it is the shape of
  // mistake that produced three entries for one person in the first place.
  const attachable = useMemo(
    () => candidates.filter(c => !c.placeholder), [candidates]);

  // EVERY MATCH, and the list scrolls. This used to end in `.slice(0, 8)`, which
  // is the shape of bug this repo has a rule against: as the writer's world grew
  // past eight entries the rest were simply not rendered, with nothing saying so,
  // and the search box stopped being a convenience and became the only way to
  // reach your own profiles. Reported exactly that way.
  //
  // Both sibling pickers (BindDot, TieEditor) already scroll rather than cap. A
  // few hundred rows is nothing to render, and a cap on a list with no "see all"
  // anywhere else is a silent cap.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return attachable;
    return attachable.filter(
      c => nodeLabel(c).toLowerCase().includes(needle)
           || c.aliases.some(a => a.toLowerCase().includes(needle)));
  }, [attachable, query]);

  async function record() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addAlias(projectPath, chosen.entity_id,
                                    text.trim(), asLabel);
      setDone({ label: result.display_name || result.name,
                added: result.added });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
    >
      <div
        role="dialog"
        aria-label={`What is ${word}?`}
        data-testid="word-fix"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            {done ? "Recorded" : `Is "${word}" already in your world?`}
          </h2>
          <Explain of="weaving.word-fix" />
          <button onClick={attemptClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        {done ? (
          <div className="p-3" data-testid="word-fix-done">
            <p className="text-xs text-text-primary">
              {done.added
                ? <>
                    <span className="font-medium">{done.label}</span> now answers
                    to <span className="font-medium">{done.added}</span>.
                  </>
                : <>
                    <span className="font-medium">{done.label}</span> already
                    answered to that. Nothing needed changing.
                  </>}
            </p>
            <p className="mt-1 text-mini text-text-muted">
              Every mention of it in your writing now finds that entry.
            </p>
            {/* SAID OUT LOUD, because it is permanent and the writer did not
                press a button called "never ask". Correcting the word IS the
                statement that the flagged phrase was not a thing, but they
                should see that the app took it that way. */}
            {corrected && (
              <p className="mt-1.5 text-mini text-amber-200/90"
                 data-testid="word-fix-retired">
                &quot;{word}&quot; was not right, so it will not be raised again.
              </p>
            )}
            <button
              onClick={() => onDone(corrected ? word : "")}
              className="mt-3 inline-flex flex-col items-start rounded border border-emerald-800 bg-emerald-950/30 px-2.5 py-1 text-left text-xs font-semibold text-text-primary hover:bg-emerald-950/50"
            >
              <span>Carry on</span>
              <span className="text-micro font-normal text-faint">
                takes you to the next thing in the walk
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {/* ── The word itself, first ─────────────────────────────────── */}
            <div>
              <label htmlFor="wf-word"
                     className="mb-1 block text-mini text-text-muted">
                The word Weaving found. Fix it if it split the wrong way.
              </label>
              <input
                id="wf-word"
                value={text}
                onChange={e => setText(e.target.value)}
                aria-label="The word"
                className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
              />
              {corrected && (
                <p className="mt-1 text-mini text-amber-200/90"
                   data-testid="word-fix-changed">
                  Recording &quot;{text.trim()}&quot;. The original,
                  &quot;{word}&quot;, will not be raised again.
                </p>
              )}
            </div>

            {/* ── Which entry it belongs to ──────────────────────────────── */}
            <div>
              <p className="mb-1 flex items-baseline gap-2 text-mini text-text-muted">
                <span>Which entry is this another name for?</span>
                {/* HOW MANY THERE ARE, so the search box reads as a shortcut
                    rather than the only way through. A writer whose world has
                    grown cannot otherwise tell whether they are looking at all of
                    it -- which is what the truncated version got wrong. */}
                {attachable.length > 0 && (
                  <span className="ml-auto shrink-0 text-faint"
                        data-testid="word-fix-count">
                    {query.trim()
                      ? `${matches.length} of ${attachable.length}`
                      : `${attachable.length} ${attachable.length === 1
                          ? "entry" : "entries"}`}
                  </span>
                )}
              </p>
              <div className="mb-1.5 flex items-center gap-1.5 rounded border border-border bg-bg-surface px-2 py-1">
                <Search size={11} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your world, or scroll the list"
                  aria-label="Search your world"
                  className="w-full bg-transparent text-xs text-text-primary placeholder-faint outline-none"
                />
              </div>
              {matches.length === 0 ? (
                <p className="text-mini text-faint">
                  {attachable.length === 0
                    ? "Nothing in your world can take another name yet. Make it an entry instead."
                    : "Nothing matches that. Clear the box to see all of them, or make it an entry instead."}
                </p>
              ) : (
                // Scrolls rather than truncates. Tall enough to show several
                // rows, short enough that the buttons below stay on screen.
                <ul className="max-h-52 space-y-0.5 overflow-y-auto"
                    data-testid="word-fix-list">
                  {matches.map(node => {
                    const kind = threadTypeEntry(node.type);
                    const KindIcon = kind.Icon;
                    const picked = chosen?.entity_id === node.entity_id;
                    return (
                      <li key={node.entity_id}>
                        <button
                          onClick={() => setChosen(picked ? null : node)}
                          className={`flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-xs ${
                            picked ? "border-violet-500 bg-violet-500/10"
                                   : "border-border hover:border-text-muted"
                          }`}
                        >
                          <KindIcon size={12}
                                    className={`shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
                          <span className="min-w-0 flex-1 truncate text-text-primary">
                            {nodeLabel(node)}
                          </span>
                          <span className="shrink-0 text-micro text-faint">
                            {kind.term}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {chosen && (
              <label className="flex items-start gap-1.5 text-mini text-text-muted">
                <input
                  type="checkbox"
                  checked={asLabel}
                  onChange={e => setAsLabel(e.target.checked)}
                  className="mt-0.5 shrink-0 accent-violet-500"
                />
                <span>
                  Call it &quot;{text.trim()}&quot; on the map and in the
                  sidebar. The entry keeps its own name; this is only what your
                  story calls it.
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="text-mini text-rose-300">{error}</p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <button
                onClick={() => void record()}
                disabled={busy || !chosen || !text.trim()}
                data-testid="word-fix-record"
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {busy ? <Loader size={11} className="animate-spin" />
                      : <Check size={11} />}
                {chosen ? `It is another name for ${nodeLabel(chosen)}`
                        : "Pick an entry above"}
              </button>
              {/* THE OTHER DESTINATION, carrying the corrected word with it.
                  A writer who fixes the text and then decides it IS new should
                  not have to type it a second time. */}
              <button
                onClick={() => onCreateInstead(text.trim())}
                disabled={busy || !text.trim()}
                data-testid="word-fix-create"
                className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
              >
                Make it its own entry
              </button>
              <span className="flex-1" />
              <button
                onClick={attemptClose}
                className="text-mini text-faint hover:text-text-primary"
              >
                Back to the stop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
