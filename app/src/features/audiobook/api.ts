// features/audiobook/api.ts
// ==========================
// Thin fetch wrappers for the /api/audiobook endpoints. Every function
// throws an Error whose message is the backend's user-facing `detail`
// string, so components can show it directly -- no status-code plumbing
// in the UI layer.

import type {
  AudiobookProjectPayload,
  GenerationRun,
  NarratorVoice,
  PronunciationEntry,
  RecentAudiobook,
} from "./types";

const API_BASE = "http://localhost:8000";

/** Parse a response, turning FastAPI error bodies into throwable Errors. */
async function toJson<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  let detail = `Server returned ${res.status}.`;
  try {
    const body = await res.json();
    if (body?.detail) detail = body.detail;
  } catch {
    // Non-JSON error body -- keep the generic message.
  }
  throw new Error(detail);
}

export async function fetchRecents(): Promise<RecentAudiobook[]> {
  const res = await fetch(`${API_BASE}/api/audiobook/recents`);
  const body = await toJson<{ audiobooks: RecentAudiobook[] }>(res);
  return body.audiobooks;
}

export async function removeRecent(workspacePath: string): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/recents/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath }),
  }));
}

export async function importSource(
  sourcePath: string,
  workspacePath: string,
  title: string,
): Promise<AudiobookProjectPayload> {
  const res = await fetch(`${API_BASE}/api/audiobook/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_path: sourcePath,
      workspace_path: workspacePath,
      title,
    }),
  });
  return toJson<AudiobookProjectPayload>(res);
}

export async function fetchProject(workspacePath: string): Promise<AudiobookProjectPayload> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/project?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<AudiobookProjectPayload>(res);
}

export async function fetchNarration(workspacePath: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/narration?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  const body = await toJson<{ content: string }>(res);
  return body.content;
}

export async function saveNarration(
  workspacePath: string,
  content: string,
): Promise<{ chapters: AudiobookProjectPayload["chapters"]; warnings: string[] }> {
  const res = await fetch(`${API_BASE}/api/audiobook/narration`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, content }),
  });
  return toJson(res);
}

export async function fetchPronunciations(workspacePath: string): Promise<{
  workspace_rules: PronunciationEntry[];
  global_rules: PronunciationEntry[];
}> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/pronunciations?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson(res);
}

// ── Voices, preview, generation ──────────────────────────────────────────────

export async function fetchVoices(): Promise<NarratorVoice[]> {
  // First call spawns the local worker and loads the model -- give it
  // the time it needs instead of failing fast.
  const res = await fetch(`${API_BASE}/api/audiobook/voices?provider=local-kokoro`);
  const body = await toJson<{ voices: NarratorVoice[] }>(res);
  return body.voices;
}

export async function previewVoice(
  text: string,
  voiceId: string,
  workspacePath: string,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/audiobook/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text, voice_id: voiceId, provider: "local-kokoro",
      workspace_path: workspacePath,
    }),
  });
  if (!res.ok) {
    let detail = `Preview failed (${res.status}).`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return res.blob();
}

export async function startGeneration(
  workspacePath: string,
  voiceId: string,
  force = false,
  draft = false,
): Promise<GenerationRun> {
  const res = await fetch(`${API_BASE}/api/audiobook/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath, provider: "local-kokoro", voice_id: voiceId,
      force, draft,
    }),
  });
  return toJson<GenerationRun>(res);
}

export interface PreviewTracePiece {
  speed: number;
  dialogue: boolean;
  marker_pace: number | null;
  snippet: string;
}

export async function previewSelection(
  workspacePath: string,
  text: string,
  voiceId: string,
): Promise<{ blob: Blob; warnings: string[]; trace: PreviewTracePiece[] }> {
  const res = await fetch(`${API_BASE}/api/audiobook/preview-selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath, text, voice_id: voiceId,
      provider: "local-kokoro",
    }),
  });
  if (!res.ok) {
    let detail = `Preview failed (${res.status}).`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  // Marker parse warnings and the render trace ride headers (the body is
  // raw audio). The trace is the ground truth of what was rendered --
  // exact speed per piece -- so pacing questions get answered by facts.
  let warnings: string[] = [];
  const rawWarnings = res.headers.get("X-Preview-Warnings");
  if (rawWarnings) {
    try { warnings = JSON.parse(decodeURIComponent(rawWarnings)); } catch { /* none */ }
  }
  let trace: PreviewTracePiece[] = [];
  const rawTrace = res.headers.get("X-Preview-Trace");
  if (rawTrace) {
    try { trace = JSON.parse(decodeURIComponent(rawTrace)); } catch { /* none */ }
  }
  return { blob: await res.blob(), warnings, trace };
}

export interface EngineStatus {
  installed: boolean;
  mode: "packaged" | "dev" | "none";
  running: boolean;
  installed_version: string | null;
  available_version: string;
  download_published: boolean;
  download_size_mb: number | null;
  install: { state: string; progress: number; error: string | null };
}

export async function fetchEngineStatus(): Promise<EngineStatus> {
  const res = await fetch(`${API_BASE}/api/audiobook/local-engine/status`);
  return toJson<EngineStatus>(res);
}

export async function installEngine(): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/local-engine/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
}

// ── Export (assembly) ────────────────────────────────────────────────────────

export interface FfmpegStatus {
  installed: boolean;
  version: string;
  download_size_mb: number;
  install: { state: string; progress: number; error: string | null };
}

export interface ExportStatus {
  state: "idle" | "starting" | "running" | "done" | "error";
  message: string | null;
  progress: number;
  error: string | null;
  outputs: string[];
  workspace_path: string | null;
}

export async function fetchFfmpegStatus(): Promise<FfmpegStatus> {
  return toJson(await fetch(`${API_BASE}/api/audiobook/ffmpeg/status`));
}

export async function installFfmpeg(): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/ffmpeg/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
}

export async function startExport(workspacePath: string, formats: string[]): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/assemble`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, formats }),
  }));
}

