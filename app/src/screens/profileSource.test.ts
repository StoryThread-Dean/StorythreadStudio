// profileSource.test.ts -- the Profile Builder over two different folders
// ========================================================================
// The writer's report, in their words: "Lord Benjamin Croft, Sir Thomas
// Henschel, Jack, Liam, Oliver, High Priestess and Pathicus do not have
// visible/editable profiles." Those seven existed on disk, were indexed, were
// connected on the Weave map, and had no editable page in the app -- because
// the Profile Builder only ever read profiles/ and their project had been
// brought into codex/.
//
// These tests cover the two things that layer has to get right:
//
//   1. It reads and writes the folder the project actually uses.
//   2. It NEVER loses what it does not edit. A Thread holds connections,
//      aliases and the Run; this screen shows none of them. A save that sent
//      back only what the form knows about would delete a character's
//      connections the first time the writer fixed a typo in their overview,
//      and nothing on screen would say a word about it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchEntriesHome, sourceFor, codexSource, profilesSource,
} from "./profileSource";
import type { Profile } from "../types/profile";

// A Thread with everything this screen does not edit: another name for her, the
// story's own word for her, a connection with a reason, and one fact.
const THREAD = {
  type: "character",
  entity_id: "e-lexa",
  name: "Alexandra Langford",
  display_name: "Lexa",
  role: "protagonist",
  status: "active",
  aliases: ["Lexa", "Miss Langford"],
  tags: ["noble"],
  fields: { born: 1247 },
  character_kind: "",
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-02-01T00:00:00+00:00",
  revision: "rev-1",
  ties: [
    { rel: "mentored_by", target: "e-garrick",
      reason: "He taught her to pick a lock before she could read." },
  ],
  run: [
    { id: "f-1", at: "c-a/s-1", axis: "belief.father",
      value: "Believes her father died in the raid." },
  ],
  full_ai_summary: "",
  sections: {
    overview: { heading: "Overview", content: "A tall woman.",
                trait_blocks: [], ai_summary: "" },
    physical_traits: {
      heading: "Physical Traits", content: "",
      trait_blocks: [
        { trait: "scarred hands", description: "From the fire.",
          importance: "core" },
        { trait: "keeps a locket", description: "Her mother's.",
          importance: "hidden", ai_scope: "on-request" },
      ],
      ai_summary: "",
    },
  },
};

/**
 * The sections a character has, as the world reports them.
 *
 * The source layer takes this as a lookup now rather than importing a table: the
 * app reads a project's kinds from its own types.json, which is what gives the
 * six kinds that had no editor a real one.
 */
const SECTIONS: Record<string, { key: string; heading: string; hasTraitBlocks: boolean }[]> = {
  character: [
    { key: "overview", heading: "Overview", hasTraitBlocks: false },
    { key: "physical_traits", heading: "Physical Traits", hasTraitBlocks: true },
    { key: "voice_notes", heading: "Voice Notes", hasTraitBlocks: true },
  ],
  location: [{ key: "overview", heading: "Overview", hasTraitBlocks: false }],
};
const sectionsFor = (type: string) => SECTIONS[type] ?? [];

let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    if (body instanceof Response) return body;
    return { ok: true, json: async () => body } as Response;
  }));
}

function sentBody(match: string): Record<string, unknown> {
  const call = calls.find(c => c.url.includes(match) && c.init?.body);
  if (!call) throw new Error(`nothing was sent to ${match}`);
  return JSON.parse(String(call.init!.body));
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); });


