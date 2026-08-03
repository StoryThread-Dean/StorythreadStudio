// The shipped heteronym table's contracts (spec 18.6).
//
// These are not style checks. Every rule below corresponds to a way the
// engine was measured to fail during the audition -- a respelling that
// breaks one of them reaches Kokoro as something other than one word, and
// the writer hears garble instead of the reading they picked. The
// mechanical audition lives in `scripts/audition-heteronyms.py`; this file
// pins the shapes that audition proved matter, so a well-meaning edit to
// the table cannot quietly reintroduce a known failure.

import { describe, expect, it } from "vitest";

import { HETERONYMS, HETERONYMS_BY_WORD } from "./heteronyms";

describe("the heteronym table", () => {
  it("gives every word exactly one reading the engine already produces", () => {
    // That row is the "as written" row: it is what the writer hears today,
    // and it is the thing the alternatives are being compared against. Two
    // of them would mean two different claims about one engine; none would
    // leave the writer with no baseline to judge by.
    for (const entry of HETERONYMS) {
      const engineReadings = entry.readings.filter(r => r.spoken === null);
      expect(engineReadings, `${entry.word} engine-default rows`).toHaveLength(1);
    }
  });

  it("gives every word at least one reading to offer", () => {
    // A word with nothing but the engine's own reading is a stop that asks
    // a question and offers no answer -- pure tax on the writer's time.
    for (const entry of HETERONYMS) {
      const offers = entry.readings.filter(r => r.spoken !== null);
      expect(offers.length, `${entry.word} alternatives`).toBeGreaterThan(0);
    }
  });

  it("never puts a capital inside a respelling", () => {
    // The single biggest failure in the candidate table. speakable() folds
    // caps RUNS but leaves a lone capital standing, and espeak treats a
    // mid-word capital as a word boundary: [say:pruh-Jekt] arrives as
    // "pruh Jekt", two words with two stresses and a gap between them.
    for (const entry of HETERONYMS) {
      for (const reading of entry.readings) {
        if (reading.spoken === null) continue;
        expect(reading.spoken, `${entry.word} / ${reading.sense}`)
          .toBe(reading.spoken.toLowerCase());
      }
    }
  });

  it("avoids the two silent-h spellings the engine says out loud", () => {
    // The vowel-alphabet trick (ah/eh/ih/oh/uh) mostly works, but two
    // shapes were MEASURED to leak a real /h/ phoneme, which the writer
    // hears as a breath in the middle of the word:
    //
    //   "ih" before a consonant -- lihv -> l-I-h-v, wihnd -> w-I-h-n-d.
    //      Leaked on all ten consonants tried; no exceptions found.
    //   "h" between two vowels -- soher -> s-oh-h-er, dahoo -> d-a-h-oo.
    //      Leaked on all five spellings tried.
    //
    // ah/eh/oh/uh before a consonant are usually safe (bohd, dohz, mohpt
    // all clean) but not always -- "rehkord" leaks where "behko" does not.
    // That word-by-word uncertainty is exactly what the audition script
    // exists to settle, so this test pins only the two absolutes.
    const VOWELS = "aeiou";
    for (const entry of HETERONYMS) {
      for (const reading of entry.readings) {
        if (reading.spoken === null) continue;
        const spelled = reading.spoken.replace(/-/g, "");
        for (let i = 1; i < spelled.length - 1; i++) {
          if (spelled[i] !== "h") continue;
          const before = spelled[i - 1];
          const after = spelled[i + 1];
          if (!VOWELS.includes(before)) continue;
          expect(before === "i" && !VOWELS.includes(after),
            `${entry.word}: "${reading.spoken}" has "ih" before "${after}" -- `
            + "the engine pronounces that h").toBe(false);
          expect(VOWELS.includes(after),
            `${entry.word}: "${reading.spoken}" puts h between two vowels -- `
            + "the engine pronounces it").toBe(false);
        }
      }
    }
  });

  it("never uses a character the engine mangles", () => {
    // Underscores, asterisks, quotes, slashes and parentheses each fail a
    // different way (letters spoken separately, symbols read aloud, chunk
    // splits). Respellings are plain letters, hyphens and apostrophes.
    for (const entry of HETERONYMS) {
      for (const reading of entry.readings) {
        if (reading.spoken === null) continue;
        expect(reading.spoken, `${entry.word} / ${reading.sense}`)
          .toMatch(/^[a-z'-]+$/);
      }
    }
  });

  it("describes every reading by sound, in plain words", () => {
    // The writer picks by ear, but they read the row first. "sounds like
    // reed" is graspable; an IPA string is not, and a bare respelling asks
    // them to trust a notation they have no reason to trust.
    for (const entry of HETERONYMS) {
      for (const reading of entry.readings) {
        expect(reading.sense.length, `${entry.word} sense`).toBeGreaterThan(2);
        expect(reading.example.length, `${entry.word} example`).toBeGreaterThan(4);
        expect(reading.sounds.length, `${entry.word} sounds`).toBeGreaterThan(1);
      }
    }
  });

  it("holds no em dashes or en dashes anywhere", () => {
    // The locked product rule: -- is the approved substitute. This text
    // ships to the writer's screen, so it is bound by it too.
    const json = JSON.stringify(HETERONYMS);
    expect(json).not.toMatch(/[—–]/);
  });

  it("lists no word twice", () => {
    const words = HETERONYMS.map(e => e.word.toLowerCase());
    expect(new Set(words).size).toBe(words.length);
  });

  it("indexes every word for the scanner, case-insensitively", () => {
    expect(HETERONYMS_BY_WORD.size).toBe(HETERONYMS.length);
    expect(HETERONYMS_BY_WORD.get("read")?.word).toBe("read");
  });

  it("keeps the words the engine reads correctly OUT of the table", () => {
    // Verified during the audition: espeak distinguishes both senses of
    // these on its own. Stopping on them is a tax the writer pays for a
    // miss that does not happen, and they are the first thing that would
    // make the walk feel like busywork.
    const alreadyCorrect = [
      "tear", "tears", "house", "learned", "abuse", "crooked", "jagged",
      "ragged", "naked", "polish", "mobile", "lives",
    ];
    for (const word of alreadyCorrect) {
      expect(HETERONYMS_BY_WORD.has(word), `${word} should not be shipped`)
        .toBe(false);
    }
  });

  it("keeps the deferred stress family out of the table", () => {
    // record/object/project and the rest need stress moved to the second
    // syllable. The capital that would do it splits the word, so the whole
    // family waits for its own pass rather than shipping half-fixed.
    for (const word of ["record", "object", "project", "present", "separate",
                        "estimate", "desert", "console", "increase"]) {
      expect(HETERONYMS_BY_WORD.has(word), `${word} is deferred`).toBe(false);
    }
  });

  it("marks a rare sense rare rather than dropping it", () => {
    // "does" the female deer is real but vanishingly rare beside "does"
    // the verb. It ships muted, not deleted: the writer with a hunting
    // scene can switch it on.
    expect(HETERONYMS_BY_WORD.get("does")?.rare).toBe(true);
    expect(HETERONYMS_BY_WORD.get("read")?.rare).toBeFalsy();
  });
});
