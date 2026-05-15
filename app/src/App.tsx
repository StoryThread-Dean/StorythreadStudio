// App.tsx -- The Root Layout Component
// ======================================
// This is the top-level component of Storythread Studio's frontend.
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
import { ReaderMode } from "./screens/ReaderMode";
import { ProfileBuilder } from "./screens/ProfileBuilder";
import { SummaryView }    from "./components/SummaryView";
import { SceneSummaryView } from "./components/SceneSummaryView";
import { SceneSummaryPreviewModal } from "./components/SceneSummaryPreviewModal";
import { RightPanelResizer, useRightPanelWidth, RIGHT_PANEL_CLASS } from "./components/RightPanelResizer";
import { Settings } from "./screens/Settings";
import { ProjectSettings } from "./screens/ProjectSettings";
import { ExportModal } from "./components/ExportModal";
import type { ProjectInfo, ChapterInfo, RecentProject, OutlineTemplateType } from "./types/project";
import type { ProfileType, Profile } from "./types/profile";
import type {
  ContextChip, ChipIncludeFlags, EditorChatMessage,
  SceneSummaryInfo, SplitChapterScenesResponse, GenerateSceneSummaryResponse,
} from "./types/ai";
import { ChatMarkdown } from "./components/ChatMarkdown";
import { formatProfileForAI, DEFAULT_CHIP_INCLUDE, estimateTokens } from "./utils/profileFormat";
import type { ChipIncludeOptions } from "./utils/profileFormat";
import { SECTION_CONFIGS } from "./types/profile";
import { EditorAdvisorBar } from "./components/editor/EditorAdvisorBar";
import { IssuePopover } from "./components/editor/IssuePopover";
import { ISSUE_CLICK_EVENT, clearIssuesEffect } from "./components/editor/issueOverlay";
import type { LocatedIssue, IssueClickDetail } from "./components/editor/issueOverlay";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useDonationState } from "./hooks/useDonationState";
import { useFreshVersion } from "./hooks/useFreshVersion";
import { UpdateBanner } from "./components/update/UpdateBanner";
import { UpdateModal } from "./components/update/UpdateModal";
import { PostUpdateBanner } from "./components/update/PostUpdateBanner";
import { AboutPanel } from "./components/about/AboutPanel";
import { DonationPrompt } from "./components/about/DonationPrompt";
import { useBackendHealth } from "./hooks/useBackendHealth";
import { initTheme } from "./hooks/useTheme";
import { initUiScale } from "./hooks/useUiScale";
import { ThemeToggle } from "./components/ThemeToggle";
import { Bot, Send, ChevronDown, Settings2, Trash2 } from "lucide-react";
import type { EditorView } from "@codemirror/view";

// The base URL for all API calls to the Python FastAPI backend.
const API_BASE = "http://localhost:8000";


// Count whitespace-separated tokens in a string. Trim first so a trailing
// newline doesn't contribute a phantom word. Markdown syntax (**bold**, `---`)
// is counted as it appears -- not perfect, but matches what a writer sees
// and stays consistent with countWords() in ProfileBuilder.
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}


