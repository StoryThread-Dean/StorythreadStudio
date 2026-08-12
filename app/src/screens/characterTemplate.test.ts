// characterTemplate.test.ts -- moving a character between the two pages
// =====================================================================
// The writer's report: Weaving's created characters "are automatically grouped
// in the Main characters section with no way to move them to side". Two things
// came out of it -- Quick Create now asks (defaulting to Side), and a character
// that already exists can be moved either way.
//
// Their instruction for this file, more or less verbatim: take what is already
// saved and convert it; it is nearly one-to-one; and where a section does not
// line up, put it somewhere the writer will find it rather than guessing.
//
// So these tests are about the two things a converter must never do: lose words,
// and change what the AI is allowed to see without saying so.

import { describe, it, expect } from "vitest";
import {
  convertToMain, convertToSide, convertCharacter, traitAsLine,
} from "./characterTemplate";
import type { Profile } from "../types/profile";
import { SECTION_CONFIGS } from "../types/profile";

function character(overrides: Partial<Profile> = {}): Profile {
  return {
    entity_id: "e-1",
    type: "character",
    name: "Alexandra Langford",
    role: "protagonist",
    status: "active",
    tags: [],
    filename: "alexandra-langford.md",
    full_ai_summary: "",
    created_at: "",
    updated_at: "",
    character_kind: "main",
    sections: {
      overview: { content: "A tall woman.", trait_blocks: [], ai_summary: "" },
      physical_traits: {
        content: "",
        trait_blocks: [
          { id: "a", trait: "scarred hands", description: "From the fire.",
            importance: "core" },
          { id: "b", trait: "keeps a locket", description: "Her mother's.",
            importance: "hidden", ai_scope: "on-request" },
        ],
        ai_summary: "",
      },
      voice_notes: {
        content: "Short sentences.",
        trait_blocks: [
          { id: "c", trait: "never swears", description: "Not once.",
            importance: "present" },
        ],
        ai_summary: "",
      },
    },
    ...overrides,
  };
}


describe("Main to Side", () => {
  it("keeps every trait as a line, because the Side page has no trait list", () => {
    // Leaving them in the data would be worse than deleting them: they would be
    // on disk, invisible on screen, and the next save would look like it had
    // eaten them.
    const { profile } = convertToSide(character());
    const physical = profile.sections.physical_traits;
    expect(physical.trait_blocks).toEqual([]);
    expect(physical.content).toContain("scarred hands -- From the fire.");
    expect(physical.content).toContain("keeps a locket -- Her mother's.");
  });

  it("appends under what the writer already wrote, never over it", () => {
    const { profile } = convertToSide(character());
    const voice = profile.sections.voice_notes;
    expect(voice.content.startsWith("Short sentences.")).toBe(true);
    expect(voice.content).toContain("never swears -- Not once.");
  });

  it("labels a hidden trait, because Side has nothing that withholds one", () => {
    // ai_scope: on-request is the mechanism that keeps a hidden trait out of a
    // prompt. As a plain line it is ordinary text the AI may use. The word
    // "Hidden" carries what the level carried and can be searched for later.
    const { profile } = convertToSide(character());
    expect(profile.sections.physical_traits.content)
      .toContain("Hidden: keeps a locket");
  });

  it("reports what it dissolved and how much of it was hidden", () => {
    // Reported rather than done quietly: the screen has to be able to say this
    // BEFORE the writer commits, because it is the one part that is not
    // reversible by converting back.
    const result = convertToSide(character());
    expect(result.dissolved).toBe(3);
    expect(result.hidden).toBe(1);
  });

  it("says nothing happened when there was nothing to dissolve", () => {
    // The case this feature exists for: a character Weaving made from a name in
    // the prose, with no traits at all. Moving them to Side must be silent.
    const placeholder = character({
      sections: {
        overview: { content: "Mentioned in chapter two.", trait_blocks: [],
                    ai_summary: "" },
      },
    });
    const result = convertToSide(placeholder);
    expect(result.dissolved).toBe(0);
    expect(result.hidden).toBe(0);
    expect(result.profile.sections.overview.content)
      .toBe("Mentioned in chapter two.");
  });

  it("changes the template", () => {
    expect(convertToSide(character()).profile.character_kind).toBe("side");
  });
});


