// components/ChapterOutlineView.tsx -- the plan for one chapter
// ==============================================================
// The per-chapter document that looks FORWARD.
//
// Its two neighbours look backward: a chapter summary and a scene summary are
// written from prose that already exists and say what the chapter turned out
// to be. This says what has to HAPPEN in it, and is usually written before
// there is a word of the chapter to summarise. The writer's own description:
//
//     "the main key events that take place that move the scenes, dialogue,
//      action, events along. essentially giving a play-by-play high level
//      overview."
//
// Storage: plain Markdown at <project>/outlines/chapters/<chapter-stem>.md.
// No frontmatter, and NEVER PARSED -- docs/outline-spec.md ruled against
// re-creating machine-read structure inside a writer's file, and this is a
// writer's file. A numbered list is what the empty state suggests and nothing
// enforces; dashes, paragraphs or a table all round-trip exactly as typed.
//
// NOT the same thing as a scene Beat, which IS parsed, carries a done state,
// and lives one rung down inside a scene's sidecar. The app's hierarchy is
// Story > Act > Chapter > Scene > Beat, and this sits at Chapter: the plan the
// scenes get cut FROM. See docs/chapter-outline-spec.md section 2.
//
// Built from SummaryView, which is the established shape for a per-chapter
// document -- same MarkdownEditor, same uncontrolled-editor remount trick via
// `reloadKey`, same manual-save-only rule with a dirty pill and Ctrl+S.
//
// WHAT IT DOES NOT HAVE IS A GENERATE BUTTON, and the difference from its
// sibling is the write boundary. SummaryView's Regenerate writes the file: a
// chapter summary is one of the four designated AI-generated fields. An
// outline is not. So Build with AI proposes, and an Insert puts the text in
// this editor UNSAVED for the writer to change and save themselves.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { Sparkles } from "lucide-react";

import { Explain } from "./learn/Explain";
import { MarkdownEditor } from "./MarkdownEditor";
import { EditorToolbar, type FontValue } from "./EditorToolbar";
import type { ProjectInfo } from "../types/project";

const API_BASE = "http://localhost:8000";

export interface ChapterOutlineViewProps {
  project:     ProjectInfo;
  chapterFile: string;       // the manuscript filename, e.g. "07-seven-to-one.md"
  font:        FontValue;
  /** The app owns the font, so changing it here changes it everywhere --
   *  which is what makes this editor feel like the same editor. */
  onFontChange: (font: FontValue) => void;
  onBack:      () => void;
  /** Let the sidebar re-read itself after a first save, so the row stops
   *  looking empty. SceneSummaryView has this and SummaryView does not, which
   *  is why deleting a chapter summary refreshes nothing. */
  onSidebarRefresh?: () => void;
  /** The world, already assembled and already inspected by the writer in the
   *  context bar. Passed in rather than fetched here, so there is one place
   *  that decides what the Weave sends and one place they can switch it off. */
  weaveBrief?: string;
}

