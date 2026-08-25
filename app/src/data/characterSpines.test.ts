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
  ESSENTIAL_KINDS, FACET_KIND_LABELS, ROLE_CATALOG, ALL_ROLE_NAMES,
  roleOptionByName, ADULT_ROLE_GROUPS, WORK_SAFE_ROLE_CATALOG,
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
      // Case-insensitive since the facet split: the dread is its own sentence
      // now, so it starts with a capital rather than following a semicolon.
      expect(o.summary).toMatch(/[Dd]reads /);
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
    // A role the catalog does not know at all. This used to be "protagonist",
    // which now resolves to hero on purpose: the catalog maps plain role names
    // to archetypes, so a character marked Protagonist gets the Hero default
    // in Quick Build instead of none. Deliberate change, not a regression.
    expect(archetypeIdForRole("Cheesemonger")).toBe("");
  });
});


// ── FACETS: the parts a writer takes or leaves ───────────────────────────────
//
// Spec: docs/character-spine-spec.md section 3.
//
// The report, about picking type 1 for a merchant who only appears in her own
// shop: "'some' of the above can be used, but most of it serves zero purpose
// for this character ... notices the crooked picture frame in any room isn't
// helpful as they only ever appear situationally in their own store."
//
// The content was never the problem. The granularity was.

describe("personality facets", () => {
  it("gives every type facets, and the summary IS them joined", () => {
    // Derived, not authored twice. Authoring both is how a paragraph came to
    // exist that nothing could take apart.
    for (const o of ENNEAGRAM_OPTIONS) {
      expect(o.facets, o.id).toBeTruthy();
      expect(o.summary).toBe((o.facets ?? []).map(f => f.text).join(" "));
    }
  });

  it("splits type 1 the way the report needed it split", () => {
    // THE ACCEPTANCE CASE. Three SEPARATE habits, so "a standard no one agreed
    // to" can be kept while "the crooked picture frame" is dropped. A
    // decomposition that kept behaviour as one facet would read as progress and
    // fail the exact report it was written for.
    const one = ENNEAGRAM_OPTIONS.find(o => o.id === "e1")!;
    const habits = (one.facets ?? []).filter(f => f.kind === "habit");
    expect(habits).toHaveLength(3);
    expect(habits.some(f => /crooked picture frame/.test(f.text))).toBe(true);
    expect(habits.some(f => /standard no one agreed to/.test(f.text))).toBe(true);
    // And the two the writer called good are their own facets, separately
    // takeable -- they were joined by a semicolon before.
    const facets = one.facets ?? [];
    expect(facets.find(f => f.kind === "wants")!.text)
      .toBe("Wants to be good and beyond reproach.");
    expect(facets.find(f => f.kind === "dreads")!.text)
      .toBe("Dreads being corrupt or wrong.");
  });

  it("makes every facet a standalone sentence", () => {
    // A facet is inserted ALONE, so it cannot lean on a sentence above it.
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const f of o.facets ?? []) {
        expect(f.text.trim().endsWith("."), `${f.id}: no full stop`).toBe(true);
        expect(f.text.trim()[0], `${f.id}: does not start with a capital`)
          .toBe(f.text.trim()[0].toUpperCase());
        expect(/^(And|But|Or|So|Then) /.test(f.text.trim()),
               `${f.id}: leans on the sentence before it`).toBe(false);
        // One sentence, one facet: an interior full stop means two.
        expect(f.text.trim().slice(0, -1).includes(". "),
               `${f.id}: is two sentences`).toBe(false);
      }
    }
  });

  it("gives every facet a unique, stable id", () => {
    // Greying keys on these, and tests cite them.
    const all = ENNEAGRAM_OPTIONS.flatMap(o => (o.facets ?? []).map(f => f.id));
    expect(new Set(all).size).toBe(all.length);
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const f of o.facets ?? []) expect(f.id.startsWith(`${o.id}-`)).toBe(true);
    }
  });

  it("keeps the fill-in hook as its own facet, last", () => {
    // It is a prompt to the writer, not a description, so it must be droppable
    // independently of everything else.
    for (const o of ENNEAGRAM_OPTIONS) {
      const facets = o.facets ?? [];
      expect(facets[facets.length - 1].kind).toBe("hook");
      expect(facets.filter(f => f.kind === "hook")).toHaveLength(1);
      expect(facets[facets.length - 1].text).toContain("____");
    }
  });

  it("has exactly one wants, dreads, speech and cracks per type", () => {
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const kind of ["wants", "dreads", "speech", "cracks"] as const) {
        expect((o.facets ?? []).filter(f => f.kind === kind), `${o.id} ${kind}`)
          .toHaveLength(1);
      }
    }
  });

  it("names no invented proper noun in any facet", () => {
    // Same rule as the outline presets, same reason: a model would adopt one as
    // canon and the Weave's scan would raise it as a planned name.
    const allowed = new Set(["Wants", "Dreads", "Holds", "Notices", "Apologizes",
      "Speech", "Under", "This", "Remembers", "Shows", "Keeps", "Reads",
      "Works", "Treats", "Feels", "Curates", "Half", "Watches", "Knows",
      "Rations", "Sees", "Stress", "Is", "Plans", "Retells", "Fills", "Tests",
      "Guards", "Agrees", "Absorbs"]);
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const f of o.facets ?? []) {
        // Any capitalised word that is not sentence-initial is suspect.
        const inner = f.text.trim().slice(1);
        const caps = inner.match(/(?<![.:] )\b[A-Z][a-z]{2,}\b/g) ?? [];
        expect(caps.filter(w => !allowed.has(w)), `${f.id}: ${caps.join(",")}`)
          .toEqual([]);
      }
    }
  });

  it("still bans em dashes in the facets themselves", () => {
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const f of o.facets ?? []) expect(f.text).not.toMatch(/[–—]/);
    }
  });
});

