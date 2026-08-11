// features/codex/QuickFill.tsx -- fill in a thin entry without leaving the Weave
// ==============================================================================
// A Frayed stop on an entry that already has writing used to say "Open it and
// fill it in" and send the writer to the editor -- which closed the Weave. The
// earlier reasoning was honest ("a partly-filled entry genuinely needs prose
// typed into it, and there is nowhere to type in the walk"), and the fix is not
// to argue with it but to put somewhere to type IN the walk:
//
//     "Every single process and option keeps them within the Weave UI even if
//      it taps into a creation process that is normally done elsewhere."
//
// So: the popup shows ONLY the missing sections as text boxes. Save writes them
// and the walk advances. Registry-driven, so a kind the writer invented this
// morning works too -- which also deletes the old "there is no editor for this
// kind" dead end.
//
// Manual save, as everywhere in this app, and the same conflict contract as the
// full editor: a save that collides with an edit made elsewhere is REFUSED with
// the writer's text still in the boxes. Losing a paragraph to a race would be
// worse than any amount of asking twice.

import { useEffect, useState } from "react";
import { Check, Loader, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";

const API_BASE = "http://localhost:8000";

interface QuickFillProps {
  projectPath: string;
  entityId: string;
  /** The section HEADINGS the stop named as missing (that is what scan sends). */
  missing: string[];
  /**
   * Set when this entry began life as a word the walk minted, and only then.
   *
   * It unlocks one side path: "this word is actually another name for an entry
   * I already have" -- the Croft-means-Lara-Croft case. A side path
   * deliberately, not the question. The entry's identity was settled when it
   * was created, and re-asking it of a writer who just read "Dean · Character"
   * on the stop is an interrogation with no right answer.
   */
  wordName?: string;
  onAbsorbInstead?: () => void;
  onClose: () => void;
  /** Saved -- advance the walk. */
  onDone: () => void;
}

interface Box { id: string; heading: string; text: string }

export function QuickFill({
  projectPath, entityId, missing, wordName, onAbsorbInstead, onClose, onDone,
}: QuickFillProps) {
  const [thread, setThread] = useState<Record<string, unknown> | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/codex/entity?project_path=${encodeURIComponent(projectPath)}`
          + `&entity_id=${encodeURIComponent(entityId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(body?.detail?.message ?? "That entry could not be read.");
        }
        setThread(body);
        // The stop names missing sections by HEADING; the file keys them by id.
        // Matched case-insensitively, and when nothing matches (a heading was
        // renamed between the scan and now) every empty section is offered --
        // showing too many boxes beats showing a form with nothing to fill.
        const wanted = new Set(missing.map(m => m.toLowerCase()));
        const sections = Object.entries(
          (body.sections ?? {}) as Record<string, { heading?: string; content?: string }>);
        let picked = sections.filter(([, s]) =>
          wanted.has(String(s.heading ?? "").toLowerCase()));
        if (picked.length === 0) {
          picked = sections.filter(([, s]) => !String(s.content ?? "").trim());
        }
        setBoxes(picked.map(([id, s]) =>
          ({ id, heading: String(s.heading ?? id), text: "" })));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "That entry could not be read.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath, entityId, missing]);

  async function save() {
    if (!thread || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sections = { ...(thread.sections as Record<string, unknown> ?? {}) };
      for (const box of boxes) {
        if (!box.text.trim()) continue;      // an empty box changes nothing
        const current = (sections[box.id] ?? {}) as Record<string, unknown>;
        sections[box.id] = { ...current, heading: box.heading,
                             content: box.text.trim() };
      }
      const response = await fetch(`${API_BASE}/api/codex/entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: projectPath,
          thread: { ...thread, sections },
          base_revision: (thread.revision as string | undefined) ?? null,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body?.detail?.message ?? "That could not be saved.");
      }
      onDone();
    } catch (e) {
      // The writer's text stays in the boxes -- same contract as the editor.
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const kind = threadTypeEntry(String(thread?.type ?? ""));
  const KindIcon = kind.Icon;
  const wrote = boxes.some(b => b.text.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label={`Fill in ${String(thread?.name ?? "the entry")}`}
        data-testid="quick-fill"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <KindIcon size={14}
                    className={`shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            {String(thread?.name ?? "...")}
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="p-3">
          <div className="mb-2">
            <Explain of="weaving.fill" />
          </div>

          {!thread && !error && (
            <p className="flex items-center gap-2 text-[11px] text-text-muted">
              <Loader size={11} className="animate-spin" /> Reading the entry...
            </p>
          )}

          {boxes.map((box, i) => (
            <div key={box.id} className="mb-2">
              <label htmlFor={`qf-${box.id}`}
                     className="mb-1 block text-[11px] text-text-muted">
                {box.heading}
              </label>
              <textarea
                id={`qf-${box.id}`}
                value={box.text}
                onChange={e => setBoxes(prev => prev.map((b, j) =>
                  j === i ? { ...b, text: e.target.value } : b))}
                rows={3}
                className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
              />
            </div>
          ))}

          {error && (
            <p role="alert" className="mb-2 text-[11px] text-rose-300">{error}</p>
          )}

          {/* The escape for a mistaken identity, phrased from the WORD's side
              so it cannot read as a question about the entry. */}
          {thread && wordName && onAbsorbInstead && (
            <button
              onClick={onAbsorbInstead}
              className="mb-2 block text-[11px] text-violet-300 hover:text-violet-200"
            >
              &ldquo;{wordName}&rdquo; is actually another name for an entry I
              already have
            </button>
          )}

          {thread && (
            <div className="flex gap-2">
              <button
                onClick={() => void save()}
                disabled={busy || !wrote}
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {busy ? <Loader size={11} className="animate-spin" />
                      : <Check size={11} />}
                Save it
              </button>
              <button
                onClick={onClose}
                className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
