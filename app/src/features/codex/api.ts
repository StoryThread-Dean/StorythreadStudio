// features/codex/api.ts -- talking to /api/codex
// ==============================================
// A thin typed client. The backend refuses with a shared shape --
// {code, message, detail} -- so this unwraps it once and every caller gets a
// CodexApiError carrying the code to branch on and the sentence to show.
// Without that, each screen would end up string-matching error text.

const API_BASE = "http://localhost:8000";

export class CodexApiError extends Error {
  constructor(
    /** Stable identifier, e.g. "entity_not_found". Branch on this. */
    public code: string,
    /** One sentence a novelist can act on. Show this. */
    message: string,
    /** Specifics: which id, which field, which line. */
    public detail: string = "",
  ) {
    super(message);
    this.name = "CodexApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/codex${path}`, init);
  if (!response.ok) {
    let code = "unknown";
    let message = `The Weave could not complete that (${response.status}).`;
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
      // A non-JSON body (a proxy error, a crash) -- keep the generic message
      // rather than letting the parse failure mask the real status.
    }
    throw new CodexApiError(code, message, detail);
  }
  return response.json() as Promise<T>;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ThreadSummary {
  entity_id: string;
  type: string;
  name: string;
  filename: string;
  status: string;
}

export interface GraphNode {
  entity_id: string;
  type: string;
  name: string;
}

export interface GraphEdge {
  src_id: string;
  dst_id: string;
  rel: string;
  active: boolean;
  expired: boolean;
}

export interface WeaveGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  as_of: string | null;
  /** Counted rather than silently dropped, so the map can say how much of
   *  the world it is not showing. */
  hidden_nodes: number;
  hidden_edges: number;
}

export interface ChapterAnchor {
  chapter_id: string;
  filename: string;
  title: string;
  anchor: string;
}

export interface WeaveHealth {
  schema_version: number;
  migration_state: "none" | "incomplete" | "done";
  index_dirty: boolean;
  registry_ok: boolean;
  registry_error: string;
}

export interface TypeEntry {
  id: string;
  label: string;
  folder: string;
  icon: string;
  sections: { id: string; heading: string; trait_blocks: boolean }[];
}

export interface TypeRegistry {
  schema_version: number;
  types: TypeEntry[];
  relations: {
    id: string; label: string; inverse: string | null; symmetric: boolean;
    source_types: string[]; target_types: string[];
    cardinality: string; exclusive_group: string | null;
  }[];
}

// ── Calls ────────────────────────────────────────────────────────────────────

const q = (params: Record<string, string | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export function fetchTypes(projectPath: string): Promise<TypeRegistry> {
  return request(`/types?${q({ project_path: projectPath })}`);
}

export function fetchHealth(projectPath: string): Promise<WeaveHealth> {
  return request(`/health?${q({ project_path: projectPath })}`);
}

export function fetchAnchors(projectPath: string): Promise<{ chapters: ChapterAnchor[] }> {
  return request(`/anchors?${q({ project_path: projectPath })}`);
}

export function fetchThreads(projectPath: string, type?: string):
    Promise<{ threads: ThreadSummary[] }> {
  return request(`/list?${q({ project_path: projectPath, type })}`);
}

export function fetchGraph(
  projectPath: string,
  options: { at?: string; pov?: string; hideSpoilers?: boolean } = {},
): Promise<WeaveGraph> {
  return request(`/graph?${q({
    project_path: projectPath,
    at: options.at,
    pov: options.pov,
    // Sent explicitly: the backend defaults to hiding, and a missing
    // parameter must not silently mean "show me the spoilers".
    hide_spoilers: options.hideSpoilers !== false,
  })}`);
}

export function fetchThread(projectPath: string, entityId: string): Promise<Record<string, unknown>> {
  return request(`/entity?${q({ project_path: projectPath, entity_id: entityId })}`);
}

export function resolveThread(
  projectPath: string,
  entityId: string,
  options: { at?: string; pov?: string; hideSpoilers?: boolean; includeOnRequest?: boolean } = {},
): Promise<Record<string, unknown>> {
  return request(`/resolve?${q({
    project_path: projectPath,
    entity_id: entityId,
    at: options.at,
    pov: options.pov,
    hide_spoilers: options.hideSpoilers !== false,
    include_on_request: options.includeOnRequest === true,
  })}`);
}

export function reindex(projectPath: string): Promise<{ indexed: number }> {
  return request(`/reindex?${q({ project_path: projectPath })}`, { method: "POST" });
}
