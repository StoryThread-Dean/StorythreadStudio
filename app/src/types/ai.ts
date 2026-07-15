// types/ai.ts -- TypeScript Types for the AI System
// ====================================================
// Mirrors the Pydantic models in backend/app/routers/ai.py and settings.py

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  openrouter_api_key:     string;    // Masked display value ("sk-or-...xyz" or "")
  openrouter_api_key_set: boolean;
  default_model:          string;
  content_mode:           string;    // "general" | "mature" | "explicit"
  cost_tier:              string;    // "free" | "budget" | "standard" | "premium"
  text_only_filter:       boolean;   // hide non-text output models
  starred_models:         string[];  // user-pinned model IDs
  model_allowlist:        string[];  // if non-empty, only these models can be used
  model_blocklist:        string[];  // excluded models (ignored if allowlist set)
  model_content_modes:    Record<string, string[]>;  // model ID -> allowed content modes
  // Parent folder where new projects and series are auto-placed. The backend
  // resolves blanks to ~/Documents/Storythread Studio and always returns a real path
  // here -- the UI can treat it as non-null for display purposes.
  vault_root:             string;
  // Writing Progress: skill level drives daily word/task targets. Values:
  // "newbie" | "beginner" | "novice" | "amateur" | "experienced" | "fulltime" | "professional".
  writing_skill_level:    string;
  // Writing Progress: clock hour at which "today" rolls over. 0 = midnight
  // (default), 4 = Night Owl. Anything in [00:00, rollover_hour) counts toward yesterday.
  day_rollover_hour:      number;
}

export interface UpdateSettingsPayload {
  openrouter_api_key?: string;
  default_model?:      string;
  content_mode?:       string;
  cost_tier?:          string;
  // Empty string resets to the default (~/Documents/Storythread Studio).
  vault_root?:         string;
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  cost_input_per_million: number;
  cost_output_per_million: number;
  output_modalities: string[];  // e.g. ["text"] or ["text","image"]
  is_free: boolean;             // true if :free suffix or zero cost
  is_moderated: boolean;        // true if model has content filters (refuses explicit)
  supports_reasoning: boolean;  // true if the model can return a reasoning trace
}

// ── Importance Levels ─────────────────────────────────────────────────────────
// Controls how the AI weights a trait when the profile is in context.
// Core = defining trait, reflected in behavior when the character is on stage.
// Hidden = sent to AI as influence material, but the prompt instructs the AI
//          to NEVER name or quote it directly -- it drives subtext only.
// (Authoritative copy lives in app/src/types/profile.ts.)

export type ImportanceLevel = "core" | "present" | "background" | "contextual" | "hidden";

// ── Context Chips ─────────────────────────────────────────────────────────────

// Per-chip options that record which slices of the profile the writer chose
// to include when attaching it. The chip's `content` was already serialized
// with these flags applied -- this field exists so the chip UI can display
// what was selected (badges) and so the writer can re-build the chip later
// if we add an "edit attachment" affordance. The backend never reads this.
export interface ChipIncludeFlags {
  summary:  boolean;
  traits:   boolean;
  overview: boolean;
  details:  boolean;
}

// A context chip is a piece of profile content the writer explicitly attaches
// to an AI request. The AI only sees what the writer chooses to share.
export interface ContextChip {
  type: string;    // "character" | "relationship" | "location" | "lore" | etc.
  name: string;    // Display name, e.g. "Elara Voss"
  content: string; // The profile summary or relevant text to include
  // Optional metadata describing what slices were included when the chip was
  // built. Older chips may not have this; treat its absence as "unknown".
  include?: ChipIncludeFlags;
}

// ── Profile Builder: Generation Payloads ─────────────────────────────────────

export interface GenerateUsagePreviewPayload {
  profile_name:    string;
  profile_type:    string;
  section_heading: string;
  trait:           string;
  description:     string;
  importance:      ImportanceLevel;
  model_id?:       string;
}

export interface GenerateSectionSummaryPayload {
  profile_name:    string;
  profile_type:    string;
  section_heading: string;
  section_content: string;
  model_id?:       string;
}

export interface GenerateFullSummaryPayload {
  profile_name:    string;
  profile_type:    string;
  profile_content: string;
  model_id?:       string;
}

// ── Profile Builder: Chat ─────────────────────────────────────────────────────

// The four behavior modes for the Profile Companion chat panel.
// "chat" = open conversation (replaces old general + ask_clarifying)
// "extract_traits" = paste text, AI pulls out traits
// "check_consistency" = flag contradictions, overlaps, importance mismatches
// "refine" = sharpen traits, interpret importance, summarize (replaces old
//            refine_traits + interpret_profile + generate_summary)
export type ProfileBehaviorMode = "chat" | "extract_traits" | "check_consistency" | "refine";

