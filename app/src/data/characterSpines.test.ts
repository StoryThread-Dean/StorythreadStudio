// characterSpines.test.ts
// ========================
// The spine dropdowns insert this canned text VERBATIM into profiles, so the
// content itself is the contract: complete entries, the fiction-first
// fill-in hook on every Enneagram summary, and -- because this text lands in
// the writer's files -- absolutely no em/en dashes (the locked product rule
// the AI sanitizer can't protect static app content from).

import { describe, it, expect } from "vitest";
import {
  ENNEAGRAM_OPTIONS, ARCHETYPE_OPTIONS, spineOptionById, archetypeIdForRole,
} from "./characterSpines";

describe("ENNEAGRAM_OPTIONS", () => {
  it("has all nine types with complete fields", () => {
    expect(ENNEAGRAM_OPTIONS).toHaveLength(9);
    for (const o of ENNEAGRAM_OPTIONS) {
      expect(o.id.trim()).not.toBe("");
      expect(o.label.trim()).not.toBe("");
      expect(o.help.trim()).not.toBe("");
      expect(o.summary.trim()).not.toBe("");
    }
  });

  it("every summary ends with the personalization fill-in hook", () => {
    // The house formula is trait + trigger + origin; the hook is where the
    // writer supplies the trigger and origin themselves.
    for (const o of ENNEAGRAM_OPTIONS) {
      expect(o.summary).toContain("sharpens around ____ because ____");
    }
  });

  it("every summary carries desire, dread, and pressure (fiction-first)", () => {
    for (const o of ENNEAGRAM_OPTIONS) {
      expect(o.summary).toMatch(/Wants /);
      expect(o.summary).toMatch(/dreads /);
      expect(o.summary).toMatch(/Under pressure/);
    }
  });
});

describe("ARCHETYPE_OPTIONS", () => {
  it("has the 12 Jungian archetypes plus story-role extras", () => {
    expect(ARCHETYPE_OPTIONS.length).toBeGreaterThanOrEqual(15);
    const ids = ARCHETYPE_OPTIONS.map(o => o.id);
    // Spot-check core Jungian entries + the extras the quick-build leans on.
    for (const id of ["hero", "mentor", "shadow", "jester", "comic_relief", "confidant", "rival"]) {
      expect(ids).toContain(id);
    }
  });

  it("every summary names the story role and a weakness to write toward", () => {
    for (const o of ARCHETYPE_OPTIONS) {
      expect(o.summary).toContain("Story role:");
      expect(o.summary).toContain("Weakness to write toward:");
    }
  });
});

describe("content rules", () => {
  it("no em or en dashes anywhere -- this text lands in the writer's files", () => {
    const everything = [...ENNEAGRAM_OPTIONS, ...ARCHETYPE_OPTIONS]
      .map(o => o.label + o.help + o.summary)
      .join("");
    expect(everything).not.toMatch(/[–—]/);
  });

  it("no trademarked personality-test naming", () => {
    const everything = [...ENNEAGRAM_OPTIONS, ...ARCHETYPE_OPTIONS]
      .map(o => o.label + o.help + o.summary)
      .join(" ")
      .toLowerCase();
    expect(everything).not.toContain("myers");
    expect(everything).not.toContain("briggs");
    expect(everything).not.toContain("mbti");
  });
});

describe("spineOptionById", () => {
  it("finds by id and returns undefined for unknowns", () => {
    expect(spineOptionById(ENNEAGRAM_OPTIONS, "e8")?.label).toContain("Challenger");
    expect(spineOptionById(ARCHETYPE_OPTIONS, "nope")).toBeUndefined();
  });
});

describe("archetypeIdForRole", () => {
  // Reopening a side character re-derives the Quick Build Story Role from
  // the profile's Role field -- these pin the matching rules.
  it("matches full labels case-insensitively", () => {
    expect(archetypeIdForRole("Comic Relief")).toBe("comic_relief");
    expect(archetypeIdForRole("comic relief")).toBe("comic_relief");
  });

  it("matches any slash-separated part of a label", () => {
    expect(archetypeIdForRole("Villain")).toBe("shadow");
    expect(archetypeIdForRole("Mentor")).toBe("mentor");
    expect(archetypeIdForRole("Sage")).toBe("mentor");
  });

  it("returns the Any-role default for blank or unmatched roles", () => {
    expect(archetypeIdForRole("")).toBe("");
    expect(archetypeIdForRole(undefined)).toBe("");
    expect(archetypeIdForRole("protagonist")).toBe("");
  });
});