describe("Side to Main", () => {
  const side = character({
    character_kind: "side",
    sections: {
      overview: { content: "Keeps the shop on Mill Street.", trait_blocks: [],
                  ai_summary: "" },
      physical_traits: { content: "Weathered hands, always moving.",
                         trait_blocks: [], ai_summary: "" },
    },
  });

  it("moves nothing at all", () => {
    // Both pages keep their words in the same place in the file. The Main page
    // just also shows a trait list, which starts empty.
    const { profile, dissolved, moved } = convertToMain(side);
    expect(profile.sections.physical_traits.content)
      .toBe("Weathered hands, always moving.");
    expect(profile.sections.physical_traits.trait_blocks).toEqual([]);
    expect(dissolved).toBe(0);
    expect(moved).toEqual([]);
  });

  it("gives the page every section it will show", () => {
    // A section the file lacks would otherwise render as a gap the writer
    // cannot type into.
    const { profile } = convertToMain(side);
    for (const config of SECTION_CONFIGS.character) {
      expect(Object.keys(profile.sections)).toContain(config.key);
    }
  });

  it("keeps a section the writer added by hand", () => {
    // Their file, their section. Dropping it here would delete it on the next
    // save, which is the class of bug this whole recovery keeps finding.
    const withExtra = character({
      character_kind: "side",
      sections: {
        overview: { content: "x", trait_blocks: [], ai_summary: "" },
        smells_like: { content: "Woodsmoke.", trait_blocks: [], ai_summary: "" },
      },
    });
    const { profile } = convertToMain(withExtra);
    expect(profile.sections.smells_like.content).toBe("Woodsmoke.");
  });

  it("changes the template", () => {
    expect(convertToMain(side).profile.character_kind).toBe("main");
  });
});


describe("a round trip", () => {
  it("never loses a word, in either direction", () => {
    // Not "is identical" -- it cannot be, a trait list flattened to prose does
    // not come back as a list. What must hold is that every word survives, so
    // the writer can promote the lines back into traits themselves.
    const original = character();
    const there = convertToSide(original).profile;
    const back = convertToMain(there).profile;

    for (const block of original.sections.physical_traits.trait_blocks) {
      expect(back.sections.physical_traits.content).toContain(block.trait);
      expect(back.sections.physical_traits.content).toContain(block.description);
    }
    expect(back.sections.overview.content).toBe("A tall woman.");
    expect(back.sections.voice_notes.content).toContain("Short sentences.");
  });

  it("leaves everything that is not a section alone", () => {
    const original = character({ tags: ["noble"], role: "protagonist" });
    const { profile } = convertToSide(original);
    expect(profile.name).toBe(original.name);
    expect(profile.role).toBe("protagonist");
    expect(profile.tags).toEqual(["noble"]);
    expect(profile.entity_id).toBe(original.entity_id);
    expect(profile.filename).toBe(original.filename);
  });
});


describe("a trait as a line", () => {
  it("reads like something a person wrote", () => {
    expect(traitAsLine({ id: "x", trait: "scarred hands",
                         description: "From the fire.", importance: "core" }))
      .toBe("scarred hands -- From the fire.");
  });

  it("uses two hyphens, never an em dash", () => {
    // The locked product rule, and this text goes into the writer's own file.
    const line = traitAsLine({ id: "x", trait: "a", description: "b",
                               importance: "core" });
    expect(line).not.toMatch(/[–—]/);
  });

  it("copes with half a trait", () => {
    expect(traitAsLine({ id: "x", trait: "", description: "Just a note.",
                         importance: "core" })).toBe("Just a note.");
    expect(traitAsLine({ id: "x", trait: "Tall", description: "",
                         importance: "core" })).toBe("Tall");
  });

  it("routes by the direction asked for", () => {
    expect(convertCharacter(character(), "side").profile.character_kind)
      .toBe("side");
    expect(convertCharacter(character(), "main").profile.character_kind)
      .toBe("main");
  });
});
