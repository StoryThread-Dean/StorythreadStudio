// screens/profileSource.ts -- where the Profile Builder reads and writes
// =======================================================================
// The Profile Builder used to talk to /api/profiles and nothing else. Once a
// project is brought into the Weave its entries live in codex/ instead, and the
// screen kept reading the old folder -- so the writer saw thirteen Characters in
// the sidebar, twelve on the Weave map, and could open five. Twelve of their
// characters existed on disk, were indexed, were connected, and had no editable
// page anywhere in the app.
//
// So the screen no longer knows which folder it is looking at. It asks the
// backend where this project's entries live (one rule, one place -- see
// entries_home in backend/app/codex/migrate.py) and gets back one of the two
// implementations below. Both speak the same small vocabulary:
//
//     list · load · save · remove · create · importFile
//
// WHY NOT JUST CONVERT EVERYTHING TO CODEX AND DELETE THE OTHER PATH
//
// Because conversion is an offer, not a toll gate -- it is a consented,
// backed-up, two-click operation, and a writer who has never opened the Weave
// must still find their profiles exactly where they left them. The sidebar
// already works this way; this makes the editor agree with it.
//
// THE ONE THING THAT MUST NOT GO WRONG
//
// A Thread file holds more than a profile does: aliases, the story's own name
// for something, connections to other entries, and the Run -- the facts that
// change across the book. This screen edits none of that. So the whole Thread
// is carried through a load and handed back on save (`weave` below). A save
// that quietly dropped what it did not understand would delete the writer's
// connections the first time they fixed a typo, and nothing on screen would
// say so.

import type { Profile, ProfileListItem, CharacterKind } from "../types/profile";
import { SECTION_CONFIGS } from "../types/profile";
import { v4 as uuidv4 } from "uuid";

const API_BASE = "http://localhost:8000";

export type EntriesHome = "codex" | "profiles";

/** A Thread as the Weave stores it. Deliberately loose: this module's job is to
 *  hand back every field it was given, including ones added after it was
 *  written, so it must not enumerate them. */
export type WeaveThread = Record<string, unknown>;

export interface ProfileSource {
  home: EntriesHome;
  list(type: string): Promise<ProfileListItem[]>;
  load(item: ProfileListItem): Promise<Profile>;
  save(profile: Profile): Promise<Profile>;
  remove(item: ProfileListItem): Promise<void>;
  create(input: {
    type: string; name: string; role: string; characterKind: CharacterKind;
  }): Promise<Profile>;
  /** Importing a .md file from elsewhere. Not ported to the codex yet
   *  (recovery task R2.7), so the screen hides the button rather than offering
   *  one that fails. */
  canImport: boolean;
  importFile(sourcePath: string): Promise<Profile>;
}

/** What the backend says about a project: which folder its entries live in, and
 *  how many are in the OTHER one. The second number is what lets the screen say
 *  "twelve entries live in the Weave and are not shown here" instead of quietly
 *  showing fewer rows than the writer has. */
export interface HomeReport {
  home: EntriesHome;
  elsewhere: number;
}

export async function fetchEntriesHome(rootPath: string): Promise<HomeReport> {
  const params = new URLSearchParams({ project_path: rootPath });
  const res = await fetch(`${API_BASE}/api/codex/health?${params}`);
  if (!res.ok) {
    // A health check that cannot answer must not decide. profiles/ is the older
    // home and the safe assumption: it is where an unconverted project's work
    // is, and reading it can lose nothing.
    return { home: "profiles", elsewhere: 0 };
  }
  const body = await res.json();
  return {
    home: body?.entries_home === "codex" ? "codex" : "profiles",
    elsewhere: Number(body?.elsewhere ?? 0) || 0,
  };
}

async function ok(res: Response, fallback: string): Promise<unknown> {
  if (res.ok) return res.json();
  let message = fallback;
  try {
    const body = await res.json();
    const detail = body?.detail;
    // Two error shapes: the plain string FastAPI raises, and the Weave's
    // {code, message, detail}. Unwrapped here so callers show one sentence.
    if (typeof detail === "string") message = detail;
    else if (detail?.message) message = detail.message;
  } catch {
    // Keep the fallback rather than letting a parse failure hide the status.
  }
  throw new Error(message);
}


// ── profiles/ -- what this screen has always done ────────────────────────────