describe("the essentials set", () => {
  it("is what they want, dread and sound like", () => {
    expect(ESSENTIAL_KINDS).toEqual(["wants", "dreads", "speech"]);
  });

  it("resolves to exactly three facets on every type", () => {
    // The fast path has to stay fast, and it has to be the same size whichever
    // type the writer picked.
    for (const o of ENNEAGRAM_OPTIONS) {
      const essential = (o.facets ?? []).filter(f => ESSENTIAL_KINDS.includes(f.kind));
      expect(essential, o.id).toHaveLength(3);
    }
  });

  it("labels every kind for the picker's headings", () => {
    for (const o of ENNEAGRAM_OPTIONS) {
      for (const f of o.facets ?? []) {
        expect(FACET_KIND_LABELS[f.kind], f.kind).toBeTruthy();
      }
    }
  });
});


describe("the role catalog", () => {
  it("contains every role the old frequency-grouped list had", () => {
    // Removing one a writer has already typed would be a silent loss.
    const retired = [
      "Protagonist", "Antagonist", "Love Interest", "Mentor", "Sidekick",
      "Villain", "Best Friend", "Parent Figure", "Anti-hero", "Rival",
      "Confidant", "Comic Relief", "Foil", "Narrator", "Guardian", "Informant",
      "Employer", "Neighbor", "Red Herring", "Unreliable Narrator", "Catalyst",
      "Herald", "Threshold Guardian", "Shapeshifter", "Scapegoat",
      "Greek Chorus", "Wildcard", "Keeper of the Secret",
    ];
    for (const name of retired) {
      expect(ALL_ROLE_NAMES, `${name} was dropped`).toContain(name);
    }
  });

  it("contains the ordinary people a world is full of", () => {
    // The report: "Merchant" was not in the list at all, so the writer typed it
    // by hand. Neither were any of these.
    for (const name of ["Merchant", "Innkeeper", "Healer", "Guard", "Suspect",
                        "Witness", "Teacher", "Priest"]) {
      expect(ALL_ROLE_NAMES, `${name} is still missing`).toContain(name);
    }
  });

  it("makes Saki's three roles all pickable", () => {
    // The acceptance case, from the report.
    for (const name of ["Merchant", "Red Herring", "Everyman"]) {
      expect(ALL_ROLE_NAMES).toContain(name);
    }
  });

  it("leaves no archetype unreachable by name", () => {
    // Every archetype's guidance has to be offered somewhere, or deleting the
    // old Story Role dropdown really did lose content.
    const reachable = new Set(ROLE_CATALOG.flatMap(g => g.options)
      .map(o => o.archetype).filter(Boolean));
    for (const a of ARCHETYPE_OPTIONS) {
      expect(reachable, `${a.id} has no role that offers it`).toContain(a.id);
    }
  });

  it("gives every role help, and never the same name twice", () => {
    for (const group of ROLE_CATALOG) {
      expect(group.group.trim()).not.toBe("");
      for (const o of group.options) {
        expect(o.help.trim(), o.name).not.toBe("");
        expect(o.help.trim().endsWith("."), o.name).toBe(true);
      }
    }
    expect(new Set(ALL_ROLE_NAMES).size).toBe(ALL_ROLE_NAMES.length);
  });

  it("groups by what a writer is looking for, not by how common it is", () => {
    // The old grouping was the cause of the missing roles: a writer knows they
    // need somebody who sells things, not whether that is Popular.
    const groups = ROLE_CATALOG.map(g => g.group);
    for (const dead of ["Popular", "Less Common", "Niche"]) {
      expect(groups).not.toContain(dead);
    }
  });

  it("finds a role by name, case-insensitively", () => {
    expect(roleOptionByName("merchant")?.name).toBe("Merchant");
    expect(roleOptionByName("  Red Herring ")?.name).toBe("Red Herring");
    expect(roleOptionByName("nope")).toBeUndefined();
  });
});