describe("which folder this project uses", () => {
  it("takes the answer from the backend rather than deciding for itself", async () => {
    // One rule, in one place. The sidebar counts the same folder, which is what
    // stops "13 in the tree, 12 on the map" from coming back.
    mockFetch(() => ({ entries_home: "codex", elsewhere: 0 }));
    expect(await fetchEntriesHome("/p"))
      .toEqual({ home: "codex", elsewhere: 0, migrationState: "none" });
    expect(calls[0].url).toContain("/api/codex/health");
  });

  it("reports how much is in the other folder, so a screen can say so", async () => {
    mockFetch(() => ({ entries_home: "profiles", elsewhere: 3 }));
    expect(await fetchEntriesHome("/p"))
      .toEqual({ home: "profiles", elsewhere: 3, migrationState: "none" });
  });

  it("falls back to profiles when the backend cannot answer", async () => {
    // A health check that cannot answer must not decide. profiles/ is the older
    // home: reading it can lose nothing, where guessing codex/ on an
    // unconverted project would show an empty screen.
    mockFetch(() => new Response("nope", { status: 500 }));
    expect((await fetchEntriesHome("/p")).home).toBe("profiles");
  });

  // ── A HALF-FINISHED CONVERSION IS NOT AN UNCONVERTED PROJECT ─────────────
  //
  // Issue #23, found by walking the migration smoke test rather than by any
  // test: a writer whose conversion died four files in was told on the Profile
  // Builder that the project "has not been brought into the Weave yet". It had.
  // Both suites were green, because both screens are individually correct --
  // the Weave offers resume and restore properly. Nothing stood on one screen
  // and read another.
  //
  // The state was in the /health response the whole time and this function
  // dropped it, so the screen had no way to tell the two causes apart.

  it("carries whether a conversion is half-finished", async () => {
    mockFetch(() => ({
      entries_home: "profiles", elsewhere: 4, migration_state: "incomplete",
    }));
    expect((await fetchEntriesHome("/p")).migrationState).toBe("incomplete");
  });

  it("tells a converted project apart from one that never started", async () => {
    mockFetch(() => ({
      entries_home: "codex", elsewhere: 0, migration_state: "done",
    }));
    expect((await fetchEntriesHome("/p")).migrationState).toBe("done");
  });

  it("assumes nothing is in flight when the backend says nothing", async () => {
    // An older backend, or a field that goes missing. The safe reading is that
    // no conversion is half-done, because claiming one would send the writer
    // looking for a recovery choice that is not there.
    mockFetch(() => ({ entries_home: "profiles", elsewhere: 2 }));
    expect((await fetchEntriesHome("/p")).migrationState).toBe("none");
  });

  it("assumes nothing is in flight when the backend cannot answer at all", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    expect((await fetchEntriesHome("/p")).migrationState).toBe("none");
  });

  it("sends each home to its own endpoints", async () => {
    mockFetch(url => (url.includes("/api/codex/list")
      ? { threads: [] } : []));
    await sourceFor("/p", "codex", sectionsFor).list("character");
    await sourceFor("/p", "profiles", sectionsFor).list("character");
    expect(calls[0].url).toContain("/api/codex/list");
    expect(calls[1].url).toContain("/api/profiles/list");
  });
});


describe("the list", () => {
  it("says what a character is to the story and which page they get", async () => {
    // Both were in every file and in no index row until recovery task R2.3a, so
    // a list built on it drew every character as an untitled Main.
    mockFetch(() => ({ threads: [
      { entity_id: "e-1", type: "character", name: "Mira Kell",
        filename: "mira.md", status: "active", role: "protagonist",
        character_kind: "side" },
      { entity_id: "e-2", type: "character", name: "Jack",
        filename: "jack.md", status: "active", role: "", character_kind: "" },
    ] }));

    const rows = await codexSource("/p", sectionsFor).list("character");
    expect(rows[0]).toMatchObject({
      entity_id: "e-1", name: "Mira Kell", role: "protagonist",
      character_kind: "side",
    });
    // No template on file means the ordinary case, which is a Main -- the list
    // groups by this, so undefined would put Jack in neither group.
    expect(rows[1].character_kind).toBe("main");
  });
});


describe("opening an entry", () => {
  it("fills in every section the form will show, even ones the file lacks", async () => {
    // An absent section renders as a gap the writer cannot type into. The file
    // here has two of the eight a character page shows.
    mockFetch(() => THREAD);
    const profile = await codexSource("/p", sectionsFor).load(
      { entity_id: "e-lexa", filename: "lexa.md", name: "Alexandra Langford",
        type: "character", role: "protagonist", status: "active" });

    expect(Object.keys(profile.sections)).toContain("voice_notes");
    expect(profile.sections.voice_notes.content).toBe("");
    expect(profile.sections.overview.content).toBe("A tall woman.");
  });

  it("gives every trait block a key without putting one in the writer's file", async () => {
    mockFetch(() => THREAD);
    const profile = await codexSource("/p", sectionsFor).load(
      { entity_id: "e-lexa", filename: "lexa.md", name: "x",
        type: "character", role: "", status: "active" });

    const blocks = profile.sections.physical_traits.trait_blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBeTruthy();
    expect(blocks[0].id).not.toEqual(blocks[1].id);
    expect(blocks[0].trait).toBe("scarred hands");
  });

  it("carries the revision it opened at", async () => {
    mockFetch(() => THREAD);
    const profile = await codexSource("/p", sectionsFor).load(
      { entity_id: "e-lexa", filename: "lexa.md", name: "x",
        type: "character", role: "", status: "active" });
    expect(profile.revision).toBe("rev-1");
  });
});


