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

export interface WorkspaceSuggestion {
  workspace_path: string;
  source_kind: "storythread-project" | "external";
  reason: string;
  collision: boolean;
}

/** Where a new audiobook should live: beside a Storythread book, or
 * under Documents/Storythread Audiobooks for outside manuscripts. */
export async function suggestWorkspace(
  sourcePath: string,
  title = "",
): Promise<WorkspaceSuggestion> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/suggest-workspace`
    + `?source_path=${encodeURIComponent(sourcePath)}`
    + `&title=${encodeURIComponent(title)}`,
  );
  return toJson<WorkspaceSuggestion>(res);
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
  /** Hosted print pass; defaults to the free local narrator. */
  provider = "local-kokoro",
  model = "",
): Promise<GenerationRun> {
  const res = await fetch(`${API_BASE}/api/audiobook/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath, provider, model, voice_id: voiceId,
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
  /** Automatic silence at every paragraph break. No engine reliably
   * pauses between paragraphs on its own. */
  paragraph_gap_ms: number;
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

// ── Hosted narration: the print pass (spec 13/19) ────────────────────────────

export interface NarrationTier {
  tier: "free" | "budget" | "standard" | "pro";
  tier_label: string;
  blurb: string;
  provider: string;
  provider_label: string;
  model: string;
  model_label: string;
  price_per_1k_chars: string;
  /** The unit providers actually quote -- "$0.62 per million" reads, where
   * "$0.00062 per 1,000" looks like a typo. */
  price_per_million_chars: string;
  same_as_local: boolean;
  voices_same_as_local: boolean;
  voices_verified: boolean;
  requires_key: boolean;
  has_api_key: boolean;
  signup_steps: string[];
  notes?: string;
  /** False = we listened to it and would not steer a writer here. Still
   * fully selectable, just not on the main shelf. */
  recommended?: boolean;
  /** Why it was demoted, in the writer's terms. */
  caveat?: string;
  /** How fast this engine is at speed 1.0, on the free narrator's scale.
   * Below 1 means it reads slowly by nature and the book's pace settings
   * are re-scaled so they sound the same here. */
  pace_baseline?: number;
}

import type { VoiceAxes } from "./VoicePicker";

/** WHICH engine narrates -- resolved once by the backend so the settings
 * screen and the narration rail can never disagree about money. */
export interface NarrationSelection {
  source: "none" | "settings" | "book" | "writing-fallback";
  provider: string;
  model: string;
  provider_label: string;
  model_label: string;
  tier: string;
  tier_label: string;
  price_per_1k_chars: string | null;
  price_per_million_chars: string | null;
  is_recommended: boolean;
  requires_key: boolean;
  has_api_key: boolean;
  using_writing_keys: boolean;
  key_setting: string;
  key_hint: string;
  signup_steps: string[];
  voices_same_as_local: boolean;
  voices: Array<{ id: string; label: string; language: string }>;
  /** Present when the engine separates voice from accent -- the picker
      then offers one dropdown per axis instead of their cross product. */
  voice_axes: VoiceAxes | null;
  voices_are_fallback: boolean;
  voices_verified: boolean;
  supports_speed: boolean;
  default_voice: string;
  book_voice: string | null;
  /** The one gate the UI uses to decide whether spending controls exist. */
  can_spend: boolean;
  /** Amber: a recommended engine with no key connected. */
  warning: string | null;
  /** Red: not a recommended narration model at all. */
  fallback_note: string | null;
  /** Zinc: a real engine with a flaw we heard for ourselves. Spending is
      still allowed -- the writer decides whether the flaw matters. */
  caveat: string;
}

/** The audiobook's own settings: narration engine + its own API keys.
 * Keys arrive MASKED and must never be sent back as-is. */
export interface AudiobookSettings {
  use_writing_keys: boolean;
  openrouter_api_key: string;
  openrouter_api_key_set: boolean;
  nanogpt_api_key: string;
  nanogpt_api_key_set: boolean;
  writing_openrouter_key_set: boolean;
  writing_nanogpt_key_set: boolean;
  writing_provider: string;
  writing_provider_label: string;
  narration_provider: string;
  narration_model: string;
  premium_voice: string;
}

export async function fetchAudiobookSettings(): Promise<AudiobookSettings> {
  return toJson<AudiobookSettings>(
    await fetch(`${API_BASE}/api/audiobook/settings`));
}

/** Partial save: omit a key field to leave it alone, send "" to clear it.
 * NEVER send a masked value back -- it would be stored verbatim. */
