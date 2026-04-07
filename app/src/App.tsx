// App.tsx -- The Root Layout Component
// ======================================
// This is the top-level component of StoryForge's frontend.
//
// IMPORTANT React rule: "Rules of Hooks"
//   Every hook (useState, useEffect, useCallback, useRef) must be called
//   at the TOP of the component, UNCONDITIONALLY, in the same order every render.
//   You cannot call a hook inside an if-statement or after an early return.
//
//   Why? React tracks hooks by the ORDER they are called. If a hook is
//   sometimes called and sometimes not (because of an if/early-return), React
//   loses track of which state belongs to which hook, and crashes.
//
//   Pattern used here:
//     1. ALL hooks declared at the top (unconditionally)
//     2. Conditional early return AFTER all hooks
//     3. Normal render return at the bottom

import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { EditorToolbar, FONT_OPTIONS, type FontValue } from "./components/EditorToolbar";
import { ProjectHome } from "./screens/ProjectHome";
import type { ProjectInfo } from "./types/project";
import type { EditorView } from "@codemirror/view";


// ── App Component ────────────────────────────────────────────────────────────
function App() {

  // ── ALL HOOKS FIRST -- before any conditional returns ─────────────────────

  // Which project is currently open. null = show home screen.
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);

  // True when the writer has typed something since the last save.
  const [isDirty, setIsDirty] = useState(false);

  // The currently selected writing font.
  const [currentFont, setCurrentFont] = useState<FontValue>(FONT_OPTIONS[0].value);

  // The live CodeMirror EditorView instance.
  // useState so the toolbar gets the view via props (ref changes don't trigger re-renders).
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // Ref for use inside callbacks -- gives the latest value without stale closures.
  const editorViewRef = useRef<EditorView | null>(null);

  // Called by ProjectHome when a project is successfully created or opened.
  const handleProjectOpen = useCallback((project: ProjectInfo) => {
    setCurrentProject(project);
    setIsDirty(false); // Reset dirty state for the new project
  }, []);

  // Called by MarkdownEditor every time the writer types anything.
  const handleContentChange = useCallback(() => {
    setIsDirty(true);
  }, []);

  // Reads current content from CodeMirror and "saves" it.
  // File I/O will be added in the next step -- for now just clears the dirty flag.
  const handleSave = useCallback(() => {
    const currentContent = editorViewRef.current?.state.doc.toString() ?? "";
    // TODO: POST /api/documents/{id} to write file to disk
    console.log("Saved (in-memory only):", currentContent.slice(0, 60) + "...");
    setIsDirty(false);
  }, []);

  // Keyboard shortcut: Ctrl+S to save.
  // useEffect runs this setup once after the first render, and cleans up on unmount.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Initial editor content -- used once when the editor first mounts.
  // CodeMirror owns the text after that.
  const initialContent = "# Chapter 1\n\nStart writing here...\n";


  // ── CONDITIONAL RENDERING -- safe to do here because all hooks are above ──

  // No project open: show the welcome / project picker screen
  if (!currentProject) {
    return <ProjectHome onProjectOpen={handleProjectOpen} />;
  }

  // Project is open: show the three-panel writing editor
  return (
    <div className="flex h-screen overflow-hidden bg-[#070724] text-[#f0f0f5]">

      {/* ── LEFT PANEL: Navigation Sidebar ─────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#1e1e4a] bg-[#0d0d2b]">

        <div className="border-b border-[#1e1e4a] px-4 py-5">
          <h1 className="text-lg font-semibold tracking-wide text-[#f0f0f5]">
            StoryForge
          </h1>
          <p className="mt-0.5 truncate text-xs text-[#8888aa]" title={currentProject.title}>
            {currentProject.title}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <NavSection label="Manuscript">
            <NavItem label="Chapter 1" hint="Click to open this chapter in the editor" active />
            <NavItem label="Chapter 2" hint="Click to open this chapter in the editor" />
          </NavSection>
          <NavSection label="Notes">
            <NavItem label="Outline"     hint="Story structure and plot notes" />
            <NavItem label="Style Guide" hint="Rules for tone, voice, and punctuation" />
          </NavSection>
          <NavSection label="Profiles">
            <NavItem label="Characters" hint="Character profiles and trait blocks" />
            <NavItem label="Locations"  hint="Location descriptions and atmosphere notes" />
            <NavItem label="Lore"       hint="World-building rules and history entries" />
          </NavSection>
        </nav>

        <div className="border-t border-[#1e1e4a] px-4 py-3">
          <button
            className="w-full rounded px-2 py-1.5 text-left text-sm text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Open project settings"
          >
            ⚙ Settings
          </button>
        </div>
      </aside>


      {/* ── CENTER PANEL: Writing Editor ───────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Chapter title bar + save indicator */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e4a] bg-[#0d0d2b] px-4 py-2">
          <span className="text-sm font-medium text-[#f0f0f5]">Chapter 1</span>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-400"
                title="You have unsaved changes. Press Ctrl+S to save.">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500"
                title="All changes are saved. Manual save only -- no autosave.">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5] disabled:cursor-not-allowed disabled:opacity-40"
              title="Save the current chapter (Ctrl+S)"
            >
              Save
            </button>
          </div>
        </div>

        {/* Formatting toolbar */}
        <EditorToolbar
          editorView={editorView}
          currentFont={currentFont}
          onFontChange={setCurrentFont}
        />

        {/* Markdown editor */}
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor
            defaultValue={initialContent}
            onChange={handleContentChange}
            font={currentFont}
            onEditorReady={(view) => {
              setEditorView(view);
              editorViewRef.current = view;
            }}
          />
        </div>
      </main>


      {/* ── RIGHT PANEL: AI Assistant ──────────────────────────────────── */}
      <aside className="flex w-80 shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b]">

        <div className="border-b border-[#1e1e4a] px-4 py-5">
          <h2 className="text-sm font-semibold text-[#f0f0f5]">AI Assistant</h2>
          <p className="mt-1 text-xs text-[#8888aa]">
            Select text in the editor, then choose an assistant. Results
            appear below -- nothing is applied automatically.
          </p>
        </div>

        <div className="border-b border-[#1e1e4a] px-4 py-3">
          <div className="flex gap-1.5">
            <AssistantTab label="Readability" active />
            <AssistantTab label="Structure" />
            <AssistantTab label="Context" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
            Readability Assistants
          </p>
          <AssistantButton label="Grammar & Punctuation"
            hint="Reviews your selected text for grammar and punctuation errors." />
          <AssistantButton label="Clarity & Consistency"
            hint="Flags unclear phrasing and inconsistent word choices." />
          <AssistantButton label="Eliminate Redundancy"
            hint="Finds repeated words or ideas that can be cut or tightened." />
          <AssistantButton label="Descriptive Enhancement"
            hint="Suggests richer sensory or atmospheric details for your selection." />

          <div className="mt-5 rounded border border-[#1e1e4a] bg-[#12122e] p-3">
            <p className="mb-1 text-xs font-semibold text-[#8888aa]">Output</p>
            <p className="text-xs leading-relaxed text-[#8888aa]">
              AI results appear here after you run an assistant. Copy what you
              like -- nothing changes in your document automatically.
            </p>
          </div>
        </div>
      </aside>

    </div>
  );
}


// ── Helper Components ─────────────────────────────────────────────────────────

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
        {label}
      </p>
      {children}
    </div>
  );
}

function NavItem({ label, hint, active = false }: { label: string; hint: string; active?: boolean }) {
  return (
    <button
      className={`mb-0.5 w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-indigo-600/20 text-indigo-300" : "text-[#f0f0f5] hover:bg-[#12122e]"
      }`}
      title={hint}
    >
      {label}
    </button>
  );
}

function AssistantTab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-indigo-600 text-white" : "text-[#8888aa] hover:text-[#f0f0f5]"
      }`}
    >
      {label}
    </button>
  );
}

function AssistantButton({ label, hint }: { label: string; hint: string }) {
  return (
    <button
      className="mb-2 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-left text-xs text-[#f0f0f5] transition-colors hover:border-indigo-500 hover:bg-[#1a1a3a]"
      title={hint}
    >
      {label}
    </button>
  );
}

export default App;
