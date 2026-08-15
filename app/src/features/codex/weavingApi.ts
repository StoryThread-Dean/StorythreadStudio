// features/codex/weavingApi.ts -- talking to the walkthrough
// ===========================================================
// The scan, the run ledger and the brief. Separate from api.ts because the
// shapes here are about a SESSION rather than about the world -- and because
// the two-phase contract below is a thing a caller has to get right, which is
// easier to state in one small file than buried in a large one.
//
// THE ONE RULE A CALLER MUST NOT BREAK
// -----------------------------------
// `apply()` means the Thread file was written to DISK. Calling it before the
// save has landed breaks the promise that a discarded edit comes back as a
// question -- the writer would lose the edit AND the finding that would have
// offered it again. There is no autosave in this app, so the distinction is
// real every single time, not an edge case.
//
// The ledger also understands a "staged" state for a change sitting in an
// unsaved buffer. No client sends it: every surface here saves directly, so
// there is no buffer to discard. The backend keeps the state because a future
// buffer-editing surface would need it -- and a client for it belongs with
// that surface, not sitting here uncalled.

import { CodexApiError } from "./api";

const API_BASE = "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/codex${path}`, init);
  if (!response.ok) {
    let code = "unknown";
    let message = `Weaving could not complete that (${response.status}).`;
    let detail = "";
    try {
      const payload = (await response.json())?.detail;
      if (payload && typeof payload === "object") {
        code = payload.code ?? code;
        message = payload.message ?? message;
        detail = payload.detail ?? "";
      }
    } catch {
      // A non-JSON body -- keep the generic message rather than letting the
      // parse failure mask the real status.
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

/** How much Weaving in one sitting. The scan is the same work either way. */
/**
 * Which of the four passes.
 *
 * Still called Depth, and still sent as `depth`, because the field name is on
 * the wire and a client mid-update should not break over a rename. What changed
 * is what the values MEAN: these were three sizes of one thing (full, targeted,
 * quick) and are now four different questions.
 *
 * The backend still accepts the old three and maps them: full and targeted to
 * the warp, quick to the cloth, since "problems only" IS reading the cloth.
 */
export type Depth = "warp" | "weft" | "cloth" | "unwoven_pass";

export interface Stop {
  kind: string;
  /** Stable across runs -- this is what the ledger remembers. */
  key: string;
  title: string;
  /** The rule that fired. Every stop must be able to answer "why am I seeing
   *  this?", or the walkthrough trains the writer to click through it. */
  why: string;
  entity_id: string;
  chapter_id: string;
  quote: string;
  evidence_hash: string;
  detail: Record<string, unknown>;
}

export interface ScanResult {
  run_id: string | null;
  stops: Stop[];
  counts: Record<string, number>;
  /** Everything found, BEFORE the writer's answers were subtracted -- so
   *  "12 of 340" means something and a long session does not look like it
   *  had barely started. */
  total: number;
  /** Chapters that could not be read. Said out loud rather than quietly
   *  scanned around. */
  unreadable: string[];
  /** Unwoven only, empty for every other pass. Every part of the world with
   *  how much of it is still open -- the sitting is bounded, the board is not,
   *  because a bounded list shown on its own lies about how much is left. */
  domains: WorldDomain[];
  resumed: ResumeReport;
}

/**
 * What a resumed sitting found changed under it. Only populated when the scan
 * carries a run id, which means: after Start, not on the setup screen.
 *
 * This was typed here and read by NOTHING for months, which is the whole of
 * gap A8. A stale stop is one the writer already put off, about words that have
 * since been rewritten -- and it came back indistinguishable from a stop nobody
 * had ever seen, which is precisely what the spec forbids.
 */
export interface ResumeReport {
  /** How many answers are about text that has since changed. */
  stale?: number;
  /** Stops whose answers no longer match anything the scan found. Kept rather
   *  than deleted: the condition can come back. */
  gone?: number;
  answered?: number;
  /** WHICH stops, so a card can say so rather than a banner claiming it
   *  vaguely. */
  stale_keys?: string[];
  /** Where they live, so re-checking just those is one scan. */
  chapters?: string[];
  /** Stale stops with no chapter to scope to. Reported because a
   *  chapter-scoped re-check silently leaves these out otherwise. */
  stale_elsewhere?: number;
}

export interface WorldDomain {
  id: string;
  /** The writer-facing name: "Power and who holds it", not "governance". */
  label: string;
  /** Still unanswered here, whether or not this sitting asks about it. */
  open: number;
  /** How many of those this sitting is actually asking. */
  asked_now: number;
}

export interface Run {
  run_id: string;
  created_at: string;
  updated_at: string;
  depth: string;
  answers: Record<string, { state: string; was?: string; evidence_hash?: string }>;
  retired: string[];
  muted_kinds: string[];
  disambiguations: Record<string, string>;
}

export interface RunSummary {
  run_id: string;
  created_at: string;
  updated_at: string;
  depth: string;
  answered: number;
  deferred: number;
}

export interface BriefPiece {
  entity_id: string;
  name: string;
  type: string;
  tokens: number;
  relevance: number;
  /** Why this Thread is here, in words -- the question that makes the
   *  inspect panel worth opening. */
  reason: string;
  pinned: boolean;
  text: string;
}

export interface Brief {
  brief: string;
  threads: BriefPiece[];
  omitted: { entity_id: string; name: string; tokens: number; reason: string }[];
  token_estimate: number;
  as_of: string | null;
  enabled: boolean;
  refused: boolean;
  refusal: string;
  withheld_spoilers: number;
  withheld_by_scope: number;
  /** Entries left out because the writer said where they appear and this
   *  is not one of those places. Counted so a shorter brief is never
   *  mistaken for a smaller world. */
  withheld_not_present?: number;
  budget: Record<string, number>;
  mentioned: string[];
}

// ── The scan ─────────────────────────────────────────────────────────────────

export function scan(
  projectPath: string,
  options: {
    depth?: Depth; types?: string[]; chapterIds?: string[];
    kinds?: string[]; runId?: string | null; domains?: string[];
  } = {},
): Promise<ScanResult> {
  // FREE. No role, no model, no cost -- which is what lets the walkthrough
  // quote a real number before offering anything that spends.
  return post("/scan", {
    project_path: projectPath,
    depth: options.depth ?? "full",
    types: options.types ?? [],
    chapter_ids: options.chapterIds ?? [],
    kinds: options.kinds ?? [],
    // Unwoven only. One domain means the writer picked it off the board, and
    // the backend stops rationing once they have said what they want.
    domains: options.domains ?? [],
    run_id: options.runId ?? null,
  });
}

// ── The run ledger ───────────────────────────────────────────────────────────

export function startRun(
  projectPath: string,
  options: { depth?: Depth; types?: string[]; chapterIds?: string[] } = {},
): Promise<Run> {
  return post("/run", {
    project_path: projectPath,
    depth: options.depth ?? "full",
    types: options.types ?? [],
    chapter_ids: options.chapterIds ?? [],
  });
}

export function fetchRuns(projectPath: string): Promise<{ runs: RunSummary[] }> {
  return request(`/runs?project_path=${encodeURIComponent(projectPath)}`);
}

export function fetchRun(projectPath: string, runId: string): Promise<Run> {
  return request(`/run?project_path=${encodeURIComponent(projectPath)}`
                 + `&run_id=${encodeURIComponent(runId)}`);
}

/**
 * Carry on where you left off, rather than starting again.
 *
 * WHY THIS IS NOT THE SAME AS A NEW RUN. Permanent answers live in the book,
 * so applied and dismissed stops stay answered either way -- which is exactly
 * why this gap was invisible for so long. But a run also holds what was
 * DEFERRED and which kinds were MUTED in that sitting, and both are per-session
 * on purpose: "not yet" means not in this sitting, and muting a kind is a
 * working preference rather than a judgement about the book. Starting fresh
 * silently discards both, so a writer who closed the app mid-walk came back to
 * questions they had already put off.
 *
 * `run` is null when there is nothing to resume. That is not an error -- a book
 * nobody has woven has no session -- and the caller starts a new one.
 */
export function resumeRun(projectPath: string): Promise<{ run: Run | null }> {
  return post(`/run/resume?project_path=${encodeURIComponent(projectPath)}`, {});
}

interface AnswerBody {
  key?: string;
  state?: string;
  evidence_hash?: string;
  retire_phrase?: string;
  mute?: string;
  unmute?: string;
  alias?: string;
  entity_id?: string;
  discard_staged?: boolean;
}

function answer(projectPath: string, runId: string, body: AnswerBody):
    Promise<{ run: Run; returned: number }> {
  return post("/run/answer", { project_path: projectPath, run_id: runId, ...body });
}

/** The Thread file was SAVED. Permanent; never comes back. */
export function apply(projectPath: string, runId: string, stop: Stop) {
  return answer(projectPath, runId,
                { key: stop.key, state: "applied",
                  evidence_hash: stop.evidence_hash });
}

/** "Not yet." Comes back next session, because that is what it means. */
export function defer(projectPath: string, runId: string, stop: Stop) {
  return answer(projectPath, runId,
                { key: stop.key, state: "deferred",
                  evidence_hash: stop.evidence_hash });
}

/** The permanent no, worded per kind on screen ("Never make this an entry",
 *  "Not a problem", ...). For a name it retires the PHRASE -- the same word in
 *  another chapter must not be asked either. */
export function dismiss(projectPath: string, runId: string, stop: Stop,
                        phrase?: string) {
  return answer(projectPath, runId, {
    key: stop.key, state: "dismissed",
    evidence_hash: stop.evidence_hash,
    ...(phrase ? { retire_phrase: phrase } : {}),
  });
}

/** "Never ask about this kind." Reversible -- it is a preference, not a
 *  judgement about the book. */
/**
 * Stop asking about a kind of stop.
 *
 * `forEntity` narrows it to ONE entry (R8.3). Without it the mute is about the
 * whole book, which is what "Never ask" silently meant for its whole existence
 * -- the spec's word was "for this target", and a writer who wanted one
 * unreliable character left alone had to turn the check off everywhere.
 */
export function muteKind(projectPath: string, runId: string, kind: string,
                         muted = true, forEntity?: string) {
  const scope = forEntity ? { mute_for: forEntity } : {};
  return answer(projectPath, runId,
                muted ? { mute: kind, ...scope }
                      : { unmute: kind, ...scope });
}

// ── The brief ────────────────────────────────────────────────────────────────

export function fetchBrief(
  projectPath: string,
  options: {
    at?: string | null; pov?: string | null; text?: string;
    modelContextLimit?: number; outputReserve?: number;
    systemPromptTokens?: number; fixedRequestOverhead?: number;
    pinnedTokens?: number;
    pinned?: string[]; excludeIds?: string[]; excludeTypes?: string[];
    enabled?: boolean; includeOnRequest?: boolean;
  } = {},
): Promise<Brief> {
  // THIS SENDS NOTHING ANYWHERE. It asks what WOULD be sent, so the writer
  // can read it, remove Threads from it, or turn it off. Something they
  // initiate does the sending, later and elsewhere.
  return post("/context", {
    project_path: projectPath,
    at: options.at ?? null,
    pov: options.pov ?? null,
    text: options.text ?? "",
    model_context_limit: options.modelContextLimit ?? 32000,
    output_reserve: options.outputReserve ?? 4000,
    system_prompt_tokens: options.systemPromptTokens ?? 0,
    fixed_request_overhead: options.fixedRequestOverhead ?? 0,
    pinned_tokens: options.pinnedTokens ?? 0,
    pinned: options.pinned ?? [],
    exclude_ids: options.excludeIds ?? [],
    exclude_types: options.excludeTypes ?? [],
    // Sent explicitly. A missing parameter must never be the reason the
    // Weave quietly turns itself back on.
    enabled: options.enabled !== false,
    include_on_request: options.includeOnRequest === true,
  });
}
