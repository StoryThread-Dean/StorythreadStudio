// types/sectionRegistry.test.ts
// =============================
// Which kinds the Profile Builder offers, and why that answer must come from
// the sidebar rather than from a list somebody typed.
//
// THE BUG, in the writer's words:
//
//     "Interface for Creatures, Culture, Factions, Religions, Ruling
//      Authorities, Dieties, Objects, Languages is visually different than
//      Characters, Locations, Lore."
//
// Two lists disagreed. `tabsFromSections` already offered every Profiles-group
// kind as a tab, while App.tsx routed on a hardcoded four -- so a Creature
// opened in the Weave's simpler editor, with a different look and no Profile
// Chat, even though the Profile Builder was sitting there ready to render it.
//
// Exactly the shape of the NOTE_FILES bug fixed a day earlier: a duplicated
// list does not announce that it has drifted, it just quietly shows less than
// there is.

import { describe, it, expect } from "vitest";

import { tabsFromSections } from "./sectionRegistry";
import type { SectionEntry, SectionsTree } from "../features/codex/api";

function section(id: string, over: Record<string, unknown> = {}) {
  return {
    kind: "type" as const, id, label: id, icon: "User",
    group: "profiles", count: 1, default_section: true, shipped: true,
    rename: "none", removal: "hide", ...over,
  } as SectionEntry;
}

function tree(over: Partial<SectionsTree> = {}): SectionsTree {
  return {
    groups: [
      { id: "profiles", label: "Profiles", available: [], sections: [
        section("character"), section("location"), section("lore"),
        section("creature"), section("faction"), section("religion"),
        section("government"), section("deity"), section("culture"),
      ] },
      { id: "other", label: "Other", available: [], sections: [
        section("object", { group: "other" }),
        section("language", { group: "other" }),
        section("concept", { group: "other" }),
        section("event", { group: "other" }),
      ] },
      { id: "notes", label: "Notes", available: [], sections: [
        { kind: "note" as const, id: "outline", label: "Outline",
          icon: "ListTree", group: "notes", count: 1, default_section: true,
          filename: "outline.md", rename: "none", removal: "trash" },
      ] },
    ],
    available: [], converted: true,
    ...over,
  } as SectionsTree;
}


describe("every kind of entry gets a tab", () => {
  const tabs = tabsFromSections(tree());

  it("includes the three that always worked", () => {
    for (const id of ["character", "location", "lore"]) {
      expect(tabs).toContain(id);
    }
  });

  it("includes every kind the writer named as looking wrong", () => {
    // Their list, verbatim: Creatures, Culture, Factions, Religions, Ruling
    // Authorities, Dieties, Objects, Languages.
    for (const id of ["creature", "culture", "faction", "religion",
                      "government", "deity", "object", "language"]) {
      expect(tabs).toContain(id);
    }
  });

  it("includes the Other group, not just Profiles", () => {
    // The old version stopped at Profiles, which is why Objects and Languages
    // ended up in a different editor from Creatures and Factions.
    expect(tabs).toContain("object");
    expect(tabs).toContain("concept");
  });

  it("leaves notes out", () => {
    // A note is a document the writer authors, edited in the editor. It is
    // not an entry about anything and has no profile form.
    expect(tabs).not.toContain("outline");
  });
});


describe("it follows the sidebar rather than repeating it", () => {
  it("shows nothing for a world with no kinds", () => {
    expect(tabsFromSections(tree({ groups: [] }))).toEqual([]);
  });

  it("picks up a kind the writer invented", () => {
    // The whole point of reading GET /sections: a kind added in the sidebar
    // turns up here without this file being edited.
    const withCustom = tree();
    withCustom.groups[0].sections.push(section("bloodline"));
    expect(tabsFromSections(withCustom)).toContain("bloodline");
  });

  it("does not second-guess which kinds are worth showing", () => {
    // GET /sections has already applied "holds something, or is a default".
    // Filtering again here is how the two screens come to disagree about a
    // writer's world -- and the crowding this was once meant to prevent is
    // already prevented by that rule.
    const sparse = tree({ groups: [
      { id: "profiles", label: "Profiles", available: [],
        sections: [section("character")] },
    ] });
    expect(tabsFromSections(sparse)).toEqual(["character"]);
  });
});