// ── App Component ────────────────────────────────────────────────────────────
function App() {

  // ── ALL HOOKS FIRST -- before any conditional returns ─────────────────────

  // Which project is currently open. null = show home screen.
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);

  // Phase 6: poll the backend /health endpoint in the background so we can
  // show one clear "backend not responding" banner instead of letting every
  // feature fail with its own cryptic fetch error.
  const backendHealth = useBackendHealth();
  // Dismiss button for the banner. Writer dismissal survives only until the
  // backend flips state again (goes down after being up, or back up after
  // being down) -- so a dismissed banner reappears if the situation changes.
  const [backendBannerDismissedAt, setBackendBannerDismissedAt] = useState<number | null>(null);

  // Which top-level view is active: the writing editor, profile builder, notes
  // editor, or chapter-summary editor. ProfileBuilder gets "profiles" because
  // it's a completely separate screen; chapter_summary is rendered in the
  // main layout (keeps the left nav mounted) so its value is a peer of editor/notes.
  const [currentView, setCurrentView]   = useState<
    "editor" | "profiles" | "notes" | "chapter_summary" | "scene_summary"
  >("editor");
  const [profileType, setProfileType]   = useState<ProfileType>("character");

  // --- Manuscript tree state (Phase 6) ---
  // expandedChapters: which chapter rows show their Chapter Summary child.
  //   A Set makes add/remove O(1).
  // currentSummaryChapter: which chapter's summary is open (null when not in
  //   summary view). Used both to load the right summary file and to give the
  //   parent chapter row a subtle highlight while the child summary is active.
  const [expandedChapters, setExpandedChapters]           = useState<Set<string>>(new Set());
  const [currentSummaryChapter, setCurrentSummaryChapter] = useState<string | null>(null);

  // Scene summaries (Phase 6):
  //   - sceneSummariesByChapter: per-chapter list of filled scene slots, so
  //     the sidebar grandchildren know which Scene N rows to show. The map
  //     key is the chapter filename; a missing key means "not fetched yet".
  //   - expandedSceneGroups: which chapters have their "Scene Summaries"
  //     subtree expanded in the sidebar. Kept separate from expandedChapters
  //     so expanding the chapter doesn't force-expand the scenes list too.
  //   - currentSummaryScene: which {chapter, index} is open in SceneSummaryView.
  //   - autoSplitProgress: text shown by the EditorToolbar button while the
  //     auto-split loop is running ("Scene 3 of 7..."). null when idle.
  //   - sceneOverwritePrompt: the currently-showing confirm dialog for the
  //     auto-split overwrite flow. null when no prompt is active.
  //   - showSceneSummaryModal: selection-based preview modal, null when closed.
  const [sceneSummariesByChapter, setSceneSummariesByChapter] = useState<
    Map<string, SceneSummaryInfo[]>
  >(new Map());
  const [expandedSceneGroups, setExpandedSceneGroups] = useState<Set<string>>(new Set());
  const [currentSummaryScene, setCurrentSummaryScene] = useState<
    { chapterFile: string; index: number } | null
  >(null);
  const [autoSplitProgress, setAutoSplitProgress] = useState<string | null>(null);
  const [sceneOverwritePrompt, setSceneOverwritePrompt] = useState<
    { index: number; title: string; total: number; onAnswer: (answer: "yes" | "no" | "cancel") => void } | null
  >(null);
  const [showSceneSummaryModal, setShowSceneSummaryModal] = useState<
    { chapterFile: string; chapterPath: string; selectedText: string; existingScenes: SceneSummaryInfo[] } | null
  >(null);

  // Writing Companion panel width -- toggle between compact and wide, persisted
  // to localStorage so the writer's preference survives restarts.
  const writingCompanionPanel = useRightPanelWidth("storythread.writingCompanion.width");

  // Settings modal visibility
  const [showSettings, setShowSettings] = useState(false);

  // Auto-update + donation + about-panel UI state. Bundled here so the
  // entire end-of-render-tree set of banners and modals can be wired up
  // from one place. The actual logic lives in useAppUpdate / useDonationState
  // / useFreshVersion -- this state just controls modal visibility.
  const [showAboutPanel, setShowAboutPanel]   = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // Auto-update orchestration. Runs a launch-time check (production only),
  // exposes the available update + download/install actions.
  const appUpdate = useAppUpdate();

  // Donation prompts + donor flag. shouldShowPrompt fires every 30-50
  // launches when the user isn't a donor; the prompt suppresses itself
  // once the writer marks themselves as a donor or dismisses.
  const donation = useDonationState();

  // First-run-after-update detection. isFreshVersion is true exactly on
  // the first launch following an upgrade. Acknowledged by clicking the
  // banner's "Got it" button, which writes the new version to localStorage.
  const freshVersion = useFreshVersion();

  // Project settings modal visibility (separate from global Settings)
  const [showProjectSettings, setShowProjectSettings] = useState(false);

  // Export modal visibility
  const [showExportModal, setShowExportModal] = useState(false);

  // Reader Mode overlay visibility
  const [showReaderMode, setShowReaderMode] = useState(false);

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
  // The category-tab system was removed in the Smart Advisor redesign;
  // structured Readability/Structure/Context feedback now renders as inline
  // editor highlights via EditorAdvisorBar, not as chat replies. The chat
  // panel is always in general-chat mode.
  const [chatMessages, setChatMessages] = useState<EditorChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const [chatError, setChatError]       = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Smart Advisor state. Currently-active issues are owned by the editor's
  // StateField (see components/editor/issueOverlay.ts); we mirror just the
  // count here for the toolbar's pill and Done button. The popover state
  // captures which issues to render and where to anchor the popover after a
  // click on a highlight; null = popover closed.
  const [issueCount, setIssueCount] = useState(0);
  const [issuePopover, setIssuePopover] = useState<IssueClickDetail | null>(null);

  // --- Cancel-in-flight chat request ---
  // chatAbortRef holds the AbortController for the currently running fetch so
  // a [Cancel] button can tear it down. chatCanCancel flips to true after 20s
  // of waiting so the button only appears once the writer has genuinely been
  // left hanging (prevents button-flicker on fast responses). chatManualCancelRef
  // lets the catch block tell the difference between "user cancelled" and
  // "timed out after 180s" so we can show the right error message.
  const chatAbortRef        = useRef<AbortController | null>(null);
  const chatManualCancelRef = useRef(false);
  const [chatCanCancel, setChatCanCancel] = useState(false);
  // Tracks which model is handling the current request so the "Thinking..."
  // indicator can show something like "google/gemini-2.5-pro..." instead of
  // a blank spinner. Set from the request payload, confirmed from the response.
  const [chatModelUsed, setChatModelUsed] = useState<string | null>(null);

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

  // Word count for the active document (chapter or note). Recomputed on chapter
  // load and on every successful save. Zero when nothing is open. Displayed
  // in the title bar so the writer can watch the number move as they write +
  // save. Deliberately not live-per-keystroke -- saving is the moment the
  // writer cares about measuring progress, and live counts tend to be noise.
  const [wordCount, setWordCount] = useState<number>(0);

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
  const currentViewRef = useRef<
    "editor" | "profiles" | "notes" | "chapter_summary" | "scene_summary"
  >("editor");

  // Keep refs in sync with state on every render.
  // This lets our event listeners (Ctrl+S) always see the latest values.
  currentChapterRef.current  = currentChapter;
  currentProjectRef.current  = currentProject;
  currentNoteRef.current     = currentNote;
  currentViewRef.current     = currentView;


  // Smart Advisor: subscribe to issue-click events from the editor's DOM.
  // The issueOverlay extension dispatches a CustomEvent whenever a writer
  // clicks a highlighted issue; we capture the click coordinates + issue ids
  // and open the IssuePopover at that position. Re-attaches when the editor
  // view changes (chapter switch).
  useEffect(() => {
    if (!editorView) return;
    const target = editorView.dom;
    function onIssueClick(e: Event) {
      const ce = e as CustomEvent<IssueClickDetail>;
      if (ce.detail) setIssuePopover(ce.detail);
    }
    target.addEventListener(ISSUE_CLICK_EVENT, onIssueClick);
    return () => target.removeEventListener(ISSUE_CLICK_EVENT, onIssueClick);
  }, [editorView]);

  // When the writer switches chapters, drop any stale issues + close any
  // open popover. The new chapter's text doesn't share offsets with the
  // previous one, so leftover decorations would highlight nonsense.
  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch({ effects: clearIssuesEffect.of() });
    setIssueCount(0);
    setIssuePopover(null);
  }, [editorView, currentChapter?.filename]);


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
      // Baseline word count on load so the title bar shows a number before
      // the first save.
      setWordCount(countWords(data.content));

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
      setWordCount(countWords(data.content));

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not load note.");
    } finally {
      setIsLoadingNote(false);
    }
  }, []);


  // --- Phase 6: Manuscript tree handlers ---

  // Toggle a chapter's expanded state. Expanding reveals the Chapter Summary
  // child row; collapsing hides it. No network calls needed.
  const toggleChapterExpanded = useCallback((chapterFilename: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterFilename)) {
        next.delete(chapterFilename);
      } else {
        next.add(chapterFilename);
      }
      return next;
    });
  }, []);

  // Open the chapter summary for a chapter. The summary file lives at
  // <project>/summaries/chapters/<chapter-stem>.md. SummaryView handles the
  // "no file yet" empty state, so we always navigate even if the file is
  // missing on disk.
  const openChapterSummary = useCallback((chapterFilename: string) => {
    setCurrentSummaryChapter(chapterFilename);
    setCurrentView("chapter_summary");
  }, []);


  // --- Scene summaries (Phase 6) ---
  //
  // Load the list of filled scene slots for one chapter and cache in state.
  // Called when the writer expands a chapter's Scene Summaries subtree, after
  // a save/generate/delete, and after the auto-split loop finishes. An empty
  // list just means the writer hasn't summarized any scenes yet.
  const loadSceneSummaries = useCallback(async (chapterFilename: string) => {
    const project = currentProjectRef.current;
    if (!project) return;

    try {
      const params = new URLSearchParams({
        folder_path:      project.root_path,
        chapter_filename: chapterFilename,
      });
      const res = await fetch(`${API_BASE}/api/documents/scene-summaries?${params}`);
      if (!res.ok) {
        // 404 is possible on some platforms even though we return [] in the
        // Python handler. Treat any non-OK response as "no summaries yet" so
        // the sidebar doesn't crash on a missing folder.
        setSceneSummariesByChapter(prev => {
          const next = new Map(prev);
          next.set(chapterFilename, []);
          return next;
        });
        return;
      }
      const list: SceneSummaryInfo[] = await res.json();
      setSceneSummariesByChapter(prev => {
        const next = new Map(prev);
        next.set(chapterFilename, list);
        return next;
      });
    } catch {
      // Silent: sidebar will show no scenes; writer can re-expand to retry.
    }
  }, []);

  // Toggle the Scene Summaries group expanded under a chapter. On first expand
  // we fetch the list; on subsequent expands we rely on cached state and the
  // refresh callbacks the individual views trigger after save/delete.
  const toggleSceneGroupExpanded = useCallback((chapterFilename: string) => {
    setExpandedSceneGroups(prev => {
      const next = new Set(prev);
      if (next.has(chapterFilename)) {
        next.delete(chapterFilename);
      } else {
        next.add(chapterFilename);
        // Fetch lazily -- only when the writer actually asks to see the list.
        if (!sceneSummariesByChapter.has(chapterFilename)) {
          void loadSceneSummaries(chapterFilename);
        }
      }
      return next;
    });
  }, [loadSceneSummaries, sceneSummariesByChapter]);

  // Open one scene summary in SceneSummaryView. Same pattern as openChapterSummary.
  const openSceneSummary = useCallback((chapterFilename: string, index: number) => {
    setCurrentSummaryScene({ chapterFile: chapterFilename, index });
    setCurrentView("scene_summary");
  }, []);

  // Delete a single scene summary from the sidebar trash icon.
  const handleDeleteSceneSummary = useCallback(async (chapterFilename: string, index: number) => {
    const project = currentProjectRef.current;
    if (!project) return;

    const ok = window.confirm(
      `Delete the summary for scene ${index}? The chapter text is untouched. This cannot be undone.`
    );
    if (!ok) return;

    try {
      const params = new URLSearchParams({
        folder_path:      project.root_path,
        chapter_filename: chapterFilename,
        index:            String(index),
      });
      const res = await fetch(`${API_BASE}/api/documents/scene-summary?${params}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Delete failed.");
      }
      if (
        currentSummaryScene &&
        currentSummaryScene.chapterFile === chapterFilename &&
        currentSummaryScene.index === index
      ) {
        setCurrentSummaryScene(null);
        setCurrentView("editor");
      }
      void loadSceneSummaries(chapterFilename);
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not delete scene summary.");
    }
  }, [currentSummaryScene, loadSceneSummaries]);

  // handleGenerateSceneSummaries and handleSummarizeAsScene are defined AFTER
  // handleSave below, because they depend on it. Placing them here would trip
  // the temporal dead zone on the `handleSave` reference.


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


  // --- Rename a chapter inline from the left nav ---
  // The backend rewrites the first `# heading` line inside the chapter file
  // (the filename is kept stable so numeric ordering survives). After a
  // successful save we patch the chapter list and, if the renamed chapter is
  // currently open, update the title shown in the editor header too.
  const handleRenameChapter = useCallback(async (filename: string, newTitle: string) => {
    const project = currentProjectRef.current;
    if (!project) return;

    const trimmed = newTitle.trim();
    if (!trimmed) return;

    // Skip the network call if nothing actually changed.
    const current = chapters.find(c => c.filename === filename);
    if (current && current.title === trimmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/documents/rename-chapter`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          folder_path: project.root_path,
          filename,
          new_title:   trimmed,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Rename failed.");
      }
      const data = await res.json();
      setChapters(prev => prev.map(c =>
        c.filename === filename ? { ...c, title: data.title } : c
      ));
      // If the renamed chapter is currently open, reflect the new title in
      // the editor header without forcing a full chapter reload.
      setCurrentChapter(prev =>
        prev && prev.filename === filename ? { ...prev, title: data.title } : prev
      );
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not rename chapter.");
    }
  }, [chapters]);


  // --- Delete a chapter (and its paired summary, if any) ---
  // The backend removes the chapter .md file AND the matching
  // summaries/chapters/<stem>.md (if present). We confirm with the writer
  // first because this is destructive and not undoable.
  const handleDeleteChapter = useCallback(async (chapter: ChapterInfo) => {
    const project = currentProjectRef.current;
    if (!project) return;

    const ok = window.confirm(
      `Delete "${chapter.title}"? This removes the chapter file (and its summary, if any) from disk and cannot be undone.`
    );
    if (!ok) return;

    try {
      const params = new URLSearchParams({
        folder_path: project.root_path,
        filename:    chapter.filename,
      });
      const res = await fetch(`${API_BASE}/api/documents/chapter?${params}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Delete failed.");
      }

      setChapters(prev => prev.filter(c => c.filename !== chapter.filename));
      setExpandedChapters(prev => {
        const next = new Set(prev);
        next.delete(chapter.filename);
        return next;
      });

      // If the deleted chapter was the one open in the editor or its summary
      // was the active view, clear back to an empty editor state so the UI
      // doesn't keep showing content that no longer exists on disk.
      if (currentChapterRef.current?.filename === chapter.filename) {
        setCurrentChapter(null);
        setChapterContent("");
        setIsDirty(false);
        setWordCount(0);
      }
      if (currentSummaryChapter === chapter.filename) {
        setCurrentSummaryChapter(null);
        setCurrentView("editor");
      }
      // Also drop any open scene summary for this chapter and clear the
      // sidebar cache so stale Scene N rows don't linger.
      if (currentSummaryScene?.chapterFile === chapter.filename) {
        setCurrentSummaryScene(null);
        setCurrentView("editor");
      }
      setSceneSummariesByChapter(prev => {
        const next = new Map(prev);
        next.delete(chapter.filename);
        return next;
      });
      setExpandedSceneGroups(prev => {
        const next = new Set(prev);
        next.delete(chapter.filename);
        return next;
      });
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not delete chapter.");
    }
  }, [currentSummaryChapter, currentSummaryScene]);


  // --- Delete a chapter summary (without touching the chapter itself) ---
  // Lets the writer wipe a bad AI-generated summary and start over without
  // losing the manuscript chapter. If the summary is currently open in the
  // summary editor, bounce back to the main editor view.
  const handleDeleteChapterSummary = useCallback(async (chapter: ChapterInfo) => {
    const project = currentProjectRef.current;
    if (!project) return;

    const ok = window.confirm(
      `Delete the chapter summary for "${chapter.title}"? The chapter itself is untouched. This cannot be undone.`
    );
    if (!ok) return;

    try {
      const params = new URLSearchParams({
        folder_path:      project.root_path,
        chapter_filename: chapter.filename,
      });
      const res = await fetch(`${API_BASE}/api/documents/chapter-summary?${params}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        // 404 = no summary file existed; treat that as already-deleted so
        // the writer isn't shown an error for trying to clean up nothing.
        if (res.status !== 404) {
          throw new Error(err.detail ?? "Delete failed.");
        }
      }

      if (currentSummaryChapter === chapter.filename) {
        setCurrentSummaryChapter(null);
        setCurrentView("editor");
      }
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not delete summary.");
    }
  }, [currentSummaryChapter]);


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
      // Refresh word count against the exact bytes that just hit disk.
      setWordCount(countWords(content));

    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save.");
    }
  }, []);


  // Orchestrate the scene summary auto-split flow: parse chapter, walk each
  // scene, prompt before overwriting existing summaries, save each generated
  // summary. See the sidebar/loop docs above for the full control flow.
  //
  // Sequencing: the overwrite prompts block the loop via a Promise wired
  // through React state (sceneOverwritePrompt). One scene failing doesn't
  // abort the whole loop -- we record the error and move on so a flaky
  // connection doesn't lose every scene's work.
  const handleGenerateSceneSummaries = useCallback(async () => {
    const project = currentProjectRef.current;
    const chapter = currentChapterRef.current;
    if (!project || !chapter) return;

    // If the writer has unsaved edits, save first so the split runs against
    // the on-disk text. Stale edits would produce wrong scene boundaries.
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved edits. Save and continue? Cancel to stop and save manually first."
      );
      if (!ok) return;
      await handleSave();
    }

    setAutoSplitProgress("Parsing chapter...");
    setEditorError(null);

    try {
      const chapterAbsPath = `${project.root_path}/manuscript/${chapter.filename}`;

      // Step 1: split the chapter (cheap, no AI call).
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
        throw new Error(err.detail ?? `Parse failed (${splitRes.status})`);
      }
      const splitData: SplitChapterScenesResponse = await splitRes.json();

      // Step 2: no-HR fallback. For the MVP this offers a chapter-wide summary;
      // the AI-suggested scene break feature is deferred per the plan.
      if (splitData.hr_count === 0) {
        const choice = window.confirm(
          "No scene breaks (---) found in this chapter.\n\n" +
          "OK: Open the Chapter Summary view so you can generate a single chapter-wide summary.\n" +
          "Cancel: Close this dialog. Add --- separators to your chapter first, then try again."
        );
        setAutoSplitProgress(null);
        if (choice) openChapterSummary(chapter.filename);
        return;
      }

      // Step 3: find out which slots are already filled.
      const listRes = await fetch(
        `${API_BASE}/api/documents/scene-summaries?` +
        new URLSearchParams({
          folder_path:      project.root_path,
          chapter_filename: chapter.filename,
        })
      );
      const existing: SceneSummaryInfo[] = listRes.ok ? await listRes.json() : [];
      const existingByIndex = new Map<number, SceneSummaryInfo>(
        existing.map(s => [s.index, s])
      );

      // Step 4: sequential loop with overwrite prompts.
      let cancelled = false;
      for (const scene of splitData.scenes) {
        if (cancelled) break;

        const existingSlot = existingByIndex.get(scene.index);
        if (existingSlot) {
          const answer = await new Promise<"yes" | "no" | "cancel">((resolve) => {
            setSceneOverwritePrompt({
              index: scene.index,
              title: existingSlot.title,
              total: splitData.scenes.length,
              onAnswer: (a) => {
                setSceneOverwritePrompt(null);
                resolve(a);
              },
            });
          });
          if (answer === "cancel") { cancelled = true; break; }
          if (answer === "no")     { continue; }
        }

        setAutoSplitProgress(`Generating Scene ${scene.index} of ${splitData.scenes.length}...`);

        try {
          const genRes = await fetch(`${API_BASE}/api/ai/generate-scene-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapter_path: chapterAbsPath,
              project_path: project.root_path,
              scene_text:   scene.text,
              scene_title:  scene.title,
              content_mode: "general",
            }),
          });
          if (!genRes.ok) {
            const err = await genRes.json().catch(() => ({}));
            throw new Error(err.detail ?? `Generation failed (${genRes.status})`);
          }
          const genData: GenerateSceneSummaryResponse = await genRes.json();

          const saveRes = await fetch(`${API_BASE}/api/documents/scene-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folder_path:      project.root_path,
              chapter_filename: chapter.filename,
              index:            scene.index,
              title:            genData.title || scene.title || "Scene",
              content:          genData.content ?? "",
            }),
          });
          if (!saveRes.ok) {
            const err = await saveRes.json().catch(() => ({}));
            throw new Error(err.detail ?? `Save failed (${saveRes.status})`);
          }
        } catch (err) {
          setEditorError(
            `Scene ${scene.index} failed: ${err instanceof Error ? err.message : "unknown error"}`
          );
        }
      }

      setAutoSplitProgress(null);
      // Refresh sidebar cache and expand the Scene Summaries subtree so the
      // writer sees what just got created.
      await loadSceneSummaries(chapter.filename);
      setExpandedChapters(prev => {
        const next = new Set(prev);
        next.add(chapter.filename);
        return next;
      });
      setExpandedSceneGroups(prev => {
        const next = new Set(prev);
        next.add(chapter.filename);
        return next;
      });
    } catch (err) {
      setAutoSplitProgress(null);
      setEditorError(err instanceof Error ? err.message : "Auto-split failed.");
    }
  }, [isDirty, handleSave, loadSceneSummaries, openChapterSummary]);


  // Selection-based flow: opens the preview modal. The modal runs the AI
  // generation itself on mount; we just seed it with the text and the list
  // of existing scene slots so its slot-picker can render the dropdown.
  const handleSummarizeAsScene = useCallback(async () => {
    const project = currentProjectRef.current;
    const chapter = currentChapterRef.current;
    if (!project || !chapter) return;
    const text = selectedText.trim();
    if (!text) return;

    const chapterAbsPath = `${project.root_path}/manuscript/${chapter.filename}`;

    let existing: SceneSummaryInfo[] = [];
    try {
      const params = new URLSearchParams({
        folder_path:      project.root_path,
        chapter_filename: chapter.filename,
      });
      const res = await fetch(`${API_BASE}/api/documents/scene-summaries?${params}`);
      if (res.ok) existing = await res.json();
    } catch {
      // Silent -- modal opens with an empty "new scene" default.
    }

    setShowSceneSummaryModal({
      chapterFile:    chapter.filename,
      chapterPath:    chapterAbsPath,
      selectedText:   text,
      existingScenes: existing,
    });
  }, [selectedText]);


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
    setChatModelUsed(currentProjectRef.current?.default_model || null);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    // --- Cancellation + timeout setup ---
    // controller: can be aborted by the hard 180s timer OR by the user clicking [Cancel].
    // cancelButtonTimer: reveals the [Cancel] button after 20s of waiting --
    //   long enough that quick responses don't show the button at all, short
    //   enough that impatient writers aren't stuck staring at "Thinking..."
    // hardTimeoutTimer: safety net matching the backend REQUEST_TIMEOUT (180s).
    const controller = new AbortController();
    chatAbortRef.current        = controller;
    chatManualCancelRef.current = false;
    setChatCanCancel(false);
    const cancelButtonTimer = setTimeout(() => setChatCanCancel(true), 20_000);
    const hardTimeoutTimer  = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(`${API_BASE}/api/ai/editor-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          // Smart Advisor redesign: chat is always general-chat now.
          // Structured Readability/Structure/Context feedback runs through
          // /api/ai/editor-pass and renders as inline highlights instead.
          category:        "chat",
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
      if (data.model_used) setChatModelUsed(data.model_used);
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
        // Abort could be user-cancel OR the 180s hard timeout. The ref flag
        // tells us which so we can show an actionable message either way.
        if (chatManualCancelRef.current) {
          setChatError("Request cancelled. Rephrase your message and try again.");
        } else {
          setChatError("Request timed out after 180 seconds. Try fewer attachments or a shorter selection.");
        }
      } else if (err instanceof TypeError && err.message.toLowerCase().includes("failed to fetch")) {
        setChatError("Could not reach the backend. Check that it is running on port 8000.");
      } else {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
      }
    } finally {
      clearTimeout(cancelButtonTimer);
      clearTimeout(hardTimeoutTimer);
      chatAbortRef.current        = null;
      chatManualCancelRef.current = false;
      setChatCanCancel(false);
      setChatLoading(false);
    }
  }, [chatInput, chatMessages, selectedText, contextChips, chatLoading, includeChapter, chapterEstablished, establishedChipKeys]);


  // --- Cancel an in-flight chat request ---
  // Called when the writer clicks the [Cancel] button that appears after 20s.
  // We set the manual-cancel flag BEFORE calling abort() so the catch block
  // in sendEditorChat knows this wasn't a timeout and shows the right message.
  const cancelEditorChat = useCallback(() => {
    if (!chatAbortRef.current) return;
    chatManualCancelRef.current = true;
    chatAbortRef.current.abort();
  }, []);


  // --- Open a URL in the system browser ---
  // Tauri's opener plugin routes URLs to the OS default browser instead of
  // Tauri's own webview, so external links don't navigate the app away.
  // Used by AboutPanel, UpdateModal, PostUpdateBanner, DonationPrompt for
  // GitHub / Sponsors / Ko-fi / changelog links. In dev (non-Tauri), falls
  // back to window.open which works fine for testing in the browser.
  const openLink = useCallback(async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      // Non-Tauri context (e.g. running Vite directly): fall back to a
      // normal browser open. Catches dev-mode tests as well.
      window.open(url, "_blank");
    }
  }, []);


  // --- Fully reset the Writing Companion conversation ---
  // The backend is stateless -- it only ever sees what the frontend sends in
  // the next POST. For Clear to actually feel like "fresh conversation," we
  // have to drop everything the next message would otherwise carry over:
  //   - chatMessages:         the prior turns themselves
  //   - establishedChipKeys:  the set that would mark chips as "already sent"
  //   - chapterEstablished:   the flag that would skip chapter text next time
  //   - contextChips:         the chips currently attached to the panel
  //   - chatInput:            any half-typed follow-up
  //
  // Before this change Clear left the chips and the chapter-send flag in
  // place, so the writer's next message still shipped the same profiles and
  // chapter. The AI then produced answers grounded in that same context,
  // which read as "the AI still remembers our last conversation" even though
  // it had no access to the prior turns.
  const clearWritingCompanionChat = useCallback(() => {
    setChatMessages([]);
    setChatError(null);
    setEstablishedChipKeys(new Set());
    setChapterEstablished(false);
    setContextChips([]);
    setChatInput("");
  }, []);


  // --- Theme + UI scale init ---
  // Load the saved theme and font-size scale from the backend on first
  // mount and apply each to the <html> element. Runs once at app boot;
  // from then on changes go through useTheme()/setTheme() and
  // useUiScale()/setUiScale() which update the DOM directly.
  useEffect(() => {
    void initTheme();
    void initUiScale();
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
  // Backend-down banner (Phase 6). Rendered as a fixed-position overlay so
  // it sits above every view without disturbing layout. Shown when the
  // health-check poll has seen at least one successful ping (so we don't
  // briefly show the banner during cold start) and the most recent ping
  // failed, unless the writer explicitly dismissed it after that failure.
  const showBackendBanner =
    backendHealth.hasEverConnected &&
    backendHealth.isDown &&
    (backendBannerDismissedAt === null || backendBannerDismissedAt < (backendHealth.lastSeen ?? 0));
  const backendDownBanner = showBackendBanner ? (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 border-b border-red-800 bg-red-950/95 px-4 py-2 shadow-lg backdrop-blur-sm"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
        <p className="text-xs text-red-100">
          <span className="font-semibold">Backend not responding.</span>{" "}
          Storythread Studio can't reach the local API at <span className="font-mono">localhost:8000</span>.
          Start it with{" "}
          <span className="rounded border border-red-800 bg-red-900/70 px-1 font-mono text-[10px] text-red-200">
            uv run uvicorn app.main:app --reload --port 8000
          </span>
          {" "}from the <span className="font-mono">backend/</span> folder.
        </p>
      </div>
      <button
        onClick={() => setBackendBannerDismissedAt(Date.now())}
        className="rounded border border-red-800 px-2 py-0.5 text-xs text-red-200 transition-colors hover:border-red-500 hover:text-red-100"
        title="Hide this banner (it reappears if the backend goes down again)"
      >
        Dismiss
      </button>
    </div>
  ) : null;

  // ── Update + donation overlays ─────────────────────────────────────────────
  // Bundled into one JSX block so each return path adds it with one variable.
  // The pieces (UpdateBanner, PostUpdateBanner, modals, donation prompt) are
  // independent -- order is purely visual.
  const updateOverlays = (
    <>
      {/* Slim "update available" banner. Rendered when the launch-time check
          found a newer release. Clicking "View details" opens UpdateModal. */}
      {appUpdate.status === "available" && appUpdate.update && (
        <UpdateBanner
          update={appUpdate.update}
          onViewDetails={() => setShowUpdateModal(true)}
        />
      )}

      {/* Post-update banner. Fires on the first launch after the writer
          installed a new version (detected via useFreshVersion). */}
      {freshVersion.isFreshVersion && freshVersion.currentVersion && (
        <PostUpdateBanner
          currentVersion={freshVersion.currentVersion}
          previousVersion={freshVersion.previousVersion}
          hasDonated={donation.hasDonated}
          openLink={openLink}
          onAcknowledge={freshVersion.acknowledge}
        />
      )}

      {/* Update details modal. Surfaced by clicking the banner OR via the
          About panel's "Check for updates" button, which re-runs the check
          and (if positive) flips status to 'available' so the banner +
          modal both become reachable again. */}
      {showUpdateModal && appUpdate.update && (
        <UpdateModal
          update={appUpdate.update}
          status={appUpdate.status}
          progress={appUpdate.progress}
          error={appUpdate.error}
          hasDonated={donation.hasDonated}
          openLink={openLink}
          onDownloadInstall={() => void appUpdate.downloadAndInstall()}
          onRelaunch={() => void appUpdate.relaunch()}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      {/* About + donation panel. Opened from the sidebar's "About" button. */}
      {showAboutPanel && freshVersion.currentVersion && (
        <AboutPanel
          version={freshVersion.currentVersion}
          hasDonated={donation.hasDonated}
          updateStatus={appUpdate.status}
          openLink={openLink}
          onMarkDonated={donation.markDonated}
          onUnmarkDonated={donation.unmarkDonated}
          onCheckUpdates={() => void appUpdate.checkAgain()}
          onClose={() => setShowAboutPanel(false)}
        />
      )}

      {/* Periodic donation nudge. Fires every 30-50 launches when the writer
          isn't already a donor (see useDonationState). Non-modal: floats in
          the bottom-right and the writer can keep typing through it. */}
      {donation.shouldShowPrompt && (
        <DonationPrompt
          appOpenCount={donation.appOpenCount}
          openLink={openLink}
          onDismiss={donation.dismissPeriodicPrompt}
          onMarkDonated={donation.markDonated}
        />
      )}
    </>
  );

  if (!currentProject) {
    return (
      <>
        {backendDownBanner}
        {updateOverlays}
        <ProjectHome onProjectOpen={handleProjectOpen} />
      </>
    );
  }

  // Profile builder view: replaces the entire editor layout
  if (currentView === "profiles") {
    return (
      <>
        {backendDownBanner}
        {updateOverlays}
        <ProfileBuilder
          project={currentProject}
          initialType={profileType}
          onBack={() => setCurrentView("editor")}
        />
      </>
    );
  }

  // ── Project is open: show the three-panel writing editor ──────────────────
  return (
    <>
      {backendDownBanner}
      {updateOverlays}
      <div className="flex h-screen overflow-hidden bg-bg-primary text-text-primary">

      {/* ── LEFT PANEL: Navigation Sidebar ─────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-panel">

        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-wide text-text-primary">
              Storythread Studio
            </h1>
            <ThemeToggle />
          </div>

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
                className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-bg-surface"
                title="Switch to a different project"
              >
                <span className="truncate text-xs text-text-muted">{currentProject.title}</span>
                <ChevronDown size={10} className="shrink-0 text-faint" />
              </button>
              <button
                onClick={() => setShowProjectSettings(true)}
                className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-bg-surface hover:text-text-muted"
                title="Project settings"
              >
                <Settings2 size={12} />
              </button>
            </div>

            {/* Project switcher dropdown */}
            {showSwitcher && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded border border-border bg-bg-panel shadow-xl">
                {switcherProjects.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-faint">No recent projects</p>
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
                      className={`w-full px-3 py-2 text-left text-xs transition-colors hover:bg-bg-surface ${
                        rp.root_path === currentProject.root_path
                          ? "text-indigo-300"
                          : "text-text-primary"
                      }`}
                    >
                      <p className="truncate font-medium">{rp.title}</p>
                      {rp.series_name && (
                        <p className="truncate text-faint">{rp.series_name}</p>
                      )}
                    </button>
                  ))
                )}
                <div className="border-t border-border">
                  <button
                    onClick={() => { setShowSwitcher(false); setCurrentProject(null); }}
                    className="w-full px-3 py-2 text-left text-xs text-faint transition-colors hover:bg-bg-surface hover:text-text-muted"
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">

          {/* Main Menu return -- Phase 6. Always-visible button at the top
              of the left nav so the writer can leave the project without
              digging into the switcher dropdown. setCurrentProject(null)
              triggers the conditional render in App() that swaps in the
              ProjectHome screen. */}
          <button
            onClick={() => setCurrentProject(null)}
            className="mb-4 flex w-full items-center gap-2 rounded border border-border bg-bg-panel px-2 py-1.5 text-left text-xs text-text-muted transition-colors hover:border-indigo-500 hover:bg-bg-surface hover:text-indigo-300"
            title="Return to the main menu (does not affect any open work on disk)"
          >
            <span aria-hidden="true">&larr;</span>
            <span>Main Menu</span>
          </button>

          {/* Manuscript section -- Phase 6 nested tree:
              Each chapter is a collapsible row. Expanding reveals a single
              "Chapter Summary" child. Clicking the chapter name opens the
              chapter in the editor; clicking the summary child opens the
              summary editor. Expanded state lives in App-level state so it
              persists as the writer navigates between views. */}
          <NavSection label="Manuscript">
            {chapters.length === 0 && (
              <p className="px-2 text-xs text-faint">No chapters found.</p>
            )}
            {chapters.map((chapter) => {
              const isExpanded        = expandedChapters.has(chapter.filename);
              const isActiveChapter   = currentView === "editor" && currentChapter?.filename === chapter.filename;
              const isChapterSummaryActive = currentView === "chapter_summary" && currentSummaryChapter === chapter.filename;
              // "Summary ancestor" -- any descendant of this chapter is the
              // active view. Used to subtly highlight the chapter row so the
              // writer can trace back up the tree.
              const isSceneSummaryActiveInThisChapter =
                currentView === "scene_summary" &&
                currentSummaryScene?.chapterFile === chapter.filename;
              const isSummaryAncestor = isChapterSummaryActive || isSceneSummaryActiveInThisChapter;

              const sceneSummaries  = sceneSummariesByChapter.get(chapter.filename);
              const isScenesExpanded = expandedSceneGroups.has(chapter.filename);
              const activeSceneIndex = isSceneSummaryActiveInThisChapter
                ? (currentSummaryScene?.index ?? null)
                : null;

              return (
                <ChapterNavRow
                  key={chapter.filename}
                  chapter={chapter}
                  isExpanded={isExpanded}
                  isActiveChapter={isActiveChapter}
                  isSummaryAncestor={isSummaryAncestor}
                  isChapterSummaryActive={isChapterSummaryActive}
                  sceneSummaries={sceneSummaries}
                  isScenesExpanded={isScenesExpanded}
                  activeSceneIndex={activeSceneIndex}
                  onToggleExpand={() => toggleChapterExpanded(chapter.filename)}
                  onOpenChapter={() => {
                    if (currentView !== "editor" || currentChapter?.filename !== chapter.filename) {
                      loadChapter(chapter, currentProject);
                    }
                  }}
                  onOpenChapterSummary={() => openChapterSummary(chapter.filename)}
                  onRenameChapter={(newTitle) => handleRenameChapter(chapter.filename, newTitle)}
                  onDeleteChapter={() => handleDeleteChapter(chapter)}
                  onDeleteChapterSummary={() => handleDeleteChapterSummary(chapter)}
                  onToggleScenesExpanded={() => toggleSceneGroupExpanded(chapter.filename)}
                  onOpenScene={(index) => openSceneSummary(chapter.filename, index)}
                  onDeleteScene={(index) => handleDeleteSceneSummary(chapter.filename, index)}
                />
              );
            })}
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

          {/* Scene Summaries remain reachable here for legacy profile access.
              Chapter summaries moved to the nested Manuscript tree in Phase 6
              (plain-Markdown files under summaries/chapters/ via SummaryView),
              so the old profile-builder link for them has been removed. */}
          <NavSection label="Summaries">
            <NavItem label="Scene Summaries" hint="Per-scene summaries used as AI context"
              onClick={() => { setProfileType("scene_summary"); setCurrentView("profiles"); }} />
          </NavSection>
        </nav>

        <div className="border-t border-border px-4 py-3">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full rounded px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
            title="Open settings (API key, model selection)"
          >
            ⚙ Settings
          </button>
          <button
            onClick={() => setShowAboutPanel(true)}
            className="mt-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
            title="About Storythread Studio: version, license, donations"
          >
            <span>ℹ About</span>
            {/* Surface the donor flag here as a small heart so the writer
                sees the acknowledgement every time they open the sidebar. */}
            {donation.hasDonated && (
              <span className="text-pink-400" title="Thank you for donating!">♥</span>
            )}
          </button>
        </div>
      </aside>


      {/*
        Phase 6: when the writer is viewing a chapter summary, swap the center
        editor + Writing Companion panels for the full-width SummaryView. The
        left-nav stays mounted so the writer can navigate between summaries,
        chapters, and other views without losing context. The Writing
        Companion is intentionally hidden here -- summaries are structured
        continuity editing, not prose drafting, so the chat panel would only
        distract.
      */}
      {currentView === "chapter_summary" && currentSummaryChapter ? (
        <SummaryView
          project={currentProject}
          chapterFile={currentSummaryChapter}
          font={currentFont}
          onBack={() => setCurrentView("editor")}
        />
      ) : currentView === "scene_summary" && currentSummaryScene ? (
        <SceneSummaryView
          project={currentProject}
          chapterFile={currentSummaryScene.chapterFile}
          sceneIndex={currentSummaryScene.index}
          font={currentFont}
          onBack={() => setCurrentView("editor")}
          onSidebarRefresh={() => loadSceneSummaries(currentSummaryScene.chapterFile)}
        />
      ) : (
      <>

      {/* ── CENTER PANEL: Writing Editor (chapters or notes) ─────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Title bar + save indicator -- shows chapter title or note title */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-panel px-4 py-2">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-medium text-text-primary">
              {currentView === "notes"
                ? (currentNote ? currentNote.title : "No note open")
                : (currentChapter ? currentChapter.title : "No chapter open")}
            </span>
            {/* Word count -- refreshed on document load and on each Save. Not
                a live counter: the writer sees the number move when they
                commit, which doubles as feedback that the save succeeded. */}
            {(currentChapter || currentNote) && (
              <span
                className="text-xs text-text-muted"
                title="Word count at last save (refreshes on Save)"
              >
                {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateChapter}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-emerald-500 hover:text-emerald-400"
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
              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title="Save to disk (Ctrl+S)"
            >
              Save
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
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
          onGenerateSceneSummaries={
            // Only surface the button when a chapter is open in the editor.
            // Scene summaries are chapter-scoped, so the button has no
            // meaning while a note or the project home is showing.
            currentView === "editor" && currentChapter
              ? handleGenerateSceneSummaries
              : undefined
          }
          autoSplitRunning={autoSplitProgress !== null}
          onReaderMode={currentProject && chapters.length > 0 ? () => setShowReaderMode(true) : undefined}
        />

        {/* Smart Advisor toolbar -- only relevant for chapter editing.
            Notes and project-home views skip this row. The bar runs the
            three category passes (Readability/Structure/Context), which
            return inline issues that decorate the manuscript directly. */}
        {currentView === "editor" && currentChapter && (
          <EditorAdvisorBar
            view={editorView}
            chapterText={chapterContent}
            contextChips={contextChips}
            modelId={currentProject?.default_model || null}
            contentMode={currentProject?.content_mode_default ?? "general"}
            projectPath={currentProject?.root_path ?? null}
            issueCount={issueCount}
            onClearIssues={() => setIssueCount(0)}
            onAddIssues={(located: LocatedIssue[]) =>
              setIssueCount(prev => prev + located.length)
            }
            profileChipCount={contextChips.filter(c =>
              ["character","relationship","location","lore",
               "series_character","series_relationship","series_location","series_lore"]
              .includes(c.type)
            ).length}
            onOpenProfilePicker={() => setShowChipPicker(true)}
          />
        )}

        {/* Editor area -- renders either a chapter or a note depending on currentView */}
        <div className="flex-1 overflow-hidden">
          {currentView === "notes" ? (
            // ── Notes editor ──
            isLoadingNote ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-text-muted">Loading note...</p>
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
                <p className="text-sm text-text-muted">
                  Select a note from the left panel.
                </p>
              </div>
            )
          ) : (
            // ── Chapter editor ──
            isLoadingChapter ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-text-muted">Loading chapter...</p>
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
                <p className="text-sm text-text-muted">
                  Select a chapter from the left panel to start writing.
                </p>
              </div>
            )
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Writing Companion ────────────────────────────────
          Width is toggleable (compact / wide) via the resizer pinned to the
          left edge; preference persists via localStorage. `relative` so the
          absolutely-positioned resizer anchors inside this aside. */}
      <aside className={`relative flex ${RIGHT_PANEL_CLASS[writingCompanionPanel.width]} shrink-0 flex-col border-l border-border bg-bg-panel transition-[width] duration-200`}>

        <RightPanelResizer width={writingCompanionPanel.width} setWidth={writingCompanionPanel.setWidth} />

        {/* Header + clear */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Writing Companion</h2>
            {chatMessages.length > 0 && (
              <button
                onClick={clearWritingCompanionChat}
                className="text-xs text-rose-700 transition-colors hover:text-rose-400"
                title="Clear the conversation and detach all context chips"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            General chat. For structured Readability, Structure, or Context
            review, use the Smart Advisor toolbar above the manuscript.
          </p>
        </div>

        {/* Context indicator -- what text the AI will see + chapter toggle */}
        <div className="shrink-0 border-b border-border px-4 py-2">
          {selectedText ? (
            // Writer has text selected -- that always gets sent (bright).
            // The "Summarize as Scene" button lives here because selection-
            // based scene summarization is conceptually a Writing Companion
            // action on the selected passage.
            <div className="flex items-center justify-between gap-2">
              <p className={`min-w-0 flex-1 truncate text-xs ${chapterEstablished ? "text-emerald-700" : "text-emerald-400"}`} title={selectedText}>
                {chapterEstablished ? "Selection (new context)" : "Using selected text"} ({selectedText.length.toLocaleString()} chars)
              </p>
              <button
                onClick={handleSummarizeAsScene}
                disabled={!currentChapter}
                className="shrink-0 rounded border border-indigo-700/50 bg-indigo-950/40 px-2 py-0.5 text-[10px] text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                title="Generate an AI scene summary from this selection (opens a preview modal)"
              >
                Summarize as Scene
              </button>
            </div>
          ) : currentChapter ? (
            // No selection -- show chapter toggle
            <div className="flex items-center justify-between">
              <p className={`text-xs ${
                !includeChapter
                  ? "text-faint"
                  : chapterEstablished
                    ? "text-amber-700"
                    : "text-indigo-300"
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
                <span className="text-xs text-faint">Include chapter</span>
                <div
                  className={`relative h-4 w-7 rounded-full transition-colors ${includeChapter ? "bg-indigo-600" : "bg-border"}`}
                  onClick={() => setIncludeChapter(v => !v)}
                >
                  <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${includeChapter ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </div>
              </label>
            </div>
          ) : (
            <p className="text-xs text-faint">
              Open a chapter to start
            </p>
          )}
        </div>

        {/* Context chips -- always visible on all tabs */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs text-text-muted">
              Context: {contextChips.length === 0 ? "none attached" : `${contextChips.length} profile${contextChips.length > 1 ? "s" : ""}`}
            </p>
            <button
              onClick={() => setShowChipPicker(prev => !prev)}
              className="rounded border border-border px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300"
              title="Attach a profile as context"
            >
              + Add
            </button>
          </div>

          {showChipPicker && currentProject && (
            <ChipPicker
              rootPath={currentProject.root_path}
              seriesPath={currentProject.series_path}
              currentChapterFilename={currentChapter?.filename ?? null}
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

                // Size indicator: chip content length in characters. Large chips
                // (especially location/lore profiles with many filled sections)
                // can push requests over the model's context window or timeout.
                // Ring color warns the writer when a chip is unusually large.
                const size = chip.content.length;
                const sizeLabel =
                  size >= 1000 ? `${(size / 1000).toFixed(1)}k` : String(size);
                const isLarge = size > 6000;    // Noticeable
                const isHuge  = size > 12000;   // Likely to cause slow/timeout

                const tooltip = [
                  chip.name,
                  `${size.toLocaleString()} chars`,
                  isEstablished ? "Established in conversation" : "Will be sent this turn",
                  isHuge ? "⚠ Very large -- may cause slow responses or timeouts" :
                    isLarge ? "Large -- takes up significant context" : "",
                ].filter(Boolean).join(" • ");

                return (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-opacity ${chipTypeColor(chip.type)} ${isEstablished ? "opacity-40" : ""} ${isHuge ? "ring-1 ring-red-500" : isLarge ? "ring-1 ring-amber-500" : ""}`}
                    title={tooltip}
                  >
                    {chip.name}
                    <span className="text-[10px] opacity-60">({sizeLabel})</span>
                    <button
                      onClick={() => setContextChips(prev => prev.filter((_, j) => j !== i))}
                      className="text-faint hover:text-red-400"
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
              <p className="text-sm font-medium text-text-muted">Writing Companion</p>
              <div className="w-full rounded border border-border bg-bg-primary p-2.5 text-left">
                <p className="mb-1 text-xs font-medium text-text-muted">Try asking:</p>
                {[
                  "What do you think of this passage?",
                  "Help me brainstorm what happens next",
                  "How could I make this scene stronger?",
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => setChatInput(q)}
                    className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-faint transition-colors hover:bg-border hover:text-text-muted"
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
                  : "rounded-tl-sm border border-border bg-bg-surface text-text-primary"
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
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              <span>
                {chatModelUsed
                  ? <>{chatModelUsed.split("/").pop()} <span className="text-faint">thinking...</span></>
                  : "Thinking..."}
              </span>
              {/* Cancel button appears only after 20s so fast responses don't
                  flash a button the writer never needed. Lets impatient
                  writers bail out and rephrase without waiting the full 180s. */}
              {chatCanCancel && (
                <button
                  onClick={cancelEditorChat}
                  className="ml-1 rounded border border-red-800/60 bg-red-950/30 px-2 py-0.5 text-[11px] text-red-300 transition-colors hover:border-red-600 hover:bg-red-900/40 hover:text-red-200"
                  title="Cancel this request"
                >
                  Cancel
                </button>
              )}
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
        <div className="border-t border-border p-3">
          <div className="relative flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                // maxH = 7 lines × ~24px line-height + padding. Larger than
                // before to accommodate the bumped text-sm size and to leave
                // room when the UI scale is raised. el.scrollHeight is in
                // rendered pixels so it tracks the live font size correctly.
                const maxH = 7 * 24 + 14;
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
              className="text-entry flex-1 rounded border border-border bg-border px-2 py-2 text-text-primary placeholder-text-muted outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              onClick={sendEditorChat}
              disabled={!currentChapter || !chatInput.trim() || chatLoading}
              className="flex items-center justify-center rounded border border-border p-1.5 text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </aside>
      </>
      )}

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

      {/* Reader Mode full-screen overlay */}
      {showReaderMode && currentProject && (
        <ReaderMode
          projectPath={currentProject.root_path}
          onClose={() => setShowReaderMode(false)}
        />
      )}

      {/* Smart Advisor issue popover. Appears when the writer clicks an
          inline issue highlight in the manuscript. Portals to body so it
          floats above the editor and can position freely. The popover
          updates the editor's StateField directly via dispatched effects
          when the writer accepts or ignores an issue. */}
      {issuePopover && editorView && (
        <IssuePopover
          view={editorView}
          issueIds={issuePopover.issueIds}
          contextChips={contextChips}
          modelId={currentProject?.default_model || null}
          contentMode={currentProject?.content_mode_default ?? "general"}
          projectPath={currentProject?.root_path ?? null}
          onIssueResolved={() => setIssueCount(prev => Math.max(0, prev - 1))}
          onClose={() => setIssuePopover(null)}
        />
      )}

      {/* Scene summary preview modal (selection-based flow). The modal runs
          its own AI generation on mount; we just hand it the selected text
          and the list of filled scene slots for its slot picker. */}
      {showSceneSummaryModal && currentProject && (
        <SceneSummaryPreviewModal
          folderPath={currentProject.root_path}
          chapterFile={showSceneSummaryModal.chapterFile}
          chapterPath={showSceneSummaryModal.chapterPath}
          selectedText={showSceneSummaryModal.selectedText}
          existingScenes={showSceneSummaryModal.existingScenes}
          onClose={(savedIndex) => {
            const chapterFile = showSceneSummaryModal.chapterFile;
            setShowSceneSummaryModal(null);
            // If the writer saved, refresh the sidebar cache + expand the
            // Scene Summaries group so the new row is visible.
            if (savedIndex !== undefined) {
              void loadSceneSummaries(chapterFile);
              setExpandedChapters(prev => {
                const next = new Set(prev);
                next.add(chapterFile);
                return next;
              });
              setExpandedSceneGroups(prev => {
                const next = new Set(prev);
                next.add(chapterFile);
                return next;
              });
            }
          }}
        />
      )}

      {/* Scene summary auto-split: overwrite prompt + progress indicator.
          The overwrite prompt is a simple modal wired to a Promise inside
          handleGenerateSceneSummaries -- clicking Yes/No/Cancel resolves the
          promise and the loop continues. */}
      {sceneOverwritePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-border bg-bg-panel p-5 shadow-xl">
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              Overwrite Scene {sceneOverwritePrompt.index}?
            </h2>
            <p className="mb-4 text-xs text-text-muted">
              A summary already exists for this scene ({sceneOverwritePrompt.total} scenes total):
              <br />
              <span className="mt-1 block font-medium text-text-primary">
                "{sceneOverwritePrompt.title}"
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => sceneOverwritePrompt.onAnswer("cancel")}
                className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-red-500 hover:text-red-300"
                title="Stop the auto-split loop (keeps what's already been generated)"
              >
                Cancel All
              </button>
              <button
                onClick={() => sceneOverwritePrompt.onAnswer("no")}
                className="rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
                title="Skip this scene; keep the existing summary"
              >
                No (Skip)
              </button>
              <button
                onClick={() => sceneOverwritePrompt.onAnswer("yes")}
                className="rounded border border-indigo-700/50 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                title="Regenerate and overwrite this scene's summary"
              >
                Yes (Overwrite)
              </button>
            </div>
          </div>
        </div>
      )}
      {autoSplitProgress && !sceneOverwritePrompt && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-40 rounded-lg border border-indigo-800 bg-bg-panel px-4 py-2 shadow-lg">
          <p className="text-xs text-indigo-300">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            {autoSplitProgress}
          </p>
        </div>
      )}

      {/* Outline template switch dialog -- shown when the writer clicks
          [+ New Template] in the toolbar while editing notes/outline.md.
          Lets them pick Novel or Short Story, warns about overwrite, and
          calls the backend to regenerate the outline file. */}
      {showTemplateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-border bg-bg-panel p-6 shadow-xl">
            <h2 className="mb-1 text-sm font-semibold text-text-primary">
              Apply Outline Template
            </h2>
            <p className="mb-4 text-xs text-text-muted">
              Choose a template to regenerate <span className="text-text-primary">notes/outline.md</span>.
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
                  className="flex cursor-pointer items-start gap-2 rounded border border-border bg-bg-surface p-2 transition-colors hover:border-faint"
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
                    <p className="text-xs font-medium text-text-primary">{opt.label}</p>
                    <p className="text-xs text-text-muted">{opt.hint}</p>
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
                className="rounded border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-faint hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </>
  );
}


// ── Helper Components ─────────────────────────────────────────────────────────

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
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
        active ? "bg-indigo-600/20 text-indigo-300" : "text-text-primary hover:bg-bg-surface"
      }`}
      title={hint}
    >
      {label}
    </button>
  );
}


// ── ChapterNavRow (Phase 6) ───────────────────────────────────────────────────
// One row in the Manuscript tree. Combines a chapter-opening button with an
// expand/collapse caret that reveals a single "Chapter Summary" child row.
//
// Clicking the caret toggles the subtree. Clicking the chapter name opens
// the chapter in the editor. These are separate click targets so the writer
// can navigate to the summary without inadvertently switching chapters.

function ChapterNavRow({
  chapter,
  isExpanded,
  isActiveChapter,
  isSummaryAncestor,
  isChapterSummaryActive,
  sceneSummaries,
  isScenesExpanded,
  activeSceneIndex,
  onToggleExpand,
  onOpenChapter,
  onOpenChapterSummary,
  onRenameChapter,
  onDeleteChapter,
  onDeleteChapterSummary,
  onToggleScenesExpanded,
  onOpenScene,
  onDeleteScene,
}: {
  chapter:                ChapterInfo;
  isExpanded:             boolean;
  isActiveChapter:        boolean;  // the chapter .md is open in the editor
  isSummaryAncestor:      boolean;  // this chapter's summary is the active view
  isChapterSummaryActive: boolean;  // the Chapter Summary child is currently active
  // Scene Summaries subtree (Phase 6):
  //   sceneSummaries      = filled scene slots fetched from the backend (or
  //                         undefined if the writer hasn't expanded yet).
  //   isScenesExpanded    = whether the Scene Summaries group is open.
  //   activeSceneIndex    = the scene currently shown in SceneSummaryView, or
  //                         null when a different view is active.
  sceneSummaries:         SceneSummaryInfo[] | undefined;
  isScenesExpanded:       boolean;
  activeSceneIndex:       number | null;
  onToggleExpand:         () => void;
  onOpenChapter:          () => void;
  onOpenChapterSummary:   () => void;
  onRenameChapter:        (newTitle: string) => void;
  onDeleteChapter:        () => void;
  onDeleteChapterSummary: () => void;
  onToggleScenesExpanded: () => void;
  onOpenScene:            (index: number) => void;
  onDeleteScene:          (index: number) => void;
}) {
  // Softer highlight for the parent chapter row when the child summary is
  // active -- helps the eye trace back up the tree without dominating the row.
  const parentGhostBg = isSummaryAncestor && !isActiveChapter ? "bg-indigo-900/10" : "";

  // Inline-rename state: when `editing` is true the title <button> swaps to
  // an <input>. Start with a local draft so Escape can discard without ever
  // calling the rename API.
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(chapter.title);

  // Keep the draft in sync when the chapter title changes from outside
  // (e.g., another action renames the same chapter) and we're not editing.
  useEffect(() => {
    if (!editing) setDraft(chapter.title);
  }, [chapter.title, editing]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === chapter.title) {
      setDraft(chapter.title);
      return;
    }
    onRenameChapter(next);
  };

  return (
    <div className="mb-0.5">
      {/* Header row: caret + chapter name + trash. Separate click targets so
          expanding, opening, renaming, and deleting can't be confused with
          each other. `group` lets the trash icon stay hidden until hover. */}
      <div
        className={`group flex items-stretch rounded transition-colors ${
          isActiveChapter ? "bg-indigo-600/20" : `hover:bg-bg-surface ${parentGhostBg}`
        }`}
      >
        <button
          onClick={onToggleExpand}
          className="flex w-6 shrink-0 items-center justify-center text-xs text-text-muted hover:text-indigo-300"
          title={isExpanded ? "Collapse" : "Expand"}
          aria-label={isExpanded ? "Collapse chapter" : "Expand chapter"}
        >
          {isExpanded ? "v" : ">"}
        </button>
        {editing ? (
          // Inline rename input: shown when the writer double-clicked the
          // title. Enter saves, Escape cancels, blur saves (so clicking
          // anywhere else commits the change, matching the example flow the
          // writer described: "click into it, change it, click out").
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(chapter.title);
                setEditing(false);
              }
            }}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded border border-indigo-500/50 bg-bg-surface px-1 py-1 text-sm text-text-primary outline-none focus:border-indigo-400"
            title="Rename chapter -- Enter to save, Escape to cancel"
          />
        ) : (
          <button
            onClick={onOpenChapter}
            onDoubleClick={() => { setDraft(chapter.title); setEditing(true); }}
            className={`flex-1 min-w-0 truncate px-1 py-1.5 text-left text-sm ${
              isActiveChapter ? "text-indigo-300" : "text-text-primary"
            }`}
            title={`Open ${chapter.filename} -- double-click to rename`}
          >
            {chapter.title}
          </button>
        )}
        {!editing && (
          <button
            onClick={onDeleteChapter}
            className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
            title={`Delete ${chapter.title}`}
            aria-label={`Delete ${chapter.title}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Expanded subtree: the Chapter Summary child row with its own trash
          button. Wrapped in a `group` container so the trash can reveal on
          hover independently of the parent chapter row. */}
      {isExpanded && (
        <div className="ml-6 mt-0.5 border-l border-border pl-2">
          <div
            className={`group flex items-stretch rounded transition-colors ${
              isChapterSummaryActive ? "bg-indigo-600/20" : "hover:bg-bg-surface"
            }`}
          >
            <button
              onClick={onOpenChapterSummary}
              className={`flex-1 min-w-0 truncate px-2 py-1.5 text-left text-sm ${
                isChapterSummaryActive ? "text-indigo-300" : "text-text-primary"
              }`}
              title="AI-generated continuity brief for this chapter"
            >
              Chapter Summary
            </button>
            <button
              onClick={onDeleteChapterSummary}
              className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
              title="Delete chapter summary (keeps the chapter)"
              aria-label="Delete chapter summary"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Scene Summaries subtree. Separate expandable group so collapsing
              the scenes doesn't hide the Chapter Summary row too. The group
              row always shows so the writer knows where to look; the list
              below only appears when expanded AND there are filled slots. */}
          <div className="mt-0.5">
            <button
              onClick={onToggleScenesExpanded}
              className="group flex w-full items-stretch rounded text-left text-sm text-text-primary transition-colors hover:bg-bg-surface"
              title="Per-scene AI summaries (click to expand)"
            >
              <span className="flex w-5 shrink-0 items-center justify-center text-xs text-text-muted group-hover:text-indigo-300">
                {isScenesExpanded ? "v" : ">"}
              </span>
              <span className="flex-1 min-w-0 truncate px-1 py-1.5 text-left">
                Scene Summaries
                {sceneSummaries && sceneSummaries.length > 0 && (
                  <span className="ml-1 text-xs text-text-muted">
                    ({sceneSummaries.length})
                  </span>
                )}
              </span>
            </button>

            {isScenesExpanded && (
              <div className="ml-5 mt-0.5 border-l border-border pl-2">
                {sceneSummaries === undefined ? (
                  <p className="px-2 py-1 text-xs text-faint">Loading...</p>
                ) : sceneSummaries.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-faint">
                    No scene summaries yet. Use the toolbar's Generate Scene Summaries button.
                  </p>
                ) : (
                  sceneSummaries.map(scene => {
                    const isActive = activeSceneIndex === scene.index;
                    return (
                      <div
                        key={scene.index}
                        className={`group flex items-stretch rounded transition-colors ${
                          isActive ? "bg-indigo-600/20" : "hover:bg-bg-surface"
                        }`}
                      >
                        <button
                          onClick={() => onOpenScene(scene.index)}
                          className={`flex-1 min-w-0 truncate px-2 py-1 text-left text-xs ${
                            isActive ? "text-indigo-300" : "text-text-primary"
                          }`}
                          title={`Scene ${scene.index}: ${scene.title}`}
                        >
                          <span className="text-text-muted">Scene {scene.index}</span>
                          <span className="mx-1 text-faint">&mdash;</span>
                          {scene.title}
                        </button>
                        <button
                          onClick={() => onDeleteScene(scene.index)}
                          className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                          title={`Delete scene ${scene.index} summary`}
                          aria-label={`Delete scene ${scene.index} summary`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
    ?? "text-text-muted border-border bg-bg-surface";
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
  // Filename of the chapter the writer currently has open in the editor (if any).
  // Drives the "Suggested" row at the top of the picker so the current chapter's
  // summary and scene summaries are one click away without browsing the tabs.
  currentChapterFilename?: string | null;
  existingChips: ContextChip[];
  onAdd: (chip: ContextChip) => void;
  onClose: () => void;
}

// Shape of an item in the chapter-summaries list endpoint. Mirrors
// ChapterSummaryListItem in backend/app/routers/documents.py.
interface ChapterSummaryListEntry {
  chapter_filename: string;
  chapter_title:    string;
  summary_filename: string;
}

// Shape of one scene inside a SceneSummaryGroup. Mirrors SceneSummaryInfo
// in backend/app/routers/documents.py.
interface SceneSummaryEntry {
  index:    number;
  title:    string;
  filename: string;
}

// Shape of a per-chapter scene-summary group returned by
// /api/documents/all-scene-summaries.
interface SceneSummaryGroupEntry {
  chapter_filename: string;
  chapter_title:    string;
  scenes:           SceneSummaryEntry[];
}

// State that holds the profile the writer clicked on but hasn't confirmed
// yet. While this is non-null, the picker shows the "configure attachment"
// panel instead of the profile list. Lets the writer choose which slices
// of the profile to include before the chip is built.
interface PendingProfile {
  filename: string;
  name:     string;
  chipType: string;            // e.g. "character" or "series_character"
  profile:  Profile;           // The fully fetched profile object
}

function ChipPicker({ rootPath, seriesPath, currentChapterFilename, existingChips, onAdd, onClose }: ChipPickerProps) {
  const [loading, setLoading] = useState(false);
  const [profileType, setProfileType] = useState("character");
  const [profiles, setProfiles] = useState<{ filename: string; name: string }[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  // "suggested" chips: auto-fetched character profiles shown at the top as ghost chips
  const [suggested, setSuggested] = useState<{ filename: string; name: string; type: string }[]>([]);
  const [suggestedLoaded, setSuggestedLoaded] = useState(false);

  // Chapter-summary tab: full list of summaries present in the project. Loaded
  // lazily the first time the writer opens the Chapter Summary tab.
  const [chapterSummaries, setChapterSummaries] = useState<ChapterSummaryListEntry[]>([]);
  const [chapterSummariesLoaded, setChapterSummariesLoaded] = useState(false);

  // Scene-summary tab: groups of (chapter, scenes[]) across the whole project.
  // Loaded lazily the first time the writer opens the Scene Summary tab. Each
  // chapter group can be expanded/collapsed to keep the picker compact.
  const [sceneGroups, setSceneGroups] = useState<SceneSummaryGroupEntry[]>([]);
  const [sceneGroupsLoaded, setSceneGroupsLoaded] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());

  // Whether we're browsing series canonical profiles vs local project profiles
  const [source, setSource] = useState<"project" | "series">("project");
  const hasSeries = Boolean(seriesPath);

  // The profile the writer has selected but not yet confirmed. While non-null
  // we show the "what to include" panel instead of the list. Once the writer
  // hits Attach, we serialize with the chosen flags and call onAdd.
  const [pending, setPending] = useState<PendingProfile | null>(null);
  const [pendingInclude, setPendingInclude] = useState<ChipIncludeOptions>(DEFAULT_CHIP_INCLUDE);
  const [showHelp, setShowHelp] = useState(false);

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


  // Load the full chapter-summaries list the first time the writer switches
  // to the Chapter Summary tab. Cached after that for the lifetime of the
  // picker (the picker remounts on each open via showChipPicker, so a fresh
  // open re-fetches; cheap because the endpoint is local).
  useEffect(() => {
    if (profileType !== "chapter_summary") return;
    if (chapterSummariesLoaded) return;
    const params = new URLSearchParams({ folder_path: rootPath });
    fetch(`${API_BASE}/api/documents/chapter-summaries?${params}`)
      .then(r => r.json())
      .then((data: ChapterSummaryListEntry[]) => {
        setChapterSummaries(Array.isArray(data) ? data : []);
      })
      .catch(() => setChapterSummaries([]))
      .finally(() => setChapterSummariesLoaded(true));
  }, [profileType, chapterSummariesLoaded, rootPath]);


  // Load the all-scene-summaries tree the first time the writer switches to
  // the Scene Summary tab. Same lazy-once pattern as chapter summaries above.
  useEffect(() => {
    if (profileType !== "scene_summary") return;
    if (sceneGroupsLoaded) return;
    const params = new URLSearchParams({ folder_path: rootPath });
    fetch(`${API_BASE}/api/documents/all-scene-summaries?${params}`)
      .then(r => r.json())
      .then((data: SceneSummaryGroupEntry[]) => {
        const groups = Array.isArray(data) ? data : [];
        setSceneGroups(groups);
        // Auto-expand the current chapter's group so the writer doesn't
        // have to hunt for it. Other chapters stay collapsed to keep the
        // list compact.
        if (currentChapterFilename) {
          setExpandedScenes(prev => {
            const next = new Set(prev);
            if (groups.some(g => g.chapter_filename === currentChapterFilename)) {
              next.add(currentChapterFilename);
            }
            return next;
          });
        }
      })
      .catch(() => setSceneGroups([]))
      .finally(() => setSceneGroupsLoaded(true));
  }, [profileType, sceneGroupsLoaded, rootPath, currentChapterFilename]);

  // Fetch the profile list when the selected type or source changes.
  // Skipped for non-profile chip tabs (notes, chapter_summary, scene_summary)
  // which load via their own dedicated endpoints elsewhere in this component.
  useEffect(() => {
    if (profileType === "notes" || profileType === "chapter_summary" || profileType === "scene_summary") {
      return;
    }
    setLoading(true);
    const folderPath = source === "series" && seriesPath ? seriesPath : rootPath;
    const params = new URLSearchParams({ folder_path: folderPath, type: profileType });
    fetch(`${API_BASE}/api/profiles/list?${params}`)
      .then(r => r.json())
      .then(data => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [profileType, rootPath, seriesPath, source]);

  // Step 1 of attaching a profile: fetch it and switch into "configure" mode
  // so the writer can pick which slices to include before the chip is built.
  // (Used to be a one-shot fetch+attach -- now split so the writer can choose
  // Summary / Traits / Overview / Details before committing.)
  async function pickProfile(filename: string, name: string, fromSource?: "project" | "series") {
    setAdding(filename);
    const chipType = (fromSource ?? source) === "series" ? `series_${profileType}` : profileType;
    try {
      if (existingChips.some(c => c.name === name && c.type === chipType)) {
        onClose();
        return;
      }
      const folderPath = (fromSource ?? source) === "series" && seriesPath ? seriesPath : rootPath;
      const params = new URLSearchParams({ folder_path: folderPath, type: profileType, filename });
      const res = await fetch(`${API_BASE}/api/profiles/profile?${params}`);
      const profile: Profile = await res.json();
      setPending({ filename, name, chipType, profile });
      // Reset to the smart default each time a new profile is selected so
      // there's no surprise carry-over from a previous attach.
      setPendingInclude(DEFAULT_CHIP_INCLUDE);
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  }

  // Step 2 of attaching: serialize the pending profile with the chosen
  // include flags and hand the chip up to the parent. Falls back to the
  // legacy default if for some reason no slice is selected -- prevents
  // sending an effectively-empty chip.
  function confirmAttach() {
    if (!pending) return;
    const safeInclude: ChipIncludeOptions =
      pendingInclude.summary || pendingInclude.traits || pendingInclude.overview || pendingInclude.details
        ? pendingInclude
        : DEFAULT_CHIP_INCLUDE;
    const content = formatProfileForAI(pending.profile, safeInclude);
    const includeFlags: ChipIncludeFlags = { ...safeInclude };
    onAdd({ type: pending.chipType, name: pending.name, content, include: includeFlags });
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

  // Fetch a chapter summary and attach it as a "chapter_summary" chip. Uses
  // the chapter filename (not the summary filename) as the dedup key so the
  // writer can't accidentally attach two chips for the same chapter from
  // different code paths (Suggested vs Chapter Summary tab).
  async function pickChapterSummary(chapterFilename: string, chapterTitle: string) {
    const chipName = `${chapterTitle || displayNameFromFilename(chapterFilename)} (Summary)`;
    setAdding(`chapter:${chapterFilename}`);
    try {
      if (existingChips.some(c => c.name === chipName && c.type === "chapter_summary")) {
        onClose();
        return;
      }
      const params = new URLSearchParams({
        folder_path:      rootPath,
        chapter_filename: chapterFilename,
      });
      const res = await fetch(`${API_BASE}/api/documents/chapter-summary?${params}`);
      if (!res.ok) {
        onClose();
        return;
      }
      const data = await res.json();
      const body = (data.content || "").trim();
      if (!body) {
        // The summary file exists but is empty. Attach a placeholder so the
        // writer notices something is off rather than sending blank context.
        onAdd({
          type: "chapter_summary",
          name: chipName,
          content: `[${chipName} is empty. Generate or write the summary first.]`,
        });
      } else {
        onAdd({ type: "chapter_summary", name: chipName, content: body });
      }
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  }

  // Fetch one scene summary and attach it as a "scene_summary" chip. Chip
  // name is "<Chapter Title> - <Scene Title>" so multiple scenes from different
  // chapters don't collide (the chat side dedupes by name + type).
  async function pickSceneSummary(
    chapterFilename: string,
    chapterTitle: string,
    sceneIndex: number,
    sceneTitle: string,
  ) {
    const chapter = chapterTitle || displayNameFromFilename(chapterFilename);
    const scene   = sceneTitle || `Scene ${sceneIndex}`;
    const chipName = `${chapter} - ${scene}`;
    setAdding(`scene:${chapterFilename}:${sceneIndex}`);
    try {
      if (existingChips.some(c => c.name === chipName && c.type === "scene_summary")) {
        onClose();
        return;
      }
      const params = new URLSearchParams({
        folder_path:      rootPath,
        chapter_filename: chapterFilename,
        index:            String(sceneIndex),
      });
      const res = await fetch(`${API_BASE}/api/documents/scene-summary?${params}`);
      if (!res.ok) {
        onClose();
        return;
      }
      const data = await res.json();
      const body = (data.content || "").trim();
      if (!body) {
        onAdd({
          type: "scene_summary",
          name: chipName,
          content: `[${chipName} is empty. Generate or write the scene summary first.]`,
        });
      } else {
        // Prepend the scene title so the AI knows what scene it's reading.
        // The file body itself stores just the summary body (the # heading
        // is stripped at read time per load_scene_summary's parser).
        const content = data.title
          ? `# ${data.title}\n\n${body}`
          : body;
        onAdd({ type: "scene_summary", name: chipName, content });
      }
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  }


  // Helper: turn a chapter filename into a humanized label when the title
  // from the list endpoint isn't available yet. Mirrors the fallback in
  // backend/_title_from_file -- drops the leading numeric prefix, replaces
  // separators, title-cases.
  function displayNameFromFilename(filename: string): string {
    let name = filename.replace(/\.md$/i, "");
    name = name.replace(/^\d+-/, "");
    name = name.replace(/[-_]/g, " ");
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }


  // Toggle a chapter group's expanded state in the Scene Summary tab.
  function toggleSceneGroup(chapterFilename: string) {
    setExpandedScenes(prev => {
      const next = new Set(prev);
      if (next.has(chapterFilename)) next.delete(chapterFilename);
      else                            next.add(chapterFilename);
      return next;
    });
  }

  // Filter suggested chips: only show ones not already attached
  const unattachedSuggested = suggested.filter(
    s => !existingChips.some(c => c.name === s.name && (c.type === s.type || c.type === `series_${s.type}`))
  );

  const typeColor = chipTypeColor(profileType);

  // Compute the live preview for the configure panel. We re-serialize the
  // pending profile every time the include checkboxes change so the token
  // estimate updates in real time.
  // (Kept cheap: formatProfileForAI is a single pass over already-loaded
  // section data.)
  const pendingPreview = pending ? formatProfileForAI(pending.profile, pendingInclude) : "";
  const pendingTokens  = estimateTokens(pendingPreview);

  // Whether the pending profile actually has trait sections. Most non-character
  // profile types (relationship, location, lore) have no trait blocks, so we
  // disable the "Traits" checkbox for those rather than offering a checkbox
  // that does nothing.
  const pendingHasTraits = pending
    ? (SECTION_CONFIGS[pending.profile.type as ProfileType] ?? []).some(c => c.hasTraitBlocks)
    : false;

  // Whether the pending profile has an AI Summary worth offering. Brand-new
  // profiles often haven't had a summary generated yet -- in that case we
  // disable the checkbox and label it as missing rather than letting the
  // writer toggle on something that produces nothing.
  const pendingHasSummary = Boolean(pending && pending.profile.full_ai_summary && pending.profile.full_ai_summary.trim().length > 0);

  return (
    <div className="mb-3 rounded border border-indigo-800/50 bg-bg-primary p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-300">
          {pending ? `Attach: ${pending.name}` : "Attach Context"}
        </p>
        <button onClick={onClose} className="text-xs text-faint hover:text-text-muted">✕</button>
      </div>

      {/* Configure-attachment panel -- replaces the browse list while a
          profile is pending. Shows the four include checkboxes, a token
          estimate, and a help button. The checkboxes write to pendingInclude
          which feeds back into the live preview computed above. */}
      {pending && (
        <ConfigureAttachPanel
          include={pendingInclude}
          onChange={setPendingInclude}
          tokens={pendingTokens}
          hasTraits={pendingHasTraits}
          hasSummary={pendingHasSummary}
          onShowHelp={() => setShowHelp(true)}
          onCancel={() => setPending(null)}
          onAttach={confirmAttach}
        />
      )}

      {/* Help popup -- detailed explanation of each include option and the
          effect of combining them. Triggered by the [?] button in the
          configure panel. Renders as an overlay so it doesn't disrupt the
          configure panel state behind it. */}
      {showHelp && <ChipIncludeHelp onClose={() => setShowHelp(false)} />}

      {/* Browse UI -- only shown when no profile is pending. */}
      {!pending && (
      <>
      {/* Suggested chips -- ghost chips shown at top for quick attachment.
          Character profiles only; summaries are attached via the Chapter
          Summary and Scene Summary tabs. */}
      {unattachedSuggested.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-faint">Suggested</p>
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
                : "border-border text-faint hover:text-text-muted"
            }`}
          >
            This Book
          </button>
          <button
            onClick={() => setSource("series")}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              source === "series"
                ? "border-teal-600 bg-teal-900/30 text-teal-300"
                : "border-border text-faint hover:text-text-muted"
            }`}
          >
            Series Profiles
          </button>
        </div>
      )}

      {/* Profile type tabs + Notes tab. Chapter Summary and Scene Summary
          show alongside the profile types but pull from /api/documents
          endpoints rather than /api/profiles. The source toggle (Project /
          Series) applies to profile tabs only -- summaries and notes are
          always project-scoped. */}
      <div className="mb-2 flex flex-wrap gap-1">
        {/* Profile type tabs. Series_* variants get filtered (they're chosen
            via the source toggle above, not as tabs). Notes get filtered
            because they have a dedicated tab below this row. */}
        {CHIP_TYPES.filter(t => !t.id.startsWith("series_") && t.id !== "note").map(t => (
          <button
            key={t.id}
            onClick={() => setProfileType(t.id)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              profileType === t.id
                ? t.color
                : "border-border text-faint hover:text-text-muted"
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
              : "border-border text-faint hover:text-text-muted"
          }`}
        >
          Notes
        </button>
      </div>

      {/* Content list -- branches on active tab. Notes and the two summary
          tabs each have their own data source and item shape; everything
          else falls through to the generic profile list. */}
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
                    ? "text-faint"
                    : "text-text-primary hover:bg-indigo-600/20"
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
      ) : profileType === "chapter_summary" ? (
        // Chapter Summary list: one row per chapter that has a summary in
        // summaries/chapters/. The row label shows the chapter title; the
        // resulting chip will be named "<Title> (Summary)".
        !chapterSummariesLoaded ? (
          <p className="py-1 text-xs text-faint">Loading...</p>
        ) : chapterSummaries.length === 0 ? (
          <p className="py-1 text-xs text-faint">
            No chapter summaries yet. Generate one from the chapter view first.
          </p>
        ) : (
          <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
            {chapterSummaries.map(cs => {
              const chipName = `${cs.chapter_title} (Summary)`;
              const alreadyAdded = existingChips.some(c => c.name === chipName && c.type === "chapter_summary");
              const addingKey    = `chapter:${cs.chapter_filename}`;
              return (
                <button
                  key={cs.summary_filename}
                  onClick={() => !alreadyAdded && pickChapterSummary(cs.chapter_filename, cs.chapter_title)}
                  disabled={alreadyAdded || adding === addingKey}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                    alreadyAdded ? "text-faint" : "text-text-primary hover:bg-indigo-600/20"
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full border text-sky-300 border-sky-700/50 bg-sky-900/20" />
                  {adding === addingKey
                    ? "Adding..."
                    : alreadyAdded
                    ? <><span className="opacity-50">{cs.chapter_title}</span><span className="ml-auto text-emerald-600">✓</span></>
                    : cs.chapter_title}
                </button>
              );
            })}
          </div>
        )
      ) : profileType === "scene_summary" ? (
        // Scene Summary list: chapters expand to show their scenes. Chapters
        // with no scene summaries are filtered server-side, so every group
        // shown has at least one attachable scene.
        !sceneGroupsLoaded ? (
          <p className="py-1 text-xs text-faint">Loading...</p>
        ) : sceneGroups.length === 0 ? (
          <p className="py-1 text-xs text-faint">
            No scene summaries yet. Generate them from a chapter view first.
          </p>
        ) : (
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {sceneGroups.map(group => {
              const expanded = expandedScenes.has(group.chapter_filename);
              return (
                <div key={group.chapter_filename}>
                  <button
                    onClick={() => toggleSceneGroup(group.chapter_filename)}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-text-muted hover:bg-emerald-600/10"
                  >
                    <span className="font-mono text-[10px] text-faint">{expanded ? "▾" : "▸"}</span>
                    <span className="truncate">{group.chapter_title}</span>
                    <span className="ml-auto text-[10px] text-faint">{group.scenes.length}</span>
                  </button>
                  {expanded && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-emerald-800/30 pl-2">
                      {group.scenes.map(scene => {
                        const sceneLabel = scene.title || `Scene ${scene.index}`;
                        const chipName   = `${group.chapter_title} - ${sceneLabel}`;
                        const alreadyAdded = existingChips.some(c => c.name === chipName && c.type === "scene_summary");
                        const addingKey    = `scene:${group.chapter_filename}:${scene.index}`;
                        return (
                          <button
                            key={`${group.chapter_filename}:${scene.index}`}
                            onClick={() => !alreadyAdded && pickSceneSummary(group.chapter_filename, group.chapter_title, scene.index, sceneLabel)}
                            disabled={alreadyAdded || adding === addingKey}
                            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs transition-colors disabled:cursor-not-allowed ${
                              alreadyAdded ? "text-faint" : "text-text-primary hover:bg-emerald-600/20"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full border text-emerald-300 border-emerald-700/50 bg-emerald-900/20" />
                            {adding === addingKey
                              ? "Adding..."
                              : alreadyAdded
                              ? <><span className="opacity-50">{sceneLabel}</span><span className="ml-auto text-emerald-600">✓</span></>
                              : sceneLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : loading ? (
        <p className="py-1 text-xs text-faint">Loading...</p>
      ) : profiles.length === 0 ? (
        <p className="py-1 text-xs text-faint">
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
                    ? "text-faint"
                    : "text-text-primary hover:bg-indigo-600/20"
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
      </>
      )}
    </div>
  );
}


// ── ConfigureAttachPanel ──────────────────────────────────────────────────────
// Inline panel shown after the writer clicks a profile in the chip picker.
// Lets them choose which slices of the profile to include before the chip
// is built. Driven by the four ChipIncludeOptions flags; the parent owns the
// state and re-serializes on each change so the token estimate stays live.

interface ConfigureAttachPanelProps {
  include:     ChipIncludeOptions;
  onChange:    (next: ChipIncludeOptions) => void;
  tokens:      number;
  hasTraits:   boolean;
  hasSummary:  boolean;
  onShowHelp:  () => void;
  onCancel:    () => void;
  onAttach:    () => void;
}

function ConfigureAttachPanel({
  include, onChange, tokens, hasTraits, hasSummary, onShowHelp, onCancel, onAttach,
}: ConfigureAttachPanelProps) {
  // A single helper to flip one flag without losing the others. Keeps the JSX
  // below readable -- otherwise every checkbox needs a four-field spread.
  const toggle = (key: keyof ChipIncludeOptions) =>
    onChange({ ...include, [key]: !include[key] });

  // Disable Attach when no slice is selected. Sending a chip that's just the
  // profile header line wastes tokens and confuses the AI ("why did the
  // writer attach this?"). Force the writer to pick at least one bucket.
  const anySelected = include.summary || include.traits || include.overview || include.details;

  // Visual warning when the writer's selection is unusually heavy. Same
  // thresholds as the inline chip badges: ~1.5k tokens (~6k chars) is large,
  // ~3k tokens (~12k chars) is huge.
  const isLarge = tokens > 1500;
  const isHuge  = tokens > 3000;

  return (
    <div className="mb-2 rounded border border-indigo-700/50 bg-indigo-950/30 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold text-indigo-300">What to include</p>
        <button
          onClick={onShowHelp}
          className="rounded-full border border-indigo-600 px-1.5 py-0 text-[10px] text-indigo-300 hover:bg-indigo-800/40"
          title="Detailed explanation of each option and combinations"
        >
          ?
        </button>
      </div>

      {/* Four checkboxes -- each one toggles a single bucket. Disabled
          checkboxes show a hint about why they're unavailable. */}
      <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
        <CheckboxRow
          label="AI Summary"
          checked={include.summary && hasSummary}
          disabled={!hasSummary}
          disabledHint="(no summary yet)"
          onToggle={() => toggle("summary")}
        />
        <CheckboxRow
          label="Traits"
          checked={include.traits && hasTraits}
          disabled={!hasTraits}
          disabledHint="(no trait sections)"
          onToggle={() => toggle("traits")}
        />
        <CheckboxRow
          label="Overview"
          checked={include.overview}
          onToggle={() => toggle("overview")}
        />
        <CheckboxRow
          label="Details"
          checked={include.details}
          onToggle={() => toggle("details")}
        />
      </div>

      {/* Token estimate -- updates live as the writer flips checkboxes.
          Color escalates from neutral to amber to red as the chip grows. */}
      <p className={`mb-2 text-[11px] ${isHuge ? "text-red-400" : isLarge ? "text-amber-400" : "text-faint"}`}>
        Estimated cost: ~{tokens.toLocaleString()} tokens
        {isHuge ? " (very heavy -- consider trimming)" : isLarge ? " (heavy)" : ""}
      </p>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded border border-border px-2 py-0.5 text-xs text-faint hover:text-text-muted"
        >
          Cancel
        </button>
        <button
          onClick={onAttach}
          disabled={!anySelected}
          className="rounded border border-indigo-600 bg-indigo-700/40 px-2 py-0.5 text-xs text-indigo-100 hover:bg-indigo-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Attach
        </button>
      </div>
    </div>
  );
}


// Checkbox row used inside the configure panel. Pulled out to keep the
// markup readable -- four near-identical rows would otherwise dominate the
// component. Disabled state shows a muted hint instead of the live label.
interface CheckboxRowProps {
  label:         string;
  checked:       boolean;
  disabled?:     boolean;
  disabledHint?: string;
  onToggle:      () => void;
}

function CheckboxRow({ label, checked, disabled = false, disabledHint, onToggle }: CheckboxRowProps) {
  return (
    <label className={`flex items-center gap-1.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-indigo-200"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="h-3 w-3 accent-indigo-500"
      />
      <span>{label}</span>
      {disabled && disabledHint && (
        <span className="text-[10px] text-faint">{disabledHint}</span>
      )}
    </label>
  );
}


// ── ChipIncludeHelp ───────────────────────────────────────────────────────────
// Detailed explanation popup triggered by the [?] button on the configure
// panel. Reads more like documentation than UI -- the writer is non-technical
// and needs to understand what each option actually does to their AI
// responses, not just what it costs in tokens.

interface ChipIncludeHelpProps {
  onClose: () => void;
}

function ChipIncludeHelp({ onClose }: ChipIncludeHelpProps) {
  return (
    // Fixed-position overlay so it sits above the picker without disrupting
    // its state. Click outside or the [Close] button to dismiss.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] max-w-2xl overflow-y-auto rounded border border-indigo-700/50 bg-bg-panel p-5 text-sm text-text-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-indigo-300">What each option does</h2>
          <button onClick={onClose} className="text-faint hover:text-text-muted">✕</button>
        </div>

        <p className="mb-4 text-xs text-faint">
          When you attach a profile to the AI chat, you decide which slices of it the AI sees.
          Each option below sends a different portion of the profile, and they combine. The
          token estimate in the configure panel updates as you toggle these on and off, so you
          can balance richness against cost.
        </p>

        <Section title="AI Summary">
          <p>The synthesized one-paragraph summary of the character (the “# Full AI Summary” block at the bottom of the profile file). Acts as the gist. The AI uses it to orient itself about who this character is at a glance.</p>
          <p className="mt-1"><strong>Use it when:</strong> you want the AI to know <em>who this character is</em> without sending every trait. Good for casual chat, brainstorming, “does this scene fit her at all?” questions, or when you’re attaching multiple characters and need to keep token use down.</p>
          <p className="mt-1"><strong>Skip it when:</strong> the profile doesn’t have a generated summary yet, or you want the AI working strictly from the raw traits without the synthesized phrasing influencing it.</p>
          <p className="mt-1 text-xs text-faint">Typical cost: ~80 to 200 tokens.</p>
        </Section>

        <Section title="Traits">
          <p>All trait-block sections of the profile (Physical Traits, Personality Traits, Motivations, Voice Notes, Hidden Traits, Contextual). Every trait carries an importance label in brackets ([core], [present], [background], [contextual], [hidden]) which the AI is instructed to weight when deciding whether to surface it.</p>
          <p className="mt-1"><strong>Use it when:</strong> you’re working on dialogue, voice, in-character behavior, consistency checks, or scene generation. This is the operational layer the AI needs to actually <em>act</em> as the character.</p>
          <p className="mt-1"><strong>Skip it when:</strong> you only need the gist (use AI Summary alone), or the profile is non-character (relationships, locations, lore have no trait sections).</p>
          <p className="mt-1 text-xs text-faint">Typical cost: 200 to 1500 tokens, depending on how many traits exist.</p>
        </Section>

        <Section title="Overview">
          <p>The free-text Overview section at the top of the profile (the writer’s prose introduction to the character or place). Different from AI Summary: this is what <em>you</em> wrote, not the synthesized recap.</p>
          <p className="mt-1"><strong>Use it when:</strong> the Overview contains backstory, context, or framing that doesn’t fit cleanly into trait blocks. Common for relationship profiles (history, current dynamic) and location profiles (atmosphere, role in the story).</p>
          <p className="mt-1"><strong>Skip it when:</strong> the Overview is empty, or it duplicates information already in the AI Summary or Traits.</p>
          <p className="mt-1 text-xs text-faint">Typical cost: 100 to 600 tokens.</p>
        </Section>

        <Section title="Details">
          <p>All other prose sections of the profile that aren’t the Overview and aren’t trait blocks. For a character profile, that’s mainly the Notes section and the Relationships Overview. For a relationship, it’s History, Current Dynamic, Hidden Tensions, Emotional Direction. For a location, it’s Physical Description, Tone and Atmosphere, Historical/Cultural Significance, Scene Use Notes. For lore, it’s Rule or Concept, What It Affects, What Characters Know, Story Relevance.</p>
          <p className="mt-1"><strong>Use it when:</strong> the question you’re asking the AI depends on the deeper material — “what would this lore rule do here?”, “how would they react given their history?”, “does this scene match the location’s mood?”.</p>
          <p className="mt-1"><strong>Skip it when:</strong> you’re doing light work and the gist is enough, or the profile is sparse and the detail sections are mostly empty.</p>
          <p className="mt-1 text-xs text-faint">Typical cost: highly variable — can be the largest section if the profile is detailed.</p>
        </Section>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-indigo-300">Combinations to recognize</h3>

        <Section title="Summary + Traits (the default)">
          <p>The everyday choice for character work. The AI sees who the character is at a glance and the operational trait layer it needs to write or analyze them in scene. Light enough to attach 3 or 4 characters at once for a multi-character scene check.</p>
        </Section>

        <Section title="Summary only">
          <p>The minimum viable chip. Useful when you’re attaching many profiles at once and don’t want to bloat the chat (e.g. a scene with 6 characters and you just want the AI to know who they all roughly are). The AI will know <em>who</em>, not <em>how</em>.</p>
        </Section>

        <Section title="Traits only">
          <p>Useful when the AI Summary feels off (you haven’t regenerated it after recent edits) or you specifically want the AI working from raw, importance-labeled traits without the synthesized prose nudging its interpretation.</p>
        </Section>

        <Section title="Summary + Traits + Overview + Details (everything)">
          <p>Heavy but thorough. Right for a focused deep-dive on a single character, relationship, or location — “does this whole subplot work with what I’ve established?”. Avoid stacking this across multiple profiles in one chat; you’ll burn through context quickly.</p>
        </Section>

        <Section title="Overview + Details only">
          <p>For non-character profiles (relationships, locations, lore) where there are no trait sections. This combination is what those profiles always look like effectively — the picker disables Traits when no trait sections exist, so you’ll naturally end up here.</p>
        </Section>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-indigo-300">A note about Hidden traits</h3>
        <p className="mb-3 text-xs">
          When you include Traits, traits marked [hidden] go to the AI <em>as influence material</em> — the AI is instructed never to name, describe, or quote them directly. They shape body language, dialogue choices, and what the character avoids; they don’t become content on the page. If you want the AI to ignore hidden traits entirely, mark them with a different importance level instead.
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded border border-indigo-600 bg-indigo-700/40 px-3 py-1 text-xs text-indigo-100 hover:bg-indigo-700/60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}


// Small section heading used inside the help popup. Keeps the markup tidy.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 text-xs">
      <h3 className="mb-1 text-sm font-semibold text-indigo-200">{title}</h3>
      <div className="text-text-primary">{children}</div>
    </div>
  );
}


export default App;
