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
import { Settings } from "./screens/Settings";
import type { ProjectInfo, ChapterInfo } from "./types/project";
import type { ProfileType } from "./types/profile";
import type { AssistantResponse, ContextChip } from "./types/ai";
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

  // Settings modal visibility
  const [showSettings, setShowSettings] = useState(false);

  // Text currently selected in the editor -- drives the AI assistant panel
  const [selectedText, setSelectedText] = useState("");

  // AI panel state
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiResult, setAiResult]         = useState<AssistantResponse | null>(null);
  const [aiError, setAiError]           = useState<string | null>(null);
  const [aiTab, setAiTab]               = useState<"readability" | "structure" | "context">("readability");

  // Context chips -- profile summaries the writer explicitly attaches to AI requests.
  // Only the chips the writer has added are sent with each assistant call.
  const [contextChips, setContextChips] = useState<ContextChip[]>([]);

  // Whether the context chip picker panel is open
  const [showChipPicker, setShowChipPicker] = useState(false);

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


  // --- Run a writing assistant on the selected text ---
  const runAssistant = useCallback(async (assistantId: string) => {
    if (!selectedText.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);

    try {
      const response = await fetch(`${API_BASE}/api/ai/run-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant_id:  assistantId,
          selected_text: selectedText,
          context_chips: contextChips,   // Pass any attached profile context chips
          project_path:  currentProjectRef.current?.root_path ?? null,
          content_mode:  currentProjectRef.current?.content_mode_default ?? "general",
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Assistant failed.");
      }

      const result: AssistantResponse = await response.json();
      setAiResult(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAiLoading(false);
    }
  }, [selectedText, contextChips]);


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
            onClick={() => setShowSettings(true)}
            className="w-full rounded px-2 py-1.5 text-left text-sm text-[#8888aa] transition-colors hover:bg-[#12122e] hover:text-[#f0f0f5]"
            title="Open settings (API key, model selection)"
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
              onSelectionChange={setSelectedText}
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

        <div className="border-b border-[#1e1e4a] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#f0f0f5]">AI Assistant</h2>
          <p className="mt-1 text-xs text-[#8888aa]">
            Select text in the editor, then choose an assistant.
            Results appear below -- nothing is applied automatically.
          </p>
        </div>

        {/* Category tabs */}
        <div className="border-b border-[#1e1e4a] px-4 py-2">
          <div className="flex gap-1">
            {(["readability", "structure", "context"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAiTab(tab)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  aiTab === tab ? "bg-indigo-600 text-white" : "text-[#8888aa] hover:text-[#f0f0f5]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Selected text indicator */}
        <div className="shrink-0 border-b border-[#1e1e4a] px-4 py-2">
          {selectedText ? (
            <p className="truncate text-xs text-emerald-400"
               title={selectedText}>
              Selected: "{selectedText.slice(0, 60)}{selectedText.length > 60 ? "..." : ""}"
            </p>
          ) : (
            <p className="text-xs text-[#3f3f7a]">
              No text selected -- highlight a passage to enable assistants.
            </p>
          )}
        </div>

        {/* Assistant buttons */}
        <div className="shrink-0 px-4 py-3">
          {aiTab === "readability" && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                Readability
              </p>
              <AssistantButton label="Grammar & Punctuation"
                hint="Reviews selected text for grammar, punctuation, and spelling errors."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("grammar_punctuation")} />
              <AssistantButton label="Clarity & Consistency"
                hint="Flags unclear phrasing, ambiguous references, and inconsistent word choices."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("clarity_consistency")} />
              <AssistantButton label="Eliminate Redundancy"
                hint="Finds repeated words or ideas that can be cut or tightened."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("eliminate_redundancy")} />
              <AssistantButton label="Descriptive Enhancement"
                hint="Suggests richer sensory or atmospheric details for the selection."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("descriptive_enhancement")} />
            </>
          )}
          {aiTab === "structure" && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                Structure
              </p>
              <AssistantButton label="Dialogue Authenticity"
                hint="Checks whether dialogue sounds natural, distinct, and free of on-the-nose exposition."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("dialogue_authenticity")} />
              <AssistantButton label="POV Consistency"
                hint="Detects point-of-view drift, head-hopping, and information the POV character couldn't know."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("pov_consistency")} />
              <AssistantButton label="Tone & Voice Consistency"
                hint="Checks whether the narrative tone and voice stay consistent throughout the passage."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("tone_voice_consistency")} />
              <AssistantButton label="Character Development"
                hint="Analyzes the passage for character growth, revelation, or missed development opportunities."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("character_development")} />
            </>
          )}
          {aiTab === "context" && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                Context
              </p>
              <AssistantButton label="Character Consistency"
                hint="Checks whether characters behave consistently with their established traits. Works best with context chips attached."
                disabled={!selectedText || aiLoading}
                onClick={() => runAssistant("character_consistency")} />

              {/* ── Context Chips Section ─────────────────────────────────────
                  Context chips let the writer explicitly attach profile
                  summaries to AI requests. The AI only sees what's attached --
                  it never has implicit access to the full project.
              ──────────────────────────────────────────────────────────────── */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#8888aa]">
                    Attached Context
                  </p>
                  <button
                    onClick={() => setShowChipPicker(prev => !prev)}
                    className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300"
                    title="Attach a profile summary as context for AI assistants"
                  >
                    + Add
                  </button>
                </div>

                {/* Chip picker -- shows when "+ Add" is clicked */}
                {showChipPicker && currentProject && (
                  <ChipPicker
                    rootPath={currentProject.root_path}
                    seriesPath={currentProject.series_path}
                    existingChips={contextChips}
                    onAdd={(chip) => {
                      setContextChips(prev => [...prev, chip]);
                      setShowChipPicker(false);
                    }}
                    onClose={() => setShowChipPicker(false)}
                  />
                )}

                {/* Active context chips */}
                {contextChips.length === 0 ? (
                  <p className="text-xs leading-relaxed text-[#3f3f7a]">
                    No context attached. Click "+ Add" to attach a profile summary.
                    The AI only sees what you share -- nothing is attached automatically.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {contextChips.map((chip, i) => {
                      const color = chipTypeColor(chip.type);
                      const label = chipTypeLabel(chip.type);
                      return (
                        <div key={i}
                          className="flex items-center justify-between rounded border border-[#1e1e4a] bg-[#12122e] px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* Color-coded type badge */}
                            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${color}`}>
                              {label}
                            </span>
                            <span className="truncate text-xs font-medium text-[#f0f0f5]">
                              {chip.name}
                            </span>
                          </div>
                          <button
                            onClick={() => setContextChips(prev => prev.filter((_, j) => j !== i))}
                            className="ml-2 shrink-0 text-xs text-[#3f3f7a] transition-colors hover:text-red-400"
                            title="Remove this context chip"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => setContextChips([])}
                      className="mt-0.5 text-xs text-[#3f3f7a] transition-colors hover:text-red-400"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Output area */}
        <div className="flex-1 overflow-y-auto border-t border-[#1e1e4a] px-4 py-4">
          {aiLoading && (
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
              Running assistant...
            </div>
          )}

          {aiError && (
            <div className="rounded border border-red-800 bg-red-950/40 p-3">
              <p className="text-xs text-red-300">{aiError}</p>
              {aiError.includes("API key") && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="mt-2 text-xs text-indigo-400 underline"
                >
                  Open Settings
                </button>
              )}
            </div>
          )}

          {aiResult && !aiLoading && (
            <div>
              {/* Assistant name + model used */}
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#f0f0f5]">
                  {aiResult.assistant_name}
                </p>
                <p className="text-xs text-[#3f3f7a]" title={`Model: ${aiResult.model_used}`}>
                  {aiResult.model_used.split("/").pop()}
                </p>
              </div>

              {/* Summary */}
              <div className="mb-3 rounded border border-[#1e1e4a] bg-[#12122e] p-3">
                <p className="mb-1 text-xs font-medium text-[#8888aa]">Summary</p>
                <p className="text-xs leading-relaxed text-[#f0f0f5]">{aiResult.summary}</p>
              </div>

              {/* Suggestions */}
              {aiResult.suggestions.map((s, i) => (
                <div key={i} className="mb-2 rounded border border-[#1e1e4a] bg-[#070724] p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-medium text-indigo-300">{s.label}</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(s.content)}
                      className="text-xs text-[#3f3f7a] transition-colors hover:text-[#8888aa]"
                      title="Copy this suggestion to clipboard"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#f0f0f5]">
                    {s.content}
                  </p>
                </div>
              ))}

              {/* Notes */}
              {aiResult.notes.length > 0 && (
                <div className="mt-2 rounded border border-[#1e1e4a] p-3">
                  <p className="mb-1 text-xs font-medium text-[#8888aa]">Notes</p>
                  {aiResult.notes.map((n, i) => (
                    <p key={i} className="text-xs leading-relaxed text-[#8888aa]">• {n}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {!aiResult && !aiLoading && !aiError && (
            <p className="text-xs leading-relaxed text-[#3f3f7a]">
              Results appear here after you run an assistant. Copy what you
              like -- nothing in your document changes automatically.
            </p>
          )}
        </div>
      </aside>

      {/* Settings modal -- rendered as an overlay on top of everything */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

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


function AssistantButton({
  label,
  hint,
  onClick,
  disabled = false,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mb-2 w-full rounded border border-[#1e1e4a] bg-[#12122e] px-3 py-2 text-left text-xs text-[#f0f0f5] transition-colors hover:border-indigo-500 hover:bg-[#1a1a3a] disabled:cursor-not-allowed disabled:opacity-40"
      title={disabled ? "Select text in the editor first" : hint}
    >
      {label}
    </button>
  );
}

// ── Context chip type config ──────────────────────────────────────────────────
// Human-readable labels and color styles for each profile type.
// Used in both the chip picker and the attached chip display.

const CHIP_TYPES: { id: string; label: string; color: string }[] = [
  { id: "character",              label: "Character",              color: "text-indigo-300 border-indigo-700/50 bg-indigo-900/20"  },
  { id: "relationship",           label: "Relationship",           color: "text-violet-300  border-violet-700/50  bg-violet-900/20"  },
  { id: "location",               label: "Location",               color: "text-teal-300    border-teal-700/50    bg-teal-900/20"    },
  { id: "lore",                   label: "Lore",                   color: "text-amber-300   border-amber-700/50   bg-amber-900/20"   },
  { id: "chapter_summary",        label: "Chapter Summary",        color: "text-sky-300     border-sky-700/50     bg-sky-900/20"     },
  { id: "scene_summary",          label: "Scene Summary",          color: "text-emerald-300 border-emerald-700/50 bg-emerald-900/20" },
  // Series canonical profiles -- attached from the series source toggle in ChipPicker
  { id: "series_character",       label: "Series Character",       color: "text-indigo-200 border-indigo-600/50 bg-indigo-800/20"  },
  { id: "series_relationship",    label: "Series Relationship",    color: "text-violet-200  border-violet-600/50  bg-violet-800/20"  },
  { id: "series_location",        label: "Series Location",        color: "text-teal-200    border-teal-600/50    bg-teal-800/20"    },
  { id: "series_lore",            label: "Series Lore",            color: "text-amber-200   border-amber-600/50   bg-amber-800/20"   },
];

function chipTypeColor(type: string): string {
  return CHIP_TYPES.find(t => t.id === type)?.color
    ?? "text-[#8888aa] border-[#1e1e4a] bg-[#12122e]";
}

function chipTypeLabel(type: string): string {
  return CHIP_TYPES.find(t => t.id === type)?.label
    ?? type.replace(/_/g, " ");
}


// ── ChipPicker ────────────────────────────────────────────────────────────────
// A small inline panel that lets the writer pick a profile to attach as a
// context chip. It fetches the profile list on mount and shows it grouped by type.
// When the writer clicks a profile, we fetch its full_ai_summary to use as
// the chip content.

interface ChipPickerProps {
  rootPath: string;
  seriesPath?: string | null;
  existingChips: ContextChip[];
  onAdd: (chip: ContextChip) => void;
  onClose: () => void;
}

function ChipPicker({ rootPath, seriesPath, existingChips, onAdd, onClose }: ChipPickerProps) {
  const [loading, setLoading] = useState(false);
  const [profileType, setProfileType] = useState("character");
  const [profiles, setProfiles] = useState<{ filename: string; name: string }[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  // "suggested" chips: auto-fetched character profiles shown at the top as ghost chips
  const [suggested, setSuggested] = useState<{ filename: string; name: string; type: string }[]>([]);
  const [suggestedLoaded, setSuggestedLoaded] = useState(false);

  // Whether we're browsing series canonical profiles vs local project profiles
  const [source, setSource] = useState<"project" | "series">("project");
  const hasSeries = Boolean(seriesPath);

  // On mount, auto-suggest character profiles from the project
  useEffect(() => {
    if (suggestedLoaded) return;
    const params = new URLSearchParams({ folder_path: rootPath, type: "character" });
    fetch(`${API_BASE}/api/profiles/list?${params}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSuggested(data.map((p: { filename: string; name: string }) => ({
            filename: p.filename, name: p.name, type: "character",
          })));
        }
      })
      .catch(() => {})
      .finally(() => setSuggestedLoaded(true));
  }, [rootPath, suggestedLoaded]);

  // Fetch the profile list when the selected type or source changes
  useEffect(() => {
    setLoading(true);
    const folderPath = source === "series" && seriesPath ? seriesPath : rootPath;
    const params = new URLSearchParams({ folder_path: folderPath, type: profileType });
    fetch(`${API_BASE}/api/profiles/list?${params}`)
      .then(r => r.json())
      .then(data => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [profileType, rootPath, seriesPath, source]);

  async function pickProfile(filename: string, name: string, fromSource?: "project" | "series") {
    setAdding(filename);
    const chipType = source === "series" ? `series_${profileType}` : profileType;
    try {
      if (existingChips.some(c => c.name === name && c.type === chipType)) {
        onClose();
        return;
      }
      const folderPath = (fromSource ?? source) === "series" && seriesPath ? seriesPath : rootPath;
      const params = new URLSearchParams({ folder_path: folderPath, type: profileType, filename });
      const res = await fetch(`${API_BASE}/api/profiles/profile?${params}`);
      const profile = await res.json();
      const content = profile.full_ai_summary?.trim()
        || `[No AI summary generated yet for ${name}. Open Profile Builder and click Generate on the Full AI Summary field.]`;
      onAdd({ type: chipType, name, content });
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  }

  // Filter suggested chips: only show ones not already attached
  const unattachedSuggested = suggested.filter(
    s => !existingChips.some(c => c.name === s.name && (c.type === s.type || c.type === `series_${s.type}`))
  );

  const typeColor = chipTypeColor(profileType);

  return (
    <div className="mb-3 rounded border border-indigo-800/50 bg-[#0a0a28] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-300">Attach Context</p>
        <button onClick={onClose} className="text-xs text-[#3f3f7a] hover:text-[#8888aa]">✕</button>
      </div>

      {/* Suggested chips -- ghost chips shown at top for quick attachment */}
      {unattachedSuggested.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-[#3f3f7a]">Suggested</p>
          <div className="flex flex-wrap gap-1">
            {unattachedSuggested.map(s => (
              <button
                key={`suggest-${s.filename}`}
                onClick={() => pickProfile(s.filename, s.name, "project")}
                disabled={adding === s.filename}
                className="rounded border border-dashed border-indigo-700/40 px-2 py-0.5 text-xs text-indigo-400/60 transition-colors hover:border-indigo-500 hover:text-indigo-300"
                title={`Suggested: ${s.name} (click to attach)`}
              >
                {adding === s.filename ? "..." : s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Source toggle: Project vs Series (only when project is in a series) */}
      {hasSeries && (
        <div className="mb-2 flex gap-1">
          <button
            onClick={() => setSource("project")}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              source === "project"
                ? "border-indigo-600 bg-indigo-900/30 text-indigo-300"
                : "border-[#1e1e4a] text-[#3f3f7a] hover:text-[#8888aa]"
            }`}
          >
            This Book
          </button>
          <button
            onClick={() => setSource("series")}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              source === "series"
                ? "border-teal-600 bg-teal-900/30 text-teal-300"
                : "border-[#1e1e4a] text-[#3f3f7a] hover:text-[#8888aa]"
            }`}
          >
            Series Profiles
          </button>
        </div>
      )}

      {/* Profile type tabs */}
      <div className="mb-2 flex flex-wrap gap-1">
        {CHIP_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setProfileType(t.id)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              profileType === t.id
                ? t.color
                : "border-[#1e1e4a] text-[#3f3f7a] hover:text-[#8888aa]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Profile list */}
      {loading ? (
        <p className="py-1 text-xs text-[#3f3f7a]">Loading...</p>
      ) : profiles.length === 0 ? (
        <p className="py-1 text-xs text-[#3f3f7a]">
          No {chipTypeLabel(profileType).toLowerCase()} profiles found
          {source === "series" ? " in this series" : " in this project"}.
        </p>
      ) : (
        <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
          {profiles.map(p => {
            const chipType = source === "series" ? `series_${profileType}` : profileType;
            const alreadyAdded = existingChips.some(c => c.name === p.name && c.type === chipType);
            return (
              <button
                key={p.filename}
                onClick={() => !alreadyAdded && pickProfile(p.filename, p.name)}
                disabled={alreadyAdded || adding === p.filename}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                  alreadyAdded
                    ? "text-[#3f3f7a]"
                    : "text-[#f0f0f5] hover:bg-indigo-600/20"
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full border ${typeColor}`} />
                {adding === p.filename
                  ? "Adding..."
                  : alreadyAdded
                  ? <><span className="opacity-50">{p.name}</span><span className="ml-auto text-emerald-600">✓</span></>
                  : p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


export default App;
