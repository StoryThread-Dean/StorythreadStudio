// features/codex/lexicon.test.ts
// ===============================
// The Weave introduces a vocabulary -- Threads, Ties, Runs, Snags, Loose
// threads. Invented words earn their keep only if the app teaches them, and
// it can only teach them consistently if one file says what each one means.
//
// This is the fence around that file. A term that can appear on screen with
// no explanation behind it fails the build, because the alternative is a
// writer meeting the word "Snag" in a heading with nothing to click.

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TYPES,
  TYPE_GROUPS,
  kindChoices,
  CONCEPTS,
  GROUP_GUIDES,
  STOP_KINDS,
  TONE_CLASSES,
  guidePlainText,
  iconByName,
  lex,
  threadTypeEntry,
} from "./lexicon";

const ALL = [...Object.values(CONCEPTS), ...Object.values(STOP_KINDS)];


describe("every term explains itself", () => {
  it("has a name, an icon and a colour", () => {
    for (const term of ALL) {
      expect(term.term.trim()).not.toBe("");
      expect(term.code.trim()).not.toBe("");
      expect(term.Icon).toBeTruthy();
      expect(TONE_CLASSES[term.tone]).toBeTruthy();
    }
  });

  it("says what it is in one line, and what it DOES for the writer", () => {
    for (const term of ALL) {
      expect(term.short.length).toBeGreaterThan(10);
      expect(term.does.length).toBeGreaterThan(10);
    }
  });

  it("says more behind 'What's this?' than the one line already showed", () => {
    // A disclosure that repeats the tooltip is a disclosure nobody opens twice.
    for (const term of ALL) {
      expect(term.whatsThis.length).toBeGreaterThan(term.short.length * 2);
    }
  });

  it("writes in plain sentences, not labels", () => {
    for (const term of ALL) {
      expect(term.short.trim().endsWith(".")).toBe(true);
      expect(term.does.trim().endsWith(".")).toBe(true);
    }
  });
});


describe("the house punctuation rule", () => {
  it("uses no em or en dashes anywhere", () => {
    // The locked product rule: -- is the approved substitute. It applies to
    // canned copy as much as to model output.
    for (const term of ALL) {
      const text = `${term.term} ${term.short} ${term.does} ${term.whatsThis}`;
      expect(text).not.toMatch(/[—–]/);
    }
  });
});


describe("the guide behind each group's What's this?", () => {
  const GROUPS = ["notes", "profiles", "other"];
  const flat = (group: string) => guidePlainText(GROUP_GUIDES[group]);

  it("has one for all three groups", () => {
    for (const group of GROUPS) {
      expect(GROUP_GUIDES[group]?.length, group).toBeGreaterThan(4);
    }
  });

  it("opens with what the Weave is, before the detail", () => {
    for (const group of GROUPS) {
      expect(GROUP_GUIDES[group][0].term, group).toBe("The Weave");
    }
  });

  it("names the group on its own line, second", () => {
    expect(GROUP_GUIDES.notes[1].term).toBe("NOTES");
    expect(GROUP_GUIDES.profiles[1].term).toBe("PROFILES");
    expect(GROUP_GUIDES.other[1].term).toBe("OTHER");
  });

  it("gives each kind its own line rather than burying it in a sentence", () => {
    // The list is what a writer is actually scanning for. In a paragraph it
    // is unfindable.
    const kinds = GROUP_GUIDES.profiles.filter(l => l.indent).map(l => l.term);
    expect(kinds).toEqual([
      "Factions", "Religions", "Governments", "Deities", "Creatures",
      "Cultures", "Relationships",
    ]);
  });

  it("leads every kind line with the term, so the eye can run down them", () => {
    for (const group of GROUPS) {
      for (const line of GROUP_GUIDES[group].filter(l => l.indent)) {
        expect(line.term?.trim(), `${group}: ${line.text}`).toBeTruthy();
      }
    }
  });

  it("names what actually lives in each group", () => {
    expect(flat("notes")).toMatch(/Outline/);
    expect(flat("notes")).toMatch(/Style Guide/);
    expect(flat("profiles")).toMatch(/Governments/);
    expect(flat("other")).toMatch(/Languages/);
  });

  it("explains the Custom option too", () => {
    for (const group of GROUPS) {
      expect(GROUP_GUIDES[group].some(l => l.term === "Something else..."), group)
        .toBe(true);
    }
  });

  it("ends by saying what Weaving will do with it", () => {
    // The part it would be easiest to leave out, and the one that makes
    // filling any of this in worth doing. A form is a chore until you know
    // what the app will DO with it.
    for (const group of GROUPS) {
      const last = GROUP_GUIDES[group][GROUP_GUIDES[group].length - 1];
      expect(last.text, group).toMatch(/WEAVING/);
    }
  });

  it("keeps the weaving metaphor rather than dropping into jargon", () => {
    const all = GROUPS.map(flat).join(" ");
    expect(all).toMatch(/thread/i);
    expect(all).toMatch(/stitch/i);
  });

  it("is long enough to be worth opening, and not a wall", () => {
    for (const group of GROUPS) {
      expect(flat(group).length, group).toBeGreaterThan(400);
      expect(flat(group).length, group).toBeLessThan(2600);
    }
  });

  it("keeps individual lines short enough to scan", () => {
    // A "line" that runs to a paragraph is the wall this structure exists
    // to break up.
    for (const group of GROUPS) {
      for (const line of GROUP_GUIDES[group]) {
        expect(line.text.length, `${group}: ${line.text.slice(0, 40)}`)
          .toBeLessThan(420);
      }
    }
  });

  it("obeys the house punctuation rule", () => {
    for (const group of GROUPS) {
      expect(flat(group), group).not.toMatch(/[—–]/);
    }
  });

  it("closes every emphasis marker it opens", () => {
    // An odd asterisk would render as a literal one mid-sentence.
    for (const group of GROUPS) {
      for (const line of GROUP_GUIDES[group]) {
        expect((line.text.match(/\*/g) ?? []).length % 2, line.text).toBe(0);
      }
    }
  });
});


