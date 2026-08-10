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
// WHY THIS HAS TO BE MANUAL
// -------------------------
// No scan will infer that "Cult" means the Daughters of Pathicus, or that the
// faction, the deity and the religion of that name are three linked things.
// The writer knows. That is the whole argument for this screen existing.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader, Search, X } from "lucide-react";

import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { absorb, nodeLabel, type GraphNode } from "./api";

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
                <li className="px-3 py-3 text-[11px] text-faint">
                  {candidates.some(n => !n.placeholder)
                    ? "Nothing matches that."
                    : "There is nothing to connect this to yet. Fill in one of "
                      + "your entries first, and this word can join it."}
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
                  : "Pick an entry"}
              </button>
              {/* Standing on its own is a legitimate answer, not a failure to
                  bind. Some things really are their own entry. */}
              <button
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
              >
                It stands on its own
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
