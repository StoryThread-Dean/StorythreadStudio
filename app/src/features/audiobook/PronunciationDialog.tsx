// features/audiobook/PronunciationDialog.tsx
// ===========================================
// The pronunciation dictionary editor: rules for THIS audiobook and rules
// for ALL audiobooks, side by side. One-spot overrides are not here by
// design -- those are inline [say:...]...[/say] markers in the narration
// text (spec 11.1), inserted from the editor toolbar.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";

import { fetchPronunciations, savePronunciations } from "./api";
import type { PronunciationEntry } from "./types";

interface PronunciationDialogProps {
  workspacePath: string;
  onClose: () => void;
}

const EMPTY_ROW: PronunciationEntry = {
  display_text: "",
  spoken_text: "",
  scope: "audiobook",
  case_sensitive: false,
};

export function PronunciationDialog({ workspacePath, onClose }: PronunciationDialogProps) {
  const [workspaceRules, setWorkspaceRules] = useState<PronunciationEntry[]>([]);
  const [globalRules, setGlobalRules] = useState<PronunciationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const body = await fetchPronunciations(workspacePath);
        setWorkspaceRules(body.workspace_rules);
        setGlobalRules(body.global_rules);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load pronunciation rules.");
      } finally {
        setLoading(false);
      }
    })();
  }, [workspacePath]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Blank rows are just abandoned inputs -- drop them instead of
      // asking the writer to clean up.
      const keep = (rules: PronunciationEntry[]) =>
        rules.filter(r => r.display_text.trim() && r.spoken_text.trim());
      await savePronunciations(
        workspacePath,
        keep(workspaceRules).map(r => ({ ...r, scope: "audiobook" as const })),
        keep(globalRules).map(r => ({ ...r, scope: "all" as const })),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save pronunciation rules.");
      setSaving(false);
    }
  }, [workspacePath, workspaceRules, globalRules, onClose]);

  // One editable rule table, reused for both scopes.
  const ruleTable = (
    label: string,
    hint: string,
    rules: PronunciationEntry[],
    setRules: (rules: PronunciationEntry[]) => void,
  ) => (
    <div className="mb-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-300">{label}</h3>
        <button
          onClick={() => setRules([...rules, { ...EMPTY_ROW }])}
          className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300"
        >
          <Plus size={11} /> Add
        </button>
      </div>
      <p className="mb-2 text-[11px] text-zinc-600">{hint}</p>
      {rules.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-800 px-3 py-2 text-xs text-zinc-600">
          No rules yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`${label} displayed text ${i + 1}`}
                type="text"
                value={rule.display_text}
                placeholder="Displayed text (Kaelith)"
                onChange={e => setRules(rules.map((r, n) => n === i ? { ...r, display_text: e.target.value } : r))}
                className="w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500"
              />
              <span className="text-zinc-600">→</span>
              <input
                aria-label={`${label} spoken as ${i + 1}`}
                type="text"
                value={rule.spoken_text}
                placeholder="Spoken as (KAY-lith)"
                onChange={e => setRules(rules.map((r, n) => n === i ? { ...r, spoken_text: e.target.value } : r))}
                className="w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500"
              />
              <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500" title="Match uppercase and lowercase exactly">
                <input
                  type="checkbox"
                  checked={rule.case_sensitive}
                  onChange={e => setRules(rules.map((r, n) => n === i ? { ...r, case_sensitive: e.target.checked } : r))}
                />
                Aa
              </label>
              <button
                onClick={() => setRules(rules.filter((_, n) => n !== i))}
                title="Delete this rule"
                className="shrink-0 rounded p-1 text-zinc-600 hover:text-rose-400"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Pronunciation Dictionary</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-[11px] text-zinc-500">
          Rules change only what the narrator SAYS -- your text on screen never
          changes. For a single spot, select the word in the editor and use the
          [say] toolbar button instead. Where both apply, [say] wins: the
          dictionary sets the rule, [say] makes the exception.
        </p>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : (
          <>
            {ruleTable("This Audiobook", "Applies everywhere in this audiobook.",
                       workspaceRules, setWorkspaceRules)}
            {ruleTable("All Audiobooks", "Applies in every audiobook on this computer.",
                       globalRules, setGlobalRules)}
          </>
        )}

        {error && (
          <p className="mb-3 rounded border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Rules
          </button>
        </div>
      </div>
    </div>
  );
}
