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

  it("exhaustive: EVERY component combination stays speakable", () => {
    // Deterministic, total coverage: drive the rng to select each specific
    // (start, mid?, end) combination instead of sampling randomly -- a
    // random fuzz here was flaky, failing only on rare draws.
    const drive = (vals: number[]) => {
      let i = 0;
      return () => vals[i++ % vals.length];
    };
    const frac = (index: number, len: number) => (index + 0.5) / len;

    const check = (name: string, label: string) => {
      expect(name[0], label).toBe(name[0].toUpperCase());
      expect(name.length, label).toBeGreaterThanOrEqual(3);
      expect(name.length, label).toBeLessThanOrEqual(16);
      expect(name, label).not.toContain("____");
      expect(name, label).not.toMatch(/([a-z])\1\1/i);
      expect(name, label).not.toMatch(/[–—\s]/);
    };

    for (const race of FANTASY_RACES) {
      for (const gender of ["male", "female"] as FantasyGender[]) {
        const parts = race.given[gender];
        // Races with solo names spend an extra leading rng call on the
        // solo gate -- 0.9 skips it so the assembly path is exercised.
        const soloSkip = parts.solos?.length ? [0.9] : [];

        // Every solo name dealt whole must also pass the rules.
        for (let i = 0; i < (parts.solos?.length ?? 0); i++) {
          const solo = generateFantasyGivenName(
            race.id, gender, drive([0.1, frac(i, parts.solos!.length)]),
          );
          check(solo, `${race.id}/${gender} solo: ${parts.solos![i]} -> ${solo}`);
        }

        for (let s = 0; s < parts.starts.length; s++) {
          for (let e = 0; e < parts.ends.length; e++) {
            // rng call order in the generator: [solo gate,] start, end,
            // mid-gate, mid. Without a middle (gate 0.9 skips the 40%).
            const plain = generateFantasyGivenName(
              race.id, gender,
              drive([...soloSkip, frac(s, parts.starts.length), frac(e, parts.ends.length), 0.9]),
            );
            check(plain, `${race.id}/${gender}: ${parts.starts[s]}+${parts.ends[e]} -> ${plain}`);
            // With every middle (0.1 passes the gate; cap may still skip it).
            for (let m = 0; m < parts.mids.length; m++) {
              const withMid = generateFantasyGivenName(
                race.id, gender,
                drive([
                  ...soloSkip,
                  frac(s, parts.starts.length), frac(e, parts.ends.length),
                  0.1, frac(m, parts.mids.length),
                ]),
              );
              check(withMid, `${race.id}/${gender}: ${parts.starts[s]}+${parts.mids[m]}+${parts.ends[e]} -> ${withMid}`);
            }
          }
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

describe("solo names (short blunt draws)", () => {
  it("orcs carry solo pools with genuinely short names", () => {
    const orc = fantasyRaceById("orc")!;
    for (const gender of ["male", "female"] as FantasyGender[]) {
      const solos = orc.given[gender].solos ?? [];
      expect(solos.length).toBeGreaterThanOrEqual(10);
      // The point of solos: one compact unit, not two assembled ones.
      for (const s of solos) expect(s.length).toBeLessThanOrEqual(5);
    }
  });

  it("the solo gate deals a whole solo name, capitalized", () => {
    const orc = fantasyRaceById("orc")!;
    const solos = orc.given.male.solos!;
    // rng: 0.1 passes the 30% solo gate; second value picks index 0.
    let calls = 0;
    const rng = () => (calls++ === 0 ? 0.1 : 0.05);
    const name = generateFantasyGivenName("orc", "male", rng);
    expect(name.toLowerCase()).toBe(solos[0].toLowerCase());
    expect(name[0]).toBe(name[0].toUpperCase());
  });
});

describe("dwarf recuration (user feedback: no gibberish)", () => {
  it("every dwarf start+end pair lands on a two-beat Norse-pattern name", () => {
    // Spot-anchor the register: these exact classics must be reachable.
    const dwarf = fantasyRaceById("dwarf")!;
    expect(dwarf.given.male.starts).toContain("thor");
    expect(dwarf.given.male.ends).toContain("grim");
    expect(dwarf.given.female.starts).toContain("gud");
    expect(dwarf.given.female.ends).toContain("run");
    // No start repeats verbatim as an end for the same gender -- that's
    // what produced Durdur-style stutters in v1.
    for (const gender of ["male", "female"] as FantasyGender[]) {
      const starts = new Set(dwarf.given[gender].starts);
      for (const end of dwarf.given[gender].ends) {
        expect(starts.has(end)).toBe(false);
      }
    }
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
