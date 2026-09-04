// screens/profileRepair.test.ts -- content the profile page cannot show
// =====================================================================
// The Profile Builder renders from the type registry, which is the right way
// round: a section added to the registry appears on every existing profile
// without touching a file. The consequence is the bug: a section in the FILE
// that the registry does not know about is rendered by nothing. It survives
// every save and the writer cannot see it, edit it, or suspect it exists.
//
// One transposed letter in a hand-edited heading is all it takes.
//
// The other half of these tests is about what this must NOT do: a section
// absent from a file is the normal state, because empty sections are never
// written to disk. "Restoring" them would write meaningless headings into
// every profile a writer owns and repair nothing.

import { describe, expect, it } from "vitest";

import {
  findUnshownSections, foldIntoNotes, nearestSection, renameSection,
} from "./profileRepair";
import type { Profile, ProfileSection } from "../types/profile";
import type { SectionConfig } from "../types/sectionRegistry";

const SECTIONS: SectionConfig[] = [
  { key: "overview", heading: "Overview", hasTraitBlocks: false },
  { key: "physical_traits", heading: "Physical Traits", hasTraitBlocks: true },
  { key: "personality_traits", heading: "Personality Traits", hasTraitBlocks: true },
  { key: "motivations", heading: "Motivations", hasTraitBlocks: true },
  { key: "voice_notes", heading: "Voice Notes", hasTraitBlocks: true },
  { key: "hidden_and_foreshadowing_traits",
    heading: "Hidden and Foreshadowing Traits", hasTraitBlocks: true },
  { key: "relationships", heading: "Relationships", hasTraitBlocks: true },
  { key: "notes", heading: "Notes", hasTraitBlocks: false },
];

function section(over: Partial<ProfileSection> = {}): ProfileSection {
  return { content: "", trait_blocks: [], ai_summary: "", ...over };
}

function profile(sections: Record<string, ProfileSection>): Profile {
  return {
    entity_id: "e-kip", type: "character", name: "Kipling", role: "",
    status: "active", tags: [], filename: "kipling.md",
    sections, full_ai_summary: "", created_at: "", updated_at: "",
  } as Profile;
}

const TRAIT = { id: "t1", trait: "Hazel Eyes",
                description: "Inherited from her father.",
                importance: "core" as const };


// ── What it finds ────────────────────────────────────────────────────────────

describe("finding content the page cannot show", () => {
  it("finds a section the registry does not know about", () => {
    const p = profile({
      overview: section({ content: "A guide." }),
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
    });
    const found = findUnshownSections(p, SECTIONS);
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe("physcial_traits");
  });

  it("names it in the writer's own spelling", () => {
    // They are looking for the heading they typed. Showing them a slug, or a
    // tidied-up version of it, is showing them something that is not in their
    // file.
    const p = profile({
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
    });
    expect(findUnshownSections(p, SECTIONS)[0].heading).toBe("Physcial Traits");
  });

  it("says what is in it, so a stray line reads differently from real work", () => {
    const p = profile({
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
      my_own_thing: section({ heading: "My Own Thing",
                              content: "one two three four five" }),
    });
    const by = Object.fromEntries(
      findUnshownSections(p, SECTIONS).map(s => [s.key, s]));
    expect(by.physcial_traits.traitCount).toBe(1);
    expect(by.my_own_thing.wordCount).toBe(5);
  });

  it("finds nothing on an ordinary profile", () => {
    const p = profile({
      overview: section({ content: "A guide." }),
      notes: section({ content: "Limited literacy." }),
    });
    expect(findUnshownSections(p, SECTIONS)).toEqual([]);
  });

  it("does not treat an EMPTY section as damage", () => {
    // THE PREMISE THAT HAD TO BE CHECKED. Empty sections are never written to
    // disk, so every profile lacks the ones its writer has not filled in --
    // and they already render as empty fields in the right place. A repair
    // that "restored" them would churn every file and fix nothing.
    const p = profile({
      overview: section({ content: "A guide." }),
      relationships: section(),
      motivations: section(),
    });
    expect(findUnshownSections(p, SECTIONS)).toEqual([]);
  });

  it("does not report an empty stray heading either", () => {
    const p = profile({ leftover: section({ heading: "Leftover" }) });
    expect(findUnshownSections(p, SECTIONS)).toEqual([]);
  });

  it("reports a stray section holding only an AI summary", () => {
    // Still the writer's file, and still invisible.
    const p = profile({
      leftover: section({ heading: "Leftover", ai_summary: "Something." }),
    });
    expect(findUnshownSections(p, SECTIONS)).toHaveLength(1);
  });
});