export async function fetchExportStatus(): Promise<ExportStatus> {
  return toJson(await fetch(`${API_BASE}/api/audiobook/assemble/status`));
}

export interface NarrationSettings {
  narrator_pace: number;
  dialogue_pace: number;
  scene_break_ms: number;
  chapter_break_ms: number;
}

export async function fetchNarrationSettings(workspacePath: string): Promise<NarrationSettings> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/narration-settings?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<NarrationSettings>(res);
}

export async function saveNarrationSettings(
  workspacePath: string,
  settings: NarrationSettings,
): Promise<NarrationSettings> {
  const res = await fetch(`${API_BASE}/api/audiobook/narration-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, ...settings }),
  });
  return toJson<NarrationSettings>(res);
}

/** Remember the narrator voice PER BOOK -- restored next session. */
export async function saveVoice(workspacePath: string, voiceId: string): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/voice`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, voice_id: voiceId }),
  }));
}

// ── Adding chapters to an existing audiobook ─────────────────────────────────

export interface AvailableChapter {
  title: string;
  characters: number;
}

export async function fetchAvailableChapters(workspacePath: string): Promise<{
  available: AvailableChapter[];
  source: string;
  warnings: string[];
}> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/chapters/available?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson(res);
}

export async function addChapters(
  workspacePath: string,
  titles: string[],
): Promise<{
  content: string;
  chapters: AudiobookProjectPayload["chapters"];
  warnings: string[];
}> {
  const res = await fetch(`${API_BASE}/api/audiobook/chapters/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, titles }),
  });
  return toJson(res);
}

// ── Book metadata + cover (spec 17) ──────────────────────────────────────────

export interface BookMetadata {
  title: string;
  subtitle: string;
  author: string;
  narrator: string;
  series: string;
  series_number: string;
  description: string;
  genre: string;
  publication_year: string;
  publisher: string;
  copyright: string;
  language: string;
  use_chapter_names: boolean;
  embed_cover: boolean;
  apply_to_chapter_mp3s: boolean;
  cover_file: string | null;
}

export async function fetchMetadata(workspacePath: string): Promise<BookMetadata> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/metadata?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<BookMetadata>(res);
}

export async function saveMetadata(
  workspacePath: string,
  metadata: Omit<BookMetadata, "cover_file">,
): Promise<BookMetadata> {
  const res = await fetch(`${API_BASE}/api/audiobook/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, ...metadata }),
  });
  return toJson<BookMetadata>(res);
}

export interface CoverInfo {
  cover_file: string | null;
  width?: number;
  height?: number;
  square?: boolean;
}

export async function setCover(
  workspacePath: string,
  sourcePath: string,
): Promise<CoverInfo> {
  const res = await fetch(`${API_BASE}/api/audiobook/metadata/cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, source_path: sourcePath }),
  });
  return toJson<CoverInfo>(res);
}

export async function removeCover(workspacePath: string): Promise<void> {
  await toJson(await fetch(
    `${API_BASE}/api/audiobook/metadata/cover?workspace_path=${encodeURIComponent(workspacePath)}`,
    { method: "DELETE" },
  ));
}

/** The preview <img> URL for the stored cover; cache-busted so a
 * replaced cover shows immediately. */
export function coverImageUrl(workspacePath: string, bust: number): string {
  return `${API_BASE}/api/audiobook/metadata/cover-image`
    + `?workspace_path=${encodeURIComponent(workspacePath)}&v=${bust}`;
}

export async function fetchMarkerDemo(kind: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/audiobook/marker-demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!res.ok) {
    let detail = `Demo failed (${res.status}).`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return res.blob();
}

export async function fetchGenerationStatus(
  workspacePath: string,
): Promise<{ run: GenerationRun | null; active: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/generation/status?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson(res);
}

async function generationControl(action: "pause" | "cancel" | "resume", workspacePath: string) {
  const res = await fetch(`${API_BASE}/api/audiobook/generation/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath }),
  });
  return toJson(res);
}

export const pauseGeneration = (ws: string) => generationControl("pause", ws);
export const cancelGeneration = (ws: string) => generationControl("cancel", ws);
export const resumeGeneration = (ws: string) => generationControl("resume", ws);

export async function savePronunciations(
  workspacePath: string,
  workspaceRules: PronunciationEntry[],
  globalRules: PronunciationEntry[],
): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/pronunciations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath,
      workspace_rules: workspaceRules,
      global_rules: globalRules,
    }),
  }));
}
