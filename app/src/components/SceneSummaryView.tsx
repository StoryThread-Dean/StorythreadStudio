// components/SceneSummaryView.tsx -- Scene Summary Editor (Phase 6)
// =================================================================
// A Markdown editor for a single scene's summary file. Modeled directly on
// SummaryView.tsx (chapter summaries) -- same shell, same reload trick, same
// save pattern. The differences are:
//
//   - Storage path: <project>/summaries/scenes/<chapter-stem>/scene-NN.md
//   - Each scene has its own editable title on top of the body, stored as
//     the `# Heading` line in the file. The title input lives in the header,
//     not in the Markdown body the writer edits, so renaming a scene feels
//     like a metadata change rather than editing prose.
//   - Regenerate: needs to know which scene to regenerate. We fetch the
//     chapter + split on the backend, pick the Nth scene, and send its body.
//
// Why a separate component instead of reusing SummaryView:
//   The header has a title input, the API endpoints are different, and the
//   regenerate flow takes an extra round-trip to find the scene body. Fewer
//   conditionals than generalizing SummaryView to handle both.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { ProjectInfo } from "../types/project";
import type { FontValue } from "./EditorToolbar";
import { MarkdownEditor } from "./MarkdownEditor";
import type {
  SceneSummaryResponse,
  SplitChapterScenesResponse,
  GenerateSceneSummaryResponse,
} from "../types/ai";


const API_BASE = "http://localhost:8000";


export interface SceneSummaryViewProps {
  project:     ProjectInfo;
  chapterFile: string;       // e.g. "01-landing.md"
  sceneIndex:  number;       // 1-based positional index
  font:        FontValue;
  onBack:      () => void;
  // Called after a successful save/delete/regenerate so App.tsx can refresh
  // the Scene Summaries grandchildren list in the sidebar. Optional -- the
  // view works without it, the sidebar just won't update until the writer
  // re-expands the chapter.
  onSidebarRefresh?: () => void;
}