// ── The guess ────────────────────────────────────────────────────────────────

describe("guessing what a stray heading meant", () => {
  it("finds the section behind a transposed letter", () => {
    expect(nearestSection("Physcial Traits", SECTIONS)?.key)
      .toBe("physical_traits");
  });

  it("ignores case and punctuation", () => {
    expect(nearestSection("physical-traits", SECTIONS)?.key)
      .toBe("physical_traits");
  });

  it("finds a singular where the template is plural", () => {
    expect(nearestSection("Motivation", SECTIONS)?.key).toBe("motivations");
  });

  it("guesses NOTHING for a heading that is simply not one of ours", () => {
    // A wrong guess offered confidently is worse than no guess: the writer
    // clicks Rename and their traits are filed under a heading they never
    // meant. Notes is the only honest offer here.
    expect(nearestSection("My Own Weird Heading", SECTIONS)).toBeUndefined();
    expect(nearestSection("Combat Statistics", SECTIONS)).toBeUndefined();
  });

  it("does not match two short unrelated headings to each other", () => {
    expect(nearestSection("Notes", SECTIONS)?.key).toBe("notes");
    expect(nearestSection("Nodes", SECTIONS)?.key).toBe("notes");
    // "Notes" and "Motivations" are both short; one edit apart they are not.
    expect(nearestSection("Motives", SECTIONS)?.key).not.toBe("notes");
  });

  it("offers the guess alongside the finding", () => {
    const p = profile({
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
      my_own_thing: section({ heading: "My Own Thing", content: "Words." }),
    });
    const by = Object.fromEntries(
      findUnshownSections(p, SECTIONS).map(s => [s.key, s]));
    expect(by.physcial_traits.looksLike?.heading).toBe("Physical Traits");
    expect(by.my_own_thing.looksLike).toBeUndefined();
  });
});


// ── Renaming: the repair that keeps the structure ────────────────────────────

describe("renaming a stray section to the one it meant", () => {
  it("moves the traits, still as traits", () => {
    // The reason rename is offered FIRST. Folding a trait list into Notes
    // turns it into prose, and a typo is the likeliest cause of all this.
    const p = profile({
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
    });
    const next = renameSection(p, "physcial_traits", "physical_traits");
    expect(next.physical_traits.trait_blocks).toHaveLength(1);
    expect(next.physical_traits.trait_blocks[0].trait).toBe("Hazel Eyes");
    expect(next.physcial_traits).toBeUndefined();
  });

  it("joins rather than overwrites when the destination already holds work", () => {
    // The writer typed into the real section too. Losing either half would
    // make this repair the thing that destroyed their work.
    const p = profile({
      physical_traits: section({ trait_blocks: [
        { id: "t0", trait: "Round Face", description: "Youthful.",
          importance: "core" }] }),
      physcial_traits: section({ heading: "Physcial Traits",
                                 trait_blocks: [TRAIT] }),
    });
    const next = renameSection(p, "physcial_traits", "physical_traits");
    expect(next.physical_traits.trait_blocks.map(b => b.trait))
      .toEqual(["Round Face", "Hazel Eyes"]);
  });

  it("joins prose with a blank line rather than running it together", () => {
    const p = profile({
      notes: section({ content: "First." }),
      note: section({ heading: "Note", content: "Second." }),
    });
    const next = renameSection(p, "note", "notes");
    expect(next.notes.content).toBe("First.\n\nSecond.");
  });

  it("keeps the destination's own AI summary", () => {
    const p = profile({
      physical_traits: section({ ai_summary: "The real one." }),
      physcial_traits: section({ heading: "Physcial Traits",
                                 ai_summary: "Written for a heading that is going away.",
                                 content: "x" }),
    });
    const next = renameSection(p, "physcial_traits", "physical_traits");
    expect(next.physical_traits.ai_summary).toBe("The real one.");
  });

  it("does nothing when asked to rename a section to itself", () => {
    const p = profile({ notes: section({ content: "Keep." }) });
    expect(renameSection(p, "notes", "notes")).toBe(p.sections);
  });
});


