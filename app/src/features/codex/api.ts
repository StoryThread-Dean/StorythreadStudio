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
  /** What the thing IS -- the official name on its entry. */
  name: string;
  /** What the story CALLS it, when that differs. Empty means use the name. */
  display_name: string;
  /** Every word that means this thing. */
  aliases: string[];
  /** An entry Weaving made from a name, with nothing in it yet: a bare dot. */
  placeholder: boolean;
}

/** What a node is called on screen: the story's word, or its name. */
export function nodeLabel(node: { name: string; display_name?: string }): string {
  return node.display_name || node.name;
}

/** Take a word into an entry that already exists.
 *
 *  NOT a merge. The word moves; a placeholder that no longer stands in for
 *  anything goes. An entry with writing in it is refused -- see the backend. */
export function absorb(
  projectPath: string,
  into: string,
  fromId: string,
  asLabel = false,
): Promise<{ entity_id: string; name: string; display_name: string;
             aliases: string[]; absorbed: string[];
             removed_placeholder: string }> {
  return request("/absorb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, into, from_id: fromId,
                           as_label: asLabel }),
  });
}


export interface GraphEdge {
  src_id: string;
  dst_id: string;
  rel: string;
  /** WHY, in the writer's own words -- sent so the map can label the line
   *  with something worth reading instead of a relation id. */
  reason?: string;
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

/**
 * One fact on an entry's Run: something that becomes true at a point in the
 * book, rather than being true throughout.
 *
 * Declared here with the other wire types rather than in the component that
 * edits it, because three places need it -- the Weave's editor, the Profile
 * Builder, and the Profile type itself -- and a shape re-declared per consumer
 * is a shape that drifts.
 */
export interface Fact {
  id: string;
  /** When it BECOMES true. Empty is a real answer: an unplaced fact. */
  at?: string | null;
  /** A short name for the thing that changes, so two facts about it can
   *  supersede each other. */
  axis?: string;
  value?: string;
  /** True of the world, or believed by one character. */
  frame?: string | null;
  /** When the READER learns it. Empty means "as it happens". */
  revealed_at?: string | null;
  ai_scope?: string | null;
  supersedes?: string | null;
  /** A contradiction the writer marked deliberate. */
  intentional?: boolean;
}

export interface ChapterAnchor {
  chapter_id: string;
  filename: string;
  title: string;
  anchor: string;
  /** Which act it belongs to. Empty when the writer has not used acts, which
   *  is the ordinary case for a project that never opened the acts tree. */
  act_id: string;
  act_title: string;
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
  /** Which part of the sidebar it belongs to: an entry ABOUT something
   *  ("profiles"), a document the writer authors ("notes"), or neither
   *  ("other"). The Profile Builder's tabs follow the same rule the sidebar
   *  does, so a kind added in one screen appears in the other. */
  group?: string;
  sections: { id: string; heading: string; trait_blocks: boolean;
              /** Its job is done elsewhere; the form hides it unless it
               *  already holds something. Kept in the list because both
               *  parsers work from it. */
              retired?: boolean }[];
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

/** One row in the sidebar: a kind of entry, or a note document. */
export interface SectionEntry {
  kind: "type" | "note";
  id: string;
  label: string;
  icon: string;
  group: string;
  /** How much is in it. 0 means it is showing because it is a default. */
  count: number;
  default_section: boolean;
  filename?: string;
  /** Part of the app rather than something the writer added. */
  shipped: boolean;
  /**
   * What a rename would actually do. Decided by the backend, beside the code
   * that enforces it -- the frontend used to keep its own list of untouchable
   * sections, which is a rule written down twice.
   *
   *   "full"   the name, the folder and the entries move together
   *   "label"  only what it is called here changes. A shipped kind keeps its
   *            id and folder because the app's own code names them.
   *   "none"   the app opens this document BY ITS FILENAME, so its name is not
   *            the writer's to change. What is inside it is.
   */
  rename: "full" | "label" | "none";
  /**
   *   "delete" gone from the registry; refused while it holds entries
   *   "hide"   off the sidebar, nothing on disk touched (reversible from
   *            "+ Add New")
   *   "trash"  moved to notes/trash/, so the words survive the decision
   */
  removal: "delete" | "hide" | "trash";
}

/** Something not on screen yet, offered under "+ Add New". */
export interface AvailableEntry {
  kind: "type" | "note";
  id: string;
  label: string;
  icon: string;
  group: string;
  filename?: string;
}

export interface SectionGroup {
  id: string;
  label: string;
  sections: SectionEntry[];
  /** What "+ Add New" offers from inside this group. */
  available: AvailableEntry[];
}

export interface SectionsTree {
  groups: SectionGroup[];
  available: AvailableEntry[];
  converted: boolean;
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

/** "This is not what I said it was." Moves the entry to its new kind's
 *  folder, keeping its id, its name and everything written in it. Connections
 *  that no longer fit are reported in `warnings`, never torn up. */
export function setEntityKind(projectPath: string, entityId: string,
                              type: string):
    Promise<{ entity_id: string; type: string; warnings: string[] }> {
  return request("/entity/kind", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, entity_id: entityId,
                           type }),
  });
}

