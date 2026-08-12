// sectionRegistry.test.ts -- the form is built from the world, not from a table
// =============================================================================
// This replaces sectionKeys.test.ts, which bound a hardcoded frontend table to
// the two Python copies of the same list. Binding them stopped the drift; R2.2b
// deleted the frontend copy instead, so there is nothing left to drift.
//
// What is worth testing now is different: that a form built from the world's own
// `types.json` works for kinds nobody wrote code for. That is the whole payoff.
// The four kinds with hardcoded editors were the four the table knew about, and
// every other kind -- Government, Faction, Deity, Religion, Creature, Culture,
// and anything a writer invents -- rendered an empty page.

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  headingFromKey, labelsFromRegistry, sectionsFromRegistry, tabsFromSections,
} from "./sectionRegistry";
import { QUICK_BUILD_ROWS } from "../components/profiles/QuickBuildPanel";
import { IMPORTANCE_HELP, SECTION_HELP } from "../data/profileHelp";
import type { TypeEntry } from "../features/codex/api";

afterEach(() => vi.restoreAllMocks());

/** A world with a shipped kind, a kind that used to have no editor, and one the
 *  writer invented. */
const WORLD: TypeEntry[] = [
  {
    id: "character", label: "Characters", folder: "characters", icon: "User",
    group: "profiles",
    sections: [
      { id: "overview", heading: "Overview", trait_blocks: false },
      { id: "physical_traits", heading: "Physical Traits", trait_blocks: true },
    ],
  },
  {
    id: "government", label: "Governments", folder: "governments",
    icon: "Landmark", group: "profiles",
    sections: [
      { id: "overview", heading: "Overview", trait_blocks: false },
      { id: "succession", heading: "Succession", trait_blocks: false },
    ],
  },
  {
    id: "bloodline", label: "Bloodlines", folder: "bloodlines",
    icon: "Sparkles", group: "other",
    sections: [{ id: "overview", heading: "Overview", trait_blocks: false }],
  },
];


describe("a form built from the world", () => {
  it("gives a kind that had no editor its real sections", () => {
    // The six kinds the old table did not know about rendered an empty page.
    const sections = sectionsFromRegistry(WORLD);
    expect(sections.government.map(s => s.key)).toEqual(["overview", "succession"]);
    expect(sections.government[1].heading).toBe("Succession");
  });

  it("works for a kind the writer invented this afternoon", () => {
    // No release, no per-kind code. This is what closing the union bought.
    expect(sectionsFromRegistry(WORLD).bloodline).toHaveLength(1);
  });

  it("carries which sections hold traits and which hold prose", () => {
    const sections = sectionsFromRegistry(WORLD);
    expect(sections.character.find(s => s.key === "physical_traits")?.hasTraitBlocks)
      .toBe(true);
    expect(sections.character.find(s => s.key === "overview")?.hasTraitBlocks)
      .toBe(false);
  });

  it("names each kind the way the world names it", () => {
    expect(labelsFromRegistry(WORLD).government).toBe("Governments");
  });

  it("offers as tabs exactly what the sidebar shows under Profiles", () => {
    // THE SIDEBAR'S RULE, read rather than recomputed: a section appears when it
    // holds something or is a default. Listing every Profiles kind instead would
    // put ten tabs on a page whose main problem is already crowding -- six of
    // them for kinds the writer has never used.
    const tree = {
      groups: [
        { id: "notes", label: "Notes", sections: [], available: [] },
        { id: "profiles", label: "Profiles", available: [], sections: [
          { kind: "type" as const, id: "character", label: "Characters",
            icon: "User", group: "profiles", count: 3, default_section: true,
            shipped: true, rename: "label" as const, removal: "hide" as const },
          { kind: "type" as const, id: "government", label: "Governments",
            icon: "Landmark", group: "profiles", count: 1, default_section: false,
            shipped: true, rename: "label" as const, removal: "hide" as const },
        ] },
        { id: "other", label: "Other", sections: [], available: [] },
      ],
      available: [],
      converted: true,
    };
    expect(tabsFromSections(tree)).toEqual(["character", "government"]);
  });

  it("falls back to a readable heading when the world gives none", () => {
    const sections = sectionsFromRegistry([{
      ...WORLD[0],
      sections: [{ id: "voice_notes", heading: "", trait_blocks: false }],
    }]);
    expect(sections.character[0].heading).toBe("Voice Notes");
  });
});


describe("a heading rebuilt from a key", () => {
  it("reads the way a person writes one", () => {
    // Mirrors the small-word rule in types_registry.py. ".title()" alone gives
    // "Hidden And Foreshadowing Traits", which is wrong in both languages.
    expect(headingFromKey("hidden_and_foreshadowing_traits"))
      .toBe("Hidden and Foreshadowing Traits");
    expect(headingFromKey("rule_or_concept")).toBe("Rule or Concept");
    expect(headingFromKey("tone_and_atmosphere")).toBe("Tone and Atmosphere");
  });

  it("never lowercases the first word, even when it is a small one", () => {
    expect(headingFromKey("of_the_king")).toBe("Of the King");
  });
});


// ── The things still keyed by a section id ───────────────────────────────────
//
// Two features address sections by key rather than by registry, and both are
// character-specific: the (?) help and Quick Build's rows. They cannot come from
// the registry -- the writing advice for Physical Traits is content, not
// configuration -- so what they CAN do is stay in step with the keys the shipped
// character page uses.

const SHIPPED_CHARACTER_KEYS = [
  "overview", "physical_traits", "personality_traits", "motivations",
  "voice_notes", "hidden_and_foreshadowing_traits", "relationships_overview",
  "notes",
];

describe("help that is keyed by section", () => {
  it("Quick Build appends into sections the character page has", () => {
    // A row pointing at a key nothing renders sends the writer's roll into a
    // section they cannot see -- which is exactly what happened when the Hidden
    // key was renamed.
    for (const row of QUICK_BUILD_ROWS) {
      expect(SHIPPED_CHARACTER_KEYS, `Quick Build row "${row.label}"`)
        .toContain(row.targetSectionKey);
    }
  });

  it("every trait section has importance examples keyed to it", () => {
    const traitKeys = ["physical_traits", "personality_traits", "motivations",
                       "voice_notes", "hidden_and_foreshadowing_traits"];
    for (const level of Object.values(IMPORTANCE_HELP)) {
      for (const key of traitKeys) {
        expect(Object.keys(level.examples)).toContain(key);
      }
    }
  });

  it("has no help keyed to a character section that does not exist", () => {
    // The trail a half-finished rename leaves.
    const orphans = Object.keys(SECTION_HELP)
      .filter(key => key.startsWith("character_"))
      .filter(key => !SHIPPED_CHARACTER_KEYS.includes(key.slice("character_".length)));
    expect(orphans).toEqual([]);
  });
});