// ── Folding into Notes: the repair for a heading that is nobody's ────────────

describe("folding a stray section into Notes", () => {
  it("keeps the words and labels them with the original heading", () => {
    // The heading is the only remaining clue about what the words were for.
    // Without it, Notes gains an unexplained paragraph.
    const p = profile({
      notes: section({ content: "Limited literacy." }),
      combat: section({ heading: "Combat Statistics",
                        content: "Fights with a short blade." }),
    });
    const next = foldIntoNotes(p, "combat");
    expect(next.notes.content).toContain("Limited literacy.");
    expect(next.notes.content).toContain("**Combat Statistics**");
    expect(next.notes.content).toContain("Fights with a short blade.");
    expect(next.combat).toBeUndefined();
  });

  it("writes traits out as readable lines rather than dropping them", () => {
    // They stop being trait blocks -- which is exactly why this is the second
    // offer -- but not one word is lost.
    const p = profile({
      notes: section(),
      odd: section({ heading: "Odd", trait_blocks: [TRAIT] }),
    });
    const next = foldIntoNotes(p, "odd");
    expect(next.notes.content).toContain("Hazel Eyes");
    expect(next.notes.content).toContain("Inherited from her father.");
  });

  it("works when Notes does not exist yet", () => {
    const p = profile({ odd: section({ heading: "Odd", content: "Words." }) });
    const next = foldIntoNotes(p, "odd");
    expect(next.notes.content).toContain("Words.");
  });

  it("refuses to fold Notes into itself", () => {
    const p = profile({ notes: section({ content: "Keep." }) });
    expect(foldIntoNotes(p, "notes")).toBe(p.sections);
  });
});


// ── Nothing is ever lost ─────────────────────────────────────────────────────

describe("the rule both repairs answer to", () => {
  const p = profile({
    overview: section({ content: "A guide from the mountain village." }),
    physcial_traits: section({ heading: "Physcial Traits",
                               trait_blocks: [TRAIT] }),
    notes: section({ content: "Limited literacy." }),
  });

  it("keeps every word through a rename", () => {
    const next = renameSection(p, "physcial_traits", "physical_traits");
    const all = JSON.stringify(next);
    expect(all).toContain("Hazel Eyes");
    expect(all).toContain("Inherited from her father.");
    expect(all).toContain("A guide from the mountain village.");
    expect(all).toContain("Limited literacy.");
  });

  it("keeps every word through a fold", () => {
    const next = foldIntoNotes(p, "physcial_traits");
    const all = JSON.stringify(next);
    expect(all).toContain("Hazel Eyes");
    expect(all).toContain("Inherited from her father.");
    expect(all).toContain("A guide from the mountain village.");
    expect(all).toContain("Limited literacy.");
  });

  it("leaves the profile it was given untouched", () => {
    // The caller sets state with the result. Mutating the buffer in place
    // would mark nothing dirty and lose the writer's undo.
    const before = JSON.stringify(p.sections);
    renameSection(p, "physcial_traits", "physical_traits");
    foldIntoNotes(p, "physcial_traits");
    expect(JSON.stringify(p.sections)).toBe(before);
  });
});
