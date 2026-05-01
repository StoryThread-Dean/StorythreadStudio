// components/SummaryView.tsx -- Chapter Summary Editor (Phase 6)
// ================================================================
// A Markdown editor for a single chapter's summary file.
//
// Storage model (as of this rewrite):
//   - Plain Markdown at <project>/summaries/chapters/<chapter-stem>.md
//   - No frontmatter, no profile schema -- the file body IS the summary
//   - Editor content is "whatever the AI generated, whatever the writer edited"
//
// Why the same look as the main editor:
//   The writer's mental model is "this is a document I type into." Using the
//   same MarkdownEditor component means the same font, theme, spellcheck, and
//   selection behavior. Only the surrounding chrome (toolbar, title bar)
//   differs, and the content reload flow handles regeneration.
//
// Regeneration reload trick:
//   MarkdownEditor is uncontrolled -- it reads defaultValue only on mount. To
//   push new AI-generated content into it without a full prop-controlled
//   rewrite, we bump a `reloadKey` state whenever the content changes from
//   outside user typing. That triggers React to unmount and remount the
//   editor with the new defaultValue. One-frame flicker, no complex
//   controlled-editor plumbing.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { ProjectInfo } from "../types/project";
import type { FontValue } from "./EditorToolbar";
import { MarkdownEditor } from "./MarkdownEditor";


const API_BASE = "http://localhost:8000";


export interface SummaryViewProps {
  project:     ProjectInfo;
  chapterFile: string;       // e.g. "01-landing.md" -- the manuscript chapter filename
  font:        FontValue;    // Writer's chosen font, passed through from App
  onBack:      () => void;   // Return to the editor view
}


export function SummaryView({ project, chapterFile, font, onBack }: SummaryViewProps) {
  // ── State ───────────────────────────────────────────────────────────────
  // initialContent: the Markdown the editor should mount with.
  //   null  = still loading from disk
  //   ""    = no summary file exists yet (empty editor, empty state banner)
  //   "..." = actual content
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [exists,         setExists]         = useState(false);
  const [chapterTitle,   setChapterTitle]   = useState<string>(chapterFile.replace(/\.md$/, ""));

  const [isDirty,        setIsDirty]        = useState(false);
  const [isGenerating,   setIsGenerating]   = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [statusMessage,  setStatusMessage]  = useState<string | null>(null);

  // Bumped whenever we want MarkdownEditor to remount with fresh content
  // (initial load, regenerate success). See file header for the reasoning.
  const [reloadKey, setReloadKey] = useState(0);

  // Reference to the CodeMirror view so handleSave can pull the current text.
  // The editor is uncontrolled, so this ref is the only way to read what's
  // actually on screen at save time.
  const editorViewRef = useRef<EditorView | null>(null);
  const isDirtyRef    = useRef(false);
  isDirtyRef.current  = isDirty;


  // ── Load the summary file ───────────────────────────────────────────────
  // Fetches on mount and whenever the writer navigates between chapters.
  // A 404-like empty response is normal: it just means the writer hasn't
  // generated this summary yet.
  useEffect(() => {
    let cancelled = false;
    setInitialContent(null);
    setError(null);

    const run = async () => {
      try {
        const params = new URLSearchParams({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
        });
        const res = await fetch(`${API_BASE}/api/documents/chapter-summary?${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail ?? `Load failed (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setInitialContent(data.content ?? "");
        setExists(Boolean(data.exists));
        setReloadKey(k => k + 1);
        setIsDirty(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load summary.");
        setInitialContent("");
      }
    };

    // Also fetch the chapter's title so the header shows something nicer
    // than the filename. This is independent of the summary load; if it
    // fails we just fall back to the filename stem.
    const fetchTitle = async () => {
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
        // Silent: falls back to filename.
      }
    };

    void run();
    void fetchTitle();
    return () => { cancelled = true; };
  }, [project.root_path, chapterFile]);


  // ── Save edits to disk ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const view = editorViewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/documents/chapter-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }, [project.root_path, chapterFile]);

  // Ctrl+S shortcut, same pattern as the main editor.
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


  // ── AI regeneration ─────────────────────────────────────────────────────
  // Posts to /api/ai/generate-chapter-summary. The backend reads the chapter
  // text, generates the Markdown, sanitizes em dashes, writes to disk, and
  // returns the content. We push that content into the editor via reloadKey.
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
      const res = await fetch(`${API_BASE}/api/ai/generate-chapter-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_path: chapterAbsPath,
          project_path: project.root_path,
          content_mode: "general",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Generation failed (${res.status})`);
      }
      const data = await res.json();
      setInitialContent(data.content ?? "");
      setExists(true);
      setIsDirty(false);
      setReloadKey(k => k + 1);
      setStatusMessage("Summary generated.");
      setTimeout(() => setStatusMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setStatusMessage(null);
    } finally {
      setIsGenerating(false);
    }
  }, [isDirty, chapterFile, project.root_path]);


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
          <span className="text-xs text-text-muted">Chapter Summary</span>
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
            title="Ask AI to generate a chapter summary from the chapter text"
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
        </div>
      </div>

      {/* Info banner -- tiny, so it doesn't dominate the editor */}
      <div className="shrink-0 border-b border-border bg-bg-panel/50 px-4 py-1.5">
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-indigo-300">Purpose:</span>{" "}
          AI context for drafting and continuity checks. Focus on causality and state changes, not prose.
        </p>
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
            Loading summary...
          </div>
        ) : !exists && initialContent === "" ? (
          // Empty state overlay: sits above an empty editor so the writer can
          // either click Generate or start typing their own summary by hand.
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-indigo-300">No summary yet.</p>
            <p className="max-w-md text-xs text-text-muted">
              Click Generate with AI to produce a continuity brief from the chapter,
              or start typing your own below.
            </p>
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="mt-2 rounded border border-indigo-700/50 bg-indigo-950/40 px-4 py-1.5 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? "Generating..." : "Generate with AI"}
            </button>
            <div className="mt-4 w-full max-w-3xl flex-1 overflow-hidden">
              {/* Still show the editor below the empty-state so writers who
                  want to type by hand can do so immediately. */}
              <MarkdownEditor
                key={`${chapterFile}-${reloadKey}`}
                defaultValue=""
                onChange={() => setIsDirty(true)}
                font={font}
                onEditorReady={(view) => { editorViewRef.current = view; }}
              />
            </div>
          </div>
        ) : (
          <MarkdownEditor
            key={`${chapterFile}-${reloadKey}`}
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