export function SceneSummaryView({
  project,
  chapterFile,
  sceneIndex,
  font,
  onBack,
  onSidebarRefresh,
}: SceneSummaryViewProps) {
  // ── State (same shape as SummaryView, with an extra title field) ────────
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [exists,         setExists]         = useState(false);
  const [title,          setTitle]          = useState("");
  const [chapterTitle,   setChapterTitle]   = useState<string>(chapterFile.replace(/\.md$/, ""));

  const [isDirty,        setIsDirty]        = useState(false);
  const [isGenerating,   setIsGenerating]   = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [statusMessage,  setStatusMessage]  = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const editorViewRef = useRef<EditorView | null>(null);
  const isDirtyRef    = useRef(false);
  isDirtyRef.current  = isDirty;


  // ── Load the summary file ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setInitialContent(null);
    setError(null);
    setTitle("");

    const run = async () => {
      try {
        const params = new URLSearchParams({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
          index:            String(sceneIndex),
        });
        const res = await fetch(`${API_BASE}/api/documents/scene-summary?${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail ?? `Load failed (${res.status})`);
        }
        const data: SceneSummaryResponse = await res.json();
        if (cancelled) return;
        setInitialContent(data.content ?? "");
        setTitle(data.title ?? "");
        setExists(Boolean(data.exists));
        setReloadKey(k => k + 1);
        setIsDirty(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load scene summary.");
        setInitialContent("");
      }
    };

    // Chapter title for the header badge.
    const fetchChapterTitle = async () => {
      try {
        const params = new URLSearchParams({
          folder_path: project.root_path,
          filename:    chapterFile,
        });
        const res = await fetch(`${API_BASE}/api/documents/chapter?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setChapterTitle(data.title || chapterFile.replace(/\.md$/, ""));
      } catch {
        // Silent fallback to the filename stem.
      }
    };

    void run();
    void fetchChapterTitle();
    return () => { cancelled = true; };
  }, [project.root_path, chapterFile, sceneIndex]);


  // ── Save edits to disk ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const view = editorViewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    const finalTitle = title.trim() || "Scene";

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/documents/scene-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
          index:            sceneIndex,
          title:            finalTitle,
          content,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Save failed (${res.status})`);
      }
      setIsDirty(false);
      setExists(true);
      setStatusMessage("Saved.");
      setTimeout(() => setStatusMessage(null), 2000);
      onSidebarRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }, [project.root_path, chapterFile, sceneIndex, title, onSidebarRefresh]);


  // Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (isDirtyRef.current) void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);


  // ── AI regeneration (two-step: split chapter, then summarize Nth scene) ──
  // Scene summaries need the scene's text, which the editor never holds.
  // We ask the backend to re-split the chapter and send back the Nth scene,
  // then pass that body into generate-scene-summary. Two round trips but the
  // split is cheap (no AI call).
  const handleRegenerate = useCallback(async () => {
    if (isDirty) {
      const ok = window.confirm("You have unsaved edits. Regenerate and discard them?");
      if (!ok) return;
    }
    setIsGenerating(true);
    setError(null);
    setStatusMessage("Generating summary...");
    try {
      const chapterAbsPath = `${project.root_path}/manuscript/${chapterFile}`;

      // 1. Split the chapter to locate the Nth scene.
      const splitRes = await fetch(`${API_BASE}/api/ai/split-chapter-scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_path: chapterAbsPath,
          project_path: project.root_path,
        }),
      });
      if (!splitRes.ok) {
        const err = await splitRes.json().catch(() => ({}));
        throw new Error(err.detail ?? `Split failed (${splitRes.status})`);
      }
      const splitData: SplitChapterScenesResponse = await splitRes.json();
      const scene = splitData.scenes.find(s => s.index === sceneIndex);
      if (!scene) {
        throw new Error(
          `Scene ${sceneIndex} no longer exists in this chapter. ` +
          `The writer may have removed scene breaks. Refresh the sidebar.`
        );
      }

      // 2. Summarize the scene body. Pass any title we already have so the
      //    backend reuses it instead of asking the AI for a new one.
      const genRes = await fetch(`${API_BASE}/api/ai/generate-scene-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_path: chapterAbsPath,
          project_path: project.root_path,
          scene_text:   scene.text,
          scene_title:  title.trim() || scene.title || null,
          content_mode: "general",
        }),
      });
      if (!genRes.ok) {
        const err = await genRes.json().catch(() => ({}));
        throw new Error(err.detail ?? `Generation failed (${genRes.status})`);
      }
      const genData: GenerateSceneSummaryResponse = await genRes.json();

      // 3. Push the result into the editor and save immediately so the file
      //    exists on disk (the backend's generate endpoint is save-less).
      setInitialContent(genData.content ?? "");
      setTitle(genData.title || "Scene");
      setReloadKey(k => k + 1);
      setIsDirty(false);

      const saveRes = await fetch(`${API_BASE}/api/documents/scene-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
          index:            sceneIndex,
          title:            genData.title || "Scene",
          content:          genData.content ?? "",
        }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.detail ?? `Save after generation failed (${saveRes.status})`);
      }
      setExists(true);
      setStatusMessage("Summary generated.");
      setTimeout(() => setStatusMessage(null), 2500);
      onSidebarRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setStatusMessage(null);
    } finally {
      setIsGenerating(false);
    }
  }, [isDirty, chapterFile, project.root_path, sceneIndex, title, onSidebarRefresh]);


  // ── Delete this scene summary ───────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const ok = window.confirm(
      `Delete the summary for scene ${sceneIndex}? The scene text in the chapter is untouched.`
    );
    if (!ok) return;

    try {
      const params = new URLSearchParams({
        folder_path:      project.root_path,
        chapter_filename: chapterFile,
        index:            String(sceneIndex),
      });
      const res = await fetch(`${API_BASE}/api/documents/scene-summary?${params}`, {
        method: "DELETE",
      });
      // 404 = file wasn't there; treat as success rather than surfacing an error.
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Delete failed (${res.status})`);
      }
      onSidebarRefresh?.();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete scene summary.");
    }
  }, [project.root_path, chapterFile, sceneIndex, onBack, onSidebarRefresh]);


  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

      {/* Title bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-panel px-4 py-2">
        <div className="flex items-baseline gap-2">
          <button
            onClick={onBack}
            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300"
            title="Back to the chapter editor"
          >
            &larr; Back
          </button>
          <span className="text-sm font-medium text-text-primary">{chapterTitle}</span>
          <span className="text-xs text-text-muted">Scene {sceneIndex}</span>
        </div>

        <div className="flex items-center gap-2">
          {statusMessage && (
            <span className="text-xs text-emerald-400">{statusMessage}</span>
          )}
          {isDirty ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-400"
              title="Unsaved changes. Press Ctrl+S to save.">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Unsaved
            </span>
          ) : exists ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500"
              title="All changes are saved.">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          ) : null}

          <button
            onClick={handleRegenerate}
            disabled={isGenerating}
            className="rounded border border-indigo-700/50 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            title="Ask AI to summarize this scene from the chapter text"
          >
            {isGenerating ? "Generating..." : exists ? "Regenerate with AI" : "Generate with AI"}
          </button>

          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="rounded border border-border px-3 py-1 text-xs text-text-primary transition-colors hover:border-emerald-500 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Save edits (Ctrl+S)"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>

          {exists && (
            <button
              onClick={handleDelete}
              className="rounded border border-red-900/50 bg-red-950/30 px-2 py-1 text-xs text-red-300 transition-colors hover:border-red-600 hover:text-red-200"
              title="Delete this scene summary"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Title input strip -- separate from the editor so renaming a scene
          feels like metadata, not editing prose. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-bg-panel/50 px-4 py-1.5">
        <label className="text-xs text-text-muted" htmlFor="scene-title-input">
          Title:
        </label>
        <input
          id="scene-title-input"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setIsDirty(true);
          }}
          placeholder="Untitled scene"
          className="flex-1 rounded border border-border bg-bg-panel px-2 py-0.5 text-xs text-text-primary placeholder:text-faint focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2">
          <p className="text-xs text-red-300">
            <span className="font-semibold">Error: </span>{error}
          </p>
        </div>
      )}

      {/* Editor body */}
      <div className="relative flex-1 overflow-hidden">
        {initialContent === null ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Loading scene summary...
          </div>
        ) : !exists && initialContent === "" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-indigo-300">No summary for scene {sceneIndex} yet.</p>
            <p className="max-w-md text-xs text-text-muted">
              Click Generate with AI to summarize this scene from the chapter text,
              or type your own below.
            </p>
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="mt-2 rounded border border-indigo-700/50 bg-indigo-950/40 px-4 py-1.5 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? "Generating..." : "Generate with AI"}
            </button>
            <div className="mt-4 w-full max-w-3xl flex-1 overflow-hidden">
              <MarkdownEditor
                key={`${chapterFile}-${sceneIndex}-${reloadKey}`}
                defaultValue=""
                onChange={() => setIsDirty(true)}
                font={font}
                onEditorReady={(view) => { editorViewRef.current = view; }}
              />
            </div>
          </div>
        ) : (
          <MarkdownEditor
            key={`${chapterFile}-${sceneIndex}-${reloadKey}`}
            defaultValue={initialContent}
            onChange={() => setIsDirty(true)}
            font={font}
            onEditorReady={(view) => { editorViewRef.current = view; }}
          />
        )}
      </div>
    </main>
  );
}