describe("the words Weaving will use", () => {
  it("has an entry for every kind the scan can actually send", () => {
    // KEYED BY THE WIRE CODE. The two sides used to use different words for
    // the same thing, which reads as harmless right up until a stop arrives
    // with a kind nothing here has an entry for and renders as a blank row.
    // ALL TEN of scan.py's STOP_KINDS -- this list used to stop at six, so
    // three real producers (untied, unwoven, pinned) had no contract at all
    // and the comment claiming "every kind" was a lie the suite kept green.
    // Tangle joined them in R8.2: `group_tangles` had been written, tested and
    // called by nothing, so every Snag was asked separately.
    const fromTheScan = [
      "unspun", "frayed", "unplaced", "loose_thread", "untied",
      "snag", "tangle", "early_mention", "unwoven", "pinned",
    ];
    for (const kind of fromTheScan) {
      expect(STOP_KINDS[kind], `no entry for ${kind}`).toBeTruthy();
    }
  });

  it("gives each of them the writer-facing name, not the code", () => {
    expect(STOP_KINDS["loose_thread"].term).toBe("Loose thread");
    expect(STOP_KINDS["snag"].term).toBe("Snag");
    expect(STOP_KINDS["unspun"].term).toBe("Unspun");
  });
});


describe("kinds of Thread", () => {
  it("describes every kind the app ships with", () => {
    expect(new Set(BUILT_IN_TYPES)).toEqual(new Set([
      "character", "relationship", "location", "lore", "faction", "religion",
      "government", "deity", "creature", "culture",
      "object", "concept", "event", "language",
    ]));
    for (const type of BUILT_IN_TYPES) {
      const entry = threadTypeEntry(type);
      expect(entry.Icon).toBeTruthy();
      expect(entry.short.trim()).not.toBe("");
    }
  });

  it("takes its icon from the registry rather than a second list here", () => {
    // This file used to keep its own list of types, which promptly fell
    // behind the backend: four kinds were added there and rendered with the
    // fallback icon, and the contract test missed it because it checked this
    // file against ITSELF. Icon NAMES now come from the registry.
    const fromRegistry = threadTypeEntry("government", "Governments", "Landmark");
    const withoutRegistry = threadTypeEntry("government", "Governments");
    expect(fromRegistry.Icon).toBe(withoutRegistry.Icon);
    expect(fromRegistry.Icon).not.toBe(threadTypeEntry("x", "X", "CircleDashed").Icon);
  });

  it("gives a writer's own kind an icon and a name too", () => {
    // Rendering a blank because we have never heard of it would punish them
    // for using a feature we built.
    const entry = threadTypeEntry("spaceship", "Spaceships", "Package");
    expect(entry.term).toBe("Spaceships");
    expect(entry.Icon).toBeTruthy();
    expect(entry.whatsThis.length).toBeGreaterThan(20);
  });

  it("degrades to a neutral icon for a name nobody has imported", () => {
    // A registry naming an icon this build does not bundle must not render
    // a blank -- the kind still has to be clickable.
    expect(iconByName("NoSuchIcon")).toBeTruthy();
    expect(iconByName(undefined)).toBeTruthy();
  });

  it("names sections as containers, because they hold many", () => {
    // "Characters", not "Character" -- a writer should see at a glance that
    // a section holds more than one.
    expect(threadTypeEntry("character", "Characters").term).toBe("Characters");
  });

  it("reads a derived term as a name, not as an id", () => {
    // "star_system" -> "Star System". A type id shown to a person should read
    // like a name: this term ends up in dropdowns, headings and sentences, and
    // lower-casing it there looked like a bug rather than a fallback.
    expect(threadTypeEntry("star_system").term).toBe("Star System");
  });

  it("leaves a SUPPLIED label exactly as the writer wrote it", () => {
    // Their wording, not ours to adjust.
    expect(threadTypeEntry("star_system", "star systems (minor)").term)
      .toBe("star systems (minor)");
  });
});


describe("looking a term up", () => {
  it("finds concepts and stop kinds in one namespace", () => {
    // The UI does not care which list a word came from.
    expect(lex("codex")?.term).toBe("the Weave");
    expect(lex("loose_thread")?.term).toBe("Loose thread");
  });

  it("returns nothing for a word it does not know", () => {
    expect(lex("nonsense")).toBeUndefined();
  });
});

describe("which group each kind belongs to", () => {
  // Mirrors the registry's own `group` field, duplicated only so a picker can
  // be grouped without fetching the registry. A Python test reads the backend's
  // list and fails if the two disagree -- see test_codex_icon_keywords.py.

  it("places every shipped kind", () => {
    for (const id of BUILT_IN_TYPES) {
      expect(TYPE_GROUPS[id], id).toBeTruthy();
    }
  });

  it("offers them grouped, in the sidebar's order", () => {
    const groups = kindChoices();
    expect(groups.map(g => g.group)).toEqual(["Profiles", "Other"]);
  });

  it("puts every kind in exactly one group", () => {
    const listed = kindChoices().flatMap(g => g.kinds.map(k => k.id));
    expect(new Set(listed)).toEqual(new Set(BUILT_IN_TYPES));
    expect(listed).toHaveLength(BUILT_IN_TYPES.length);
  });

  it("names them in the app's own words", () => {
    const profiles = kindChoices()[0].kinds.map(k => k.term);
    expect(profiles).toContain("Faction");
    expect(profiles).toContain("Deity");
  });
});
