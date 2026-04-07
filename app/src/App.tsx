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
import { ProfileBuilder } from "./screens/ProfileBuilder";
import type { ProjectInfo, ChapterInfo } from "./types/project";
import type { ProfileType } from "./types/profile";
import type { EditorView } from "@codemirror/view";

// The base URL for all API calls to the Python FastAPI backend.
const API_BASE = "http://localhost:8000";


// ── App Component ────────────────────────────────────────────────────────────
function App() {

  // ── ALL HOOKS FIRST -- before any conditional returns ─────────────────────

  // Which project is currently open. null = show home screen.
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);

  // Which top-level view is active: the writing editor or the profile builder.
  // profileType tracks which tab was clicked so the ProfileBuilder opens on the right type.
  const [currentView, setCurrentView]   = useState<"editor" | "profiles">("editor");
  const [profileType, setProfileType]   = useState<ProfileType>("character");

  // The list of chapter files found in the project's manuscript/ folder.
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);

  // The chapter currently open in the editor.
  const [currentChapter, setCurrentChapter] = useState<ChapterInfo | null>(null);

  // The content loaded from disk for the current chapter.
  // This is passed to MarkdownEditor as its initial content.
  const [chapterContent, setChapterContent] = useState<string>("");

  // True while a chapter is being fetched from the backend.
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);

  // True when the writer has typed something since the last save.
  const [isDirty, setIsDirty] = useState(false);

  // Any error message to show in the editor area (e.g. save failed).
  const [editorError, setEditorError] = useState<string | null>(null);

  // The currently selected writing font.
  const [currentFont, setCurrentFont] = useState<FontValue>(FONT_OPTIONS[0].value);

  // The live CodeMirror EditorView instance.
  // useState so the toolbar gets the view via props (ref changes don't trigger re-renders).
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // Ref for use inside callbacks -- gives the latest value without stale closures.
  // A "stale closure" is when a function captures an old version of a variable.
  // The ref always points to the current value, even inside older closures.
  const editorViewRef = useRef<EditorView | null>(null);
  const currentChapterRef = useRef<ChapterInfo | null>(null);
  const currentProjectRef = useRef<ProjectInfo | null>(null);

  // Keep refs in sync with state on every render.
  // This lets our event listeners (Ctrl+S) always see the latest values.
  currentChapterRef.current  = currentChapter;
  currentProjectRef.current  = currentProject;


  // --- Load a chapter from the backend ---
  // Fetches the file content for a given chapter and updates the editor.
  // useCallback memoizes this function so it doesn't get recreated every render.
  const loadChapter = useCallback(async (chapter: ChapterInfo, project: ProjectInfo) => {
    setIsLoadingChapter(true);
    setEditorError(null);

    try {
      const params = new URLSearchParams({
        folder_path: project.root_path,
        filename:    chapter.filename,
      });

      const response = await fetch(`${API_BASE}/api/documents/chapter?${params}`);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Failed to load chapter.");
      }

      const data = await response.json();

      // Update the content and mark the chapter as current.
      // The editor uses `key={currentChapter.filename}` so changing
      // currentChapter causes a full remount with the new content.
      setChapterContent(data.content);
      setCurrentChapter(chapter);
      setIsDirty(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not load chapter.");
    } finally {
      setIsLoadingChapter(false);
    }
  }, []);


  // --- Called by ProjectHome when a project is opened or created ---
  // Fetches the chapter list, then auto-opens the first chapter.
  const handleProjectOpen = useCallback(async (project: ProjectInfo) => {
    setCurrentProject(project);
    setChapters([]);
    setCurrentChapter(null);
    setChapterContent("");
    setIsDirty(false);
    setEditorError(null);

    try {
      const params = new URLSearchParams({ folder_path: project.root_path });
      const response = await fetch(`${API_BASE}/api/documents/chapters?${params}`);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Failed to load chapter list.");
      }

      const chapterList: ChapterInfo[] = await response.json();
      setChapters(chapterList);

      // Auto-open the first chapter if any exist
      if (chapterList.length > 0) {
        await loadChapter(chapterList[0], project);
      }

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not load project chapters.");
    }
  }, [loadChapter]);


  // --- Called by MarkdownEditor every time the writer types anything ---
  const handleContentChange = useCallback(() => {
    setIsDirty(true);
  }, []);


  // --- Save the current chapter to disk ---
  // Reads the current editor content and POSTs it to the backend.
  const handleSave = useCallback(async () => {
    const view    = editorViewRef.current;
    const chapter = currentChapterRef.current;
    const project = currentProjectRef.current;

    // Nothing to save if no chapter is open
    if (!view || !chapter || !project) return;

    const content = view.state.doc.toString();
    setEditorError(null);

    try {
      const response = await fetch(`${API_BASE}/api/documents/chapter`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          folder_path: project.root_path,
          filename:    chapter.filename,
          content,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Save failed.");
      }

      setIsDirty(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save chapter.");
    }
  }, []);


  // --- Keyboard shortcut: Ctrl+S to save ---
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


  // ── CONDITIONAL RENDERING -- safe to do here because all hooks are above ──

  // No project open: show the welcome / project picker screen
  if (!currentProject) {
    return <ProjectHome onProjectOpen={handleProjectOpen} />;
  }

  // Profile builder view: replaces the entire editor layout
  if (currentView === "profiles") {
    return (
      <ProfileBuilder
        project={currentProject}
        initialType={profileType}
        onBack={() => setCurrentView("editor")}
      />
    );
  }

  // ── Project is open: show the three-panel writing editor ──────────────────
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

          {/* Manuscript section -- real chapter list from disk */}
          <NavSection label="Manuscript">
            {chapters.length === 0 && (
              <p className="px-2 text-xs text-[#3f3f7a]">No chapters found.</p>
            )}
            {chapters.map((chapter) => (
              <NavItem
                key={chapter.filename}
                label={chapter.title}
                hint={`Open ${chapter.filename} in the editor`}
                active={currentChapter?.filename === chapter.filename}
                onClick={() => {
                  // Don't reload if this chapter is already open
                  if (currentChapter?.filename !== chapter.filename) {
                    loadChapter(chapter, currentProject);
                  }
                }}
              />
            ))}
          </NavSection>

          <NavSection label="Notes">
            <NavItem label="Outline"     hint="Story structure and plot notes" />
            <NavItem label="Style Guide" hint="Rules for tone, voice, and punctuation" />
          </NavSection>

          <NavSection label="Profiles">
            <NavItem label="Characters"    hint="Character profiles and trait blocks"
              onClick={() => { setProfileType("character");    setCurrentView("profiles"); }} />
            <NavItem label="Relationships" hint="Relationship profiles and dynamic notes"
              onClick={() => { setProfileType("relationship"); setCurrentView("profiles"); }} />
            <NavItem label="Locations"     hint="Location descriptions and atmosphere notes"
              onClick={() => { setProfileType("location");     setCurrentView("profiles"); }} />
            <NavItem label="Lore"          hint="World-building rules and history entries"
              onClick={() => { setProfileType("lore");         setCurrentView("profiles"); }} />
          </NavSection>

          <NavSection label="Summaries">
            <NavItem label="Chapter Summaries" hint="Per-chapter summaries used as AI context"
              onClick={() => { setProfileType("chapter_summary"); setCurrentView("profiles"); }} />
            <NavItem label="Scene Summaries"   hint="Per-scene summaries used as AI context"
              onClick={() => { setProfileType("scene_summary");   setCurrentView("profiles"); }} />
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
          <span className="text-sm font-medium text-[#f0f0f5]">
            {currentChapter ? currentChapter.title : "No chapter open"}
          </span>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-400"
                title="You have unsaved changes. Press Ctrl+S to save.">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500"
                title="All changes are saved to disk. Manual save only -- no autosave.">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || !currentChapter}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5] disabled:cursor-not-allowed disabled:opacity-40"
              title="Save the current chapter to disk (Ctrl+S)"
            >
              Save
            </button>
          </div>
        </div>

        {/* Error banner -- shown when save or load fails */}
        {editorError && (
          <div className="shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2">
            <p className="text-xs text-red-300">
              <span className="font-semibold">Error: </span>{editorError}
            </p>
          </div>
        )}

        {/* Formatting toolbar */}
        <EditorToolbar
          editorView={editorView}
          currentFont={currentFont}
          onFontChange={setCurrentFont}
        />

        {/* Editor area -- loading state or the actual editor */}
        <div className="flex-1 overflow-hidden">
          {isLoadingChapter ? (
            // Loading placeholder shown while the chapter file is being fetched
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-[#8888aa]">Loading chapter...</p>
            </div>
          ) : currentChapter ? (
            // key={currentChapter.filename} forces a full remount when the chapter
            // changes. This is the correct way to reset an uncontrolled component
            // (CodeMirror) with new content -- instead of trying to imperatively
            // push new content into the editor, we simply unmount and remount it.
            <MarkdownEditor
              key={currentChapter.filename}
              defaultValue={chapterContent}
              onChange={handleContentChange}
              font={currentFont}
              onEditorReady={(view) => {
                setEditorView(view);
                editorViewRef.current = view;
              }}
            />
          ) : (
            // No chapter open yet (project has no chapters, or still loading)
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-[#8888aa]">
                Select a chapter from the left panel to start writing.
              </p>
            </div>
          )}
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

function NavItem({
  label,
  hint,
  active = false,
  onClick,
}: {
  label: string;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
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
