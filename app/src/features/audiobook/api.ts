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
): Promise<GenerationRun> {
  const res = await fetch(`${API_BASE}/api/audiobook/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_path: workspacePath, provider: "local-kokoro", voice_id: voiceId,
      force,
    }),
  });
  return toJson<GenerationRun>(res);
}

export async function previewSelection(
  workspacePath: string,
  text: string,
  voiceId: string,
): Promise<{ blob: Blob; warnings: string[] }> {
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
  // Marker parse warnings ride a header (the body is raw audio). They
  // matter: a selection that cuts into a pace span plays at normal pace,
  // and without the warning that reads as "pace doesn't work".
  let warnings: string[] = [];
  const raw = res.headers.get("X-Preview-Warnings");
  if (raw) {
    try { warnings = JSON.parse(decodeURIComponent(raw)); } catch { /* none */ }
  }
  return { blob: await res.blob(), warnings };
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
