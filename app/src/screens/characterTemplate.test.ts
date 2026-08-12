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
  convertToMain, convertToSide, convertCharacter, traitAsLine, isSecret,
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
          // A SECRET THAT MATTERS, which the old single scale could not hold:
          // weight and secrecy are separate fields now.
          { id: "b", trait: "keeps a locket", description: "Her mother's.",
            importance: "core", subtext: true },
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
  it("turns an ordinary trait into a line, because Side has no trait list", () => {
    // Leaving one in the data would be worse than deleting it: on disk,
    // invisible on screen, and the next save would look like it had eaten it.
    const { profile } = convertToSide(character());
    const physical = profile.sections.physical_traits;
    expect(physical.content).toContain("scarred hands -- From the fire.");
  });

  it("does NOT flatten a secret -- it stays a trait", () => {
    // THE CORRECTION. A line of prose has nowhere to carry "never say this", so
    // flattening a secret strips the only thing stopping the model writing it
    // out loud. The Side page shows its plain box AND the section's secrets, so
    // the conversion is lossless and a Side character can keep one.
    const { profile } = convertToSide(character());
    const physical = profile.sections.physical_traits;
    expect(physical.trait_blocks.map(b => b.trait)).toEqual(["keeps a locket"]);
    expect(physical.trait_blocks[0].subtext).toBe(true);
    // And it is not ALSO written into the prose, which would duplicate it.
    expect(physical.content).not.toContain("keeps a locket");
  });

  it("appends under what the writer already wrote, never over it", () => {
    const { profile } = convertToSide(character());
    const voice = profile.sections.voice_notes;
    expect(voice.content.startsWith("Short sentences.")).toBe(true);
    expect(voice.content).toContain("never swears -- Not once.");
  });

  it("reads an unconverted file's on-request trait as a secret too", () => {
    // What the old migration wrote. A file that has not been re-saved since
    // still says it, and reading it as ordinary would expose it.
    const legacy = character({
      sections: {
        physical_traits: {
          content: "", ai_summary: "",
          trait_blocks: [{ id: "z", trait: "the locket", description: "Hers.",
                           importance: "present", ai_scope: "on-request" }],
        },
      },
    });
    const { profile } = convertToSide(legacy);
    expect(profile.sections.physical_traits.trait_blocks).toHaveLength(1);
  });

  it("reports what it dissolved and what it kept", () => {
    const result = convertToSide(character());
    expect(result.dissolved).toBe(2);      // scarred hands, never swears
    expect(result.hidden).toBe(1);         // the locket, kept as a trait
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

    const physical = back.sections.physical_traits;
    const everything = physical.content
      + physical.trait_blocks.map(b => `${b.trait} ${b.description}`).join(" ");
    for (const block of original.sections.physical_traits.trait_blocks) {
      expect(everything).toContain(block.trait);
      expect(everything).toContain(block.description);
    }
    expect(back.sections.overview.content).toBe("A tall woman.");
    expect(back.sections.voice_notes.content).toContain("Short sentences.");
  });

  it("never loses a SECRET, in either direction", () => {
    // The one part of a round trip that cannot be repaired by hand afterwards:
    // if the flag goes, the writer has no way to know their subtext became
    // ordinary text the AI may state outright.
    const there = convertToSide(character()).profile;
    const back = convertToMain(there).profile;
    for (const profile of [there, back]) {
      const secrets = Object.values(profile.sections)
        .flatMap(section => section.trait_blocks)
        .filter(block => block.subtext);
      expect(secrets.map(b => b.trait)).toContain("keeps a locket");
    }
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

  it("is only ever asked about traits that are not secret", () => {
    // A secret never becomes a line, so this function has no secrecy handling
    // and no "Hidden:" prefix to get wrong. isSecret is what decides.
    expect(isSecret({ id: "x", trait: "t", description: "d",
                      importance: "core", subtext: true })).toBe(true);
    expect(isSecret({ id: "x", trait: "t", description: "d",
                      importance: "core" })).toBe(false);
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