export interface ProfileChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProfileChatPayload {
  profile_name:    string;
  profile_type:    string;
  profile_content: string;
  messages:        ProfileChatMessage[];
  model_id?:       string;
  behavior_mode?:  ProfileBehaviorMode;
  content_mode?:   string;
}


// ── Writing Companion (Editor Chat) ───────────────────────────────────────────

// The focus categories for the main editor's Writing Companion panel.
// Each category sets the AI's area of expertise for the conversation.
//   "chat"  = general discussion / brainstorming companion (default)
//   "draft" = the AI writes story prose (a scene or chapter segment)
//   readability/structure/context = legacy structured-review modes
//   null = no category selected
// The wire format currently sends "chat" by default and "draft" when the
// writer has Draft mode on or clicks Continue.
export type EditorChatCategory =
  | "readability"
  | "structure"
  | "context"
  | "chat"
  | "draft"
  | "enhance"
  | null;

// Enhance length budget. The writer's chat message supplies the direction;
// the level governs how long the rewrite is relative to the original passage:
//   "restate"  -- about the same length (rework wording in place)
//   "default"  -- ~1.5x to 2.2x
//   "expanded" -- ~2.2x to 4x
export type EnhanceLevel = "restate" | "default" | "expanded";

export interface EditorChatMessage {
  role: "user" | "assistant";
  content: string;
  // The model's reasoning trace for this assistant reply, present only when
  // the Reasoning toggle was on and the model emitted one. Display-only --
  // the backend ignores it when the message is sent back as history.
  reasoning?: string;
}

export interface EditorChatPayload {
  category:        EditorChatCategory;
  text_content:    string;          // Selected text OR full chapter (enhance: the passage to expand)
  is_full_chapter: boolean;
  messages:        EditorChatMessage[];
  context_chips?:  ContextChip[];
  model_id?:       string;
  content_mode?:   string;
  project_path?:   string;
  // Enhance mode only: paragraphs around the selection (grounding, not rewritten).
  surrounding_context?: string;
  // Enhance mode only: how much to expand.
  enhance_level?:  EnhanceLevel;
  // Reasoning toggle: ask for the model's reasoning trace (reasoning-capable
  // models only; the UI hides the toggle otherwise).
  include_reasoning?: boolean;
}


// ── Scene Break Suggestions ──────────────────────────────────────────────────
// Mirrors SuggestSceneBreaksRequest/Response in backend/app/routers/ai.py. The
// AI reads a chapter and proposes where to place `---` scene breaks; each
// suggestion is anchored to a verbatim quote the writer can find. Review-only:
// the writer inserts the breaks by hand.
export type SceneBreakSeverity = "strong" | "moderate" | "subtle";

export interface SceneBreakSuggestion {
  quote:       string;            // verbatim text just before the suggested break
  explanation: string;            // why a break here helps
  severity:    SceneBreakSeverity;
}

export interface SuggestSceneBreaksPayload {
  chapter_path?: string;
  project_path?: string;
  chapter_text:  string;
  model_id?:     string;
  content_mode?: string;
}

export interface SuggestSceneBreaksResponse {
  suggestions: SceneBreakSuggestion[];
  analysis:    string;
  model_used:  string;
}


// ── Editor Pass (Inline Overlay Feedback) ────────────────────────────────────
// Mirrors EditorPassRequest / EditorPassResponse / EditorIssueModel in
// backend/app/routers/ai.py. The pass endpoint is the JSON-output cousin of
// editor-chat: it returns a list of issues anchored to verbatim quotes from
// the chapter, which the frontend turns into clickable highlights in the
// CodeMirror editor.

// Top-level pass categories. Maps 1:1 to the three buttons in EditorAdvisorBar.
export type IssueCategory = "readability" | "structure" | "context";

// Severity drives the popover badge color. "praise" highlights what's working;
// "issue" flags problems; "suggestion" proposes an improvement that isn't
// strictly broken. Backend normalizes anything outside this set to "issue".
export type IssueSeverity = "praise" | "issue" | "suggestion";

