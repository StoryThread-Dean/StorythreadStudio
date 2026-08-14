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

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { EditorToolbar, FONT_OPTIONS, type FontValue } from "./components/EditorToolbar";
import { ProjectHome } from "./screens/ProjectHome";
import { AudiobookConverter } from "./features/audiobook/AudiobookConverter";
import { ReaderMode } from "./screens/ReaderMode";
import { ProfileBuilder } from "./screens/ProfileBuilder";
// The Weave: a self-contained island under features/codex/, opened from the
// sidebar. This file only knows how to show it.
import { WeaveScreen } from "./features/codex/WeaveScreen";
import { WeaveNav } from "./features/codex/WeaveNav";
import { WeavingPanel } from "./features/codex/WeavingPanel";
import { WeaveContextBar } from "./features/codex/WeaveContextBar";
import { ThreadEditor } from "./features/codex/ThreadEditor";

/** The four kinds the Profile Builder owns. Everything else in the Weave is
 *  edited by the Thread editor -- named once so the three places that route on
 *  it cannot drift apart. */
const PROFILE_KINDS = ["character", "relationship", "location", "lore"];
import { OutlinePlanner } from "./screens/OutlinePlanner";
import { SummaryView }    from "./components/SummaryView";
import { SceneSummaryView } from "./components/SceneSummaryView";
import { SceneSummaryPreviewModal } from "./components/SceneSummaryPreviewModal";
import { RightPanelResizer, useRightPanelWidth, RIGHT_PANEL_CLASS } from "./components/RightPanelResizer";
import { Settings } from "./screens/Settings";
import { ProjectSettings } from "./screens/ProjectSettings";
import { ExportModal } from "./components/ExportModal";
import { EditorMenu } from "./components/EditorMenu";
import { DialogueCheck } from "./components/DialogueCheck";
import type { ProjectInfo, ChapterInfo, RecentProject, OutlineTemplateType } from "./types/project";
import { toPutPayload } from "./types/structure";
import type { StructureManifest } from "./types/structure";
import type { ProfileType, Profile, ProfileListItem } from "./types/profile";
import type {
  ContextChip, ChipIncludeFlags, EditorChatMessage, EnhanceLevel,
  SceneSummaryInfo, SplitChapterScenesResponse, GenerateSceneSummaryResponse,
  SuggestSceneBreaksResponse,
} from "./types/ai";
import { ChatMarkdown } from "./components/ChatMarkdown";
// THE CHIP PICKER READS THE SAME FOLDER THE EDITOR DOES.
//
// It fetched /api/profiles directly, which on a converted project is the BACKUP
// copy rather than the live world -- so attaching a character sent the model
// their old text, or nothing at all once the writer had tidied profiles/ away.
// Reusing the source layer means the two screens cannot disagree about where a
// writer's entries live, which is the whole reason that layer exists.
import { fetchEntriesHome, sourceFor } from "./screens/profileSource";
import type { EntriesHome } from "./screens/profileSource";
import { useTypeRegistry } from "./types/sectionRegistry";
import { formatProfileForAI, DEFAULT_CHIP_INCLUDE, estimateTokens } from "./utils/profileFormat";
import type { ChipIncludeOptions } from "./utils/profileFormat";
import { buildEditorChatPayload, appendTurnToHistory, isWeakDraftingModel, computeSurroundingWindow } from "./utils/buildEditorChatPayload";
import { autoSizeTextarea } from "./utils/autoSizeTextarea";
import { EditorAdvisorBar } from "./components/editor/EditorAdvisorBar";
import { ProjectCompletionGauge } from "./components/progress/ProjectCompletionGauge";
import { NavSection } from "./components/sidebar/NavSection";
// NavItem is no longer used here: the Notes and Profiles lists it built are
// now the Weave's own tree (WeaveNav). The component itself stays -- the
// chapter rows still use it.
import { ChapterNavRow } from "./components/sidebar/ChapterNavRow";
import { ActGroup } from "./components/sidebar/ActGroup";
import { GlobalSearchModal } from "./components/GlobalSearchModal";
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
import { useProjectUiState } from "./hooks/useProjectUiState";
import { initTheme } from "./hooks/useTheme";
import { initUiScale } from "./hooks/useUiScale";
import { ThemeToggle } from "./components/ThemeToggle";
import { Bot, Send, ChevronDown, CornerDownRight, PenLine, Sparkles, HelpCircle, Brain } from "lucide-react";
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

  // Per-book remembered UI state (sidebar collapse states, Book Details
  // expansion). Persisted inside the project folder via the backend so it
  // survives restarts, updates, and moving the project between machines.
  const projectUi = useProjectUiState(currentProject?.root_path ?? null);

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
    | "outline_planner" | "weave" | "thread"
  >("editor");
  // Which Weave section the sidebar shows as active. Kept here rather than
  // inside WeaveNav because opening a section changes the VIEW, and the view
  // lives in this file.
  const [weaveSection, setWeaveSection] = useState<string | null>(null);
  // Weaving opens as a right-hand panel rather than a screen: it is a
  // conversation ABOUT the book, and taking the book away to have it would
  // make every stop harder to judge.
  const [weavingOpen, setWeavingOpen] = useState(false);
  // Which entry Weaving sent the writer to, so the Profile Builder opens
  // on THAT one rather than on its list. "Open it" has to open it.
  const [profileFilename, setProfileFilename] = useState<string | undefined>();
  // Which kind of Weave entry the Thread editor has open. The Profile
  // Builder covers four kinds; everything else in the Weave -- factions,
  // deities, objects, a writer's own Race -- is edited here.
  const [threadType, setThreadType] = useState<string | null>(null);
  // Audiobook Converter: a standalone tool shown INSTEAD of Project Home
  // when no writing project is open. Not part of currentView because it
  // never coexists with the editor layout.
  const [showAudiobookConverter, setShowAudiobookConverter] = useState(false);
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

  // Global Search + Replace modal visibility (Ctrl+Shift+F)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  // Banner shown briefly when Global Replace modifies the open chapter.
  const [globalReplaceBanner, setGlobalReplaceBanner] = useState<string | null>(null);

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

  // Draft mode: when ON, a typed message asks the AI to write story prose (a
  // scene or chapter segment) instead of discussing the text. The Continue
  // button always drafts regardless of this toggle. Off = normal discussion.
  const [draftMode, setDraftMode] = useState(false);
  // One-time, dismissible nudge shown when the writer drafts on a weak model
  // (cheap tiers produce generic prose). Never blocks; resets per session.
  const [showDraftModelNudge, setShowDraftModelNudge] = useState(false);
  const [draftNudgeDismissed, setDraftNudgeDismissed] = useState(false);

  // Enhance mode: when ON, the writer highlights a passage and the AI returns a
  // richer, expanded rewrite of ONLY that selection (grounded by surrounding
  // paragraphs). Mutually exclusive with Draft mode. enhanceLevel controls how
  // much it expands. A one-time dismissible nudge suggests attaching the
  // chapter/outline/profiles as context for better grounding.
  const [enhanceMode, setEnhanceMode] = useState(false);
  const [enhanceLevel, setEnhanceLevel] = useState<EnhanceLevel>("default");
  const [enhanceNudgeDismissed, setEnhanceNudgeDismissed] = useState(false);

  // Chat-mode help: expands an explanation panel under the Draft / Enhance /
  // Reasoning toggles describing what each mode does and when to use it.
  // Same pattern as the Canon/Reference "What's this?" help.
  const [showModeHelp, setShowModeHelp] = useState(false);

  // "New ask" boundaries: indices into chatMessages where a fresh ask begins.
  // Only messages at/after the LAST boundary are sent to the AI, so an unrelated
  // follow-up (e.g. a different highlighted passage) isn't contaminated by the
  // prior ask -- without erasing the visible transcript (that's what Clear does).
  const [askBoundaries, setAskBoundaries] = useState<number[]>([]);
  // The selection text last submitted, so we can nudge "start a new ask" when the
  // writer moves to a different passage after a result.
  const [lastSentSelection, setLastSentSelection] = useState("");
  // The selection text that was SUCCESSFULLY sent and persisted into the chat
  // history (as a hidden materials message). Different from lastSentSelection:
  // that one is set optimistically before the request (for the "new ask" nudge),
  // this one only after the backend confirms -- so a failed send never marks a
  // selection as "already in the history". buildEditorChatPayload uses it to
  // stop resending an unchanged highlight every turn, which used to stack a
  // duplicate copy of the selection into the payload on each follow-up.
  const [establishedSelection, setEstablishedSelection] = useState("");

  // Canon/Reference toggle (attachment popup): when ON (default), attached
  // profiles/outline/locations are treated as canon the AI must stay consistent
  // with. When OFF, they are reference only and the writer's typed direction wins.
  const [treatAsCanon, setTreatAsCanon] = useState(true);

  // WHAT THE WEAVE WILL TELL THE AI, assembled locally and inspected by the
  // writer before any request carries it. Held here rather than inside the
  // bar because the send path is what transmits it -- which is the locked
  // context rule: nothing goes until the writer initiates an AI action.
  const [weaveBrief, setWeaveBrief] = useState("");

  // Reasoning toggle: when ON, chat requests ask OpenRouter for the model's
  // reasoning trace, shown as a collapsible block above the reply. Only offered
  // when the active model supports reasoning (see the capability fetch below) --
  // reasoningCapableIds holds the reasoning-capable slugs from the model list,
  // and globalDefaultModel resolves which model is active when the project has
  // no per-project override.
  const [reasoningMode, setReasoningMode] = useState(false);
  const [reasoningCapableIds, setReasoningCapableIds] = useState<Set<string>>(new Set());
  const [globalDefaultModel, setGlobalDefaultModel] = useState("");

  // One capability fetch per project open. Best-effort: without an API key the
  // models call fails and the set stays empty, which simply hides the toggle.
  useEffect(() => {
    if (!currentProject?.root_path) return;
    (async () => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/api/ai/models`),
          fetch(`${API_BASE}/api/settings`),
        ]);
        if (mRes.ok) {
          const models: { id: string; supports_reasoning?: boolean }[] = await mRes.json();
          setReasoningCapableIds(new Set(
            models.filter(m => m.supports_reasoning).map(m => m.id)
          ));
        }
        if (sRes.ok) {
          const settings = await sRes.json();
          setGlobalDefaultModel(settings.default_model ?? "");
        }
      } catch { /* toggle stays hidden */ }
    })();
  }, [currentProject?.root_path]);

  // The model the next chat request will actually use: the project override
  // if set, otherwise the global default from Settings.
  const activeChatModel = currentProject?.default_model || globalDefaultModel;
  const activeModelSupportsReasoning =
    activeChatModel !== "" && reasoningCapableIds.has(activeChatModel);

  // Scene-break suggestions: true while the "Suggest Breaks" toolbar request is
  // in flight. Results are rendered into the Writing Companion chat below.
  const [suggestBreaksRunning, setSuggestBreaksRunning] = useState(false);

  // Smart Advisor state. Currently-active issues are owned by the editor's
  // StateField (see components/editor/issueOverlay.ts); we mirror just the
  // count here for the toolbar's pill and Done button. The popover state
  // captures which issues to render and where to anchor the popover after a
  // click on a highlight; null = popover closed.
  const [issueCount, setIssueCount] = useState(0);
  const [issuePopover, setIssuePopover] = useState<IssueClickDetail | null>(null);

  // Writing Progress: whether the gauge's slide-over breakdown is expanded.
  // Lifted here so future left-panel coordination (close on project switch,
  // etc.) is easy if we ever need it.
  const [progressOpen, setProgressOpen] = useState(false);

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

  // The acts/order tree from manuscript/structure.json (null = load failed
  // or not loaded yet -> the sidebar falls back to the flat chapter list, so
  // the app keeps working even if the structure endpoint is unavailable).
  // `chapters` above stays the single source of chapter METADATA; this tree
  // only groups and orders filenames.
  const [structure, setStructure] = useState<StructureManifest | null>(null);

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
  // Dialogue Check: the passage the writer had selected when they opened
  // it. Held as TEXT rather than offsets -- the tool is read-only and
  // never edits, so it should not care what happens in the editor while
  // it is open.
  const [dialogueCheckText, setDialogueCheckText] = useState<string | null>(null);
  // Whether that text came from a real selection. The panel says so --
  // a gentle reminder, because reading a whole chapter is legitimate but
  // rarely what somebody meant by "check this passage".
  const [dialogueCheckSelected, setDialogueCheckSelected] = useState(true);

  // Ref for use inside callbacks -- gives the latest value without stale closures.
  // A "stale closure" is when a function captures an old version of a variable.
  // The ref always points to the current value, even inside older closures.
  const editorViewRef = useRef<EditorView | null>(null);
  const currentChapterRef = useRef<ChapterInfo | null>(null);
  const currentProjectRef = useRef<ProjectInfo | null>(null);
  const currentNoteRef = useRef<{ filename: string; title: string } | null>(null);
  const currentViewRef = useRef<
    "editor" | "profiles" | "notes" | "chapter_summary" | "scene_summary"
    | "outline_planner" | "weave" | "thread"
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
  // ── Acts / structure tree (manuscript/structure.json) ────────────────────
  // The manifest is the manuscript's reading-order authority. Every mutation
  // follows one pattern: adjust the tree in memory, PUT the whole thing, and
  // adopt the server's echoed (validated + healed) version as truth. There
  // are no per-operation endpoints -- see backend/app/routers/structure.py.

  const loadStructure = useCallback(async (projectPath: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/structure?folder_path=${encodeURIComponent(projectPath)}`
      );
      if (!res.ok) throw new Error();
      setStructure(await res.json());
    } catch {
      // Graceful degradation: with no tree the sidebar renders the flat
      // chapter list, exactly like before acts existed.
      setStructure(null);
    }
  }, []);

  const putStructure = useCallback(async (next: StructureManifest) => {
    const project = currentProjectRef.current;
    if (!project) return;
    setStructure(next);   // optimistic -- the sidebar responds instantly
    try {
      const res = await fetch(`${API_BASE}/api/structure`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(toPutPayload(project.root_path, next)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? "Could not save manuscript structure.");
      }
      // Adopt the healed echo (server may have assigned ids to new acts or
      // dropped files that vanished mid-operation).
      setStructure(await res.json());
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not save structure.");
      await loadStructure(project.root_path);   // resync with disk truth
    }
  }, [loadStructure]);

  // Create a new act at the end of the act list.
  const handleAddAct = useCallback(() => {
    if (!structure) return;
    const name = window.prompt("Act name:", `Act ${structure.acts.length + 1}`);
    if (!name || !name.trim()) return;
    void putStructure({
      ...structure,
      acts: [...structure.acts, { id: "", title: name.trim(), chapters: [] }],
    });
  }, [structure, putStructure]);

  const handleRenameAct = useCallback((actId: string, newTitle: string) => {
    if (!structure) return;
    void putStructure({
      ...structure,
      acts: structure.acts.map(a => a.id === actId ? { ...a, title: newTitle } : a),
    });
  }, [structure, putStructure]);

  // Move an act up/down in the act list. delta is -1 or +1.
  const handleMoveAct = useCallback((actId: string, delta: number) => {
    if (!structure) return;
    const idx = structure.acts.findIndex(a => a.id === actId);
    const to  = idx + delta;
    if (idx < 0 || to < 0 || to >= structure.acts.length) return;
    const acts = [...structure.acts];
    [acts[idx], acts[to]] = [acts[to], acts[idx]];
    void putStructure({ ...structure, acts });
  }, [structure, putStructure]);

  // Delete an act. Its chapters are NOT deleted -- they drop back into the
  // unassigned bucket (an act is just a grouping, never a container that
  // owns files).
  const handleDeleteAct = useCallback((actId: string) => {
    if (!structure) return;
    const act = structure.acts.find(a => a.id === actId);
    if (!act) return;
    if (act.chapters.length > 0) {
      const ok = window.confirm(
        `Delete "${act.title}"? Its ${act.chapters.length} chapter(s) are NOT deleted -- they move to Unassigned.`
      );
      if (!ok) return;
    }
    void putStructure({
      ...structure,
      acts: structure.acts.filter(a => a.id !== actId),
      unassigned: [...structure.unassigned, ...act.chapters],
    });
  }, [structure, putStructure]);

  // Move a chapter into another act (or the unassigned bucket when
  // targetActId is null). Appends at the end of the target.
  const handleMoveChapterToAct = useCallback((filename: string, targetActId: string | null) => {
    if (!structure) return;
    let moved = structure.unassigned.find(c => c.filename === filename)
      ?? structure.acts.flatMap(a => a.chapters).find(c => c.filename === filename);
    if (!moved) return;
    const without = {
      ...structure,
      acts: structure.acts.map(a => ({
        ...a, chapters: a.chapters.filter(c => c.filename !== filename),
      })),
      unassigned: structure.unassigned.filter(c => c.filename !== filename),
    };
    void putStructure(targetActId === null
      ? { ...without, unassigned: [...without.unassigned, moved] }
      : {
          ...without,
          acts: without.acts.map(a =>
            a.id === targetActId ? { ...a, chapters: [...a.chapters, moved] } : a
          ),
        });
  }, [structure, putStructure]);

  // Move a chapter up/down WITHIN its current container (act or unassigned).
  const handleMoveChapterWithin = useCallback((filename: string, delta: number) => {
    if (!structure) return;

    const moveIn = (list: typeof structure.unassigned) => {
      const idx = list.findIndex(c => c.filename === filename);
      const to  = idx + delta;
      if (idx < 0 || to < 0 || to >= list.length) return null;
      const next = [...list];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    };

    for (const act of structure.acts) {
      const next = moveIn(act.chapters);
      if (next) {
        void putStructure({
          ...structure,
          acts: structure.acts.map(a => a.id === act.id ? { ...a, chapters: next } : a),
        });
        return;
      }
      if (act.chapters.some(c => c.filename === filename)) return; // at edge
    }
    const next = moveIn(structure.unassigned);
    if (next) void putStructure({ ...structure, unassigned: next });
  }, [structure, putStructure]);


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

      // Add to chapter list and open it. The structure tree is refetched so
      // the new chapter appears in the sidebar's Unassigned bucket.
      setChapters((prev) => [...prev, newChapter].sort((a, b) => a.filename.localeCompare(b.filename)));
      void loadStructure(currentProject.root_path);
      loadChapter(newChapter, currentProject);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not create chapter.");
    }
  }, [currentProject, chapters.length, loadChapter, loadStructure]);


  // --- Rename cascade bookkeeping ---
  // A rename now changes the FILENAME too, and filenames are the key for a
  // lot of App state (Sets, Maps, open views). This helper owns the entire
  // swap in one place so nothing keyed on the old name goes stale.
  const migrateChapterKey = useCallback((
    oldFilename: string,
    newFilename: string,
    newTitle: string,
    newPath: string,
  ) => {
    // ⚠ CRITICAL ORDER: if the renamed chapter is the OPEN one, snapshot the
    // live editor buffer into chapterContent BEFORE touching
    // currentChapter.filename. MarkdownEditor is keyed on the filename --
    // changing it remounts the editor from `chapterContent`, and without
    // this snapshot any unsaved typing would silently revert to the last
    // saved text. (isDirty is left as-is, so the unsaved indicator and
    // Ctrl+S keep working across the remount.)
    if (currentChapterRef.current?.filename === oldFilename && editorViewRef.current) {
      setChapterContent(editorViewRef.current.state.doc.toString());
    }

    const swapRef = (c: { filename: string; title: string }) =>
      c.filename === oldFilename ? { filename: newFilename, title: newTitle } : c;

    setChapters(prev => prev.map(c =>
      c.filename === oldFilename
        ? { filename: newFilename, title: newTitle, path: newPath }
        : c
    ));
    setCurrentChapter(prev =>
      prev && prev.filename === oldFilename
        ? { filename: newFilename, title: newTitle, path: newPath }
        : prev
    );
    setStructure(prev => prev === null ? prev : {
      ...prev,
      acts: prev.acts.map(a => ({ ...a, chapters: a.chapters.map(swapRef) })),
      unassigned: prev.unassigned.map(swapRef),
    });
    setExpandedChapters(prev => {
      if (!prev.has(oldFilename)) return prev;
      const next = new Set(prev);
      next.delete(oldFilename);
      next.add(newFilename);
      return next;
    });
    setExpandedSceneGroups(prev => {
      if (!prev.has(oldFilename)) return prev;
      const next = new Set(prev);
      next.delete(oldFilename);
      next.add(newFilename);
      return next;
    });
    setSceneSummariesByChapter(prev => {
      if (!prev.has(oldFilename)) return prev;
      const next = new Map(prev);
      next.set(newFilename, next.get(oldFilename)!);
      next.delete(oldFilename);
      return next;
    });
    setCurrentSummaryChapter(prev => (prev === oldFilename ? newFilename : prev));
    setCurrentSummaryScene(prev =>
      prev?.chapterFile === oldFilename ? { ...prev, chapterFile: newFilename } : prev
    );
  }, []);

  // --- Rename a chapter inline from the left nav ---
  // The backend rewrites the first `# heading` line AND renames the file so
  // the slug matches the title (NN- prefix kept), cascading the chapter
  // summary, scene folder, structure manifest, and progress history along.
  // We patch every piece of state keyed on the old filename via
  // migrateChapterKey. Older backends that return no filename change fall
  // back to a title-only patch.
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

      if (data.filename && data.filename !== filename) {
        // File was renamed -- swap every filename-keyed piece of state.
        migrateChapterKey(filename, data.filename, data.title, data.path);

        // The cascade steps after the file rename are fail-soft on the
        // backend; surface a gentle heads-up if any were skipped so the
        // writer isn't surprised by an un-paired summary later.
        const flags: [string, boolean][] = [
          ["chapter summary",   data.summary_moved   ?? true],
          ["scene summaries",   data.scenes_moved    ?? true],
          ["act assignment",    data.structure_updated ?? true],
          ["progress history",  data.progress_migrated ?? true],
        ];
        const skipped = flags.filter(([, ok]) => !ok).map(([label]) => label);
        if (skipped.length > 0) {
          setEditorError(
            `Renamed, but could not update: ${skipped.join(", ")}. ` +
            "These re-pair automatically the next time they're touched."
          );
          return;
        }
      } else {
        // Title-only change (same slug) -- patch titles in place.
        setChapters(prev => prev.map(c =>
          c.filename === filename ? { ...c, title: data.title } : c
        ));
        setCurrentChapter(prev =>
          prev && prev.filename === filename ? { ...prev, title: data.title } : prev
        );
        setStructure(prev => prev === null ? prev : {
          ...prev,
          acts: prev.acts.map(a => ({
            ...a,
            chapters: a.chapters.map(c =>
              c.filename === filename ? { ...c, title: data.title } : c
            ),
          })),
          unassigned: prev.unassigned.map(c =>
            c.filename === filename ? { ...c, title: data.title } : c
          ),
        });
      }
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not rename chapter.");
    }
  }, [chapters, migrateChapterKey]);


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
      // The backend already removed the chapter from structure.json --
      // refetch so the sidebar tree drops the row too.
      void loadStructure(project.root_path);
      setEditorError(null);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Could not delete chapter.");
    }
  }, [currentSummaryChapter, currentSummaryScene, loadStructure]);


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
    setStructure(null);
    setCurrentChapter(null);
    setChapterContent("");
    setIsDirty(false);
    setEditorError(null);

    // Fetch the acts tree in parallel with the chapter list -- neither
    // depends on the other, and a structure failure only costs the acts
    // grouping (flat list fallback), never the chapters themselves.
    void loadStructure(project.root_path);

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
  }, [loadChapter, loadStructure]);


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

      // Keep the sidebar title in sync with the saved content. The backend
      // derives a chapter's display title from its first "# " heading, but
      // the `chapters` list is only fetched at project open -- so if the
      // writer edits the H1 in the editor, the sidebar would show the old
      // title until an app restart. Re-derive it here from the exact bytes
      // we just saved (same rule the backend uses: first H1 wins).
      if (activeView !== "notes" && chapter) {
        const h1 = content.match(/^#\s+(.+)$/m);
        const newTitle = h1?.[1].trim();
        if (newTitle && newTitle !== chapter.title) {
          setChapters(prev => prev.map(c =>
            c.filename === chapter.filename ? { ...c, title: newTitle } : c
          ));
          setCurrentChapter(prev =>
            prev && prev.filename === chapter.filename
              ? { ...prev, title: newTitle }
              : prev
          );
        }
      }

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


  // --- Suggest scene breaks ---
  // Sends the open chapter to the AI and asks where `---` scene breaks would
  // help. Results are formatted into the Writing Companion chat (reusing
  // ChatMarkdown), where the writer reads them and inserts breaks by hand.
  // No auto-apply: this only suggests.
  const handleSuggestSceneBreaks = useCallback(async () => {
    const project = currentProjectRef.current;
    const chapter = currentChapterRef.current;
    if (!project || !chapter || suggestBreaksRunning) return;

    // Use the live editor text (includes unsaved edits) so suggestions match
    // what the writer is currently looking at.
    const view = editorViewRef.current;
    const chapterText = view ? view.state.doc.toString() : chapterContent;
    if (!chapterText.trim()) return;

    setSuggestBreaksRunning(true);
    setChatError(null);

    try {
      const res = await fetch(`${API_BASE}/api/ai/suggest-scene-breaks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_path: `${project.root_path}/manuscript/${chapter.filename}`,
          project_path: project.root_path,
          chapter_text: chapterText,
          model_id:     project.default_model || undefined,
          content_mode: project.content_mode_default ?? "general",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Request failed (${res.status})`);
      }

      const data: SuggestSceneBreaksResponse = await res.json();
      if (data.model_used) setChatModelUsed(data.model_used);

      // Format the structured result as markdown for the chat panel. The writer
      // reads each quote-anchored suggestion and places the break themselves.
      const severityLabel: Record<string, string> = {
        strong: "Strong", moderate: "Moderate", subtle: "Subtle",
      };
      let reply: string;
      if (data.suggestions.length === 0) {
        reply = `**Scene break suggestions**\n\n${data.analysis || "No strong scene-break candidates found in this chapter."}`;
      } else {
        const items = data.suggestions.map(s =>
          `**${severityLabel[s.severity] ?? "Suggested"}** — place a break after:\n\n> ${s.quote}\n\n${s.explanation}`
        ).join("\n\n---\n\n");
        reply = `**Scene break suggestions**\n\n${data.analysis}\n\n---\n\n${items}\n\n---\n\n_Insert a \`---\` line (blank line above and below) at each spot you agree with. Nothing was changed in your manuscript._`;
      }

      setChatMessages(prev => [
        ...prev,
        { role: "user", content: "Suggest scene breaks for this chapter." },
        { role: "assistant", content: reply },
      ]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      if (err instanceof TypeError && err.message.toLowerCase().includes("failed to fetch")) {
        setChatError("Could not reach the backend. Check that it is running on port 8000.");
      } else {
        setChatError(err instanceof Error ? err.message : "Scene-break request failed.");
      }
    } finally {
      setSuggestBreaksRunning(false);
    }
  }, [suggestBreaksRunning, chapterContent]);


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
  // the AI hasn't seen yet in this conversation. Materials from prior turns
  // genuinely live in the conversation history: the backend echoes each
  // turn's materials block back (materials_content) and the success handler
  // persists it as a hidden history message, so it rides along in every
  // later request. (Before this, "established" materials were sent exactly
  // once and then vanished -- the AI forgot profiles after turn one.)
  //
  // "Established" = sent in a prior turn (muted in UI, in the AI's history).
  // "New"         = first time being sent (bright in UI, included in payload).
  // Note: the persisted chapter text is a snapshot from when it was sent;
  // Start a new ask to refresh it after heavy edits.
  const sendEditorChat = useCallback(async (opts?: {
    // When set, send this text as the user turn instead of the input box.
    // Used by the Continue button (a canned "keep going" message).
    overrideText?: string;
    // Force a category. Defaults to mode-aware "chat"/"draft"/"enhance".
    category?: "chat" | "draft" | "enhance";
    // Skip sending any chapter/selection text (Continue relies on history).
    suppressText?: boolean;
  }) => {
    const messageText = (opts?.overrideText ?? chatInput).trim();
    if (!messageText || chatLoading) return;

    // Resolve the category: explicit override wins, else follow the toggles.
    // Draft and Enhance are mutually exclusive (enforced by the toggle handlers),
    // so at most one is on here.
    const category: "chat" | "draft" | "enhance" =
      opts?.category ?? (draftMode ? "draft" : enhanceMode ? "enhance" : "chat");
    const modelId = currentProjectRef.current?.default_model || undefined;

    // Enhance needs a highlighted passage to expand. Guard early with a clear
    // hint rather than sending an empty target.
    if (category === "enhance" && !selectedText.trim()) {
      setChatError("Highlight the passage you want to enhance first.");
      return;
    }

    // Non-blocking nudge: if we're about to draft on a weak model, surface a
    // one-time suggestion to switch to a stronger one. Never stops the request.
    if (category === "draft" && !draftNudgeDismissed && isWeakDraftingModel(modelId)) {
      setShowDraftModelNudge(true);
    }

    // ── Decide what materials this turn carries (text + new chips) ─────────
    // Delegated to a pure helper so the branching is unit-tested. Continue
    // turns suppress text entirely (the prose so far is in the history).
    const view = editorViewRef.current;
    const fullChapterText = view ? view.state.doc.toString() : null;

    // For enhance, compute the surrounding-paragraph grounding window from the
    // live selection offsets into the full chapter. (Other modes send "".)
    let surroundingContext = "";
    if (category === "enhance" && view && fullChapterText) {
      const sel = view.state.selection.main;
      surroundingContext = computeSurroundingWindow(fullChapterText, sel.from, sel.to);
    }

    const payloadCore = buildEditorChatPayload({
      category,
      selectedText,
      fullChapterText,
      includeChapter,
      chapterEstablished,
      establishedSelection,
      contextChips,
      establishedChipKeys,
      suppressText: opts?.suppressText ?? false,
      enhanceLevel,
      surroundingContext,
    });
    const textContent = payloadCore.text_content;
    const newChips    = payloadCore.context_chips;

    const userMsg: EditorChatMessage = { role: "user", content: messageText };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    // Remember which passage this ask was about, so we can nudge a "new ask" when
    // the writer moves to a different selection later.
    setLastSentSelection(selectedText);
    // Only clear the input box when we actually sent what was typed there.
    if (opts?.overrideText === undefined) setChatInput("");
    setChatLoading(true);
    setChatError(null);
    setChatModelUsed(currentProjectRef.current?.default_model || null);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    // --- Cancellation + timeout setup ---
    // controller: can be aborted by the hard 300s timer OR by the user clicking [Cancel].
    // cancelButtonTimer: reveals the [Cancel] button after 20s of waiting --
    //   long enough that quick responses don't show the button at all, short
    //   enough that impatient writers aren't stuck staring at "Thinking..."
    // hardTimeoutTimer: safety net matching the backend REQUEST_TIMEOUT (300s).
    //   300s (up from 180s) because follow-up turns now carry the persisted
    //   materials in history: slow reasoning models that don't prompt-cache
    //   (AionLabs Aion-3.0 in live testing) re-read the whole payload every
    //   turn and legitimately need the headroom on drafting turns.
    const controller = new AbortController();
    chatAbortRef.current        = controller;
    chatManualCancelRef.current = false;
    setChatCanCancel(false);
    const cancelButtonTimer = setTimeout(() => setChatCanCancel(true), 20_000);
    const hardTimeoutTimer  = setTimeout(() => controller.abort(), 300_000);

    try {
      const res = await fetch(`${API_BASE}/api/ai/editor-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          // "chat" = discussion companion; "draft" = the AI writes prose.
          // Structured Readability/Structure/Context feedback runs through
          // /api/ai/editor-pass and renders as inline highlights instead.
          category:        category,
          text_content:    payloadCore.text_content,
          is_full_chapter: payloadCore.is_full_chapter,
          // Only send messages from the current "new ask" boundary onward, so a
          // fresh ask starts the AI with a clean slate (the full transcript stays
          // visible in the UI). lastBoundary is 0 when no boundary is set.
          messages:        newMessages.slice(askBoundaries[askBoundaries.length - 1] ?? 0),
          context_chips:   newChips,
          model_id:        modelId,
          content_mode:    currentProjectRef.current?.content_mode_default ?? "general",
          project_path:    currentProjectRef.current?.root_path ?? null,
          // Enhance mode only; harmless empties for other modes (backend ignores).
          surrounding_context: payloadCore.surrounding_context,
          enhance_level:       payloadCore.enhance_level,
          // Canon/Reference toggle: how the AI treats attached chips.
          treat_attachments_as_canon: treatAsCanon,
          // True while ANY chips are attached (context_chips above only
          // carries the NEW ones) -- keeps the backend's ATTACHMENT STANCE
          // instruction active for the whole life of the attachment.
          has_attached_context: contextChips.length > 0,
          // WHAT THE WEAVE ASSEMBLED, and the moment it actually travels.
          // Built locally and already inspectable in the bar above the chat;
          // it rides along here because the writer just initiated an AI
          // action, which is the only thing allowed to transmit it. Empty
          // when they switched it off, emptied it, or it did not fit.
          weave_brief: weaveBrief,
          // Reasoning toggle: only honored by reasoning-capable models, and the
          // toggle is hidden otherwise, so this is false unless both are true.
          include_reasoning: reasoningMode && activeModelSupportsReasoning,
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
      // Rebuild the history from the pre-send snapshot (`chatMessages` is the
      // closure value from before userMsg was optimistically appended --
      // chatLoading serializes sends, so nothing else touched it since).
      // appendTurnToHistory slots the backend's echoed materials block in as
      // a HIDDEN message just before the user turn -- that's what keeps the
      // attached profiles + chapter text in front of the model on every
      // later turn instead of vanishing after the turn they were sent.
      const assistantMsg: EditorChatMessage = {
        role: "assistant",
        content: data.reply,
        // Reasoning trace rides along when the toggle was on and the model
        // emitted one; rendered as a collapsible block above the reply.
        ...(data.reasoning ? { reasoning: data.reasoning } : {}),
      };
      setChatMessages(appendTurnToHistory(chatMessages, userMsg, data.materials_content, assistantMsg));
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

      // ── Mark materials as established after successful send ────────────
      // These will show as muted in the UI and won't be resent on future turns.
      if (textContent) {
        setChapterEstablished(true);
        // Record a persisted selection so an unchanged highlight isn't resent
        // next turn. Gated on materials_content: only when the backend echoed
        // the materials (and we just appended them to history above) is the
        // selection genuinely in front of the model on future turns. Enhance
        // echoes nothing by design, so it keeps resending -- correct for it.
        if (data.materials_content && !payloadCore.is_full_chapter) {
          setEstablishedSelection(textContent);
        }
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
          setChatError("Request timed out after 5 minutes. Try a faster model, fewer attachments, or a shorter selection.");
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
    // weaveBrief is in here deliberately: without it this callback would
    // close over the brief as it was when the deps last changed and send that
    // instead of what the writer is looking at now -- the exact stale-closure
    // shape that made Quick Fill wipe half-typed boxes.
  }, [chatInput, chatMessages, selectedText, contextChips, chatLoading, includeChapter, chapterEstablished, establishedSelection, establishedChipKeys, draftMode, draftNudgeDismissed, enhanceMode, enhanceLevel, askBoundaries, treatAsCanon, reasoningMode, activeModelSupportsReasoning, weaveBrief]);


  // --- Start a new ask ---
  // Drops a boundary at the current end of the transcript. Subsequent turns send
  // only messages after this point to the AI (clean slate), while the visible
  // transcript is preserved. Attached chips are kept but re-armed so they attach
  // to the fresh ask; the chapter is re-sendable again too.
  const startNewAsk = useCallback(() => {
    setAskBoundaries(prev => {
      const boundary = chatMessages.length;
      // No-op if we're already at a fresh boundary (nothing new since last one).
      if (prev[prev.length - 1] === boundary) return prev;
      return [...prev, boundary];
    });
    setEstablishedChipKeys(new Set());
    setChapterEstablished(false);
    setLastSentSelection("");
    setEstablishedSelection("");
    setChatError(null);
  }, [chatMessages.length]);


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
    setAskBoundaries([]);
    setLastSentSelection("");
    setEstablishedSelection("");
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


  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+Shift+F: open Global Search + Replace (only when a project is open)
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        if (currentProject) setShowGlobalSearch(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, currentProject]);


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
    // The Audiobook Converter is a standalone tool beside the writing app:
    // its own dashboard, its own workspaces, its own jewel-tone look. It is
    // only reachable from Project Home (no project open), never from
    // inside a writing project.
    if (showAudiobookConverter) {
      return (
        <>
          {backendDownBanner}
          {updateOverlays}
          <AudiobookConverter onExit={() => setShowAudiobookConverter(false)} />
        </>
      );
    }
    return (
      <>
        {backendDownBanner}
        {updateOverlays}
        <ProjectHome
          onProjectOpen={handleProjectOpen}
          onOpenAudiobooks={() => setShowAudiobookConverter(true)}
        />
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
          initialFilename={profileFilename}
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
      <aside className="relative flex w-64 shrink-0 flex-col border-r border-border bg-bg-panel">

        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-wide text-text-primary">
              Storythread Studio
            </h1>
            <ThemeToggle />
          </div>

          {/* Project title + switcher dropdown. The old settings gear that
              sat next to the title is gone -- everything it opened now
              lives in the Book Details popout (see the BOOK DETAILS section
              at the top of the nav below). */}
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

          {/* Book Details -- opens the popout modal (formerly "Project
              Settings" behind a tiny gear icon; the gear is gone and this
              section is the one entry point). The modal holds the story
              facts that feed AI prompts (genre, tone, theme, setting, POV,
              tense, audience), the word-count target, plus content mode
              and the model picker. */}
          <div className="mb-4">
            <button
              onClick={() => setShowProjectSettings(true)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wider text-text-muted transition-colors hover:bg-bg-surface hover:text-text-primary"
              title="Title, genre, tone, POV, word target, AI model... everything about this book"
            >
              <span>Book Details</span>
              <span aria-hidden="true" className="normal-case text-faint">&#8599;</span>
            </button>
          </div>

          {/* Manuscript section -- the acts tree.
              Story > Act > Chapter > (Chapter Summary + Scenes). Acts come
              from manuscript/structure.json (see loadStructure); a project
              that never made an act just shows its chapters flat, exactly
              like before. Moving/reordering is menu-based (hover the '...'
              on a row) -- drag-and-drop is a roadmap enhancement. */}
          <NavSection label="Manuscript">
            {chapters.length === 0 && (
              <p className="px-2 text-xs text-faint">No chapters found.</p>
            )}
            {(() => {
              // One row renderer shared by every container (acts, the
              // unassigned bucket, and the flat no-structure fallback).
              // `pos` describes the chapter's place in its container so the
              // menu can offer/disable Move up / Move down correctly; null
              // means "no move menu" (flat fallback keeps the plain trash).
              const chapterByFilename = new Map(chapters.map(c => [c.filename, c]));

              const renderChapterRow = (
                filename: string,
                fallbackTitle: string,
                pos: { actId: string | null; index: number; count: number } | null,
              ) => {
                // Metadata comes from `chapters`; a manifest entry we don't
                // have metadata for yet (file added mid-session) degrades to
                // its manifest title and loads fine by filename.
                const chapter: ChapterInfo = chapterByFilename.get(filename)
                  ?? { filename, title: fallbackTitle, path: "" };

                const isExpanded        = expandedChapters.has(filename);
                const isActiveChapter   = currentView === "editor" && currentChapter?.filename === filename;
                const isChapterSummaryActive = currentView === "chapter_summary" && currentSummaryChapter === filename;
                // "Summary ancestor" -- any descendant of this chapter is
                // the active view; subtly highlight the chapter row so the
                // writer can trace back up the tree.
                const isSceneSummaryActiveInThisChapter =
                  currentView === "scene_summary" &&
                  currentSummaryScene?.chapterFile === filename;
                const isSummaryAncestor = isChapterSummaryActive || isSceneSummaryActiveInThisChapter;

                const sceneSummaries  = sceneSummariesByChapter.get(filename);
                const isScenesExpanded = expandedSceneGroups.has(filename);
                const activeSceneIndex = isSceneSummaryActiveInThisChapter
                  ? (currentSummaryScene?.index ?? null)
                  : null;

                // The hover '...' menu: reorder within the container, move
                // between acts, delete. Rename stays double-click-the-title.
                const menuItems = pos === null || structure === null ? undefined : [
                  {
                    label: "Move up",
                    disabled: pos.index === 0,
                    onClick: () => handleMoveChapterWithin(filename, -1),
                  },
                  {
                    label: "Move down",
                    disabled: pos.index === pos.count - 1,
                    onClick: () => handleMoveChapterWithin(filename, +1),
                  },
                  {
                    label: "Move to Act",
                    submenu: [
                      ...structure.acts
                        .filter(a => a.id !== pos.actId)
                        .map(a => ({
                          label: a.title,
                          onClick: () => handleMoveChapterToAct(filename, a.id),
                        })),
                      ...(pos.actId !== null ? [{
                        label: "(Unassigned)",
                        hint: "Remove from its act without deleting anything",
                        onClick: () => handleMoveChapterToAct(filename, null),
                      }] : []),
                    ],
                  },
                  {
                    label: "Delete",
                    danger: true,
                    hint: "Delete the chapter file (and its summaries) from disk",
                    onClick: () => handleDeleteChapter(chapter),
                  },
                ];

                return (
                  <ChapterNavRow
                    key={filename}
                    chapter={chapter}
                    isExpanded={isExpanded}
                    isActiveChapter={isActiveChapter}
                    isSummaryAncestor={isSummaryAncestor}
                    isChapterSummaryActive={isChapterSummaryActive}
                    sceneSummaries={sceneSummaries}
                    isScenesExpanded={isScenesExpanded}
                    activeSceneIndex={activeSceneIndex}
                    onToggleExpand={() => toggleChapterExpanded(filename)}
                    onOpenChapter={() => {
                      if (currentView !== "editor" || currentChapter?.filename !== filename) {
                        loadChapter(chapter, currentProject);
                      }
                    }}
                    onOpenChapterSummary={() => openChapterSummary(filename)}
                    onRenameChapter={(newTitle) => handleRenameChapter(filename, newTitle)}
                    onDeleteChapter={() => handleDeleteChapter(chapter)}
                    onDeleteChapterSummary={() => handleDeleteChapterSummary(chapter)}
                    onToggleScenesExpanded={() => toggleSceneGroupExpanded(filename)}
                    onOpenScene={(index) => openSceneSummary(filename, index)}
                    onDeleteScene={(index) => handleDeleteSceneSummary(filename, index)}
                    menuItems={menuItems}
                  />
                );
              };

              // Fallback: structure endpoint unavailable -> flat list,
              // exactly the pre-acts behavior (trash icon, no move menu).
              if (structure === null) {
                return chapters.map(c => renderChapterRow(c.filename, c.title, null));
              }

              const collapsedActs = projectUi.uiState.collapsedActs ?? [];
              const toggleActCollapsed = (actId: string) => projectUi.update({
                collapsedActs: collapsedActs.includes(actId)
                  ? collapsedActs.filter(id => id !== actId)
                  : [...collapsedActs, actId],
              });

              // Defensive union: a chapter with metadata but missing from
              // the manifest (should be healed away server-side, but never
              // hide a chapter over a bookkeeping gap).
              const known = new Set([
                ...structure.acts.flatMap(a => a.chapters.map(c => c.filename)),
                ...structure.unassigned.map(c => c.filename),
              ]);
              const strays = chapters.filter(c => !known.has(c.filename));

              return (
                <>
                  {structure.acts.map((act, actIdx) => (
                    <ActGroup
                      key={act.id}
                      title={act.title}
                      chapterCount={act.chapters.length}
                      collapsed={collapsedActs.includes(act.id)}
                      onToggleCollapsed={() => toggleActCollapsed(act.id)}
                      onRename={(t) => handleRenameAct(act.id, t)}
                      menuItems={[
                        {
                          label: "Move up",
                          disabled: actIdx === 0,
                          onClick: () => handleMoveAct(act.id, -1),
                        },
                        {
                          label: "Move down",
                          disabled: actIdx === structure.acts.length - 1,
                          onClick: () => handleMoveAct(act.id, +1),
                        },
                        {
                          label: "Delete act",
                          danger: true,
                          hint: "Chapters are kept -- they move to Unassigned",
                          onClick: () => handleDeleteAct(act.id),
                        },
                      ]}
                    >
                      {act.chapters.map((ref, i) =>
                        renderChapterRow(ref.filename, ref.title, {
                          actId: act.id, index: i, count: act.chapters.length,
                        })
                      )}
                    </ActGroup>
                  ))}

                  {/* Unassigned bucket -- only labeled when acts exist;
                      an act-less project reads as a plain chapter list. */}
                  {structure.acts.length > 0 && structure.unassigned.length > 0 && (
                    <p className="mb-0.5 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                      Unassigned
                    </p>
                  )}
                  {structure.unassigned.map((ref, i) =>
                    renderChapterRow(ref.filename, ref.title, {
                      actId: null, index: i, count: structure.unassigned.length,
                    })
                  )}
                  {strays.map(c => renderChapterRow(c.filename, c.title, null))}

                  {/* Ghost button: create the next act. First use is what
                      materializes structure.json on disk. */}
                  <button
                    onClick={handleAddAct}
                    className="mt-1 w-full rounded border border-dashed border-border px-2 py-1 text-left text-xs text-faint transition-colors hover:border-indigo-500 hover:text-indigo-300"
                    title="Group chapters into acts (Act I, Act II...). Chapters can be moved between acts from their row menu."
                  >
                    + New Act
                  </button>
                </>
              );
            })()}
          </NavSection>

          {/* The Weave replaces the old flat Notes and Profiles sections.
              Both are now GROUPS inside it, alongside Other, and each grows
              as the writer needs it rather than listing every possibility
              up front. The tree itself is built by the backend from one
              rule -- a section appears when it holds something, or when it
              is a default -- so this file does not decide what is in it.

              Sections still open the screens they always did: a note goes
              to the editor, a profile kind to the Profile Builder. Only the
              way a writer FINDS them has changed. */}
          <WeaveNav
            projectPath={currentProject.root_path}
            activeSection={weaveSection}
            onOpenWeave={() => setCurrentView("weave")}
            onOpenWeaving={() => setWeavingOpen(true)}
            onOpenSection={section => {
              setWeaveSection(section.id);
              if (section.kind === "note") {
                if (section.id === "outline") { setCurrentView("outline_planner"); return; }
                loadNote(section.filename ?? `${section.id}.md`,
                         section.label, currentProject);
                return;
              }
              // A kind of entry. The Profile Builder still handles the four
              // it was built for; everything else opens in the Thread editor.
              if (PROFILE_KINDS.includes(section.id)) {
                setProfileType(section.id as "character" | "relationship" | "location" | "lore");
                setCurrentView("profiles");
              } else {
                setThreadType(section.id);
                setProfileFilename(undefined);
                setCurrentView("thread");
              }
            }}
          />

        </nav>

        {/* Writing Progress gauge. Pinned BELOW the scrollable nav so it
            never scrolls out of sight no matter how many acts/chapters/
            scenes the writer expands above it. The aside is a flex column:
            header (fixed) / nav (flex-1, scrolls) / gauge (fixed) / footer
            (fixed). The breakdown slide-over opens UPWARD from here (see
            ProjectCompletionGauge) so it stays inside the aside. */}
        <div className="border-t border-border px-3 py-3">
          <ProjectCompletionGauge
            projectPath={currentProject.root_path}
            isOpen={progressOpen}
            onToggle={() => setProgressOpen(o => !o)}
          />
        </div>

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
      {currentView === "thread" && threadType ? (
        // Every Weave kind the Profile Builder does not cover. Rendered like
        // the Weave itself rather than as a takeover, so the chapter list
        // stays put -- an entry is something a writer edits WHILE writing.
        <div className="flex-1 overflow-hidden">
          <ThreadEditor
            projectPath={currentProject.root_path}
            typeId={threadType}
            initialFilename={profileFilename}
            onBack={() => setCurrentView("editor")}
            onDirtyChange={setIsDirty}
          />
        </div>
      ) : currentView === "weave" ? (
        // Rendered here rather than as a full-screen takeover so the left
        // nav stays put: the Weave is something you consult WHILE writing,
        // and losing the chapter list to look at it would make it a
        // destination rather than a reference. The feature itself stays an
        // island in features/codex/ -- this file only knows how to show it.
        <div className="flex-1 overflow-y-auto">
          <WeaveScreen
            projectPath={currentProject.root_path}
            pinned={projectUi.uiState.weaveNodePositions}
            onPin={positions => projectUi.update({ weaveNodePositions: positions })}
          />
        </div>
      ) : currentView === "outline_planner" ? (
        <OutlinePlanner
          project={currentProject}
          onBack={() => setCurrentView("editor")}
          onDirtyChange={setIsDirty}
          onSwitchToRaw={() => loadNote("outline.md", "Outline", currentProject)}
        />
      ) : currentView === "chapter_summary" && currentSummaryChapter ? (
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
            {/* Tools menu -- collects the one-off features (scene/chapter
                summary generation, Reader Mode, Export) that used to be
                separate toolbar/header buttons. Chapter-scoped items are
                only passed when a chapter is open, so the menu adapts. */}
            <EditorMenu
              onGenerateSceneSummaries={
                currentView === "editor" && currentChapter
                  ? handleGenerateSceneSummaries
                  : undefined
              }
              autoSplitRunning={autoSplitProgress !== null}
              onSuggestSceneBreaks={
                currentView === "editor" && currentChapter
                  ? handleSuggestSceneBreaks
                  : undefined
              }
              suggestBreaksRunning={suggestBreaksRunning}
              onDialogueCheck={
                currentView === "editor" && currentChapter
                  ? () => {
                      // Selection if there is one, otherwise the whole
                      // chapter -- a writer who wants to hear the scene
                      // they are in should not have to select it first.
                      const view = editorViewRef.current;
                      const sel = view?.state.selection.main;
                      const selected = view && sel && !sel.empty
                        ? view.state.sliceDoc(sel.from, sel.to) : "";
                      setDialogueCheckSelected(Boolean(selected.trim()));
                      setDialogueCheckText(selected || chapterContent);
                    }
                  : undefined
              }
              onOpenChapterSummary={
                currentView === "editor" && currentChapter
                  ? () => openChapterSummary(currentChapter.filename)
                  : undefined
              }
              onReaderMode={
                currentProject && chapters.length > 0
                  ? () => setShowReaderMode(true)
                  : undefined
              }
              onExport={() => setShowExportModal(true)}
            />
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
            the active file so the [+ New Template] button appears contextually.
            The one-off feature buttons (scene summaries, Reader Mode, ...)
            moved from here into the Tools menu in the title bar above. */}
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

        {/* Smart Advisor toolbar -- only relevant for chapter editing.
            Notes and project-home views skip this row. The bar runs the
            three category passes (Readability/Structure/Context), which
            return inline issues that decorate the manuscript directly. */}
        {currentView === "editor" && currentChapter && (
          <EditorAdvisorBar
            view={editorView}
            chapterText={chapterContent}
            chapterFilename={currentChapter?.filename ?? null}
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
                projectPath={currentProject.root_path}
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
                projectPath={currentProject.root_path}
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
            Discuss your writing, or turn on Draft mode to have the AI write a
            scene. For structured Readability, Structure, or Context review, use
            the Smart Advisor toolbar above the manuscript.
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
              <p className={`min-w-0 flex-1 truncate text-xs ${enhanceMode ? "text-violet-400" : (establishedSelection !== "" && selectedText.trim() === establishedSelection) || chapterEstablished ? "text-emerald-700" : "text-emerald-400"}`} title={selectedText}>
                {enhanceMode
                  ? "Passage to enhance"
                  // Muted label when this exact selection is already in the
                  // conversation -- it won't be resent (no duplicate copies).
                  : establishedSelection !== "" && selectedText.trim() === establishedSelection ? "Selection (already sent)"
                  : chapterEstablished ? "Selection (new context)" : "Using selected text"} ({selectedText.length.toLocaleString()} chars)
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
          ) : currentChapter && enhanceMode ? (
            // Enhance is on but nothing is highlighted -- the feature needs a
            // target passage, so prompt the writer to select one.
            <p className="text-xs text-violet-400">
              Highlight a passage in the editor to enhance
            </p>
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
              {/* Surface the stance when attachments are set to Reference, since it
                  changes how the AI uses them and is otherwise hidden in the popup. */}
              {contextChips.length > 0 && !treatAsCanon && (
                <span className="ml-1 text-amber-400" title="Attachments are reference only; your direction takes precedence. Change in + Add.">
                  · reference
                </span>
              )}
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
              treatAsCanon={treatAsCanon}
              onTreatAsCanonChange={setTreatAsCanon}
            />
          )}

          {contextChips.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="context-chips">
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

        {/* WHAT THE WEAVE ADDS, and every control the context rule requires:
            read it, drop a Thread, drop a kind, or switch it off. It sits
            under the attachments because that is the order it reaches the
            model in -- what the writer chose for this turn first, standing
            context about the world second. */}
        {currentProject && (
          <WeaveContextBar
            projectPath={currentProject.root_path}
            chapterFilename={currentChapter?.filename ?? null}
            // The selection when there is one: what the writer is looking at
            // decides who counts as named in this scene. Read at assembly
            // time, so typing does not re-assemble on every keystroke.
            text={selectedText}
            // The writer's own attachments claim their tokens first and are
            // never pruned, so the Weave spends what is left after them.
            pinnedTokens={contextChips.reduce(
              (sum, chip) => sum + estimateTokens(chip.content), 0)}
            prefs={projectUi.uiState.weaveContext ?? {}}
            onPrefsChange={next => projectUi.update({ weaveContext: next })}
            onBriefChange={setWeaveBrief}
          />
        )}

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
                <p className="mb-1 text-xs font-medium text-text-muted">
                  {draftMode ? "Try drafting:" : enhanceMode ? "Try enhancing (highlight a passage first):" : "Try asking:"}
                </p>
                {(draftMode
                  ? [
                      "Write the opening scene where they first meet",
                      "Draft a tense confrontation in the throne room",
                      "Write the next scene from the premise in my outline",
                    ]
                  : enhanceMode
                  ? [
                      "Work in a description of the setting",
                      "Make this character's reply more reluctant",
                      "Sharpen the tension and tighten the pacing",
                    ]
                  : [
                      "What do you think of this passage?",
                      "Help me brainstorm what happens next",
                      "How could I make this scene stronger?",
                    ]
                ).map(q => (
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
            <div key={i}>
              {/* "New ask" divider: everything below this line is a fresh ask; the
                  AI only sees messages from the latest divider onward. */}
              {askBoundaries.includes(i) && (
                <div className="my-3 flex items-center gap-2" aria-label="new ask">
                  <div className="h-px flex-1 bg-violet-800/50" />
                  <span className="text-[10px] uppercase tracking-wide text-violet-400">New ask</span>
                  <div className="h-px flex-1 bg-violet-800/50" />
                </div>
              )}
              {/* Hidden messages (the persisted materials block -- profiles +
                  chapter text) stay in the history the AI sees but never
                  render; the writer already sees their attachments as chips. */}
              {!msg.hidden && (
              <div className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
                  <>
                    {/* Reasoning trace (Reasoning toggle): collapsed by default so
                        the reply stays the focus; native <details> needs no state. */}
                    {msg.reasoning && (
                      <details className="mb-2 rounded border border-sky-900/60 bg-sky-950/20 px-2 py-1">
                        <summary className="cursor-pointer text-[11px] text-sky-400">
                          Reasoning
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] text-text-muted">
                          {msg.reasoning}
                        </p>
                      </details>
                    )}
                    <ChatMarkdown content={msg.content} />
                  </>
                )}
              </div>
              {msg.role === "user" && (
                <div className="ml-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-800/60 text-indigo-300">
                  <span className="text-xs font-bold">W</span>
                </div>
              )}
              </div>
              )}
            </div>
          ))}

          {/* Continue: appends the next prose segment. Shown only after the
              AI has replied (last message is the assistant's) and we're idle.
              It sends a canned "keep going" turn in draft mode, relying on the
              conversation history for everything else, so the scene can be
              extended indefinitely one segment at a time. */}
          {!chatLoading && !chatError &&
            chatMessages.length > 0 &&
            chatMessages[chatMessages.length - 1].role === "assistant" && (
            <div className="mb-2 ml-7 flex">
              <button
                onClick={() => sendEditorChat({
                  overrideText: "Continue from where you left off. Pick up at the next word of the prose, no recap and no preamble.",
                  category: "draft",
                  suppressText: true,
                })}
                disabled={!currentChapter}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-700/50 bg-indigo-950/40 px-2.5 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
                title="Write the next segment of the scene, continuing from here"
              >
                <CornerDownRight size={12} />
                Continue
              </button>
            </div>
          )}

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

          {/* Weak-model nudge: shown once when drafting on a budget model that
              tends to produce generic prose. Dismissible, never blocks. */}
          {showDraftModelNudge && !draftNudgeDismissed && (
            <div className="mb-2 rounded border border-amber-800/60 bg-amber-950/30 p-2">
              <p className="text-xs text-amber-200">
                Drafting works best on a stronger model.
                {chatModelUsed ? <> Current: <span className="font-medium">{chatModelUsed.split("/").pop()}</span>.</> : null}
              </p>
              <div className="mt-1 flex items-center gap-3">
                <button
                  onClick={() => { setShowSettings(true); }}
                  className="text-xs text-indigo-300 underline transition-colors hover:text-indigo-200"
                >
                  Change in Settings
                </button>
                <button
                  onClick={() => { setDraftNudgeDismissed(true); setShowDraftModelNudge(false); }}
                  className="text-xs text-faint transition-colors hover:text-text-muted"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Enhance-mode context nudge: shown once when Enhance is on, suggesting
              the writer attach grounding (chapter/outline/profiles) for better
              results. Dismissible, never blocks. */}
          {enhanceMode && !enhanceNudgeDismissed && (
            <div className="mb-2 rounded border border-violet-800/60 bg-violet-950/30 p-2">
              <p className="text-xs text-violet-200">
                For the richest results, attach your outline, chapter or scene
                summaries, and relevant character profiles as context (use + Add
                above). Enhance already includes the paragraphs around your
                selection automatically.
              </p>
              <div className="mt-1 flex items-center gap-3">
                <button
                  onClick={() => setEnhanceNudgeDismissed(true)}
                  className="text-xs text-faint transition-colors hover:text-text-muted"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Mode toggles. Draft and Enhance are mutually exclusive; turning one
              on turns the other off. Off (both) = discussion chat. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Draft mode: the AI writes a new scene/segment from your message. */}
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title="When on, the AI writes story prose from your message and attached context. When off, it discusses your writing. Draft uses this conversation as planning context -- use New Ask for a clean slate."
            >
              <PenLine size={12} className={draftMode ? "text-emerald-400" : "text-faint"} />
              <span className={`text-xs ${draftMode ? "text-emerald-400" : "text-faint"}`}>Draft mode</span>
              <div
                className={`relative h-4 w-7 rounded-full transition-colors ${draftMode ? "bg-emerald-600" : "bg-border"}`}
                onClick={() => setDraftMode(v => { const next = !v; if (next) setEnhanceMode(false); return next; })}
              >
                <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${draftMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </div>
            </label>

            {/* Enhance mode: the AI expands your HIGHLIGHTED passage into richer prose. */}
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title="When on, highlight a passage and the AI rewrites it as richer, more vivid prose (keeping the same events). Output appears in chat for you to copy."
            >
              <Sparkles size={12} className={enhanceMode ? "text-violet-400" : "text-faint"} />
              <span className={`text-xs ${enhanceMode ? "text-violet-400" : "text-faint"}`}>Enhance</span>
              <div
                className={`relative h-4 w-7 rounded-full transition-colors ${enhanceMode ? "bg-violet-600" : "bg-border"}`}
                onClick={() => setEnhanceMode(v => { const next = !v; if (next) setDraftMode(false); return next; })}
              >
                <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${enhanceMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </div>
            </label>

            {/* Reasoning toggle: only offered when the active model can return a
                reasoning trace. Composes with Chat/Draft/Enhance (not exclusive). */}
            {activeModelSupportsReasoning && (
              <label
                className="flex cursor-pointer items-center gap-1.5"
                title="When on, the AI's reasoning trace is shown above each reply as a collapsible block. Available because the active model supports reasoning."
              >
                <Brain size={12} className={reasoningMode ? "text-sky-400" : "text-faint"} />
                <span className={`text-xs ${reasoningMode ? "text-sky-400" : "text-faint"}`}>Reasoning</span>
                <div
                  className={`relative h-4 w-7 rounded-full transition-colors ${reasoningMode ? "bg-sky-600" : "bg-border"}`}
                  onClick={() => setReasoningMode(v => !v)}
                >
                  <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${reasoningMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </div>
              </label>
            )}

            {/* Mode help: expands a panel explaining Chat / Draft / Enhance /
                Reasoning and when a writer would reach for each. */}
            <button
              onClick={() => setShowModeHelp(v => !v)}
              className="flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-indigo-300"
              title="What do these modes do?"
            >
              <HelpCircle size={12} />
              {showModeHelp ? "Hide" : "What's this?"}
            </button>

            {draftMode && (
              <span className="text-[10px] text-faint">AI writes prose &middot; use Continue to extend</span>
            )}

            {/* New ask: start a fresh AI context without erasing the transcript.
                Appears once there's an exchange in the current segment; it pulses
                violet when the selection has changed (a likely new, unrelated ask). */}
            {chatMessages.length > (askBoundaries[askBoundaries.length - 1] ?? 0) && (
              <button
                onClick={startNewAsk}
                title="Start a new ask: the AI gets a clean slate (your attachments stay). Your transcript is kept."
                className={`ml-auto flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] transition-colors ${
                  selectedText.trim() !== "" && selectedText !== lastSentSelection
                    ? "border-violet-500 bg-violet-950/50 text-violet-200"
                    : "border-border text-faint hover:border-violet-700 hover:text-violet-300"
                }`}
              >
                <CornerDownRight size={11} />
                New ask
              </button>
            )}
          </div>

          {/* Mode help panel: opened by the "What's this?" button above. Plain
              language for writers new to AI tools -- what each mode does and
              the situation where it earns its keep. */}
          {showModeHelp && (
            <div className="mb-2 space-y-2 rounded border border-border bg-bg-surface/60 px-2.5 py-2 text-[11px] leading-relaxed text-text-muted">
              <div>
                <span className="font-semibold text-text-primary">Chat (both toggles off)</span>
                <p>
                  A discussion partner. Ask questions, brainstorm plot ideas, talk
                  through a scene that isn't working. The AI talks <em>about</em> your
                  writing; it doesn't write story text. Use this most of the time.
                </p>
              </div>
              <div>
                <span className="font-semibold text-emerald-300">
                  <PenLine size={11} className="mr-1 inline" />Draft mode
                </span>
                <p>
                  The AI writes story prose from your message. Describe what should
                  happen ("Kael confronts the smuggler at the docks") and it drafts the
                  scene, using your attached profiles and outline as canon. A Continue
                  button extends the scene segment by segment. Use it when you're stuck
                  facing a blank page and want a first pass to react to and rewrite --
                  the draft appears in the chat for you to place, never in your chapter.
                </p>
              </div>
              <div>
                <span className="font-semibold text-violet-300">
                  <Sparkles size={11} className="mr-1 inline" />Enhance
                </span>
                <p>
                  Rewrites a passage you've highlighted, following your direction: add
                  sensory detail, deepen the mood, tighten the pacing. Amount controls
                  how far it goes (Restate keeps the length; Expanded is a fuller
                  rewrite). Use it when a moment reads flat or thin and you can name
                  what's missing. The rewrite appears in the chat for you to copy.
                </p>
              </div>
              <div>
                <span className="font-semibold text-sky-300">
                  <Brain size={11} className="mr-1 inline" />Reasoning
                </span>
                <p>
                  Shows the AI's step-by-step thinking above each reply, in a
                  collapsible block. Use it when you want to check <em>why</em> the AI
                  said what it said -- did it actually use your attached profiles? did
                  it understand the scene? -- or when weighing conflicting advice.
                  Replies take longer and cost more with it on. This toggle only
                  appears when your current model supports reasoning; if you don't see
                  it, your model doesn't offer a trace.
                </p>
              </div>
            </div>
          )}

          {/* Enhance level: how much to expand the highlighted passage. */}
          {enhanceMode && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[10px] text-faint">Amount:</span>
              {([
                { value: "restate",  label: "Restate",  hint: "Rework the wording, about the same length" },
                { value: "default",  label: "Default",  hint: "Richer pass, about 1.5x to 2.2x" },
                { value: "expanded", label: "Expanded", hint: "Most immersive, about 2.2x to 4x" },
              ] as { value: EnhanceLevel; label: string; hint: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setEnhanceLevel(opt.value)}
                  title={opt.hint}
                  className={`rounded border px-2 py-0.5 text-[10px] transition-colors ${
                    enhanceLevel === opt.value
                      ? "border-violet-500 bg-violet-950/50 text-violet-200"
                      : "border-border text-faint hover:border-violet-700 hover:text-violet-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                // maxH = 7 lines × ~24px line-height + padding. el.scrollHeight
                // tracks the live rendered font size, so this adapts to UI scale.
                autoSizeTextarea(e.currentTarget, { maxH: 7 * 24 + 14 });
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendEditorChat();
                }
              }}
              placeholder={
                !currentChapter
                  ? "Open a chapter first"
                  : draftMode
                    ? "Describe the scene to write... (Enter to send)"
                    : enhanceMode
                      ? (selectedText.trim()
                          ? "Describe how to enrich the highlighted passage... (Enter to send)"
                          : "Type your direction, then highlight the passage to enhance")
                      : "Ask about your writing... (Enter to send)"
              }
              // Enhance requires a selection, but we DON'T disable the box for it:
              // the writer can type their direction first, then highlight. The
              // missing-selection case is caught at send time with a clear hint
              // (see sendEditorChat). Disabling the whole box just reads as broken.
              disabled={!currentChapter || chatLoading}
              rows={3}
              style={{ resize: "none", overflowY: "hidden" }}
              className="text-entry flex-1 rounded border border-border bg-border px-2 py-2 text-text-primary placeholder-text-muted outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              onClick={() => sendEditorChat()}
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

      {/* ── WEAVING ───────────────────────────────────────────────────────
          An overlay, not a column. As a third panel it left the writer's own
          prose as the narrowest thing on screen, between the sidebar and the
          Writing Companion -- exactly backwards for an app whose rule is
          that the manuscript is the visual focus. It is also the shape this
          app already uses for a guided walk (the audiobook's formatting
          walkthrough), so the interaction is one the writer has met before.
          The component renders its own backdrop; nothing here reserves
          space for it.

          RENDERED HERE, WITH THE OTHER OVERLAYS, AND THAT POSITION IS THE
          WHOLE POINT. It used to sit inside the editor arm of the view
          switch, which meant clicking "Weaving..." from the Weave screen set
          the state and mounted nothing -- reported as "attempting to go into
          Weaving does nothing... if I switch to a document, the Weaving
          interface pops up like I had clicked it then." It was never hung;
          it simply was not in the tree. An overlay opened from a sidebar
          that is visible in every view has to live outside every view.

          The Weave is also a CLOSED WORLD: the writer does not leave it
          until they are done or they X out. It used to take navigation
          callbacks here and five stop kinds ended by calling one --
          creation, filling-in and fixing all happen inside the panel now,
          so there is nothing to route. */}
      {weavingOpen && currentProject && (
        <WeavingPanel
          projectPath={currentProject.root_path}
          onClose={() => setWeavingOpen(false)}
        />
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

      {/* Global Search + Replace modal (Ctrl+Shift+F) */}
      {showGlobalSearch && currentProject && (
        <GlobalSearchModal
          projectPath={currentProject.root_path}
          openFileRelpath={
            currentView === "editor" && currentChapter
              ? `manuscript/${currentChapter.filename}`
              : currentView === "notes" && currentNote
              ? `notes/${currentNote.filename}`
              : currentView === "outline_planner"
              ? "notes/outline.md"
              : null
          }
          isDirty={isDirty}
          onSaveRequest={handleSave}
          onFileModifiedByReplace={(relpaths) => {
            // If the currently open chapter was one of the modified files,
            // reload it so the editor shows the post-replace text.
            const openRelpath =
              currentView === "editor" && currentChapter
                ? `manuscript/${currentChapter.filename}`
                : null;
            if (openRelpath && relpaths.includes(openRelpath) && currentProject) {
              void loadChapter(currentChapter!, currentProject);
              setGlobalReplaceBanner("File updated by Global Replace");
              setTimeout(() => setGlobalReplaceBanner(null), 4000);
            }
          }}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}

      {/* Global Replace banner -- briefly shown after the open chapter is
          modified by a replace, so the writer knows why their text changed. */}
      {globalReplaceBanner && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border border-indigo-700 bg-indigo-950/90 px-4 py-2 text-xs text-indigo-200 shadow-lg backdrop-blur-sm">
          {globalReplaceBanner}
        </div>
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

      {/* Dialogue Check: listening only. Local, free, saves nothing --
          and it says so, plus where to go for real audio. */}
      {dialogueCheckText !== null && (
        <DialogueCheck
          text={dialogueCheckText}
          hadSelection={dialogueCheckSelected}
          voiceId={projectUi.uiState.passageCheckVoice}
          onVoiceChange={voice =>
            projectUi.update({ passageCheckVoice: voice })}
          onClose={() => setDialogueCheckText(null)}
        />
      )}

      </div>
    </>
  );
}


// ── Helper Components ─────────────────────────────────────────────────────────
// NavSection, NavItem, and ChapterNavRow used to live here; they moved to
// components/sidebar/ during the sidebar overhaul so the nav pieces have a
// home of their own instead of the bottom of this file.


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
  // Canon/Reference stance for how the AI treats attachments (global, applies to
  // all attached context). Shown as a toggle at the top of the picker.
  treatAsCanon: boolean;
  onTreatAsCanonChange: (v: boolean) => void;
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

function ChipPicker({ rootPath, seriesPath, currentChapterFilename, existingChips, onAdd, onClose, treatAsCanon, onTreatAsCanonChange }: ChipPickerProps) {
  const [loading, setLoading] = useState(false);
  const [profileType, setProfileType] = useState("character");
  // character_kind rides along for characters so the picker can mirror the
  // Profile Builder's Main vs Side/Background grouping.
  const [profiles, setProfiles] = useState<{ filename: string; name: string; character_kind?: string }[]>([]);
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

  // Which folder this project keeps its entries in, decided by the backend and
  // asked exactly as the Profile Builder asks it.
  const [home, setHome] = useState<EntriesHome | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEntriesHome(rootPath).then(report => {
      if (!cancelled) setHome(report.home);
    });
    return () => { cancelled = true; };
  }, [rootPath]);

  // The world's kinds, for the section shapes a codex entry is read into.
  const chipRegistry = useTypeRegistry(rootPath);
  const chipSource = useMemo(
    () => (home && !chipRegistry.loading && !chipRegistry.error
      ? sourceFor(rootPath, home, type => chipRegistry.sections[type] ?? [])
      : null),
    [rootPath, home, chipRegistry.loading, chipRegistry.error, chipRegistry.sections],
  );

  // On mount, auto-suggest characters from the project -- from wherever this
  // project's entries actually live.
  useEffect(() => {
    if (suggestedLoaded || !chipSource) return;
    chipSource.list("character")
      .then(rows => {
        setSuggested(rows.map(row => ({
          filename: row.filename, name: row.name, type: "character",
          entity_id: row.entity_id,
        })));
      })
      .catch(() => {})
      .finally(() => setSuggestedLoaded(true));
  }, [chipSource, suggestedLoaded]);


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
    // SERIES PROFILES STAY ON THE OLD PATH. A series folder is not a project and
    // has never been converted -- the Weave works one book at a time -- so
    // asking it which folder its entries live in would be asking a question it
    // cannot answer.
    if (source === "series" && seriesPath) {
      const params = new URLSearchParams({ folder_path: seriesPath, type: profileType });
      fetch(`${API_BASE}/api/profiles/list?${params}`)
        .then(r => r.json())
        .then(data => setProfiles(Array.isArray(data) ? data : []))
        .catch(() => setProfiles([]))
        .finally(() => setLoading(false));
      return;
    }
    if (!chipSource) return;
    chipSource.list(profileType)
      .then((rows: ProfileListItem[]) => setProfiles(rows))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
  }, [profileType, rootPath, seriesPath, source, chipSource]);

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
      const fromSeries = (fromSource ?? source) === "series" && seriesPath;
      let profile: Profile;
      if (fromSeries) {
        const params = new URLSearchParams({
          folder_path: seriesPath, type: profileType, filename });
        profile = await (await fetch(`${API_BASE}/api/profiles/profile?${params}`)).json();
      } else {
        if (!chipSource) return;
        const row = profiles.find(p => p.filename === filename)
          ?? suggested.find(p => p.filename === filename);
        profile = await chipSource.load({
          filename, name, type: profileType,
          role: "", status: "active",
          entity_id: (row as { entity_id?: string } | undefined)?.entity_id,
        });
      }
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
    // Does this entry HOLD any traits? Asked of the data rather than of a
    // table of four kinds, which answered no for every other kind there is.
    ? Object.values(pending.profile.sections)
        .some(section => (section.trait_blocks ?? []).length > 0)
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
          treatAsCanon={treatAsCanon}
          onTreatAsCanonChange={onTreatAsCanonChange}
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
          {(() => {
            const renderProfileRow = (p: { filename: string; name: string }) => {
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
            };

            // Characters mirror the Profile Builder's Main vs Side/Background
            // split so the writer attaches from the same mental groups. Other
            // profile types stay flat.
            if (profileType !== "character") return profiles.map(renderProfileRow);
            const mains = profiles.filter(p => (p.character_kind ?? "main") !== "side");
            const sides = profiles.filter(p => p.character_kind === "side");
            if (sides.length === 0) return profiles.map(renderProfileRow);
            return (
              <>
                <p className="px-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Main</p>
                {mains.map(renderProfileRow)}
                <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Side / Background</p>
                {sides.map(renderProfileRow)}
              </>
            );
          })()}
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
  // Canon/Reference stance for how the AI treats attachments (global).
  treatAsCanon:         boolean;
  onTreatAsCanonChange: (v: boolean) => void;
}