describe("finding an archetype in a multi-role field", () => {
  it("matches a part rather than the whole field", () => {
    // The bug the multi-role change would otherwise have CREATED: this used to
    // compare the entire Role string, so a writer who added a second role
    // silently lost Quick Build's Story Role default.
    expect(archetypeIdForRole("Merchant, Red Herring, Mentor")).toBe("mentor");
    expect(archetypeIdForRole("Merchant, Villain")).toBe("shadow");
  });

  it("reads an archetype off a plain role name too", () => {
    // How the guidance stays reachable now the archetype dropdown is gone.
    expect(archetypeIdForRole("Everyman")).toBe("everyman");
    expect(archetypeIdForRole("Merchant, Everyman")).toBe("everyman");
    expect(archetypeIdForRole("Protagonist")).toBe("hero");
  });

  it("still returns nothing for a field with no archetype in it", () => {
    expect(archetypeIdForRole("Merchant, Innkeeper")).toBe("");
    expect(archetypeIdForRole("")).toBe("");
    expect(archetypeIdForRole(undefined)).toBe("");
  });
});


describe("adult roles", () => {
  it("puts every adult group last, after every ordinary one", () => {
    // Requested explicitly: "at the bottom". A writer working on a
    // general-audience book scrolls past them and reads none of it.
    const groups = ROLE_CATALOG.map(g => g.group);
    const firstAdult = groups.findIndex(g => ADULT_ROLE_GROUPS.has(g));
    expect(firstAdult).toBeGreaterThan(0);
    for (const g of groups.slice(firstAdult)) {
      expect(ADULT_ROLE_GROUPS.has(g), `${g} sits below an adult group`).toBe(true);
    }
  });

  it("escalates rather than arriving all at once", () => {
    // "starting from Mild not safe for work roles to increasingly more
    // hardcore to explicit to graphic/fetish/bdsm/kink roles."
    const adult = ROLE_CATALOG.map(g => g.group).filter(g => ADULT_ROLE_GROUPS.has(g));
    expect(adult).toEqual([
      "Adult: attraction and tension",
      "Adult: explicit",
      "Adult: power exchange",
      "Adult: fetish and taboo",
    ]);
  });

  it("names every one of them so they can be skipped unread", () => {
    // The group label is the whole opt-out. One that did not say what it was
    // would put this content in front of a writer who did not want it.
    for (const g of ADULT_ROLE_GROUPS) expect(g.startsWith("Adult:")).toBe(true);
  });

  it("describes story function, exactly like every other role", () => {
    // These are labels for a character's part in a plot. A help line that
    // described content rather than function would be a different thing in a
    // list that is not for that.
    for (const group of ROLE_CATALOG.filter(g => ADULT_ROLE_GROUPS.has(g.group))) {
      expect(group.options.length).toBeGreaterThan(3);
      for (const o of group.options) {
        expect(o.help.trim().endsWith("."), o.name).toBe(true);
        expect(o.help.length, o.name).toBeLessThan(90);
      }
    }
  });

  it("keeps the consent vocabulary that power exchange actually runs on", () => {
    // Leaving negotiation, safewords and aftercare out is how fiction in this
    // space reads as written by somebody who has not thought about it.
    const names = ROLE_CATALOG
      .find(g => g.group === "Adult: power exchange")!.options.map(o => o.name);
    for (const n of ["Negotiator", "Safeword Keeper", "Aftercare Partner"]) {
      expect(names).toContain(n);
    }
  });

  it("offers a work-safe view of the catalog for later gating", () => {
    // Not used by the picker today -- the ask was present-and-last, not gated.
    // It exists because the app already has a per-project content_mode, so the
    // boundary is worth NAMING rather than rediscovering.
    expect(WORK_SAFE_ROLE_CATALOG.length)
      .toBe(ROLE_CATALOG.length - ADULT_ROLE_GROUPS.size);
    for (const g of WORK_SAFE_ROLE_CATALOG) {
      expect(ADULT_ROLE_GROUPS.has(g.group)).toBe(false);
    }
  });
});