describe("saving an entry", () => {
  async function saveAfterEditing(edit: (p: Profile) => Profile) {
    mockFetch(url => (url.includes("/api/codex/entity?") ? THREAD
      : { saved: true, revision: "rev-2" }));
    const source = codexSource("/p", sectionsFor);
    const profile = await source.load(
      { entity_id: "e-lexa", filename: "lexa.md", name: "x",
        type: "character", role: "", status: "active" });
    await source.save(edit(profile));
    return sentBody("/api/codex/entity").thread as Record<string, unknown>;
  }

  it("hands back every connection and fact it was given", async () => {
    // THE ONE THAT MATTERS. The writer fixes a typo in an overview; the entry's
    // connections and the facts that change across the book must still be there
    // afterwards. Nothing on screen would have reported losing them.
    const thread = await saveAfterEditing(profile => ({
      ...profile,
      sections: {
        ...profile.sections,
        overview: { ...profile.sections.overview, content: "A tall woman, quiet." },
      },
    }));

    expect(thread.ties).toEqual(THREAD.ties);
    expect(thread.run).toEqual(THREAD.run);
    expect(thread.aliases).toEqual(THREAD.aliases);
    expect(thread.display_name).toBe("Lexa");
    expect(thread.fields).toEqual({ born: 1247 });
    expect((thread.sections as Record<string, { content: string }>)
      .overview.content).toBe("A tall woman, quiet.");
  });

  it("keeps a trait's ai_scope, which is what actually withholds it", async () => {
    // Conversion rewrites a `hidden` trait as ai_scope: on-request, and that is
    // the mechanism behind "drives subtext, never named directly". This screen
    // does not offer it as a control, so dropping it here would silently undo
    // the conversion on the first save of every converted character.
    const thread = await saveAfterEditing(p => p);
    const blocks = (thread.sections as Record<string, {
      trait_blocks: Record<string, unknown>[] }>).physical_traits.trait_blocks;
    expect(blocks[1].ai_scope).toBe("on-request");
    // And no React key leaks into the writer's Markdown.
    expect(blocks[0]).not.toHaveProperty("id");
  });

  it("keeps the heading the file already used", async () => {
    // A section's id is derived from its heading, so writing a different wording
    // would re-file the section and the content would read back as missing.
    const thread = await saveAfterEditing(p => p);
    const sections = thread.sections as Record<string, { heading: string }>;
    expect(sections.overview.heading).toBe("Overview");
    // A section the file never had gets the heading the form showed.
    expect(sections.voice_notes.heading).toBe("Voice Notes");
  });

  it("sends the revision it opened at so a stale save is refused", async () => {
    await saveAfterEditing(p => p);
    expect(sentBody("/api/codex/entity").base_revision).toBe("rev-1");
  });

  it("explains a refused save in the words the backend used", async () => {
    // The writer's text stays in the buffer -- the screen shows the message and
    // changes nothing, which is the whole point of refusing over overwriting.
    mockFetch(url => (url.includes("/api/codex/entity?")
      ? THREAD
      : new Response(JSON.stringify({ detail: {
          code: "version_conflict",
          message: "This entry changed on disk since you opened it.",
        } }), { status: 409 })));

    const source = codexSource("/p", sectionsFor);
    const profile = await source.load(
      { entity_id: "e-lexa", filename: "lexa.md", name: "x",
        type: "character", role: "", status: "active" });

    await expect(source.save(profile)).rejects.toThrow(/changed on disk/);
  });

  it("reads the entry back, because the file is what is true", async () => {
    await saveAfterEditing(p => p);
    // Two reads: the one that opened it and the one after saving. The second is
    // what gives the next save a current revision.
    expect(calls.filter(c => c.url.includes("/api/codex/entity?"))).toHaveLength(2);
  });
});


