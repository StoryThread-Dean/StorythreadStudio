// components/sidebar/BookDetailsPanel.tsx -- Book Details in the Sidebar
// ========================================================================
// An expandable "Book Details" section at the top of the left nav (between
// the Main Menu button and MANUSCRIPT). It surfaces the story-level facts
// -- genre, tone, theme, setting, word target, POV, tense, audience --
// that used to be buried in the Project Settings modal, and every one of
// them (except the word target) is auto-injected into AI prompts as STORY
// CONTEXT, so filling them in directly improves every AI feature.
//
// Save model: per-field on blur. This matches the app's manual-save ethos
// (no autosave anywhere) while staying lightweight -- each blur PUTs only
// the field that changed via the existing partial-update endpoint. A small
// "Saved" tick appears briefly after each successful write.
//
// Data is fetched lazily on first expand, so a writer who never opens the
// panel costs zero requests. Expansion state is remembered per book by the
// parent (useProjectUiState).

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateProjectSettingsPayload } from "../../types/project";

const API_BASE = "http://localhost:8000";

// The editable fields, in display order. `kind` picks the input widget.
// Values are stored as flat strings in project.json (target_word_count is
// special-cased: the backend routes it into the outline frontmatter).
type FieldKey =
  | "title" | "genre" | "tone" | "theme" | "setting"
  | "target_word_count" | "point_of_view" | "tense" | "target_audience";

interface FieldSpec {
  key:      FieldKey;
  label:    string;
  hint:     string;
  kind:     "text" | "number" | "select";
  options?: string[];   // for kind === "select"
}

const FIELDS: FieldSpec[] = [
  { key: "title",             label: "Title",           kind: "text",
    hint: "The book's title (also shown in the project switcher)" },
  { key: "genre",             label: "Genre",           kind: "text",
    hint: "e.g. Fantasy, Mystery, Romance -- auto-injected into AI prompts" },
  { key: "tone",              label: "Tone",            kind: "text",
    hint: "e.g. Dark, Wry, Hopeful -- auto-injected into AI prompts" },
  { key: "theme",             label: "Theme",           kind: "text",
    hint: "The idea the story keeps returning to, e.g. Redemption" },
  { key: "setting",           label: "Setting",         kind: "text",
    hint: "Where and when the story happens, in a phrase" },
  { key: "target_word_count", label: "Word Count",      kind: "number",
    hint: "Target length in words -- drives the Writing Progress gauge (stored in the outline)" },
  { key: "point_of_view",     label: "Point of View",   kind: "select",
    options: ["", "First", "Second", "Third Limited", "Third Omniscient", "Multiple"],
    hint: "Narration perspective -- auto-injected into AI prompts" },
  { key: "tense",             label: "Tense",           kind: "select",
    options: ["", "Past", "Present"],
    hint: "Narration tense -- auto-injected into AI prompts" },
  { key: "target_audience",   label: "Target Audience", kind: "text",
    hint: "e.g. Adult, Young Adult, Middle Grade -- auto-injected into AI prompts" },
];

type FieldValues = Partial<Record<FieldKey, string>>;

