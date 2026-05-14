// components/SceneSummaryPreviewModal.tsx -- Selection-based Scene Summary Preview
// ==================================================================================
// Opens when the writer selects a passage in the editor and clicks
// "Summarize as Scene" in the Writing Companion panel. The modal:
//
//   1. Generates an AI summary of the selected text on open (or on Regenerate).
//   2. Shows the title and body in editable fields -- the writer can tweak
//      either before saving.
//   3. Offers a slot picker: "Save as new Scene N+1" (default) or "Replace
//      existing Scene X" from a dropdown of currently-filled slots.
//   4. Persists the summary via POST /api/documents/scene-summary when the
//      writer clicks Save; or discards everything on Cancel/Discard.
//
// Why a modal (not a dedicated screen like SceneSummaryView):
//   The writer is mid-flow in the editor. A modal returns them to editing
//   as soon as they're done, preserves the text selection underneath, and
//   doesn't touch the editor state.
//
// Why generate-on-open vs generate-on-button-click:
//   Opening the modal IS the request. The writer already clicked "Summarize
//   as Scene" in the panel, which expresses intent. Making them click a
//   second Generate button inside the modal would feel redundant.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GenerateSceneSummaryResponse,
  SceneSummaryInfo,
} from "../types/ai";


const API_BASE = "http://localhost:8000";


export interface SceneSummaryPreviewModalProps {
  /** Project root on disk. Used for save + validation on the backend. */
  folderPath:   string;
  /** Chapter filename the selection came from, e.g. "01-landing.md". */
  chapterFile:  string;
  /** Absolute chapter path -- passed to the AI endpoint for context injection. */
  chapterPath:  string;
  /** Text the writer highlighted in the editor. */
  selectedText: string;
  /** List of already-saved scene summaries. Used to build the dropdown and
   *  compute the default "new scene" index. */
  existingScenes: SceneSummaryInfo[];
  /** Called when the modal should close. If `savedIndex` is set, the caller
   *  should refresh the sidebar to show the new/updated row. */
  onClose: (savedIndex?: number) => void;
}