export async function saveAudiobookSettings(
  patch: Partial<{
    use_writing_keys: boolean;
    openrouter_api_key: string;
    nanogpt_api_key: string;
    narration_provider: string;
    narration_model: string;
    premium_voice: string;
  }>,
): Promise<AudiobookSettings> {
  const res = await fetch(`${API_BASE}/api/audiobook/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return toJson<AudiobookSettings>(res);
}

export async function fetchNarrationSelection(
  workspacePath: string,
): Promise<NarrationSelection> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/narration-selection`
    + `?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<NarrationSelection>(res);
}

/** This BOOK's narration override (kept apart from the local narrator's
 * remembered voice). */
export async function saveNarrationChoice(
  workspacePath: string,
  choice: { provider?: string; model?: string; premium_voice?: string },
): Promise<NarrationSelection> {
  const res = await fetch(`${API_BASE}/api/audiobook/narration-choice`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, ...choice }),
  });
  return toJson<NarrationSelection>(res);
}

export interface TtsCatalog {
  recommended: NarrationTier[];
  selection: NarrationSelection;
  using_writing_keys: boolean;
  providers: Array<{
    provider: string;
    provider_label: string;
    key_hint: string;
    has_api_key: boolean;
    models: Array<{
      id: string;
      label: string;
      price_per_1k_chars: string;
      price_per_million_chars: string;
      tier: string;
      same_as_local: boolean;
      voices_same_as_local: boolean;
      voices_verified: boolean;
      supports_speed: boolean;
      notes: string;
      recommended: boolean;
      caveat: string;
      voice_axes: VoiceAxes | null;
      voices: Array<{ id: string; label: string; language: string }>;
    }>;
  }>;
}

export async function fetchTtsCatalog(): Promise<TtsCatalog> {
  return toJson<TtsCatalog>(await fetch(`${API_BASE}/api/audiobook/tts-catalog`));
}

export interface PrintEstimate {
  provider: string;
  provider_label: string;
  model: string;
  model_label: string;
  characters: number;
  segments: number;
  chapters: number;
  flow_segments: number;
  price_per_1k_chars: string;
  estimate_usd: string;
  note: string;
}

export async function fetchPrintEstimate(
  workspacePath: string,
  provider: string,
  model: string,
): Promise<PrintEstimate> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/print-estimate`
    + `?workspace_path=${encodeURIComponent(workspacePath)}`
    + `&provider=${encodeURIComponent(provider)}`
    + `&model=${encodeURIComponent(model)}`,
  );
  return toJson<PrintEstimate>(res);
}

/** Audition a PAID voice on one passage. Returns the audio plus what
 * the audition itself cost. */
export async function printPreview(
  workspacePath: string,
  provider: string,
  model: string,
  voiceId: string,
  text = "",
): Promise<{ blob: Blob; costUsd: string }> {
  const res = await fetch(`${API_BASE}/api/audiobook/print-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath, provider, model, voice_id: voiceId, text,
    }),
  });
  if (!res.ok) {
    let detail = `Preview failed (${res.status}).`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return {
    blob: await res.blob(),
    costUsd: res.headers.get("X-Preview-Cost-Usd") ?? "0.00",
  };
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

/** The escape hatch: forget the interrupted run and force a stale lock
 * off so generation can start over. Completed audio is kept. */
export async function resetGeneration(workspacePath: string): Promise<void> {
  await toJson(await fetch(`${API_BASE}/api/audiobook/generation/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath }),
  }));
}

// ── The cast (spec 27) ───────────────────────────────────────────────────────
// Speakers choose a VOICE, never a provider: one run, one engine. And the
// narration copy carries NAMES ([voice:Elena]), not voice ids, so
// recasting a character never touches a word of the manuscript.

export interface Speaker {
  speaker_id: string;
  display_name: string;
  role: "narrator" | "character";
  /** Nicknames the book uses for this character. */
  aliases: string[];
  /** Local voice, used when drafting. */
  voice_id: string;
  /** Hosted voice, used on a print pass. */
  premium_voice_id: string;
}

export interface CastReport {
  speakers: Speaker[];
  /** Detected names the writer told us the narrator reads. */
  ignored_names: string[];
  /** Names the manuscript already uses that the cast does not have. */
  unassigned_names: string[];
  single_engine: boolean;
}

export async function fetchCast(workspacePath: string): Promise<CastReport> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/speakers?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<CastReport>(res);
}