export function BookDetailsPanel({
  projectPath,
  expanded,
  onToggleExpanded,
  onTitleSaved,
  onOpenAdvancedSettings,
}: {
  projectPath:            string;
  expanded:               boolean;
  onToggleExpanded:       () => void;
  // Title edits must also update the header + switcher immediately.
  onTitleSaved:           (newTitle: string) => void;
  // "AI & advanced settings..." opens the full Project Settings modal
  // (models, content mode, outline template stay there).
  onOpenAdvancedSettings: () => void;
}) {
  const [values,   setValues]   = useState<FieldValues>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<FieldKey | null>(null);
  const savedTimer = useRef<number | null>(null);

  // ── Lazy load: fetch once per project, on first expand ──────────────────
  useEffect(() => {
    if (!expanded || loadedFor === projectPath) return;
    let cancelled = false;

    fetch(`${API_BASE}/api/projects/settings?root_path=${encodeURIComponent(projectPath)}`)
      .then(r => {
        if (!r.ok) throw new Error("Could not load project settings.");
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const next: FieldValues = {};
        for (const f of FIELDS) {
          const raw = data[f.key];
          // Numbers render into the input as strings; null/undefined as "".
          next[f.key] = raw === null || raw === undefined ? "" : String(raw);
        }
        setValues(next);
        setLoadedFor(projectPath);
        setError(null);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed.");
      });

    return () => { cancelled = true; };
  }, [expanded, projectPath, loadedFor]);

  // Reset when switching books so the old book's values never flash.
  useEffect(() => {
    setValues({});
    setLoadedFor(null);
    setError(null);
  }, [projectPath]);

  // ── Save one field (called on blur / select change) ─────────────────────
  const saveField = useCallback(async (key: FieldKey, value: string) => {
    const payload: UpdateProjectSettingsPayload = { root_path: projectPath };

    if (key === "target_word_count") {
      const n = parseInt(value.replace(/[,\s]/g, ""), 10);
      if (value.trim() !== "" && (!Number.isFinite(n) || n < 0)) {
        setError("Word Count must be a number.");
        return;
      }
      if (value.trim() === "") return;   // blank = leave the outline alone
      payload.target_word_count = n;
    } else if (key === "title") {
      const t = value.trim();
      if (!t) return;                    // never save an empty title
      payload.title = t;
    } else {
      payload[key] = value.trim();
    }

    try {
      const res = await fetch(`${API_BASE}/api/projects/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? "Save failed.");
      }
      setError(null);
      if (key === "title") onTitleSaved(value.trim());

      // Transient per-field "Saved" tick.
      setSavedKey(key);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedKey(null), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }, [projectPath, onTitleSaved]);

  const setValue = (key: FieldKey, value: string) =>
    setValues(prev => ({ ...prev, [key]: value }));

  return (
    <div className="mb-4">
      {/* Caret header -- same visual language as the collapsible NavSection */}
      <button
        onClick={onToggleExpanded}
        className="mb-1 flex w-full items-center gap-1 rounded px-2 text-left text-xs font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-primary"
        title="Story-level details (genre, tone, POV...) -- most are auto-injected into AI prompts"
        aria-expanded={expanded}
      >
        <span aria-hidden="true" className="w-3 text-center normal-case">
          {expanded ? "v" : ">"}
        </span>
        <span>Book Details</span>
      </button>

      {expanded && (
        <div className="ml-2 border-l border-border pl-2 pr-1">
          {error && (
            <p className="mb-1 px-1 text-[11px] text-rose-400">{error}</p>
          )}
          {loadedFor !== projectPath && !error ? (
            <p className="px-1 py-1 text-xs text-faint">Loading...</p>
          ) : (
            <div className="space-y-1.5 py-1">
              {FIELDS.map(f => (
                <label key={f.key} className="block" title={f.hint}>
                  <span className="mb-0.5 flex items-center gap-1 px-0.5 text-[10px] uppercase tracking-wide text-faint">
                    {f.label}
                    {savedKey === f.key && (
                      <span className="normal-case tracking-normal text-emerald-500">Saved</span>
                    )}
                  </span>
                  {f.kind === "select" ? (
                    <select
                      value={values[f.key] ?? ""}
                      onChange={e => {
                        // Selects save immediately -- there's no meaningful
                        // "typing" phase like a text input has.
                        setValue(f.key, e.target.value);
                        void saveField(f.key, e.target.value);
                      }}
                      className="w-full rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary transition-colors hover:border-indigo-500 focus:border-indigo-400 focus:outline-none"
                    >
                      {(f.options ?? []).map(opt => (
                        <option key={opt} value={opt}>{opt === "" ? "(not set)" : opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode={f.kind === "number" ? "numeric" : undefined}
                      value={values[f.key] ?? ""}
                      onChange={e => setValue(f.key, e.target.value)}
                      onBlur={e => void saveField(f.key, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                      }}
                      placeholder={f.kind === "number" ? "e.g. 90000" : ""}
                      className="w-full rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary placeholder:text-faint transition-colors hover:border-indigo-500 focus:border-indigo-400 focus:outline-none"
                    />
                  )}
                </label>
              ))}

              {/* Model, content mode, and outline template stay in the full
                  Project Settings modal -- link there rather than duplicate. */}
              <button
                onClick={onOpenAdvancedSettings}
                className="mt-1 w-full rounded px-1 py-1 text-left text-[11px] text-indigo-300/80 transition-colors hover:bg-bg-surface hover:text-indigo-300"
                title="Open Project Settings (AI model, content mode, outline template)"
              >
                AI &amp; advanced settings...
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
