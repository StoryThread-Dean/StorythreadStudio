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

// --- ProjectInfo ---
// Represents an open StoryForge writing project.
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
  created_at:           string;   // ISO datetime string
  updated_at:           string;
}


// --- SeriesInfo ---
// Represents a StoryForge book series.
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
}

// --- OpenProjectPayload ---
// What we send to POST /api/projects/open
export interface OpenProjectPayload {
  folder_path: string;
}

// --- ChapterInfo ---
// Metadata about one chapter file, returned by GET /api/documents/chapters.
// The editor uses this to build the chapter list in the left nav panel.
export interface ChapterInfo {
  filename: string;   // e.g. "01-chapter-one.md"
  title: string;      // e.g. "Chapter One"
  path: string;       // Full absolute path on disk
}
