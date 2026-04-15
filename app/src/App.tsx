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
import { ProjectSettings } from "./screens/ProjectSettings";
import { ExportModal } from "./components/ExportModal";
import type { ProjectInfo, ChapterInfo, RecentProject, OutlineTemplateType } from "./types/project";
import type { ProfileType } from "./types/profile";
import type { ContextChip, EditorChatMessage, EditorChatCategory } from "./types/ai";
import { ChatMarkdown } from "./components/ChatMarkdown";
import { formatProfileForAI } from "./utils/profileFormat";
import { Bot, Send, ChevronDown, Settings2 } from "lucide-react";
import type { EditorView } from "@codemirror/view";

// The base URL for all API calls to the Python FastAPI backend.
const API_BASE = "http://localhost:8000";


// ── App Component ────────────────────────────────────────────────────────────
function App() {

  // ── ALL HOOKS FIRST -- before any conditional returns ─────────────────────

  // Which project is currently open. null = show home screen.
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);

  // Which top-level view is active: the writing editor, profile builder, or notes editor.
  // profileType tracks which tab was clicked so the ProfileBuilder opens on the right type.
  const [currentView, setCurrentView]   = useState<"editor" | "profiles" | "notes">("editor");
  const [profileType, setProfileType]   = useState<ProfileType>("character");

  // Settings modal visibility
  const [showSettings, setShowSettings] = useState(false);

  // Project settings modal visibility (separate from global Settings)
  const [showProjectSettings, setShowProjectSettings] = useState(false);

  // Export modal visibility
  const [showExportModal, setShowExportModal] = useState(false);

  // Outline template switcher dialog -- triggered by [+ New Template] in the
  // toolbar when notes/outline.md is the active file.
  const [showTemplateDialog, setShowTemplateDialog]       = useState(false);
  const [templateDialogChoice, setTemplateDialogChoice]   = useState<OutlineTemplateType>("novel");
  const [templateDialogLoading, setTemplateDialogLoading] = useState(false);

  // Project switcher dropdown
  const [showSwitcher, setShowSwitcher]   = useState(false);
  const [switcherProjects, setSwitcherProjects] = useState<RecentProject[]>([]);

  // Text currently selected in the editor -- drives the AI assistant panel
  const [selectedText, setSelectedText] = useState("");

  // Writing Companion (editor chat) state
  // null = no category selected (general chat mode); string = structured review mode
  const [chatCategory, setChatCategory] = useState<EditorChatCategory>(null);
  const [chatMessages, setChatMessages] = useState<EditorChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [chatError, setChatError]       = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Context chips -- profile summaries the writer explicitly attaches to AI requests.
  const [contextChips, setContextChips] = useState<ContextChip[]>([]);

  // ── Materials tracking ──────────────────────────────────────────────────────
  // These track what's already been sent in the current conversation so we
  // don't resend the same chapter text + chips on every turn. "Established"
  // means it was sent in a prior turn and is already in the conversation history.
  //
  // When the writer clicks Clear or switches categories, everything resets.
  // When new chips are added or a different text selection is made mid-convo,
  // only the NEW materials get sent on the next turn.

  // Toggle: whether to include the chapter text at all (default ON).
  // When OFF the AI responds based on the writer's message + any chips only.
  const [includeChapter, setIncludeChapter] = useState(true);

  // Set of chip keys (type+name) that have been sent in a prior turn.
  // These show as muted in the UI -- still "in play" but not re-sent.
  const [establishedChipKeys, setEstablishedChipKeys] = useState<Set<string>>(new Set());

  // True after chapter text has been sent at least once in this conversation.
  const [chapterEstablished, setChapterEstablished] = useState(false);

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

  // The note file currently open in the editor (e.g. outline.md, style-guide.md).
  const [currentNote, setCurrentNote] = useState<{ filename: string; title: string } | null>(null);

  // The content loaded from disk for the current note.
  const [noteContent, setNoteContent] = useState<string>("");

  // True while a note is being fetched from the backend.
  const [isLoadingNote, setIsLoadingNote] = useState(false);

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
  const currentNoteRef = useRef<{ filename: string; title: string } | null>(null);
  const currentViewRef = useRef<"editor" | "profiles" | "notes">("editor");

  // Keep refs in sync with state on every render.
  // This lets our event listeners (Ctrl+S) always see the latest values.
  currentChapterRef.current  = currentChapter;
  currentProjectRef.current  = currentProject;
  currentNoteRef.current     = currentNote;
  currentViewRef.current     = currentView;


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
      setCurrentView("editor");
      setIsDirty(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not load chapter.");
    } finally {
      setIsLoadingChapter(false);
    }
  }, []);


  // --- Load a note file from the backend ---
  // Same pattern as loadChapter but reads from notes/ instead of manuscript/.
  // Switches the center panel to notes view.
  const loadNote = useCallback(async (filename: string, title: string, project: ProjectInfo | null) => {
    if (!project) return;

    setIsLoadingNote(true);
    setEditorError(null);

    try {
      const params = new URLSearchParams({
        folder_path: project.root_path,
        filename,
      });

      const response = await fetch(`${API_BASE}/api/documents/note?${params}`);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Failed to load note.");
      }

      const data = await response.json();

      setNoteContent(data.content);
      setCurrentNote({ filename, title });
      setCurrentView("notes");
      setIsDirty(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not load note.");
    } finally {
      setIsLoadingNote(false);
    }
  }, []);


  // --- Create a new chapter file and open it in the editor ---
  const handleCreateChapter = useCallback(async () => {
    if (!currentProject) return;

    const title = window.prompt("Chapter title:", `Chapter ${chapters.length + 1}`);
    if (!title || !title.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/documents/create-chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: currentProject.root_path,
          title: title.trim(),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Failed to create chapter.");
      }

      const data = await response.json();
      const newChapter: ChapterInfo = {
        filename: data.filename,
        title: data.title,
        path: data.path,
      };

      // Add to chapter list and open it
      setChapters((prev) => [...prev, newChapter].sort((a, b) => a.filename.localeCompare(b.filename)));
      loadChapter(newChapter, currentProject);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not create chapter.");
    }
  }, [currentProject, chapters.length, loadChapter]);


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


  // --- Save the current document (chapter or note) to disk ---
  // Reads the current editor content and POSTs it to the appropriate backend endpoint.
  // The view ref tells us whether we're saving a chapter or a note.
  const handleSave = useCallback(async () => {
    const view    = editorViewRef.current;
    const project = currentProjectRef.current;
    const activeView = currentViewRef.current;

    if (!view || !project) return;

    // Determine which endpoint and filename to use based on the active view
    const note    = currentNoteRef.current;
    const chapter = currentChapterRef.current;

    let endpoint: string;
    let filename: string;

    if (activeView === "notes" && note) {
      endpoint = `${API_BASE}/api/documents/note`;
      filename = note.filename;
    } else if (chapter) {
      endpoint = `${API_BASE}/api/documents/chapter`;
      filename = chapter.filename;
    } else {
      return; // Nothing to save
    }

    const content = view.state.doc.toString();
    setEditorError(null);

    try {
      const response = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          folder_path: project.root_path,
          filename,
          content,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail ?? "Save failed.");
      }

      setIsDirty(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save.");
    }
  }, []);


  // --- Apply a new outline template (overwrites notes/outline.md) ---
  // Called from the template-switch confirmation dialog. Sends the chosen
  // template type to the backend, which regenerates outline.md and returns
  // the new content so we can reload the editor without a full refresh.
  const handleApplyTemplate = useCallback(async () => {
    const project = currentProjectRef.current;
    if (!project) return;

    setTemplateDialogLoading(true);
    setEditorError(null);

    try {
      const res = await fetch(`${API_BASE}/api/projects/apply-outline-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_path:     project.root_path,
          template_type: templateDialogChoice,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Failed to apply template.");
      }

      const data = await res.json();

      // Reload the outline in the notes editor. Setting noteContent + toggling
      // currentNote triggers a MarkdownEditor remount via the key prop.
      setNoteContent(data.content);
      setCurrentNote({ filename: "outline.md", title: "Outline" });
      setIsDirty(false);
      setShowTemplateDialog(false);

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not apply template.");
    } finally {
      setTemplateDialogLoading(false);
    }
  }, [templateDialogChoice]);


  // --- Send a message in the Writing Companion chat ---
  // Only sends materials (chapter text + context chips) that are NEW -- things
  // the AI hasn't seen yet in this conversation. Materials from prior turns are
  // already in the conversation history and don't need to be resent.
  //
  // "Established" = sent in a prior turn (muted in UI, still in AI memory).
  // "New"         = first time being sent (bright in UI, included in payload).
  const sendEditorChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;

    // ── Determine what text to send (if any) ──────────────────────────────
    // Selected text is always "new" (it's a fresh passage the writer highlighted).
    // Full chapter text is sent only if: toggle is ON and it hasn't been established yet.
    const selected = selectedText.trim();
    let textContent = "";
    let isFullChapter = false;

    if (selected) {
      // Writer highlighted specific text -- always send it (it's new context)
      textContent = selected;
      isFullChapter = false;
    } else if (includeChapter && !chapterEstablished) {
      // No selection, chapter toggle ON, chapter not yet sent in this convo
      const view = editorViewRef.current;
      if (view) {
        textContent = view.state.doc.toString();
        isFullChapter = true;
      }
    }
    // Otherwise: no text sent. Either toggle is OFF, or chapter was already
    // established in a prior turn. The AI still has it from history.

    // ── Determine which chips are new ─────────────────────────────────────
    // Only send chips that haven't been established yet in this conversation.
    const newChips = contextChips.filter(
      chip => !establishedChipKeys.has(`${chip.type}:${chip.name}`)
    );

    const userMsg: EditorChatMessage = { role: "user", content: chatInput.trim() };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch(`${API_BASE}/api/ai/editor-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          category:        chatCategory ?? "chat",
          text_content:    textContent,
          is_full_chapter: isFullChapter,
          messages:        newMessages,
          context_chips:   newChips,
          model_id:        currentProjectRef.current?.default_model || undefined,
          content_mode:    currentProjectRef.current?.content_mode_default ?? "general",
          project_path:    currentProjectRef.current?.root_path ?? null,
        }),
      });

      if (!res.ok) {
        let detail = `Server returned ${res.status}.`;
        try {
          const errBody = await res.json();
          detail = errBody.detail ?? detail;
        } catch {
          if (res.status === 502 || res.status === 503) {
            detail = "The AI service returned an error. The text may exceed the model's context window.";
          }
        }
        throw new Error(detail);
      }

      const data = await res.json();
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

      // ── Mark materials as established after successful send ────────────
      // These will show as muted in the UI and won't be resent on future turns.
      if (textContent) {
        setChapterEstablished(true);
      }
      if (newChips.length > 0) {
        setEstablishedChipKeys(prev => {
          const next = new Set(prev);
          for (const chip of newChips) next.add(`${chip.type}:${chip.name}`);
          return next;
        });
      }

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setChatError("Request timed out after 90 seconds. Try a shorter text selection.");
      } else if (err instanceof TypeError && err.message.toLowerCase().includes("failed to fetch")) {
        setChatError("Could not reach the backend. Check that it is running on port 8000.");
      } else {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
      }
    } finally {
      clearTimeout(timeoutId);
      setChatLoading(false);
    }
  }, [chatInput, chatMessages, chatCategory, selectedText, contextChips, chatLoading, includeChapter, chapterEstablished, establishedChipKeys]);


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

        <div className="border-b border-[#1e1e4a] px-4 py-4">
          <h1 className="text-lg font-semibold tracking-wide text-[#f0f0f5]">
            StoryForge
          </h1>

          {/* Project title + switcher dropdown + settings gear */}
          <div className="relative mt-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  // Fetch recent projects when opening the switcher
                  if (!showSwitcher) {
                    fetch(`${API_BASE}/api/projects/recent`)
                      .then(r => r.ok ? r.json() : [])
                      .then(data => setSwitcherProjects(Array.isArray(data) ? data : []))
                      .catch(() => setSwitcherProjects([]));
                  }
                  setShowSwitcher(s => !s);
                }}
                className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-[#12122e]"
                title="Switch to a different project"
              >
                <span className="truncate text-xs text-[#8888aa]">{currentProject.title}</span>
                <ChevronDown size={10} className="shrink-0 text-[#3f3f7a]" />
              </button>
              <button
                onClick={() => setShowProjectSettings(true)}
                className="shrink-0 rounded p-1 text-[#3f3f7a] transition-colors hover:bg-[#12122e] hover:text-[#8888aa]"
                title="Project settings"
              >
                <Settings2 size={12} />
              </button>
            </div>

            {/* Project switcher dropdown */}
            {showSwitcher && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded border border-[#1e1e4a] bg-[#0d0d2b] shadow-xl">
                {switcherProjects.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-[#3f3f7a]">No recent projects</p>
                ) : (
                  switcherProjects.filter(p => p.exists).map(rp => (
                    <button
                      key={rp.project_id}
                      onClick={async () => {
                        setShowSwitcher(false);
                        if (rp.root_path === currentProject.root_path) return;
                        try {
                          const res = await fetch(`${API_BASE}/api/projects/open`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ folder_path: rp.root_path }),
                          });
                          if (!res.ok) throw new Error("Failed to switch.");
                          const proj: ProjectInfo = await res.json();
                          handleProjectOpen(proj);
                        } catch {
                          // Fallback: go to ProjectHome
                          setCurrentProject(null);
                        }
                      }}
                      className={`w-full px-3 py-2 text-left text-xs transition-colors hover:bg-[#12122e] ${
                        rp.root_path === currentProject.root_path
                          ? "text-indigo-300"
                          : "text-[#f0f0f5]"
                      }`}
                    >
                      <p className="truncate font-medium">{rp.title}</p>
                      {rp.series_name && (
                        <p className="truncate text-[#3f3f7a]">{rp.series_name}</p>
                      )}
                    </button>
                  ))
                )}
                <div className="border-t border-[#1e1e4a]">
                  <button
                    onClick={() => { setShowSwitcher(false); setCurrentProject(null); }}
                    className="w-full px-3 py-2 text-left text-xs text-[#3f3f7a] transition-colors hover:bg-[#12122e] hover:text-[#8888aa]"
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
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
                  // Don't reload if this chapter is already open AND we're in editor view.
                  // If we're in notes/profiles view, always switch back to the editor.
                  if (currentView !== "editor" || currentChapter?.filename !== chapter.filename) {
                    loadChapter(chapter, currentProject);
                  }
                }}
              />
            ))}
          </NavSection>

          <NavSection label="Notes">
            <NavItem label="Outline"     hint="Story structure and plot notes"
              active={currentView === "notes" && currentNote?.filename === "outline.md"}
              onClick={() => loadNote("outline.md", "Outline", currentProject)} />
            <NavItem label="Style Guide" hint="Rules for tone, voice, and punctuation"
              active={currentView === "notes" && currentNote?.filename === "style-guide.md"}
              onClick={() => loadNote("style-guide.md", "Style Guide", currentProject)} />
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


      {/* ── CENTER PANEL: Writing Editor (chapters or notes) ─────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Title bar + save indicator -- shows chapter title or note title */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e4a] bg-[#0d0d2b] px-4 py-2">
          <span className="text-sm font-medium text-[#f0f0f5]">
            {currentView === "notes"
              ? (currentNote ? currentNote.title : "No note open")
              : (currentChapter ? currentChapter.title : "No chapter open")}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateChapter}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-emerald-500 hover:text-emerald-400"
              title="Create a new chapter in manuscript/"
            >
              + New Chapter
            </button>
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
              disabled={!isDirty || (currentView === "notes" ? !currentNote : !currentChapter)}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5] disabled:cursor-not-allowed disabled:opacity-40"
              title="Save to disk (Ctrl+S)"
            >
              Save
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="rounded border border-[#1e1e4a] px-2 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-[#f0f0f5]"
              title="Export manuscript to the exports/ folder"
            >
              Export
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

        {/* Formatting toolbar -- onNewTemplate only passed when outline.md is
            the active file so the [+ New Template] button appears contextually */}
        <EditorToolbar
          editorView={editorView}
          currentFont={currentFont}
          onFontChange={setCurrentFont}
          onNewTemplate={
            currentView === "notes" && currentNote?.filename === "outline.md"
              ? () => setShowTemplateDialog(true)
              : undefined
          }
        />

        {/* Editor area -- renders either a chapter or a note depending on currentView */}
        <div className="flex-1 overflow-hidden">
          {currentView === "notes" ? (
            // ── Notes editor ──
            isLoadingNote ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-[#8888aa]">Loading note...</p>
              </div>
            ) : currentNote ? (
              // key includes "note-" prefix so switching between a chapter and note
              // with the same filename still triggers a remount.
              <MarkdownEditor
                key={`note-${currentNote.filename}`}
                defaultValue={noteContent}
                onChange={handleContentChange}
                font={currentFont}
                onEditorReady={(view) => {
                  setEditorView(view);
                  editorViewRef.current = view;
                }}
                onSelectionChange={setSelectedText}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-[#8888aa]">
                  Select a note from the left panel.
                </p>
              </div>
            )
          ) : (
            // ── Chapter editor ──
            isLoadingChapter ? (
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
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-[#8888aa]">
                  Select a chapter from the left panel to start writing.
                </p>
              </div>
            )
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Writing Companion ──────────────────────────────── */}
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-[#1e1e4a] bg-[#0d0d2b]">

        {/* Header + clear */}
        <div className="border-b border-[#1e1e4a] px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#f0f0f5]">Writing Companion</h2>
            {chatMessages.length > 0 && (
              <button
                onClick={() => { setChatMessages([]); setChatError(null); setEstablishedChipKeys(new Set()); setChapterEstablished(false); }}
                className="text-xs text-rose-700 transition-colors hover:text-rose-400"
                title="Clear conversation"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[#8888aa]">
            {chatCategory
              ? `Focus: ${chatCategory}. Click tab again to return to general chat.`
              : "General chat. Click a tab for structured feedback."}
          </p>
        </div>

        {/* Category tabs -- toggleable: click active tab to deselect (return to general chat) */}
        <div className="border-b border-[#1e1e4a] px-4 py-2">
          <div className="flex gap-1">
            {(["readability", "structure", "context"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  if (chatCategory === tab) {
                    // Toggle off: return to general chat (no clearing)
                    setChatCategory(null);
                  } else {
                    // Switch categories: clear chat + reset materials tracking
                    if (chatCategory !== null) {
                      setChatMessages([]);
                      setChatError(null);
                      setEstablishedChipKeys(new Set());
                      setChapterEstablished(false);
                    }
                    setChatCategory(tab);
                  }
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  chatCategory === tab ? "bg-indigo-600 text-white" : "text-[#8888aa] hover:text-[#f0f0f5]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Context indicator -- what text the AI will see + chapter toggle */}
        <div className="shrink-0 border-b border-[#1e1e4a] px-4 py-2">
          {selectedText ? (
            // Writer has text selected -- that always gets sent (bright)
            <p className={`truncate text-xs ${chapterEstablished ? "text-emerald-700" : "text-emerald-400"}`} title={selectedText}>
              {chapterEstablished ? "Selection (new context)" : "Using selected text"} ({selectedText.length.toLocaleString()} chars)
            </p>
          ) : currentChapter ? (
            // No selection -- show chapter toggle
            <div className="flex items-center justify-between">
              <p className={`text-xs ${
                !includeChapter
                  ? "text-[#3f3f7a]"
                  : chapterEstablished
                    ? "text-amber-700"
                    : "text-amber-400"
              }`}>
                {!includeChapter
                  ? "Chapter text not included"
                  : chapterEstablished
                    ? "Chapter text (established)"
                    : "Full chapter will be sent"}
              </p>
              <label
                className="flex cursor-pointer items-center gap-1.5"
                title="When off, AI responds based on your message and attached context only"
              >
                <span className="text-xs text-[#3f3f7a]">Include chapter</span>
                <div
                  className={`relative h-4 w-7 rounded-full transition-colors ${includeChapter ? "bg-indigo-600" : "bg-[#1e1e4a]"}`}
                  onClick={() => setIncludeChapter(v => !v)}
                >
                  <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${includeChapter ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </div>
              </label>
            </div>
          ) : (
            <p className="text-xs text-[#3f3f7a]">
              Open a chapter to start
            </p>
          )}
        </div>

        {/* Context chips -- always visible on all tabs */}
        <div className="shrink-0 border-b border-[#1e1e4a] px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs text-[#8888aa]">
              Context: {contextChips.length === 0 ? "none attached" : `${contextChips.length} profile${contextChips.length > 1 ? "s" : ""}`}
            </p>
            <button
              onClick={() => setShowChipPicker(prev => !prev)}
              className="rounded border border-[#1e1e4a] px-1.5 py-0.5 text-xs text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300"
              title="Attach a profile as context"
            >
              + Add
            </button>
          </div>

          {showChipPicker && currentProject && (
            <ChipPicker
              rootPath={currentProject.root_path}
              seriesPath={currentProject.series_path}
              existingChips={contextChips}
              onAdd={(chip) => { setContextChips(prev => [...prev, chip]); setShowChipPicker(false); }}
              onClose={() => setShowChipPicker(false)}
            />
          )}

          {contextChips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contextChips.map((chip, i) => {
                // Established chips (already sent in a prior turn) show muted --
                // they're still "in play" in the AI's memory from the conversation
                // history, but won't be resent. New chips show bright/full color.
                const isEstablished = establishedChipKeys.has(`${chip.type}:${chip.name}`);
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-opacity ${chipTypeColor(chip.type)} ${isEstablished ? "opacity-40" : ""}`}
                    title={isEstablished ? `${chip.name} (established -- already in conversation)` : chip.name}
                  >
                    {chip.name}
                    <button
                      onClick={() => setContextChips(prev => prev.filter((_, j) => j !== i))}
                      className="text-[#3f3f7a] hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Empty state with tab-specific suggestions */}
          {chatMessages.length === 0 && !chatLoading && !chatError && (
            <div className="flex flex-col items-center gap-3 pt-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-900/40 text-indigo-400">
                <Bot size={20} />
              </div>
              <p className="text-sm font-medium text-[#8888aa]">Writing Companion</p>
              <div className="w-full rounded border border-[#1e1e4a] bg-[#070724] p-2.5 text-left">
                <p className="mb-1 text-xs font-medium text-[#8888aa]">Try asking:</p>
                {(chatCategory === null ? [
                  "What do you think of this passage?",
                  "Help me brainstorm what happens next",
                  "How could I make this scene stronger?",
                ] : chatCategory === "readability" ? [
                  "Check this paragraph for grammar issues",
                  "Is this passage too wordy?",
                  "How can I make this clearer?",
                ] : chatCategory === "structure" ? [
                  "Does the dialogue sound natural?",
                  "Is the POV consistent here?",
                  "How's the pacing in this section?",
                ] : [
                  "Is this character behaving consistently?",
                  "Does this match the setting we established?",
                  "Check for lore contradictions",
                ]).map(q => (
                  <button
                    key={q}
                    onClick={() => setChatInput(q)}
                    className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-[#3f3f7a] transition-colors hover:bg-[#1e1e4a] hover:text-[#8888aa]"
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-900/60 text-indigo-400">
                  <Bot size={11} />
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "rounded-tr-sm bg-indigo-600 text-white"
                  : "rounded-tl-sm border border-[#1e1e4a] bg-[#12122e] text-[#f0f0f5]"
              }`}>
                {msg.role === "user" ? (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  <ChatMarkdown content={msg.content} />
                )}
              </div>
              {msg.role === "user" && (
                <div className="ml-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-800/60 text-indigo-300">
                  <span className="text-xs font-bold">W</span>
                </div>
              )}
            </div>
          ))}

          {chatLoading && (
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              Thinking...
            </div>
          )}

          {chatError && (
            <div className="rounded border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{chatError}</p>
              {chatError.includes("API key") && (
                <button onClick={() => setShowSettings(true)} className="mt-1 text-xs text-indigo-400 underline">
                  Open Settings
                </button>
              )}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="border-t border-[#1e1e4a] p-3">
          <div className="relative flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                const maxH = 7 * 20 + 12;
                el.style.height = Math.min(el.scrollHeight, maxH) + "px";
                el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendEditorChat();
                }
              }}
              placeholder={currentChapter ? "Ask about your writing... (Enter to send)" : "Open a chapter first"}
              disabled={!currentChapter || chatLoading}
              rows={3}
              style={{ resize: "none", overflowY: "hidden" }}
              className="flex-1 rounded border border-[#1e1e4a] bg-[#1e1e48] px-2 py-2 text-xs text-[#f0f0f5] placeholder-[#6666a0] outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              onClick={sendEditorChat}
              disabled={!currentChapter || !chatInput.trim() || chatLoading}
              className="flex items-center justify-center rounded border border-[#1e1e4a] p-1.5 text-[#8888aa] transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* Settings modal -- rendered as an overlay on top of everything */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* Project settings modal */}
      {showProjectSettings && currentProject && (
        <ProjectSettings
          project={currentProject}
          onClose={() => setShowProjectSettings(false)}
          onProjectUpdated={(updated) => {
            setCurrentProject(updated);
            setShowProjectSettings(false);
          }}
        />
      )}

      {/* Export modal */}
      {showExportModal && currentProject && (
        <ExportModal
          project={currentProject}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Outline template switch dialog -- shown when the writer clicks
          [+ New Template] in the toolbar while editing notes/outline.md.
          Lets them pick Novel or Short Story, warns about overwrite, and
          calls the backend to regenerate the outline file. */}
      {showTemplateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-[#1e1e4a] bg-[#0d0d2b] p-6 shadow-xl">
            <h2 className="mb-1 text-sm font-semibold text-[#f0f0f5]">
              Apply Outline Template
            </h2>
            <p className="mb-4 text-xs text-[#8888aa]">
              Choose a template to regenerate <span className="text-[#f0f0f5]">notes/outline.md</span>.
            </p>

            {/* Warning banner */}
            <div className="mb-4 rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2">
              <p className="text-xs font-medium text-amber-400">
                This will overwrite the current outline.
              </p>
              <p className="mt-0.5 text-xs text-amber-600">
                Any existing content in outline.md will be replaced. This cannot be undone.
              </p>
            </div>

            {/* Template radio options */}
            <div className="mb-4 flex flex-col gap-1.5">
              {([
                { value: "novel" as OutlineTemplateType, label: "Novel", hint: "Full novel scaffold with three-act structure. Good for fiction and fantasy." },
                { value: "short_story" as OutlineTemplateType, label: "Short Story", hint: "Tight 2k-10k scaffold with Seven-Point, Freytag, and more. Pick one, delete the rest." },
              ]).map(opt => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 rounded border border-[#1e1e4a] bg-[#12122e] p-2 transition-colors hover:border-[#3f3f7a]"
                >
                  <input
                    type="radio"
                    name="templateSwitch"
                    value={opt.value}
                    checked={templateDialogChoice === opt.value}
                    onChange={() => setTemplateDialogChoice(opt.value)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <div>
                    <p className="text-xs font-medium text-[#f0f0f5]">{opt.label}</p>
                    <p className="text-xs text-[#8888aa]">{opt.hint}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleApplyTemplate}
                disabled={templateDialogLoading}
                className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {templateDialogLoading ? "Applying..." : "Apply Template"}
              </button>
              <button
                onClick={() => setShowTemplateDialog(false)}
                disabled={templateDialogLoading}
                className="rounded border border-[#1e1e4a] px-4 py-2 text-sm text-[#8888aa] transition-colors hover:border-[#3f3f7a] hover:text-[#f0f0f5]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
  // Notes -- outline and style guide documents from the notes/ folder
  { id: "note",                   label: "Note",                   color: "text-rose-300    border-rose-700/50    bg-rose-900/20"    },
  // Series canonical profiles -- attached from the series source toggle in ChipPicker
  { id: "series_character",       label: "Series Character",       color: "text-indigo-200 border-indigo-600/50 bg-indigo-800/20"  },
  { id: "series_relationship",    label: "Series Relationship",    color: "text-violet-200  border-violet-600/50  bg-violet-800/20"  },
  { id: "series_location",        label: "Series Location",        color: "text-teal-200    border-teal-600/50    bg-teal-800/20"    },
  { id: "series_lore",            label: "Series Lore",            color: "text-amber-200   border-amber-600/50   bg-amber-800/20"   },
];

// Known note files in the project's notes/ folder.
// These are created by the project init and can be attached as context chips.
const NOTE_FILES = [
  { filename: "outline.md",      name: "Outline" },
  { filename: "style-guide.md",  name: "Style Guide" },
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
      // Format the full profile (traits + overview + notes) for AI context.
      // Uses the same formatter as Profile Builder chat so both paths send
      // consistent, importance-labeled content -- not the AI summary.
      const content = formatProfileForAI(profile);
      onAdd({ type: chipType, name, content });
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  }

  // Fetch a note file's content and attach it as a "note" context chip.
  // Uses the /api/documents/note endpoint instead of the profiles API.
  async function pickNote(filename: string, name: string) {
    setAdding(filename);
    try {
      if (existingChips.some(c => c.name === name && c.type === "note")) {
        onClose();
        return;
      }
      const params = new URLSearchParams({ folder_path: rootPath, filename });
      const res = await fetch(`${API_BASE}/api/documents/note?${params}`);
      if (!res.ok) {
        onClose();
        return;
      }
      const data = await res.json();
      const content = (data.content || "").trim()
        || `[${name} is empty. Open it from the sidebar Notes section and add content.]`;
      onAdd({ type: "note", name, content });
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

      {/* Profile type tabs + Notes tab */}
      <div className="mb-2 flex flex-wrap gap-1">
        {/* Profile type tabs -- only show directly pickable types (not series_* or note) */}
        {CHIP_TYPES.filter(t => !t.id.startsWith("series_") && t.id !== "note").map(t => (
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
        {/* Notes tab -- shows outline and style guide from the notes/ folder */}
        <button
          onClick={() => setProfileType("notes")}
          className={`rounded border px-2 py-0.5 text-xs transition-colors ${
            profileType === "notes"
              ? "text-rose-300 border-rose-700/50 bg-rose-900/20"
              : "border-[#1e1e4a] text-[#3f3f7a] hover:text-[#8888aa]"
          }`}
        >
          Notes
        </button>
      </div>

      {/* Content list -- either profiles or notes depending on active tab */}
      {profileType === "notes" ? (
        // Notes list: hardcoded note files from the project's notes/ folder
        <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
          {NOTE_FILES.map(n => {
            const alreadyAdded = existingChips.some(c => c.name === n.name && c.type === "note");
            return (
              <button
                key={n.filename}
                onClick={() => !alreadyAdded && pickNote(n.filename, n.name)}
                disabled={alreadyAdded || adding === n.filename}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                  alreadyAdded
                    ? "text-[#3f3f7a]"
                    : "text-[#f0f0f5] hover:bg-indigo-600/20"
                }`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full border text-rose-300 border-rose-700/50 bg-rose-900/20" />
                {adding === n.filename
                  ? "Adding..."
                  : alreadyAdded
                  ? <><span className="opacity-50">{n.name}</span><span className="ml-auto text-emerald-600">✓</span></>
                  : n.name}
              </button>
            );
          })}
        </div>
      ) : loading ? (
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
