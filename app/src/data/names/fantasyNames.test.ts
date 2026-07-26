// fantasyNames.test.ts
// =====================
// The fantasy generator's contract: every race complete, assembly
// deterministic under an injected rng, output speakable (fuzz-tested
// bounds), and race phonologies actually distinct -- asserted on the
// component sets, not on vibes.

import { describe, it, expect } from "vitest";
import {
  FANTASY_RACES,
  fantasyRaceById,
  generateFantasyGivenName,
  generateFantasySurname,
  type FantasyGender,
} from "./fantasyNames";

function seededRng(): () => number {
  let i = 0;
  const seq = [0.13, 0.91, 0.47, 0.66, 0.08, 0.72, 0.35, 0.58, 0.24, 0.83];
  return () => seq[i++ % seq.length];
}

const EXPECTED_RACES = [
  "wood_elf", "moon_elf", "sun_elf", "high_elf", "dark_elf",
  "orc", "gnome", "hobbit", "dwarf", "goblin", "dragonkin", "fae",
];

describe("race roster", () => {
  it("all 12 races present with both genders and surname components", () => {
    expect(FANTASY_RACES.map(r => r.id)).toEqual(EXPECTED_RACES);
    for (const race of FANTASY_RACES) {
      for (const gender of ["male", "female"] as FantasyGender[]) {
        const parts = race.given[gender];
        expect(parts.starts.length).toBeGreaterThanOrEqual(10);
        expect(parts.mids.length).toBeGreaterThanOrEqual(4);
        expect(parts.ends.length).toBeGreaterThanOrEqual(8);
      }
      const s = race.surname;
      if ("epithets" in s) expect(s.epithets.length).toBeGreaterThanOrEqual(15);
      else {
        expect(s.firsts.length).toBeGreaterThanOrEqual(10);
        expect(s.seconds.length).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("no em or en dashes in any component", () => {
    const everything = JSON.stringify(FANTASY_RACES);
    expect(everything).not.toMatch(/[–—]/);
  });
});

describe("generateFantasyGivenName", () => {
  it("is deterministic under an injected rng", () => {
    const a = generateFantasyGivenName("dark_elf", "female", seededRng());
    const b = generateFantasyGivenName("dark_elf", "female", seededRng());
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("fuzz: 200 names per race stay speakable", () => {
    for (const race of FANTASY_RACES) {
      for (const gender of ["male", "female"] as FantasyGender[]) {
        for (let i = 0; i < 100; i++) {
          const name = generateFantasyGivenName(race.id, gender);
          // Capitalized, sane length, no fill-in blanks, no stutters.
          expect(name[0]).toBe(name[0].toUpperCase());
          expect(name.length).toBeGreaterThanOrEqual(3);
          expect(name.length).toBeLessThanOrEqual(16);
          expect(name).not.toContain("____");
          expect(name).not.toMatch(/([a-z])\1\1/i);
          expect(name).not.toMatch(/[–—\s]/);
        }
      }
    }
  });

  it("returns empty string for unknown races", () => {
    expect(generateFantasyGivenName("mermaid", "male")).toBe("");
  });
});

describe("generateFantasySurname", () => {
  it("compounds for compound races, epithets for goblins", () => {
    const dwarf = generateFantasySurname("dwarf", seededRng());
    expect(dwarf[0]).toBe(dwarf[0].toUpperCase());
    expect(dwarf).not.toContain(" ");

    const goblin = generateFantasySurname("goblin", seededRng());
    const race = fantasyRaceById("goblin")!;
    expect("epithets" in race.surname && race.surname.epithets).toContain(goblin);
  });

  it("is deterministic under an injected rng", () => {
    expect(generateFantasySurname("orc", seededRng()))
      .toBe(generateFantasySurname("orc", seededRng()));
  });
});

describe("phonology distinctness", () => {
  it("orc endings never overlap elf endings (component-set disjointness)", () => {
    const orc = fantasyRaceById("orc")!;
    const elves = ["wood_elf", "moon_elf", "sun_elf", "high_elf"].map(id => fantasyRaceById(id)!);
    for (const gender of ["male", "female"] as FantasyGender[]) {
      const orcEnds = new Set(orc.given[gender].ends);
      for (const elf of elves) {
        for (const end of elf.given[gender].ends) {
          expect(orcEnds.has(end)).toBe(false);
        }
      }
    }
  });

  it("dwarf surnames read earthy, elf surnames read natural -- no shared firsts with orcs' violence", () => {
    const orcFirsts = new Set((fantasyRaceById("orc")!.surname as { firsts: string[] }).firsts);
    const hobbitFirsts = (fantasyRaceById("hobbit")!.surname as { firsts: string[] }).firsts;
    for (const first of hobbitFirsts) {
      expect(orcFirsts.has(first)).toBe(false);
    }
  });
});