export function profilesSource(rootPath: string): ProfileSource {
  return {
    home: "profiles",
    canImport: true,

    async list(type) {
      const params = new URLSearchParams({ folder_path: rootPath, type });
      const rows = await ok(
        await fetch(`${API_BASE}/api/profiles/list?${params}`),
        "Failed to load profiles.") as ProfileListItem[];
      return rows;
    },

    async load(item) {
      const params = new URLSearchParams({
        folder_path: rootPath, type: item.type, filename: item.filename,
      });
      const body = await ok(
        await fetch(`${API_BASE}/api/profiles/profile?${params}`),
        "Failed to load profile.") as Profile & { profile_id?: string };
      // One name for the id across the screen, whichever folder it came from.
      return { ...body, entity_id: body.entity_id || body.profile_id || "" };
    },

    async save(profile) {
      const body = await ok(await fetch(`${API_BASE}/api/profiles/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: rootPath,
          filename: profile.filename,
          profile: { ...profile, profile_id: profile.entity_id },
        }),
      }), "Save failed.") as Profile & { profile_id?: string };
      return { ...body, entity_id: body.entity_id || body.profile_id || "" };
    },

    async remove(item) {
      const params = new URLSearchParams({
        folder_path: rootPath, type: item.type, filename: item.filename,
      });
      await ok(await fetch(`${API_BASE}/api/profiles/profile?${params}`,
                          { method: "DELETE" }),
               "Failed to delete profile.");
    },

    async create({ type, name, role, characterKind }) {
      const body = await ok(await fetch(`${API_BASE}/api/profiles/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: rootPath, type, name, role,
          character_kind: type === "character" ? characterKind : "main",
        }),
      }), "Failed to create profile.") as Profile & { profile_id?: string };
      return { ...body, entity_id: body.entity_id || body.profile_id || "" };
    },

    async importFile(sourcePath) {
      const body = await ok(await fetch(`${API_BASE}/api/profiles/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: rootPath, source_path: sourcePath }),
      }), "Import failed.") as Profile & { profile_id?: string };
      return { ...body, entity_id: body.entity_id || body.profile_id || "" };
    },
  };
}


// ── codex/ -- the same screen, over the Weave's own entries ──────────────────

/** A Thread's sections, as a profile's sections -- plus a React key per trait
 *  block, which the Weave's format deliberately does not store (an id in the
 *  writer's Markdown would be noise, and render_thread drops it on the way
 *  back). */
function sectionsFromThread(thread: WeaveThread, type: string): Profile["sections"] {
  const stored = (thread.sections ?? {}) as Record<string, {
    heading?: string; content?: string; ai_summary?: string;
    trait_blocks?: Record<string, unknown>[];
  }>;

  const out: Profile["sections"] = {};
  // Every section the form will render must exist, even if the file has none of
  // it -- an absent section renders as an uneditable gap.
  const wanted = (SECTION_CONFIGS[type as keyof typeof SECTION_CONFIGS] ?? [])
    .map(s => s.key);
  for (const key of [...wanted, ...Object.keys(stored)]) {
    if (out[key]) continue;
    const section = stored[key] ?? {};
    out[key] = {
      content: section.content ?? "",
      ai_summary: section.ai_summary ?? "",
      trait_blocks: (section.trait_blocks ?? []).map(block => ({
        id: uuidv4(),
        trait: String(block.trait ?? ""),
        description: String(block.description ?? ""),
        importance: (block.importance ?? "background") as Profile["sections"][string]["trait_blocks"][number]["importance"],
        ...(block.ai_scope
          ? { ai_scope: block.ai_scope as "always" | "on-request" | "never" }
          : {}),
      })),
    };
  }
  return out;
}

function profileFromThread(thread: WeaveThread): Profile {
  const type = String(thread.type ?? "");
  return {
    entity_id: String(thread.entity_id ?? ""),
    type: type as Profile["type"],
    name: String(thread.name ?? ""),
    role: String(thread.role ?? ""),
    status: String(thread.status ?? "active"),
    tags: (thread.tags ?? []) as string[],
    filename: String(thread.filename ?? ""),
    sections: sectionsFromThread(thread, type),
    full_ai_summary: String(thread.full_ai_summary ?? ""),
    created_at: String(thread.created_at ?? ""),
    updated_at: String(thread.updated_at ?? ""),
    character_kind: (thread.character_kind === "side" ? "side" : "main"),
    // The revision this was opened at, so a save can be refused rather than
    // silently overwriting somebody else's -- or the writer's own work in
    // another window.
    revision: thread.revision ? String(thread.revision) : undefined,
    // EVERYTHING ELSE THE FILE HELD, kept so the save can hand it back. See
    // the note at the top of this file: this is the difference between editing
    // an entry and quietly deleting its connections.
    weave: thread,
  };
}

function threadFromProfile(profile: Profile): WeaveThread {
  const previous = (profile.weave ?? {}) as WeaveThread;
  const previousSections = (previous.sections ?? {}) as Record<string, {
    heading?: string;
  }>;
  const headings = new Map(
    (SECTION_CONFIGS[profile.type as keyof typeof SECTION_CONFIGS] ?? [])
      .map(s => [s.key, s.heading] as const));

  const sections: Record<string, unknown> = {};
  for (const [key, section] of Object.entries(profile.sections)) {
    sections[key] = {
      // The heading the file already used wins: it is what the writer sees
      // when they open the Markdown, and the section's id is derived from it,
      // so replacing it with a different wording would re-file the section.
      heading: previousSections[key]?.heading || headings.get(key)
        || key.replace(/_/g, " "),
      content: section.content ?? "",
      ai_summary: section.ai_summary ?? "",
      trait_blocks: (section.trait_blocks ?? []).map(block => ({
        trait: block.trait,
        description: block.description,
        importance: block.importance,
        // Carried, not edited here. Conversion turns a `hidden` trait into
        // `ai_scope: on-request`, which is the mechanism that actually keeps it
        // out of a prompt -- dropping the field would undo that silently on the
        // first save of every converted character.
        ...(block.ai_scope ? { ai_scope: block.ai_scope } : {}),
      })),
    };
  }

  return {
    ...previous,
    type: profile.type,
    entity_id: profile.entity_id,
    name: profile.name,
    role: profile.role,
    status: profile.status,
    tags: profile.tags,
    filename: profile.filename,
    character_kind: profile.character_kind === "side" ? "side" : "",
    full_ai_summary: profile.full_ai_summary,
    sections,
  };
}

export function codexSource(rootPath: string): ProfileSource {
  const get = async (entityId: string) => {
    const params = new URLSearchParams({
      project_path: rootPath, entity_id: entityId,
    });
    return await ok(await fetch(`${API_BASE}/api/codex/entity?${params}`),
                    "Failed to load entry.") as WeaveThread;
  };

  return {
    home: "codex",
    // R2.7. Offering a button that cannot work would be worse than not
    // offering it, and pretending it worked would be worse still.
    canImport: false,

    async list(type) {
      const params = new URLSearchParams({ project_path: rootPath, type });
      const body = await ok(
        await fetch(`${API_BASE}/api/codex/list?${params}`),
        "Failed to load entries.") as {
          threads: {
            entity_id: string; type: string; name: string; filename: string;
            status: string; role: string; character_kind: string;
          }[];
        };
      return (body.threads ?? []).map(row => ({
        entity_id: row.entity_id,
        filename: row.filename,
        name: row.name,
        type: row.type as ProfileListItem["type"],
        role: row.role ?? "",
        status: row.status ?? "active",
        // "" means the ordinary case, which is a Main.
        character_kind: (row.character_kind === "side" ? "side" : "main"),
      }));
    },

    async load(item) {
      return profileFromThread(await get(item.entity_id ?? ""));
    },

    async save(profile) {
      await ok(await fetch(`${API_BASE}/api/codex/entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: rootPath,
          thread: threadFromProfile(profile),
          base_revision: profile.revision ?? null,
        }),
      }), "Save failed.");
      // Read back rather than trusting what we sent: the file is the source of
      // truth, the save stamps a date, and the next save needs the revision
      // this one produced or it would be refused as a conflict with itself.
      return profileFromThread(await get(profile.entity_id));
    },

    async remove(item) {
      const params = new URLSearchParams({
        project_path: rootPath, entity_id: item.entity_id ?? "",
        // The Weave forgets it too, so a name still in the prose is asked about
        // again rather than staying invisible for good.
        forget_answers: "true",
      });
      await ok(await fetch(`${API_BASE}/api/codex/entity?${params}`,
                           { method: "DELETE" }),
               "Failed to delete entry.");
    },

    async create({ type, name, role, characterKind }) {
      const body = await ok(await fetch(`${API_BASE}/api/codex/thread/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: rootPath, type, name, role,
          character_kind: type === "character" ? characterKind : "",
        }),
      }), "Failed to create entry.") as { thread: WeaveThread };
      // Fetched again so the new entry carries a revision, like any other.
      return profileFromThread(await get(String(body.thread?.entity_id ?? "")));
    },

    async importFile() {
      throw new Error(
        "Importing a profile file into the Weave is not built yet. Open the " +
        "file in the editor and copy what you need, or import it before " +
        "bringing the project in.");
    },
  };
}

export function sourceFor(rootPath: string, home: EntriesHome): ProfileSource {
  return home === "codex" ? codexSource(rootPath) : profilesSource(rootPath);
}