export function ChapterOutlineView({
  project, chapterFile, font, onFontChange, onBack, onSidebarRefresh,
  weaveBrief = "",
}: ChapterOutlineViewProps) {
  // null = still reading from disk; "" = nothing written yet.
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [exists,        setExists]        = useState(false);
  const [chapterTitle,  setChapterTitle]  = useState(chapterFile.replace(/\.md$/, ""));
  const [isDirty,       setIsDirty]       = useState(false);
  const [isSaving,      setIsSaving]      = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Bumped to remount the uncontrolled editor with fresh content.
  const [reloadKey, setReloadKey] = useState(0);

  // ── Build with AI ─────────────────────────────────────────────────────
  // Kept in this view rather than in the chat panel on the right, for one
  // structural reason on top of the obvious one: Insert has to write into
  // THIS editor's buffer, and the CodeMirror handle is a ref that lives here.
  // Driving it from the chat panel would mean lifting that ref into App so a
  // different pane could reach across into it.
  const [buildOpen, setBuildOpen]       = useState(false);
  const [instruction, setInstruction]   = useState("");
  const [building, setBuilding]         = useState(false);
  const [proposal, setProposal]         = useState<string | null>(null);
  const [buildError, setBuildError]     = useState<string | null>(null);

  const editorViewRef = useRef<EditorView | null>(null);
  const isDirtyRef    = useRef(false);
  isDirtyRef.current  = isDirty;

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setInitialContent(null);
    setIsDirty(false);
    setError(null);

    (async () => {
      try {
        const params = new URLSearchParams({
          folder_path: project.root_path, chapter_filename: chapterFile,
        });
        const res = await fetch(`${API_BASE}/api/documents/chapter-outline?${params}`);
        if (!res.ok) throw new Error(`Could not read the outline (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        setInitialContent(body.content ?? "");
        setExists(Boolean(body.exists));
        setReloadKey(k => k + 1);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read the outline.");
          setInitialContent("");
        }
      }
    })();

    // The chapter's own title, so the header names the chapter rather than
    // its filename stem.
    (async () => {
      try {
        const params = new URLSearchParams({
          folder_path: project.root_path, filename: chapterFile,
        });
        const res = await fetch(`${API_BASE}/api/documents/chapter?${params}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.title) setChapterTitle(body.title);
      } catch {
        // The stem is a perfectly readable fallback.
      }
    })();

    return () => { cancelled = true; };
  }, [project.root_path, chapterFile]);

  // ── Save. Manual only, per the locked product rule. ─────────────────────
  const handleSave = useCallback(async () => {
    const view = editorViewRef.current;
    if (!view) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/documents/chapter-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path:      project.root_path,
          chapter_filename: chapterFile,
          content:          view.state.doc.toString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Save failed (${res.status})`);
      }
      setIsDirty(false);
      // The FIRST save is the one the sidebar needs to hear about: until it
      // lands there is no file, and the row has nothing to point at.
      const wasNew = !exists;
      setExists(true);
      if (wasNew) onSidebarRefresh?.();
      setStatusMessage("Saved.");
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }, [project.root_path, chapterFile, exists, onSidebarRefresh]);

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

  const handleBuild = useCallback(async () => {
    if (!instruction.trim()) return;
    setBuilding(true);
    setBuildError(null);
    setProposal(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/build-chapter-outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: project.root_path,
          // An ABSOLUTE path, which is what _read_chapter_text validates
          // against the manuscript folder. Same shape SummaryView sends.
          chapter_path: `${project.root_path}/manuscript/${chapterFile}`,
          instruction:  instruction.trim(),
          // What is on screen right now, not what was last saved -- a writer
          // asking for a change means the version they are looking at.
          existing:     editorViewRef.current?.state.doc.toString() ?? "",
          weave_brief:  weaveBrief,
          content_mode: project.content_mode_default ?? "general",
          model_id:     project.default_model || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail ?? `Build failed (${res.status})`);
      setProposal(String(body.outline ?? "").trim());
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "Could not build an outline.");
    } finally {
      setBuilding(false);
    }
  }, [instruction, project, chapterFile, weaveBrief]);

  /**
   * INSERT, and why this is not a hole in the AI write boundary.
   *
   * Nothing is written to disk here. The text goes into the editor buffer,
   * marked unsaved, and the writer can rewrite every line of it before they
   * press Save -- which is the boundary's actual requirement, that AI output
   * does not reach a human-authored field "without the writer applying it,
   * per action". This button IS that action.
   *
   * It REPLACES rather than appends. The model was told to return the whole
   * revised outline precisely so this could be a replacement: appending would
   * leave the writer with two numbered lists to reconcile by hand, which is
   * the thing they asked the AI to save them.
   */
  const handleInsert = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || proposal === null) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: proposal },
    });
    setIsDirty(true);
    setProposal(null);
    setBuildOpen(false);
    setStatusMessage("Inserted. Not saved yet.");
    setTimeout(() => setStatusMessage(null), 4000);
  }, [proposal]);

  // THE TOOLBAR NEEDS THIS IN STATE. The ref below is what the Insert
  // button writes through, and a ref does not re-render -- so a toolbar
  // reading it would come up on first paint with no editor to act on and
  // every button dead.
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  const editor = (defaultValue: string) => (
    <MarkdownEditor
      key={`${chapterFile}-${reloadKey}`}
      defaultValue={defaultValue}
      onChange={() => setIsDirty(true)}
      font={font}
      onEditorReady={view => { editorViewRef.current = view; setEditorView(view); }}
    />
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-panel px-4 py-2">
        <div className="flex items-baseline gap-2">
          <button
            onClick={onBack}
            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-accent-fill hover:text-accent"
            title="Back to the chapter editor"
          >
            &larr; Back
          </button>
          <span className="text-sm font-medium text-text-primary">{chapterTitle}</span>
          <span className="text-xs text-text-muted">Chapter Outline</span>
          <Explain of="chapter-outline.what" compact />
        </div>

        <div className="flex items-center gap-2">
          {statusMessage && (
            <span className="text-xs text-success-muted">{statusMessage}</span>
          )}
          {isDirty ? (
            <span className="flex items-center gap-1.5 text-xs text-warn-muted"
                  title="Unsaved changes. Press Ctrl+S to save.">
              <span className="h-1.5 w-1.5 rounded-full bg-warn-muted" />
              Unsaved
            </span>
          ) : exists ? (
            <span className="flex items-center gap-1.5 text-xs text-success-fill"
                  title="All changes are saved.">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fill" />
              Saved
            </span>
          ) : null}

          <button
            onClick={() => setBuildOpen(v => !v)}
            aria-expanded={buildOpen}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs transition-colors ${
              buildOpen
                ? "border-accent-fill bg-accent-soft/40 text-accent-strong"
                : "border-accent-fill/50 text-accent hover:border-accent-fill hover:text-accent-strong"
            }`}
            title="Describe what this chapter should do and have AI draft the outline"
          >
            <Sparkles size={11} /> Build with AI
          </button>

          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="rounded border border-border px-3 py-1 text-xs text-text-primary transition-colors hover:border-success-fill hover:text-success-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Save (Ctrl+S)"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-bg-panel/50 px-4 py-1.5">
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-accent">Purpose:</span>{" "}
          What has to happen in this chapter, in order. Your plan, not a
          summary of what you wrote.
        </p>
      </div>

      {/* ── Build with AI ────────────────────────────────────────────────
          A composer and a proposal, in this view rather than in the chat
          panel: the writer is looking at the document the text is going into,
          and Insert writes to THIS editor's buffer.

          The proposal is shown in full and lands nowhere until Insert. That
          is the AI write boundary satisfied rather than widened -- output does
          not reach a human-authored field without the writer applying it, per
          action, and this is the action. */}
      {buildOpen && (
        <div className="shrink-0 border-b border-border bg-bg-panel/60 px-4 py-3"
             data-testid="outline-build-panel">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary">
              What should this chapter do?
            </span>
            <Explain of="chapter-outline.build" compact />
          </div>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            rows={3}
            placeholder={"In your own words. For example: she takes the job she "
              + "swore she would not take, and the reason she gives is not the "
              + "real one. Ends on the party leaving without her."}
            className="w-full resize-y rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleBuild()}
              disabled={building || !instruction.trim()}
              className="rounded border border-accent-fill/50 bg-accent-soft/40 px-3 py-1 text-xs text-accent transition-colors hover:border-accent-fill hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {building ? "Building..." : proposal ? "Build again" : "Build"}
            </button>
            <button
              onClick={() => { setBuildOpen(false); setProposal(null); setBuildError(null); }}
              className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:text-text-primary"
            >
              Close
            </button>
            <span className="text-micro text-faint">
              Nothing is written until you press Insert, and nothing is saved
              until you press Save.
            </span>
          </div>

          {buildError && (
            <p role="alert" className="mt-2 text-mini text-danger">{buildError}</p>
          )}

          {proposal !== null && (
            <div className="mt-3" data-testid="outline-proposal">
              <p className="mb-1 text-xs text-text-muted">
                Read it before you take it. Insert REPLACES what is in the
                editor, and you can change every line before saving.
              </p>
              <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded border border-accent-fill/40 bg-bg-surface px-3 py-2 text-sm leading-relaxed text-text-primary">
{proposal}
              </pre>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleInsert}
                  data-testid="outline-insert"
                  className="rounded border border-accent-fill bg-accent-soft/50 px-3 py-1 text-xs text-accent-strong transition-colors hover:bg-accent-soft"
                >
                  Insert into the outline
                </button>
                <button
                  onClick={() => setProposal(null)}
                  className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-danger-fill hover:text-danger"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="shrink-0 border-b border-danger-fill bg-danger-soft/40 px-4 py-2">
          <p className="text-xs text-danger">
            <span className="font-semibold">Error: </span>{error}
          </p>
        </div>
      )}

      {/* THE SAME FORMATTING TOOLBAR THE MANUSCRIPT HAS.

          An outline is a numbered list more often than it is anything
          else, and there was no way to make one but typing the digits --
          no bullets, no headings, no bold. The plan is a document the
          writer works in, so it gets the document tools. Reused rather
          than rebuilt: it is formatting-only and takes the editor view,
          so there is nothing chapter-specific in it to strip out. */}
      <EditorToolbar
        editorView={editorView}
        currentFont={font}
        onFontChange={onFontChange}
      />

      <div className="relative flex-1 overflow-hidden">
        {initialContent === null ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Reading the outline...
          </div>
        ) : !exists && initialContent === "" ? (
          // AN EMPTY STATE THAT TEACHES. It shows the shape rather than
          // describing it, because "a numbered list of key events" is four
          // words that a four-line example explains better -- and the editor
          // sits right underneath so a writer who knows their chapter can
          // ignore all of it and start typing.
          <div className="flex h-full flex-col items-center gap-2 px-6 pt-8 text-center">
            <p className="text-sm text-accent">Nothing planned for this chapter yet.</p>
            <p className="max-w-lg text-xs text-text-muted">
              List the key events that move this chapter along, in the order
              they happen. High level: one line each, the things without which
              the chapter does not work.
            </p>
            <pre className="mt-1 max-w-lg rounded border border-dashed border-border bg-bg-surface px-3 py-2 text-left text-xs leading-relaxed text-faint">
{`1. The column is spotted at dusk.
2. Vance argues for withdrawal, and is overruled.
3. The mercenaries hit the flank before the party agrees a plan.
4. She follows the wrong order and it works, which is worse.`}
            </pre>
            <p className="max-w-lg text-xs text-faint">
              Start typing below. Nothing is saved until you press Save.
            </p>
            <div className="mt-3 w-full max-w-3xl flex-1 overflow-hidden text-left">
              {editor("")}
            </div>
          </div>
        ) : (
          editor(initialContent)
        )}
      </div>
    </main>
  );
}
