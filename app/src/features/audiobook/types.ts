// features/audiobook/types.ts
// ============================
// Shared TypeScript shapes for the Audiobook Converter frontend. These
// mirror the backend's JSON exactly (audiobook-project.json manifest,
// chapters/*.json records, the recents index rows, pronunciation rules) --
// one file to update if the backend contract ever changes.

/** The audiobook-project.json manifest (spec section 31.1). */
export interface AudiobookManifest {
  project_id: string;
  schema_version: number;
  title: string;
  author: string;
  workspace_path: string;
  source_file: string;
  language: string;
  status: string;
  created_at: string;
  updated_at: string;
  selected_provider: string | null;
  selected_model: string | null;
  selected_voice: string | null;
  output_formats: string[];
  retain_intermediate_audio: boolean;
}

/** One chapters/chapter-NNN.json record, derived from the narration copy. */
export interface AudiobookChapter {
  chapter_id: string;
  title: string;
  order: number;
  selected_for_generation: boolean;
  status: string;
}

/** One row in the dashboard's Recent Activity list. */
export interface RecentAudiobook {
  workspace_path: string;
  title: string;
  author: string;
  source_file: string;
  status: string;
  imported_at: string;
  last_opened: string;
  /** How far the last generation run got (0..1), read live from the
      workspace's run record. Null when nothing has been generated. */
  progress?: number | null;
}

/** One pronunciation dictionary entry (spec section 11.2). */
export interface PronunciationEntry {
  display_text: string;
  spoken_text: string;
  scope: "audiobook" | "all";
  case_sensitive: boolean;
}

/** What /api/audiobook/import and /project return. */
export interface AudiobookProjectPayload {
  manifest: AudiobookManifest;
  chapters: AudiobookChapter[];
  warnings?: string[];
}

/** One narrator voice from the engine's catalog. */
export interface NarratorVoice {
  id: string;
  label: string;
  language: string;
  gender_presentation: string;
}

/** The generation-run.json record (spec section 31.4 + live counters). */
export interface GenerationRun {
  run_id: string;
  status: string;
  /** Draft pass: pauses kept, continuous-flow rendering skipped (fast
      testing gear). Absent on runs from before the flag existed. */
  draft?: boolean;
  provider: string;
  model: string;
  engine_version: string;
  voice_id: string;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  total_segments: number;
  completed_segments: number;
  failed_segments: number;
  note: string | null;
}

/** Friendly labels for manifest/recents status values. */
export const AUDIOBOOK_STATUS_LABELS: Record<string, string> = {
  needs_review: "Needs Review",
  ready: "Ready",
  generating: "Generating",
  paused: "Paused",
  partially_completed: "Partially Completed",
  completed: "Completed",
  completed_with_warnings: "Completed with Warnings",
  failed: "Failed",
  export_only: "Export Only",
};
