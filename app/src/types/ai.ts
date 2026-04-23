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
  // resolves blanks to ~/Documents/StoryForge and always returns a real path
  // here -- the UI can treat it as non-null for display purposes.
  vault_root:             string;
}

export interface UpdateSettingsPayload {
  openrouter_api_key?: string;
  default_model?:      string;
  content_mode?:       string;
  cost_tier?:          string;
  // Empty string resets to the default (~/Documents/StoryForge).
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
}

// ── Assistants ────────────────────────────────────────────────────────────────

export interface AssistantMeta {
  id: string;
  name: string;
  category: string;
  scope: string;
  description: string;
}

export interface AssistantSuggestion {
  label: string;
  content: string;
}

export interface AssistantResponse {
  assistant_id: string;
  assistant_name: string;
  summary: string;
  suggestions: AssistantSuggestion[];
  notes: string[];
  model_used: string;
  had_em_dashes: boolean;
}

// ── Importance Levels ─────────────────────────────────────────────────────────
// Controls how (and whether) a trait is sent to the AI.
// Core = always in prompt at highest priority.
// Hidden = writer-only, never sent to the API.

export type ImportanceLevel = "core" | "present" | "background" | "contextual" | "hidden";

// ── Context Chips ─────────────────────────────────────────────────────────────

// A context chip is a piece of profile content the writer explicitly attaches
// to an AI assistant request. The AI only sees what the writer chooses to share.
export interface ContextChip {
  type: string;    // "character" | "relationship" | "location" | "lore" | etc.
  name: string;    // Display name, e.g. "Elara Voss"
  content: string; // The profile summary or relevant text to include
}

export interface RunAssistantPayload {
  assistant_id: string;
  selected_text: string;
  model_id?: string;
  context_chips?: ContextChip[];
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

// The three focus categories for the main editor's Writing Companion panel.
// Each category sets the AI's area of expertise for the conversation.
// null = no category selected (general chat mode)
export type EditorChatCategory = "readability" | "structure" | "context" | null;

export interface EditorChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EditorChatPayload {
  category:        EditorChatCategory;
  text_content:    string;          // Selected text OR full chapter
  is_full_chapter: boolean;
  messages:        EditorChatMessage[];
  context_chips?:  ContextChip[];
  model_id?:       string;
  content_mode?:   string;
  project_path?:   string;
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
