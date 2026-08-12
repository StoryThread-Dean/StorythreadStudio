// sectionKeys.test.ts -- one name per section, across the whole frontend
// ======================================================================
// A section's key is not just a key. It is the id the backend files that section
// under, derived from the section's own heading -- so the form, the help text,
// the Quick Build randomizer and the parser all have to agree on the same word.
//
// They stopped agreeing, and it was expensive. The character page's Hidden and
// Foreshadowing section was keyed `hidden_and_foreshadowing` in some places and
// `hidden_and_foreshadowing_traits` in others. The form asked for a section the
// parser never produced, so a converted character's hidden traits looked empty
// and the next save wrote that emptiness to disk over them; Quick Build's Hidden
// row appended into a section nothing rendered; and the (?) help for that
// section quietly stopped appearing.
//
// None of that shows up as an error. An empty section looks like a section you
// have not filled in yet. So the agreement is a test.
//
// The backend half of this contract lives in
// backend/tests/test_profile_registry_agreement.py, which reads profile.ts from
// Python and compares it to both Python copies of the same list.

import { describe, it, expect } from "vitest";
import { SECTION_CONFIGS, PROFILE_TYPE_LABELS } from "./profile";
import type { ProfileType } from "./profile";
import { IMPORTANCE_HELP, SECTION_HELP } from "../data/profileHelp";
import { QUICK_BUILD_ROWS } from "../components/profiles/QuickBuildPanel";

const EDITED_TYPES: ProfileType[] = ["character", "relationship", "location", "lore"];

describe("a section key is the same word everywhere", () => {
  it("every key is what its own heading derives to", () => {
    // The rule the bug broke. The Weave reads a section's id from its heading
    // (lowercased, non-alphanumerics collapsed to underscores), so a key that
    // disagrees with its heading names a section that can never come back from
    // disk.
    //
    // Only the four types the Weave also stores. The dormant chapter_summary and
    // scene_summary configs break this rule on purpose -- key `overview` under
    // the heading "Chapter Overview" -- and it is harmless there, because
    // neither is a kind in the Weave's registry, so their files are only ever
    // read by the old parser, which keys sections from the CONFIG rather than
    // from the heading. Running the rule over them would fail for a reason that
    // cannot hurt anybody. Running it over the live four is what stops the
    // hidden-traits bug returning.
    const derive = (heading: string) =>
      heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    for (const type of EDITED_TYPES) {
      for (const section of SECTION_CONFIGS[type]) {
        expect(derive(section.heading), `${type}.${section.key}`)
          .toBe(section.key);
      }
    }
  });

  it("Quick Build appends into sections that exist", () => {
    // Quick Build's rows land in the character page. A row pointing at a key
    // nothing renders sends the writer's roll into a section they cannot see.
    const characterKeys = SECTION_CONFIGS.character.map(s => s.key);
    for (const row of QUICK_BUILD_ROWS) {
      expect(characterKeys, `Quick Build row "${row.label}"`)
        .toContain(row.targetSectionKey);
    }
  });

  it("every trait section has importance examples keyed to it", () => {
    // The (?) beside an importance level shows an example FOR THAT SECTION.
    // A renamed key means the writer gets the generic text instead, and nothing
    // reports it.
    const traitKeys = SECTION_CONFIGS.character
      .filter(s => s.hasTraitBlocks).map(s => s.key);
    for (const level of Object.values(IMPORTANCE_HELP)) {
      for (const key of traitKeys) {
        expect(Object.keys(level.examples)).toContain(key);
      }
    }
  });

  it("every section a writer types into has help under its own key", () => {
    // SECTION_HELP is keyed "{type}_{sectionKey}". Not every section needs a
    // tailored entry -- there is a documented fallback -- but a key that exists
    // for no section at all is a rename that was only half done, and it is the
    // trail the last one left.
    const known = new Set<string>();
    for (const type of EDITED_TYPES) {
      for (const section of SECTION_CONFIGS[type]) {
        known.add(`${type}_${section.key}`);
      }
    }
    const orphans = Object.keys(SECTION_HELP)
      .filter(key => key.startsWith("character_") || key.startsWith("relationship_")
        || key.startsWith("location_") || key.startsWith("lore_"))
      .filter(key => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it("every type with a tab has sections to render", () => {
    // A tab with no section list renders an empty page, which is what the six
    // kinds the Weave added would do today (recovery task R2.8).
    for (const type of Object.keys(PROFILE_TYPE_LABELS) as ProfileType[]) {
      expect(SECTION_CONFIGS[type]?.length ?? 0, type).toBeGreaterThan(0);
    }
  });
});
