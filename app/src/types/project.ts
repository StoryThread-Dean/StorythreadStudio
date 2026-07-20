// types/project.ts -- Shared TypeScript Types for Projects
// ===========================================================
// TypeScript "types" are descriptions of data shapes. They don't produce
// any runtime code -- they only exist to help the compiler catch mistakes
// before the app runs. Think of them like blueprints: you describe what a
// house looks like, and TypeScript tells you if you try to build something
// that doesn't match the blueprint.
//
// These types mirror the Pydantic models in backend/app/routers/projects.py
// so both sides agree on what data looks like.

// --- OutlineTemplateType ---
// The scaffolds available for notes/outline.md. Extended in Phase 6 with
// novella, novelette, and serial_fiction so each story type has its own
// dedicated default scaffold. Keep in sync with VALID_OUTLINE_TEMPLATES in
// backend/app/routers/projects.py.
export type OutlineTemplateType =
  | "novel"
  | "novella"
  | "novelette"
  | "short_story"
  | "serial_fiction";


// --- StoryType ---
// Writer-facing label for what kind of work a project is. Drives the default
// outline template at creation, and shown on each row of the recent-projects
// list. The two are independent on disk so the writer can swap templates
// without changing the story type.
export type StoryType =
  | "novel"
  | "novella"
  | "novelette"
  | "short_story"
  | "serial_fiction";


// Display labels for each story type, used in the picker tiles and the
// recent-projects list. Single source of truth -- both UIs read from here.
export const STORY_TYPE_LABELS: Record<StoryType, string> = {
  novel:          "Novel",
  novella:        "Novella",
  novelette:      "Novelette",
  short_story:    "Short Story",
  serial_fiction: "Serial Fiction",
};


// --- ProjectInfo ---
// Represents an open Storythread Studio writing project.
// This is what the backend returns after create or open.
export interface ProjectInfo {
  project_id:           string;
  title:                string;
  description:          string;
  root_path:            string;   // Absolute path on the user's machine
  content_mode_default: string;   // "general" | "mature" | "explicit"
  default_model:        string | null;
  series_id:            string | null;  // Links to parent series (null = standalone)
  series_path:          string | null;  // Absolute path to the series folder
  // Story type. Defaults to "novel" for legacy projects via the backend's
  // read-time fallback -- the frontend never sees null/undefined here.
  story_type:           StoryType;
  // Which outline scaffold was last applied. May be null on older projects
  // created before this field existed -- treat null as unknown (not an error).
  outline_template:     OutlineTemplateType | null;
  created_at:           string;   // ISO datetime string
  updated_at:           string;
}


// --- SeriesInfo ---
// Represents a Storythread Studio book series.
// Series hold canonical profiles and shared settings across multiple books.
export interface SeriesInfo {
  series_id:       string;
  name:            string;
  genre:           string;
  subgenre:        string;
  tone:            string;
  pacing:          string;
  target_audience: string;
  content_mode:    string;   // "general" | "mature" | "explicit"
  keywords:        string[];
  root_path:       string;   // Absolute path to the series folder
  created_at:      string;
  updated_at:      string;
}


// --- CreateSeriesPayload ---
// What we send to POST /api/series/create
export interface CreateSeriesPayload {
  folder_path: string;
  name:        string;
  genre?:      string;
  subgenre?:   string;
  tone?:       string;
  pacing?:     string;
  target_audience?: string;
  content_mode?: string;
  keywords?:   string[];
}


// --- CreateBookInSeriesPayload ---
// What we send to POST /api/projects/create-in-series
export interface CreateBookInSeriesPayload {
  series_path: string;
  title:       string;
  description?: string;
  folder_name?: string;
  // Story type drives the default outline template on the backend.
  story_type?:    StoryType;
  template_type?: OutlineTemplateType;  // Optional override; backend defaults from story_type
}


// --- BookListItem ---
// One book found inside a series, returned by POST /api/series/list-books
export interface BookListItem {
  project_id:  string;
  title:       string;
  folder_name: string;
  root_path:   string;
}

// --- CreateProjectPayload ---
// What we send to POST /api/projects/create
export interface CreateProjectPayload {
  folder_path: string;
  title:       string;
  description: string;
  // Story type drives the default outline template on the backend.
  story_type?:    StoryType;
  template_type?: OutlineTemplateType;  // Optional override; backend defaults from story_type
}

// --- ApplyOutlineTemplatePayload / Response ---
// POST /api/projects/apply-outline-template -- overwrites notes/outline.md
// with a freshly-rendered scaffold of the chosen type. Used by the editor
// toolbar [+ New Template] button and the same control in Project Settings.
export interface ApplyOutlineTemplatePayload {
  root_path:     string;
  template_type: OutlineTemplateType;
}

export interface ApplyOutlineTemplateResponse {
  content:          string;                // New outline.md body (for editor refresh)
  template_applied: OutlineTemplateType;   // Echo of what got written
}

// --- OpenProjectPayload ---
// What we send to POST /api/projects/open
export interface OpenProjectPayload {
  folder_path: string;
}

// --- RecentProject ---
// One entry from the recent projects list, returned by GET /api/projects/recent.
// The dashboard shows these sorted by last_opened so the writer can quickly
// reopen a project without navigating to its folder.
export interface RecentProject {
  project_id:   string;
  title:        string;
  root_path:    string;
  content_mode: string;
  series_name:  string | null;
  // Story type for the kind label on each row. Backend backfills "novel" for
  // legacy entries that lack the field, so the UI never sees null.
  story_type:   StoryType;
  last_opened:  string;    // ISO datetime
  exists:       boolean;   // false if the folder has been deleted/moved
}


// --- InspectFolderResponse ---
// Returned by GET /api/projects/inspect-folder?path=... -- powers the unified
// [Open Project] flow on the main menu. The backend looks at a folder picked
// by the writer and reports whether it's a project, a series, or neither.
// For series, books in the immediate children are listed inline so the UI
// can show a picker without a second round-trip.
export interface InspectedBook {
  project_id:  string;
  title:       string;
  folder_name: string;
  root_path:   string;
}

export interface InspectFolderResponse {
  kind:  "project" | "series" | "unknown";
  path:  string;
  title: string | null;
  books: InspectedBook[];
}

// --- UpdateProjectSettingsPayload ---
// What we send to PUT /api/projects/settings
export interface UpdateProjectSettingsPayload {
  root_path:             string;   // Required: identifies which project
  title?:                string;
  description?:          string;
  genre?:                string;
  tone?:                 string;
  content_mode_default?: string;
  cost_tier?:            string;
  default_model?:        string;
}

// --- ChapterInfo ---
// Metadata about one chapter file, returned by GET /api/documents/chapters.
// The editor uses this to build the chapter list in the left nav panel.
export interface ChapterInfo {
  filename: string;   // e.g. "01-chapter-1.md"
  title: string;      // e.g. "Chapter 1"
  path: string;       // Full absolute path on disk
}
