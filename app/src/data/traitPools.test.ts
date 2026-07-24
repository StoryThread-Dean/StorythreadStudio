// traitPools.test.ts
// ===================
// Pins the trait randomizer's contract: the NSFW toggle tiers REPLACE each
// other (never mix), archetype flavor biases the normal tier only, rolls
// are deterministic under an injected rng, and the canned text obeys the
// house content rules (no em/en dashes; the spiciest tier is
// fill-in-the-blank).

import { describe, it, expect } from "vitest";
import {
  TRAIT_POOLS, ARCHETYPE_FLAVOR, rollTraitOptions, type TraitSection,
} from "./traitPools";

const SECTIONS: TraitSection[] = ["physical", "mannerism", "voice", "want", "hidden"];

// A deterministic rng: cycles through a fixed sequence so shuffles are
// reproducible in tests without patching Math.random.
function seededRng(): () => number {
  let i = 0;
  const seq = [0.11, 0.87, 0.42, 0.63, 0.29, 0.95, 0.05, 0.71];
  return () => seq[i++ % seq.length];
}

describe("pool contents", () => {
  it("every section has all three tiers, deeply stocked (5x expansion)", () => {
    for (const s of SECTIONS) {
      expect(TRAIT_POOLS[s].normal.length).toBeGreaterThanOrEqual(50);
      expect(TRAIT_POOLS[s].nsfw.length).toBeGreaterThanOrEqual(18);
      expect(TRAIT_POOLS[s].explicit.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("entries carry real texture, not fragments", () => {
    // The v1 pools read too short -- lock in sentence-length entries.
    for (const s of SECTIONS) {
      for (const option of TRAIT_POOLS[s].normal) {
        expect(option.split(/\s+/).length).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("no duplicate options within any tier", () => {
    for (const s of SECTIONS) {
      for (const tier of ["normal", "nsfw", "explicit"] as const) {
        const list = TRAIT_POOLS[s][tier];
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it("the explicit tier mixes blanks with filled-in inspiration, majority blank", () => {
    // The writer's chosen balance: fill-in-the-blank stays the majority
    // (personalization over prescription), but a real share of options are
    // filled in -- concrete sparks to deviate from or expand on.
    for (const s of SECTIONS) {
      const options = TRAIT_POOLS[s].explicit;
      const blanks = options.filter(o => o.includes("____")).length;
      const filled = options.length - blanks;
      expect(blanks).toBeGreaterThanOrEqual(Math.ceil(options.length / 2));
      expect(filled).toBeGreaterThanOrEqual(Math.floor(options.length / 4));
    }
  });

  it("no em or en dashes anywhere -- this text lands in the writer's files", () => {
    const everything = SECTIONS
      .flatMap(s => [...TRAIT_POOLS[s].normal, ...TRAIT_POOLS[s].nsfw, ...TRAIT_POOLS[s].explicit])
      .join("");
    expect(everything).not.toMatch(/[–—]/);
  });
});

describe("rollTraitOptions -- tier replacement semantics", () => {
  it("default rolls come from the normal tier only", () => {
    const rolled = rollTraitOptions("want", 4, {}, seededRng());
    expect(rolled).toHaveLength(4);
    for (const o of rolled) expect(TRAIT_POOLS.want.normal).toContain(o);
  });

  it("nsfw REPLACES normal -- never mixes", () => {
    const rolled = rollTraitOptions("want", 4, { nsfw: true }, seededRng());
    for (const o of rolled) {
      expect(TRAIT_POOLS.want.nsfw).toContain(o);
      expect(TRAIT_POOLS.want.normal).not.toContain(o);
    }
  });

  it("explicit REPLACES nsfw when both flags are on", () => {
    const rolled = rollTraitOptions("want", 4, { nsfw: true, explicit: true }, seededRng());
    for (const o of rolled) {
      expect(TRAIT_POOLS.want.explicit).toContain(o);
      expect(TRAIT_POOLS.want.nsfw).not.toContain(o);
    }
  });

  it("explicit without nsfw does nothing (the checkbox is greyed out in the UI)", () => {
    const rolled = rollTraitOptions("want", 4, { explicit: true }, seededRng());
    for (const o of rolled) expect(TRAIT_POOLS.want.normal).toContain(o);
  });
});

describe("rollTraitOptions -- archetype flavor", () => {
  it("flavored options lead the roll for the chosen role", () => {
    const flavor = ARCHETYPE_FLAVOR.comic_relief!.mannerism!;
    const rolled = rollTraitOptions(
      "mannerism", 4, { archetypeId: "comic_relief" }, seededRng(),
    );
    // Flavor fills up to half the slots, drawn FIRST by construction.
    expect(flavor).toContain(rolled[0]);
  });

  it("flavor never applies to the NSFW tiers (writer already opted in role-neutral)", () => {
    const rolled = rollTraitOptions(
      "mannerism", 4, { nsfw: true, archetypeId: "comic_relief" }, seededRng(),
    );
    for (const o of rolled) expect(TRAIT_POOLS.mannerism.nsfw).toContain(o);
  });

  it("unknown archetype ids fall back to the plain pool", () => {
    const rolled = rollTraitOptions("voice", 4, { archetypeId: "not-a-role" }, seededRng());
    for (const o of rolled) expect(TRAIT_POOLS.voice.normal).toContain(o);
  });
});

describe("rollTraitOptions -- no-repeat dealing", () => {
  it("never re-deals excluded options while the pool has enough left", () => {
    const seen = new Set<string>();
    // Page through most of the pool: each roll must be repeat-free.
    const poolSize = TRAIT_POOLS.want.normal.length;
    const rounds = Math.floor((poolSize - 4) / 4);
    for (let round = 0; round < rounds; round++) {
      const rolled = rollTraitOptions("want", 4, { exclude: seen }, seededRng());
      for (const o of rolled) {
        expect(seen.has(o)).toBe(false);
        seen.add(o);
      }
    }
  });

  it("resets the cycle when exclusions leave too little to deal", () => {
    // Exclude everything: the pool has cycled, so the full pool is back.
    const everything = new Set(TRAIT_POOLS.voice.normal);
    const rolled = rollTraitOptions("voice", 4, { exclude: everything }, seededRng());
    expect(rolled).toHaveLength(4);
    for (const o of rolled) expect(TRAIT_POOLS.voice.normal).toContain(o);
  });
});

describe("rollTraitOptions -- mechanics", () => {
  it("is deterministic under an injected rng", () => {
    const a = rollTraitOptions("physical", 4, {}, seededRng());
    const b = rollTraitOptions("physical", 4, {}, seededRng());
    expect(a).toEqual(b);
  });

  it("returns unique options and respects the count", () => {
    const rolled = rollTraitOptions("physical", 6, {}, seededRng());
    expect(rolled).toHaveLength(6);
    expect(new Set(rolled).size).toBe(6);
  });

  it("never mutates the pools", () => {
    const before = [...TRAIT_POOLS.voice.normal];
    rollTraitOptions("voice", 4, {}, seededRng());
    expect(TRAIT_POOLS.voice.normal).toEqual(before);
  });
});