describe("creating and removing", () => {
  it("creates with the role and template the form asked for", async () => {
    mockFetch(url => (url.includes("/api/codex/entity?")
      ? { ...THREAD, entity_id: "e-new" }
      : { thread: { entity_id: "e-new" } }));

    await codexSource("/p", sectionsFor).create({
      type: "character", name: "Mira Kell", role: "protagonist",
      characterKind: "side",
    });
    expect(sentBody("/thread/new")).toMatchObject({
      type: "character", name: "Mira Kell", role: "protagonist",
      character_kind: "side",
    });
  });

  it("does not send a template for something that is not a character", async () => {
    mockFetch(url => (url.includes("/api/codex/entity?")
      ? { ...THREAD, type: "location" } : { thread: { entity_id: "e-new" } }));
    await codexSource("/p", sectionsFor).create({
      type: "location", name: "Ravensmoor", role: "", characterKind: "main",
    });
    expect(sentBody("/thread/new").character_kind).toBe("");
  });

  it("lets the Weave forget a deleted entry, so its name can be asked about again", async () => {
    mockFetch(() => ({ deleted: "e-lexa", forgotten: 2 }));
    await codexSource("/p", sectionsFor).remove(
      { entity_id: "e-lexa", filename: "lexa.md", name: "x",
        type: "character", role: "", status: "active" });
    expect(calls[0].url).toContain("forget_answers=true");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("brings an entry in from another book", async () => {
    mockFetch(() => ({
      thread: { ...THREAD, entity_id: "e-new", type: "character" },
      warnings: [],
    }));
    const profile = await codexSource("/p", sectionsFor).importFile("C:/other/x.md");
    expect(sentBody("/api/codex/import")).toMatchObject({
      source_path: "C:/other/x.md",
    });
    expect(profile.entity_id).toBe("e-new");
  });

  it("carries what the import left behind, so the screen can say it", async () => {
    // An entry from another book brings ids that mean nothing here -- its
    // connections, the chapters its facts happen in, whose beliefs they were.
    // Dropped silently they are a loss the writer finds weeks later.
    mockFetch(() => ({
      thread: { ...THREAD, entity_id: "e-new" },
      warnings: ["2 connections were not brought across: they point at entries "
                 + "in the other book."],
    }));
    const profile = await codexSource("/p", sectionsFor).importFile("C:/other/x.md");
    expect(profile.importWarnings).toHaveLength(1);
    expect(profile.importWarnings?.[0]).toContain("connections");
  });
});


describe("the profiles folder, unchanged", () => {
  it("still addresses a profile by folder and filename", async () => {
    mockFetch(() => ({ profile_id: "p-1", type: "character", name: "Elara",
                       filename: "elara.md", sections: {}, role: "",
                       status: "active", tags: [], full_ai_summary: "",
                       created_at: "", updated_at: "" }));
    const profile = await profilesSource("/p").load(
      { filename: "elara.md", name: "Elara", type: "character", role: "",
        status: "active" });
    expect(calls[0].url).toContain("filename=elara.md");
    // One name for the id across the screen, whichever folder it came from.
    expect(profile.entity_id).toBe("p-1");
  });

  it("sends the id back under the name that folder uses", async () => {
    mockFetch(() => ({ profile_id: "p-1", type: "character", name: "Elara",
                       filename: "elara.md", sections: {}, role: "",
                       status: "active", tags: [], full_ai_summary: "",
                       created_at: "", updated_at: "" }));
    await profilesSource("/p").save({
      entity_id: "p-1", type: "character", name: "Elara", role: "",
      status: "active", tags: [], filename: "elara.md", sections: {},
      full_ai_summary: "", created_at: "", updated_at: "",
    });
    expect((sentBody("/api/profiles/save").profile as Record<string, unknown>)
      .profile_id).toBe("p-1");
  });

  it("can still import, which is why the button is per home", async () => {
    expect(profilesSource("/p").canImport).toBe(true);
  });
});


// ── AND THE SCREEN THAT READS IT ─────────────────────────────────────────────
//
// The plumbing above is only half of issue #23. The bug a writer actually met
// was a SENTENCE, and the sentence is in ProfileBuilder.tsx.
//
// Read as source rather than rendered, the same choice Explain.test.tsx makes
// and for the same reason: ProfileBuilder is a large screen whose mount needs
// its whole API mocked, and a test that expensive gets skipped rather than
// extended. What matters here is narrow and a source read can prove it -- that
// the explanation BRANCHES on the migration state, and that both branches say
// the right thing. A screen that carries only one of these sentences is the
// bug, whichever one it kept.

describe("what a half-converted project is told", () => {
  const SOURCES = import.meta.glob("./*.tsx", {
    query: "?raw", import: "default", eager: true,
  }) as Record<string, string>;

  const screen = (() => {
    const key = Object.keys(SOURCES).find(k => k.endsWith("/ProfileBuilder.tsx"));
    expect(key, "ProfileBuilder.tsx not found").toBeTruthy();
    return SOURCES[key!];
  })();

  it("branches the explanation on the migration state", () => {
    // The fix. Without this the two causes are indistinguishable on screen.
    expect(screen).toMatch(/migrationState === "incomplete"\s*\?/);
  });

  it("tells an interrupted conversion that it was interrupted", () => {
    expect(screen).toMatch(/conversion was started and did not finish/i);
  });

  it("says nothing was lost, and where to go to fix it", () => {
    // Not decoration. This notice is the one a writer meets FIRST, before the
    // Weave screen where resume and restore live, so it has to carry them there
    // rather than leaving the state as a dead end.
    // Whitespace-tolerant: this is JSX prose, so any phrase can be split across
    // a line break by the formatter at any time. Matching the exact spacing
    // would make these tests fail on a reflow rather than on a regression.
    expect(screen).toMatch(/Nothing\s+has\s+been\s+lost/i);
    expect(screen).toMatch(/Open\s+the\s+Weave\s+to\s+carry\s+on/i);
  });

  it("keeps the original wording for a project that really has not converted", () => {
    // The fix must not swap one wrong sentence for another. A writer who made
    // entries in the Weave on an unconverted project still needs the old text.
    expect(screen).toMatch(/has not been brought into the Weave yet, so this/);
  });

  it("still reports the count, which was never the broken part", () => {
    expect(screen).toMatch(/made\s*\n?\s*in the Weave and .* not shown here/);
  });
});


// ── WHERE AN ENTRY APPEARS, THROUGH THE ROUND TRIP ──────────────────────────
//
// `appears_in` is unlike everything else this screen holds: it is written the
// moment the writer presses Record, by POST /place, and is NOT part of the
// page's manual-save buffer.
//
// That creates a hazard the rest of the fields do not have. The profile was
// loaded with the OLD list in its pass-through blob, so an ordinary save
// afterwards would hand that back and silently undo the placement made two
// minutes earlier -- with nothing on screen to show it happened. It is the R2.1
// failure exactly: a save dropping something the form did not display.

describe("where an entry appears", () => {
  const ITEM = { entity_id: "e-lexa", filename: "lexa.md",
                 name: "Alexandra Langford", type: "character",
                 role: "protagonist", status: "active" };

  it("is surfaced on load, not left in the blob", async () => {
    mockFetch(() => ({ ...THREAD, appears_in: ["c-1", "c-3"] }));
    const profile = await codexSource("/p", sectionsFor).load(ITEM);
    expect(profile.appears_in).toEqual(["c-1", "c-3"]);
  });

  it("THE EDITED VALUE BEATS THE STALE BLOB ON SAVE", async () => {
    // The hazard, stated as a test. The blob says one chapter; the writer has
    // since placed it in two, through POST /place, which is not part of this
    // page's save buffer. Saving the profile must not roll that back.
    mockFetch(() => ({ ...THREAD, appears_in: ["c-1"] }));
    const loaded = await codexSource("/p", sectionsFor).load(ITEM);

    calls = [];
    mockFetch(() => ({ ok: true }));
    await codexSource("/p", sectionsFor)
      .save({ ...loaded, appears_in: ["c-1", "c-2"] });
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.thread.appears_in).toEqual(["c-1", "c-2"]);
  });

  it("keeps what the file had when this screen never touched it", async () => {
    // The other direction, and the rule every field here follows: a screen
    // that does not edit something hands back exactly what it was given.
    mockFetch(() => ({ ...THREAD, appears_in: ["c-4"] }));
    const loaded = await codexSource("/p", sectionsFor).load(ITEM);

    calls = [];
    mockFetch(() => ({ ok: true }));
    await codexSource("/p", sectionsFor).save(loaded);
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.thread.appears_in).toEqual(["c-4"]);
  });
});
