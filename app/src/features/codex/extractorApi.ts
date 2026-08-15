// features/codex/extractorApi.ts -- talking to /api/extractor
// ===========================================================
// The Profile Extractor's client. Its own file rather than more of api.ts
// because the routes live under a different prefix, but it throws the SAME
// CodexApiError -- the backend refuses with one shape everywhere, and a second
// error type would mean every screen learning two ways to read a failure.

import { CodexApiError } from "./api";

const API_BASE = "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/extractor${path}`, init);
  if (!response.ok) {
    let code = "unknown";
    let message = `That could not be completed (${response.status}).`;
    let detail = "";
    try {
      const body = await response.json();
      const payload = body?.detail;
      if (payload && typeof payload === "object") {
        code = payload.code ?? code;
        message = payload.message ?? message;
        detail = payload.detail ?? "";
      } else if (typeof payload === "string") {
        message = payload;
      }
    } catch {
      // Non-JSON body: keep the generic message rather than letting the parse
      // failure mask the real status.
    }
    throw new CodexApiError(code, message, detail);
  }
  return response.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface PlanChapter {
  chapter_id: string;
  filename: string;
  title: string;
  chars: number;
}

export interface PlanEntry {
  entity_id: string;
  name: string;
  type: string;
  written_chars: number;
  /** A SUGGESTION to leave this one alone, never an automatic skip. Nothing
   *  here can know a character from chapter two has returned for the rest of
   *  the book, so skipping would miss exactly the entry the writer wanted. */
  suggest_exclude: boolean;
}

export interface ExtractorPlan {
  chapters: PlanChapter[];
  manuscript_chars: number;
  known: PlanEntry[];
  /** False means run Weaving first: with nothing to match against, the pass
   *  proposes a world from scratch, which is the expensive way to get the
   *  noisiest possible result. */
  has_world: boolean;
  /** How many proposals a new run would destroy. */
  unreviewed: number;
  has_current: boolean;
  /** The model that will ACTUALLY run this, resolved. Shown before the button
   *  because the first live run was made by a model the writer did not think
   *  they were using: the role was unassigned, so it fell through to the
   *  Default Model. */
  model_id: string;
  /** Why no model could be resolved, when that is the answer. */
  model_error: string;
  /** That model's context window. 0 means we could not find out, which is NOT
   *  the same as "it fits". */
  context_tokens: number;
  estimated_tokens: number;
  fits: boolean;
  /** How the book will be split into requests that can actually be answered.
   *  A novel's worth of proposals does not fit in one reply and no output
   *  budget fixes that -- measured, not assumed. */
  batches: string[][];
}

/** One clickable proposal: a section's prose, or a single trait. */
export interface ExtractionPart {
  part_id: string;
  section_id: string;
  heading: string;
  form: "prose" | "trait";
  trait_name: string;
  content: string;
  state: "open" | "applied" | "dismissed";
  applied_as: string;
}

export interface ExtractionEntry {
  item_id: string;
  /** Empty means the pass found something the writer does not have yet. */
  entity_id: string;
  type: string;
  name: string;
  aliases: string[];
  /** A character the prose describes without naming. The description IS the
   *  name and must never be replaced by one the app invented. */
  unnamed: boolean;
  /** "this turns out to be that entry you already have" -- an offer only. */
  same_as: string;
  character_kind: string;
  state: "open" | "done";
  created_entity_id: string;
  parts: ExtractionPart[];
}

export interface ExtractionRun {
  run_id: string;
  created_at: string;
  model_used: string;
  scope: {
    chapter_ids?: string[];
    chapter_count?: number;
    whole_manuscript?: boolean;
    excluded?: string[];
  };
  entries: ExtractionEntry[];
  dropped?: string[];
  /** What the model actually said, when nothing could be read from it. Kept so
   *  a failure is a five-second diagnosis rather than a mystery. */
  raw_excerpt?: string;
  estimated_tokens?: number;
  context_tokens?: number;
  /** Which batch this run reached, so a writer who closed the app between
   *  batches is told they stopped at three of four rather than shown a
   *  partial world with no explanation. */
  batch_index?: number;
  batch_count?: number;
  batches_done?: number;
  batch_notes?: string[];
}

export interface ExtractionProgress {
  entries: number;
  entries_done: number;
  parts: number;
  parts_open: number;
  parts_applied: number;
  parts_dismissed: number;
  new_entries: number;
}

// ── Calls ────────────────────────────────────────────────────────────────────

export function fetchPlan(projectPath: string): Promise<ExtractorPlan> {
  return request(`/plan?project_path=${encodeURIComponent(projectPath)}`);
}

export function fetchCurrent(
  projectPath: string,
): Promise<{ run: ExtractionRun | null; progress: ExtractionProgress }> {
  return request(`/current?project_path=${encodeURIComponent(projectPath)}`);
}

export function discardCurrent(projectPath: string): Promise<{ discarded: boolean }> {
  return request(`/current?project_path=${encodeURIComponent(projectPath)}`,
                 { method: "DELETE" });
}

export function runExtraction(body: {
  project_path: string;
  chapter_ids: string[];
  exclude: string[];
  /** The writer has been told what a new run would replace and said go. */
  replace_existing: boolean;
  /** Add to the run in progress rather than starting one. Every batch after
   *  the first. Each is saved as it lands, so stopping halfway keeps half. */
  append?: boolean;
  batch_index?: number;
  batch_count?: number;
}): Promise<{ run: ExtractionRun; progress: ExtractionProgress;
              dropped: string[]; raw_excerpt?: string;
              merged?: { added: number; merged: number; parts: number } }> {
  return post("/run", body);
}

/** The ONLY route that writes to a profile. One part, one explicit action. */
export function applyPart(body: {
  project_path: string;
  item_id: string;
  part_id: string;
  action: "overwrite" | "merge" | "add" | "merge_trait" | "dismiss";
  entity_id?: string;
  /** merge_trait only, and required: merging into a trait the app picked is
   *  how a writer's own wording gets overwritten. */
  merge_into?: string;
}): Promise<{ ok: boolean; applied_as?: string; progress: ExtractionProgress }> {
  return post("/part", body);
}

export function setEntryState(body: {
  project_path: string;
  item_id: string;
  state: "open" | "done";
  created_entity_id?: string;
}): Promise<{ ok: boolean; entry: ExtractionEntry; progress: ExtractionProgress }> {
  return post("/entry", body);
}

// ── Choosing the model, from this screen ─────────────────────────────────────
//
// The Settings roles picker groups models as budget / pricier and never shows a
// context window. That is fine for a request about one chapter and useless for
// one carrying an entire manuscript, which is the writer's own report: the list
// does "not list the limits at all", so a bad choice is discovered by paying
// for it. This is the same catalog ordered by the number that decides the
// outcome here.

export interface ExtractorModel {
  id: string;
  name: string;
  context_length: number;
  cost_input_per_million: number;
  cost_output_per_million: number;
  is_free: boolean;
  /** Reasoning models spend their reply budget thinking first, and can return
   *  nothing at all. Surfaced because that is the exact trap a live run hit. */
  supports_reasoning: boolean;
}

export function fetchModels(): Promise<{
  models: ExtractorModel[]; provider?: string; error: string;
}> {
  return request("/models");
}

/** Assigns the app-wide Long-context role -- the same setting the Settings
 *  screen writes, deliberately, rather than a second copy of the choice. */
export function chooseModel(modelId: string): Promise<{ ok: boolean; model_id: string }> {
  return post("/model", { model_id: modelId });
}