export function SceneSummaryPreviewModal({
  folderPath,
  chapterFile,
  chapterPath,
  selectedText,
  existingScenes,
  onClose,
}: SceneSummaryPreviewModalProps) {

  // ── State ───────────────────────────────────────────────────────────────
  const [title,   setTitle]   = useState("");
  const [content, setContent] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // Slot picker: "new" appends, "replace" overwrites an existing scene index.
  type SlotMode = "new" | "replace";
  const [slotMode,     setSlotMode]     = useState<SlotMode>("new");
  const [replaceIndex, setReplaceIndex] = useState<number | null>(
    existingScenes[0]?.index ?? null
  );

  // The default "new scene" index = one past whatever's already filled.
  // Using max+1 (not length+1) handles sparse cases where e.g. scenes 1, 2,
  // and 4 exist -- the next scene becomes 5, not 4.
  const nextNewIndex = useMemo(() => {
    if (existingScenes.length === 0) return 1;
    const maxIdx = Math.max(...existingScenes.map(s => s.index));
    return maxIdx + 1;
  }, [existingScenes]);


  // ── Generate on mount + on Regenerate click ─────────────────────────────
  // We pass scene_title: null on the first call so the AI produces a title
  // itself; the writer can override it afterward in the title input. On
  // subsequent Regenerate clicks we pass whatever title they've typed, which
  // tells the backend to skip the second title-only AI call.
  const hasGeneratedRef = useRef(false);

  const runGenerate = useCallback(async (preserveTitle: boolean) => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-scene-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_path: chapterPath,
          project_path: folderPath,
          scene_text:   selectedText,
          scene_title:  preserveTitle && title.trim() ? title.trim() : null,
          content_mode: "general",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Generation failed (${res.status})`);
      }
      const data: GenerateSceneSummaryResponse = await res.json();
      // Only overwrite title when we asked the AI for one; if the writer had
      // typed a title and we're regenerating the body, leave the title alone.
      if (!preserveTitle || !title.trim()) {
        setTitle(data.title || "Scene");
      }
      setContent(data.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [chapterPath, folderPath, selectedText, title]);

  useEffect(() => {
    // Generate once on mount. Guard against React 18 StrictMode's double-invoke
    // of effects in dev so we don't pay for two AI calls when the modal opens.
    if (hasGeneratedRef.current) return;
    hasGeneratedRef.current = true;
    void runGenerate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── Save to disk ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    // Pick the index to save under based on the slot mode.
    const targetIndex = slotMode === "replace"
      ? (replaceIndex ?? nextNewIndex)
      : nextNewIndex;

    if (slotMode === "replace") {
      const target = existingScenes.find(s => s.index === targetIndex);
      const ok = window.confirm(
        target
          ? `Replace the existing summary for Scene ${target.index} ("${target.title}")?`
          : `Save as Scene ${targetIndex}?`
      );
      if (!ok) return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/documents/scene-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:      folderPath,
          chapter_filename: chapterFile,
          index:            targetIndex,
          title:            title.trim() || "Scene",
          content:          content,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Save failed (${res.status})`);
      }
      onClose(targetIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }, [
    slotMode, replaceIndex, nextNewIndex, existingScenes,
    folderPath, chapterFile, title, content, onClose,
  ]);


  // ── Escape closes the modal ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isGenerating && !isSaving) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isGenerating, isSaving]);


  // ── Render ──────────────────────────────────────────────────────────────
  // Full-screen overlay with a centered card. Clicking the overlay dismisses;
  // clicking inside the card does not (stopPropagation).
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!isGenerating && !isSaving) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">
              New Scene Summary
            </span>
            <span className="text-xs text-text-muted">
              Generated from selected text ({selectedText.length.toLocaleString()} chars)
            </span>
          </div>
          <button
            onClick={() => onClose()}
            disabled={isGenerating || isSaving}
            className="rounded px-2 text-lg text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">

          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-muted" htmlFor="preview-title">
              Title
            </label>
            <input
              id="preview-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isGenerating || isSaving}
              placeholder={isGenerating ? "Generating title..." : "Scene title"}
              className="rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary placeholder:text-faint focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Body */}
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-text-muted" htmlFor="preview-body">
              Summary
            </label>
            <textarea
              id="preview-body"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isGenerating || isSaving}
              placeholder={isGenerating ? "Generating summary..." : "Summary body"}
              rows={10}
              className="text-entry flex-1 resize-y rounded border border-border bg-bg-primary px-2 py-1.5 text-text-primary placeholder:text-faint focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Slot picker */}
          <div className="flex flex-col gap-2 rounded border border-border bg-bg-primary/50 p-3">
            <span className="text-xs font-semibold text-indigo-300">Save as</span>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="slot-mode"
                checked={slotMode === "new"}
                onChange={() => setSlotMode("new")}
                className="accent-indigo-500"
              />
              <span>
                New scene &nbsp;
                <span className="text-xs text-text-muted">
                  (will be Scene {nextNewIndex})
                </span>
              </span>
            </label>

            {existingScenes.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="slot-mode"
                  checked={slotMode === "replace"}
                  onChange={() => setSlotMode("replace")}
                  className="accent-indigo-500"
                />
                <span className="flex items-center gap-2">
                  Replace existing scene
                  <select
                    value={replaceIndex ?? ""}
                    onChange={(e) => setReplaceIndex(Number(e.target.value))}
                    onClick={() => setSlotMode("replace")}
                    className="rounded border border-border bg-bg-panel px-1.5 py-0.5 text-xs text-text-primary"
                  >
                    {existingScenes.map(s => (
                      <option key={s.index} value={s.index}>
                        Scene {s.index} &mdash; {s.title}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              <span className="font-semibold">Error: </span>{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
          <button
            onClick={() => runGenerate(true)}
            disabled={isGenerating || isSaving}
            className="rounded border border-indigo-700/50 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            title="Re-run the AI on the same selected text"
          >
            {isGenerating ? "Generating..." : "Regenerate"}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onClose()}
              disabled={isGenerating || isSaving}
              className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={isGenerating || isSaving || !content.trim()}
              className="rounded border border-emerald-700/50 bg-emerald-950/40 px-3 py-1 text-xs text-emerald-300 transition-colors hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
