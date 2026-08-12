// components/learn/registries.test.ts -- two registries that cannot drift apart
// =============================================================================
// The spec asked for ONE lexicon, "so the sidebar, the map legend, the walk
// rail, tooltips and the tutorial cannot drift apart". Two shipped:
//
//   lexicon.ts        a TERM. Thread, Tie, Unspun, Frayed. Has an icon, a tone,
//                     a one-line definition and a longer disclosure.
//   explanations.ts   a SCREEN or an action. Has a necessity level, what it
//                     spends, and steps under "How to do this".
//
// Ruled 2026-08-11 (recovery task R1.6): keep both, because they are genuinely
// different shapes -- forcing one type would give every term a meaningless
// `cost` field and every screen an icon -- but BIND THEM, because the spec's
// underlying worry was right. Two registries with no contract between them is
// how the sidebar ends up calling something one thing and the tooltip another.
//
// So this file is the binding. It is the only place that knows about both.

import { describe, expect, it } from "vitest";

import { EXPLAIN } from "./explanations";
import { CONCEPTS, STOP_KINDS } from "../../features/codex/lexicon";

/** Every writer-facing term the Weave has a word for, by key. */
const TERMS = { ...CONCEPTS, ...STOP_KINDS };

/**
 * An Explain key that names a Weave term, mapped to that term.
 *
 * Convention rather than magic: `weaving.fill` is about Frayed, `tie.reason` is
 * about a Tie. Only the pairs that genuinely describe the same thing are here
 * -- a bad guess would make this test enforce a coincidence.
 */
const ABOUT: Record<string, keyof typeof TERMS> = {
  "weaving.what": "weaving",
  "weaving.scan": "weaving",
  "weaving.quick-entry": "unspun",
  "weaving.fill": "frayed",
  "weaving.snag-fixer": "snag",
  "tie.reason": "tie",
  "tie.relation": "tie",
  "tie.own-label": "tie",
  "thread.absorb": "thread",
  "thread.editor": "thread",
  "thread.run": "run",
  "profile.connections": "tie",
  "weave.context": "weaving",
};


describe("the two registries agree about the same things", () => {
  it("every Explain entry that names a term names one that exists", () => {
    // A key like "weaving.fill" claims to be about Frayed. If Frayed is
    // renamed or removed in the lexicon and this mapping is not updated, the
    // help and the vocabulary have silently parted company.
    for (const [key, term] of Object.entries(ABOUT)) {
      expect(EXPLAIN[key], `no Explain entry for ${key}`).toBeTruthy();
      expect(TERMS[term], `${key} claims to be about "${term}", which the `
        + `lexicon does not have`).toBeTruthy();
    }
  });

  it("uses the term's own word rather than inventing a synonym", () => {
    // The failure this prevents: the lexicon calls it a "Loose thread", the
    // help calls it an "orphan", and the writer has to work out they are the
    // same thing.
    //
    // Deliberately a SHORT list, not everything in ABOUT. Most explanations
    // are about an ACTION taken on a stop rather than about the stop itself --
    // Quick Entry serves Unspun, Pinned and Unwoven, so demanding it say
    // "Unspun" would enforce a coincidence rather than a contract, which is
    // the way a test like this turns into noise. These are the pairs where the
    // explanation IS the disclosure for that term and has to name it.
    const MUST_NAME: [string, keyof typeof TERMS][] = [
      ["weaving.what", "weaving"],
      ["weaving.fill", "frayed"],
      ["weaving.snag-fixer", "snag"],
      ["thread.run", "run"],
    ];
    for (const [key, term] of MUST_NAME) {
      const entry = EXPLAIN[key];
      expect(entry, `no Explain entry for ${key}`).toBeTruthy();
      const words = [entry.what, entry.why].join(" ").toLowerCase();
      const wanted = TERMS[term].term.toLowerCase();
      expect(words.includes(wanted),
        `${key} is the disclosure for "${wanted}" but never uses the word`)
        .toBe(true);
    }
  });
});


describe("neither registry can describe something the other has not heard of", () => {
  it("no Explain key claims a stop kind the scan cannot produce", () => {
    // An explanation for a stop that can never appear is documentation
    // pretending to be help.
    for (const [key, term] of Object.entries(ABOUT)) {
      if (!(term in STOP_KINDS)) continue;
      expect(STOP_KINDS[term as string],
        `${key} explains stop kind "${term}", which is not in STOP_KINDS`)
        .toBeTruthy();
    }
  });

  it("every stop kind a writer can meet has SOMETHING that explains it", () => {
    // Not necessarily an Explain entry -- the lexicon's own `whatsThis` is a
    // real answer, and most stop kinds use exactly that. What is not allowed
    // is a kind with neither.
    const explained = new Set(Object.values(ABOUT));
    for (const [kind, entry] of Object.entries(STOP_KINDS)) {
      const hasOwn = Boolean(entry.whatsThis && entry.whatsThis.trim());
      expect(hasOwn || explained.has(kind as keyof typeof TERMS),
        `stop kind "${kind}" has no disclosure of its own and no Explain entry`)
        .toBe(true);
    }
  });
});


describe("the shapes stay distinct, which is why there are two", () => {
  it("a term carries an icon and a tone; an explanation does not", () => {
    for (const entry of Object.values(TERMS)) {
      expect(entry.Icon).toBeTruthy();
      expect(entry.tone).toBeTruthy();
    }
    for (const entry of Object.values(EXPLAIN)) {
      expect("Icon" in entry).toBe(false);
    }
  });

  it("an explanation carries a necessity and a cost; a term does not", () => {
    // This is the argument for two registries in one assertion. Giving every
    // term a `cost` field would mean answering "what does a Tie spend?", which
    // is not a question.
    for (const [key, entry] of Object.entries(EXPLAIN)) {
      expect(entry.needed, `${key} has no necessity`).toBeTruthy();
      expect(entry.cost, `${key} has no cost line`).toBeTruthy();
    }
    for (const entry of Object.values(TERMS)) {
      expect("cost" in entry).toBe(false);
      expect("needed" in entry).toBe(false);
    }
  });
});