export async function saveCast(
  workspacePath: string,
  speakers: { display_name: string; aliases?: string[]; voice_id: string;
              premium_voice_id?: string }[],
  narratorVoice?: string,
  narratorPremiumVoice?: string,
  ignoredNames?: string[],
): Promise<CastReport> {
  const res = await fetch(`${API_BASE}/api/audiobook/speakers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath,
      speakers: speakers.map(s => ({ premium_voice_id: "", aliases: [], ...s })),
      narrator_voice: narratorVoice ?? null,
      narrator_premium_voice: narratorPremiumVoice ?? null,
      ignored_names: ignoredNames ?? null,
    }),
  });
  return toJson<CastReport>(res);
}

/** The two rosters a cast needs, because the app has two narration
 *  passes at once: the free local narrator a book is drafted with, and
 *  the hosted engine it may be printed with. Voice ids do not carry
 *  between them. */
export interface VoiceRoster {
  label?: string;
  installed?: boolean;
  configured?: boolean;
  tier_label?: string;
  has_api_key?: boolean;
  voices: { id: string; label: string }[];
  /** Why it is empty or unusable, in the writer's terms. "" when fine. */
  note: string;
}

export async function fetchVoiceOptions(
  workspacePath: string,
): Promise<{ draft: VoiceRoster; print: VoiceRoster }> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/voice-options?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson(res);
}

/** One AI proposal about who speaks a passage. `start`/`end` index into
 *  the text that was analysed, so the editor wraps the REAL words. */
export interface SpeakerProposal {
  quote: string;
  speaker: string;
  confidence: number;
  reason: string;
  start: number;
  end: number;
  in_cast: boolean;
}

export interface SpeakerPassEstimate {
  model_id: string;
  provider_label?: string;
  price_known: boolean;
  cost_usd: number | null;
  note: string;
}

/** What one AI pass over this much text would cost, before it runs. */
export async function fetchSpeakerPassEstimate(
  workspacePath: string,
  characters: number,
): Promise<SpeakerPassEstimate> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/speaker-pass-estimate`
    + `?workspace_path=${encodeURIComponent(workspacePath)}`
    + `&characters=${characters}`,
  );
  return toJson<SpeakerPassEstimate>(res);
}

/** Optional AI attribution. Takes an AbortSignal because this is the one
 *  audiobook call that waits on a language model, and a writer who is
 *  tired of waiting must be able to take their walk back. */
export async function analyzeSpeakers(
  workspacePath: string,
  text: string,
  signal?: AbortSignal,
): Promise<{ proposals: SpeakerProposal[]; dropped: number; model_used: string }> {
  const res = await fetch(`${API_BASE}/api/audiobook/analyze-speakers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, text }),
    signal,
  });
  return toJson(res);
}

// ── Audio freshness (spec 24.2) ──────────────────────────────────────────────
// Which chapters still match their narration. Read-only: asking never
// spawns the local engine and never touches a paid one, so the rail can
// refresh it on every save.

export type ChapterAudioStatus =
  | "current" | "partial" | "outdated" | "not_generated" | "empty";

export interface ChapterAudio {
  chapter_id: string;
  title: string;
  status: ChapterAudioStatus;
  current: number;
  outdated: number;
  missing: number;
}

export interface AudioStatus {
  chapters: ChapterAudio[];
  book: ChapterAudioStatus;
  outdated_segments: number;
  draft_segments: number;
  /** "voice" | "text" when the whole book agrees on one cause, else "". */
  outdated_reason: string;
}

export async function fetchAudioStatus(workspacePath: string): Promise<AudioStatus> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/audio-status?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<AudioStatus>(res);
}

// ── Storage and cleanup (spec 25) ────────────────────────────────────────────

export type RetentionMode = "keep" | "delete_after_export" | "ask_after_export";

export interface StorageCategory {
  key: string;
  label: string;
  description: string;
  /** What is lost for good. Empty when nothing is. */
  consequence: string;
  /** Pre-checked in the dialog. Never true for anything irreversible. */
  default_selected: boolean;
  /** Cannot be rebuilt at all -- earns a stronger warning. */
  protected: boolean;
  files: number;
  bytes: number;
}

export interface StorageReport {
  categories: StorageCategory[];
  total_bytes: number;
  /** Exports survive but the audio behind them does not (spec 25.3). */
  export_only: boolean;
  export_only_note: string;
  has_exports: boolean;
  retention: RetentionMode;
}

export async function fetchStorage(workspacePath: string): Promise<StorageReport> {
  const res = await fetch(
    `${API_BASE}/api/audiobook/storage?workspace_path=${encodeURIComponent(workspacePath)}`,
  );
  return toJson<StorageReport>(res);
}

export async function saveRetention(
  workspacePath: string,
  retention: RetentionMode,
): Promise<StorageReport> {
  const res = await fetch(`${API_BASE}/api/audiobook/storage/retention`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, retention }),
  });
  return toJson<StorageReport>(res);
}

export interface CleanupResult {
  deleted: Record<string, { files: number; bytes: number }>;
  freed_bytes: number;
  /** Files that would not delete (locked by a player, usually). */
  problems: string[];
  storage: StorageReport;
}

export async function runCleanup(
  workspacePath: string,
  categories: string[],
): Promise<CleanupResult> {
  const res = await fetch(`${API_BASE}/api/audiobook/storage/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_path: workspacePath, categories }),
  });
  return toJson<CleanupResult>(res);
}

/** Bytes as a writer reads them. Sizes here run from KB to many GB. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
