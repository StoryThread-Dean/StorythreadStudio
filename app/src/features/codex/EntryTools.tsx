// features/codex/EntryTools.tsx -- this is not what I said it was
// ================================================================
// Two repairs the Weave had no way to make, both reported from live testing
// in one breath:
//
//     "Pathicus was wrongly assumed to be a Character instead of a Deity. I
//      need to be able to change it from there or delete it altogether
//      because it was made incorrectly. This should reset the name connection
//      allowing for Dress the Loom to pick it up again so it can be tagged
//      and connected."
//
// A WRONG KIND IS EASY TO MAKE. Weaving offers Character for a name it finds
// in prose, because most names in prose are people -- so a god, a ship or a
// house gets filed as a person the first time it is mentioned. Before this
// the only fix was to delete the entry and lose everything written in it,
// which is a bad trade for a one-word mistake.
//
// AND DELETING HAS TO UNDO THE QUESTION, not just the file. The name was
// probably made into an entry from an Unspun stop, and the walk remembers
// that as answered for good. Deleting the file alone would leave the writer's
// prose full of a word the Weave had quietly agreed to ignore forever. So
// removing an entry also forgets what was answered about it -- said on this
// screen, because a delete with invisible side effects is worse than one
// without them.

import { useState } from "react";
import { AlertTriangle, Check, Loader, Trash2, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, kindChoices, threadTypeEntry } from "./lexicon";
import { deleteThread, nodeLabel, setEntityKind, type GraphNode } from "./api";

interface EntryToolsProps {
  projectPath: string;
  entry: GraphNode;
  onClose: () => void;
  /** The entry changed kind. The world needs re-reading. */
  onChanged: () => void;
  /** The entry is gone. Anything showing it has to stop. */
  onDeleted: () => void;
}

export function EntryTools({
  projectPath, entry, onClose, onChanged, onDeleted,
}: EntryToolsProps) {
  const [kind, setKind] = useState(entry.type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [changed, setChanged] = useState<string | null>(null);
  // Deleting is two clicks, and the second one says what it will destroy.
  const [confirming, setConfirming] = useState(false);

  const current = threadTypeEntry(entry.type);
  const CurrentIcon = current.Icon;

  async function changeKind() {
    if (kind === entry.type || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setEntityKind(projectPath, entry.entity_id, kind);
      setWarnings(result.warnings ?? []);
      setChanged(threadTypeEntry(result.type).term);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteThread(projectPath, entry.entity_id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be removed.");
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
        aria-label={`Fix or remove ${nodeLabel(entry)}`}
        data-testid="entry-tools"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <CurrentIcon size={14}
                       className={`shrink-0 ${TONE_CLASSES[current.tone].text}`} />
          <h2 className="flex-1 truncate text-xs font-semibold text-text-primary">
            {nodeLabel(entry)}
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="p-3">
          <div className="mb-2">
            <Explain of="thread.fix-or-remove" />
          </div>

          {/* ── It is the wrong kind of thing ──────────────────────────── */}
          {changed ? (
            <div className="mb-3 rounded border border-emerald-800 bg-emerald-950/20 p-2.5">
              <p className="flex items-start gap-1.5 text-[11px] text-emerald-200">
                <Check size={12} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium text-text-primary">
                    {nodeLabel(entry)}
                  </span>{" "}
                  is a {changed} now. Everything written in it came with it.
                </span>
              </p>
              {warnings.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {warnings.map(w => (
                    <li key={w}
                        className="flex items-start gap-1.5 text-[10px] text-amber-200/90">
                      <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mb-3">
              <label htmlFor="et-kind"
                     className="mb-1 block text-[11px] text-text-muted">
                What kind of thing is this?
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="et-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  aria-label="What kind of thing"
                  className="rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                >
                  {kindChoices().map(group => (
                    <optgroup key={group.group} label={group.group}>
                      {group.kinds.map(k => (
                        <option key={k.id} value={k.id}>{k.term}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  onClick={() => void changeKind()}
                  disabled={busy || kind === entry.type}
                  className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                  {busy ? <Loader size={11} className="animate-spin" />
                        : <Check size={11} />}
                  Change it
                </button>
              </div>
              <p className="mt-1 text-[10px] text-faint">
                Its name, everything written in it and every connection stay
                exactly as they are -- only what it IS changes.
              </p>
            </div>
          )}

          {/* ── It should not be here at all ───────────────────────────── */}
          <div className="rounded border border-border p-2">
            {confirming ? (
              <>
                <p className="mb-1.5 text-[11px] text-text-primary">
                  Remove {nodeLabel(entry)} from your world?
                </p>
                {/* WHAT IT COSTS, before the button that does it. */}
                <ul className="mb-2 space-y-0.5 text-[10px] text-text-muted">
                  <li>Everything written in this entry is deleted.</li>
                  <li>Its connections to other entries go with it.</li>
                  <li>
                    Your manuscript is not touched -- and because the prose
                    still says the name, Weaving will ask about it again
                    rather than staying quiet about a word it once knew.
                  </li>
                </ul>
                <div className="flex gap-2">
                  <button
                    onClick={() => void remove()}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
                  >
                    {busy ? <Loader size={11} className="animate-spin" />
                          : <Trash2 size={11} />}
                    Yes, remove it
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
                  >
                    Keep it
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="inline-flex flex-col items-start text-left text-[11px] text-rose-300 hover:text-rose-200"
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={10} /> Remove this entry
                </span>
                <span className="text-[10px] text-faint">
                  for something created by mistake
                </span>
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>
          )}

          <button
            onClick={onClose}
            className="mt-3 block text-[11px] text-faint hover:text-text-primary"
          >
            {changed ? "Done" : "Back"}
          </button>
        </div>
      </div>
    </div>
  );
}