function ConfigureAttachPanel({
  include, onChange, tokens, hasTraits, hasSummary, onShowHelp, onCancel, onAttach,
  treatAsCanon, onTreatAsCanonChange,
}: ConfigureAttachPanelProps) {
  // Local expand state for the Canon/Reference tutorial helptip.
  const [showCanonHelp, setShowCanonHelp] = useState(false);
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

      {/* Canon / Reference stance -- how the AI treats everything you attach
          (global, applies to all attachments). Lives here, just under the token
          estimate, with a tutorial helptip. */}
      <div className="mb-2 border-t border-indigo-800/40 pt-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5" title="How the AI treats your attachments">
            <span className={`text-xs font-medium ${treatAsCanon ? "text-indigo-300" : "text-amber-400"}`}>
              {treatAsCanon ? "Canon" : "Reference"}
            </span>
            <div
              className={`relative h-4 w-7 rounded-full transition-colors ${treatAsCanon ? "bg-indigo-600" : "bg-amber-600"}`}
              onClick={() => onTreatAsCanonChange(!treatAsCanon)}
            >
              <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${treatAsCanon ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </div>
          </label>
          <button
            onClick={() => setShowCanonHelp(v => !v)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-indigo-300"
            title="What does this do?"
          >
            <HelpCircle size={12} />
            {showCanonHelp ? "Hide" : "What's this?"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-text-muted">
          {treatAsCanon
            ? "Attachments are treated as established truth; the AI keeps your writing consistent with them."
            : "Attachments are reference only; your typed instructions take precedence over them."}
        </p>
        {showCanonHelp && (
          <div className="mt-2 space-y-2 border-t border-indigo-800/40 pt-2 text-[11px] leading-relaxed text-text-muted">
            <p>
              <span className="font-semibold text-indigo-300">Toggle (On) Canon:</span> the AI treats attached
              profiles, outline, and locations as established truth and keeps your writing consistent with
              them. Use when drafting a scene where characters should stay true to their established traits,
              or when you want the profile enforced.
            </p>
            <p>
              <span className="font-semibold text-amber-400">Toggle (Off) Reference:</span> the AI uses attachments
              as helpful reference but follows <em>your</em> instructions first, drawing on the details that
              fit this moment. Use when you're deliberately showing a different side of a character, writing a
              turning point or exception, or your specific direction matters more than strict consistency right now.
            </p>
            <p>
              Tip: if a Draft or Enhance result feels like it's arguing with what you asked by clinging to
              profile traits, switch this to Reference.
            </p>
          </div>
        )}
      </div>

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