// Subcategory keys per category. Must stay in sync with EDITOR_PASS_SUBCATEGORIES
// in backend/app/ai/prompts.py -- adding a key on one side without the other
// means either the toolbar shows a checkbox the AI never receives, or the AI
// returns a category the frontend doesn't know how to color.
export type ReadabilitySubcategory = "grammar" | "clarity" | "redundancy" | "descriptive";
export type StructureSubcategory   = "dialogue" | "pov" | "tone" | "character" | "pacing";
export type ContextSubcategory     = "character_consistency" | "relationships" | "setting" | "lore" | "timeline" | "scene_goal";
export type IssueSubcategory       = ReadabilitySubcategory | StructureSubcategory | ContextSubcategory;

// One AI-flagged issue. The frontend matches `quote` against the editor's
// current document to determine where to render the highlight. If no exact
// match is found at locate-time, the issue is silently dropped.
export interface EditorIssue {
  id:          string;             // server-generated UUID
  category:    IssueSubcategory;   // e.g. "grammar", "character_consistency"
  severity:    IssueSeverity;
  quote:       string;             // verbatim chapter passage
  explanation: string;
  suggestions: string[];           // typically 1; "praise" entries may be []
}

export interface EditorPassRequest {
  category:         IssueCategory;
  subcategories:    IssueSubcategory[];   // empty = all subcategories
  chapter_text:     string;               // selected passage or full chapter depending on is_selection
  is_selection?:    boolean;              // true when chapter_text is a writer selection rather than whole chapter
  context_chips?:   ContextChip[];
  model_id?:        string;
  content_mode?:    string;
  project_path?:    string | null;
  chapter_filename?: string | null;       // for Writing Progress logging: which chapter file the writer is reviewing
}

export interface EditorPassResponse {
  issues:     EditorIssue[];
  model_used: string;
}

// Quick-modifier names for the per-issue revise endpoint. Each name maps to
// a short instruction the backend appends to the system prompt. "default" is
// the open rewrite -- same intent, different phrasing, no other constraint.
export type ReviseModifier =
  | "default"
  | "rewrite"
  | "expand"
  | "shorten"
  | "describe"
  | "rephrase"
  | "add sensory detail"
  | "change tone";

export interface ReviseSuggestionRequest {
  quote:              string;
  current_suggestion: string;
  modifier:           ReviseModifier;
  context_chips?:     ContextChip[];
  model_id?:          string;
  content_mode?:      string;
  project_path?:      string | null;
}

export interface ReviseSuggestionResponse {
  suggestion: string;
  model_used: string;
}


// ── Scene Summary ─────────────────────────────────────────────────────────────
// Scene summaries are the per-scene counterpart to chapter summaries. Each
// chapter is split on `---` horizontal rules; each resulting scene gets its
// own file: <project>/summaries/scenes/<chapter-stem>/scene-NN.md.

// Metadata returned by the list endpoint -- one entry per filled slot. The
// sidebar uses this to render Scene N grandchildren under each chapter.
export interface SceneSummaryInfo {
  index:    number;   // 1-based positional index
  title:    string;   // From the `# Heading` line of the scene file
  filename: string;   // e.g. "scene-01.md"
}

// Body returned when loading one scene summary. `exists` is false when the
// file hasn't been created yet -- UI uses that to show an empty state.
export interface SceneSummaryResponse {
  index:   number;
  title:   string;
  content: string;
  exists:  boolean;
}

// Payload for saving a scene summary. The backend prepends "# <title>" to
// the file, so `content` is just the body.
export interface SaveSceneSummaryPayload {
  folder_path:      string;
  chapter_filename: string;
  index:            number;
  title:            string;
  content:          string;
}

export interface SaveSceneSummaryResponse {
  filename: string;
  index:    number;
  message:  string;
}

// Payload for generating one scene summary. Title null means "ask AI to
// produce a title too" (second small call on the backend).
export interface GenerateSceneSummaryPayload {
  chapter_path: string;
  project_path: string;
  scene_text:   string;
  scene_title:  string | null;
  model_id?:    string;
  content_mode?: string;
}

export interface GenerateSceneSummaryResponse {
  title:      string;
  content:    string;
  model_used: string;
}

// Payload for the scene-split endpoint. Pure parsing -- no AI call.
export interface SplitChapterScenesPayload {
  chapter_path: string;
  project_path: string;
}

// One entry in the split response. `text` is the full scene body, which the
// frontend sends back to generate-scene-summary for each scene the writer
// wants summarized. `text_preview` is a short snippet for UI display.
export interface SplitChapterScene {
  index:        number;
  title:        string | null;
  text_preview: string;
  text:         string;
  start:        number;
  end:          number;
}

export interface SplitChapterScenesResponse {
  scenes:   SplitChapterScene[];
  hr_count: number;   // 0 triggers the "no scene breaks" fallback UI
}