/**
 * Remove an entry from the world.
 *
 * `forgetAnswers` (the default) also lets the WEAVE forget it: answers about
 * the entry go, and its name comes off the retired list, so a name still in
 * the prose is asked about again rather than staying invisible forever. Pass
 * false when deleting a duplicate -- there the survivor answers to the name
 * and re-raising it would be noise.
 */
export function deleteThread(projectPath: string, entityId: string,
                             forgetAnswers = true):
    Promise<{ deleted: string; forgotten: number }> {
  return request(`/entity?${q({
    project_path: projectPath, entity_id: entityId,
    forget_answers: forgetAnswers,
  })}`, { method: "DELETE" });
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

export function fetchSections(projectPath: string): Promise<SectionsTree> {
  return request(`/sections?${q({ project_path: projectPath })}`);
}

/** Add a KIND of entry -- a Government, a Bloodline. Profiles and Other. */
export function addType(projectPath: string, label: string, group: string):
    Promise<SectionsTree> {
  return request("/type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // id is derived from the label server-side, so there is no second route
    // in that could carry a digit or a symbol past the name rule.
    body: JSON.stringify({ project_path: projectPath, id: "", label, group }),
  });
}

/**
 * Start showing a kind the Weave already knows.
 *
 * What "+ Add New > Faction" does. Faction is not being CREATED -- it ships
 * with the app and is simply not on screen yet, so picking it asks for the
 * section. Sending that to addType would be refused as a duplicate.
 */
export function showType(projectPath: string, id: string, show = true):
    Promise<SectionsTree> {
  return request("/type/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, id, show }),
  });
}

/** Add a DOCUMENT -- "Dungeon Rules". Notes only, because that is what a
 *  note is. */
export function addNote(projectPath: string, label: string): Promise<SectionsTree> {
  return request("/note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, label }),
  });
}

/**
 * Fix a section's name. Pass `id` for a kind, `filename` for a note.
 *
 * "Magic Sysstem" becomes "Magic System", and everything moves with it --
 * the folder, the entries already written, or the note's own heading.
 */
export function renameSection(
  projectPath: string,
  target: { id?: string; filename?: string },
  label: string,
): Promise<SectionsTree> {
  return request("/section", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, label, ...target }),
  });
}

/**
 * Remove a section.
 *
 * A KIND holding entries is refused with a count -- the backend will not
 * delete a writer's work. A NOTE moves to notes/trash/ and the response says
 * where, which the caller must pass on.
 */
export function deleteSection(
  projectPath: string,
  target: { id?: string; filename?: string },
): Promise<SectionsTree & { moved_to?: string }> {
  return request(`/section?${q({
    project_path: projectPath, id: target.id, filename: target.filename,
  })}`, { method: "DELETE" });
}

export function reindex(projectPath: string): Promise<{ indexed: number }> {
  return request(`/reindex?${q({ project_path: projectPath })}`, { method: "POST" });
}
