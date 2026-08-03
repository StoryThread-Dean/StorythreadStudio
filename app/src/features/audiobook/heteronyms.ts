// features/audiobook/heteronyms.ts
// ================================
// Words whose spelling does not fix their sound (spec 18.6): "read" is
// "reed" or "red", "wound" is "woond" or "wow-nd". The engine picks one
// reading from grammar it only half understands, and the writer has no
// way to find the misses except by listening to the whole book.
//
// EVERY ENTRY HERE IS VERIFIED against the real engine, not guessed.
// `scripts/audition-heteronyms.py` runs espeak-ng -- the exact
// grapheme-to-phoneme step Kokoro uses -- over each sense's own sentence
// and over each respelling, through the same speakable() path a [say]
// marker takes. A word earns a place here only when BOTH hold:
//
//   1. the engine reads one of its senses WRONG in ordinary prose, and
//   2. a respelling exists whose phonemes land on the right sound.
//
// The writer's candidate table (local/kokoro_heteronym_list.md) had 214
// rows; 84 produced a broken payload, 8 were no-ops, and the noun/verb
// stress family (record, object, project, ~54 words) is deferred because
// its only lever -- a capital letter -- makes espeak emit TWO words.
// See spec 18.5 and 18.6 for the full findings.
//
// Phonemes right does not mean audio right: [say:Thee] phonemizes
// correctly and still came back sounding like "neh". The audition kills
// bad rows cheaply; the WRITER'S EAR is the verdict, which is why every
// reading below gets its own Play button in the walkthrough.

export interface HeteronymReading {
  /** Plain-language sense -- the label the writer chooses by. */
  sense: string;
  /** A short phrase showing that sense, so the choice reads at a glance. */
  example: string;
  /** The [say] spoken form, or null for the reading the engine already
   *  produces on its own (that one is the "as written" row -- there is
   *  nothing to apply, so its answer is Skip). */
  spoken: string | null;
  /** What the engine actually says for this reading, in plain letters.
   *  Verified, not described -- this is what the Play button will play. */
  sounds: string;
}

export interface HeteronymEntry {
  word: string;
  /** The wrong reading is unlikely in fiction, so these stops are muted
   *  by default: the engine is right nearly every time and stopping on
   *  each one is a tax. "does" the female deer against "does" the verb
   *  is the clearest case. The writer can switch them on in the panel. */
  rare?: boolean;
  readings: HeteronymReading[];
}

// Ordered roughly by how often the miss bites in fiction.
export const HETERONYMS: HeteronymEntry[] = [
  {
    word: "read",
    readings: [
      { sense: "present tense", example: "I read every evening",
        spoken: null, sounds: "reed" },
      { sense: "past tense", example: "I read it yesterday",
        spoken: "red", sounds: "red" },
    ],
  },
  {
    word: "dove",
    readings: [
      { sense: "the bird", example: "a dove on the sill",
        spoken: null, sounds: "duv" },
      { sense: "past tense of dive", example: "he dove into the water",
        spoken: "dohv", sounds: "dohv" },
    ],
  },
  {
    word: "wound",
    readings: [
      { sense: "an injury", example: "he nursed the wound",
        spoken: null, sounds: "woond" },
      { sense: "past tense of wind", example: "she wound the cord",
        spoken: "wow-nd", sounds: "wownd" },
    ],
  },
  {
    word: "close",
    readings: [
      { sense: "near", example: "stand close to me",
        spoken: null, sounds: "klohss" },
      { sense: "to shut", example: "close the door",
        spoken: "klohz", sounds: "klohz" },
    ],
  },
  {
    word: "lead",
    readings: [
      { sense: "to guide", example: "she will lead the group",
        spoken: null, sounds: "leed" },
      { sense: "the metal", example: "the pipe contains lead",
        spoken: "led", sounds: "led" },
    ],
  },
  {
    word: "bow",
    readings: [
      { sense: "the weapon, or a ribbon", example: "he carried a bow",
        spoken: null, sounds: "boh" },
      { sense: "to bend forward", example: "bow before the queen",
        spoken: "bau", sounds: "bow, rhyming with now" },
    ],
  },
  {
    word: "bowed",
    readings: [
      { sense: "bent forward", example: "he bowed politely",
        spoken: null, sounds: "bowd, rhyming with loud" },
      { sense: "curved out of true", example: "the board was bowed",
        spoken: "bohd", sounds: "bohd" },
    ],
  },
  {
    word: "row",
    readings: [
      { sense: "a line, or to row a boat", example: "a row of windows",
        spoken: null, sounds: "roh" },
      { sense: "an argument", example: "they had a terrible row",
        spoken: "rau", sounds: "row, rhyming with now" },
    ],
  },
  {
    word: "wind",
    readings: [
      { sense: "moving air", example: "the wind off the sea",
        spoken: null, sounds: "wind" },
      { sense: "to twist or turn", example: "wind the clock",
        spoken: "wined", sounds: "wined" },
    ],
  },
  {
    word: "bass",
    readings: [
      { sense: "the low musical range", example: "he played bass",
        spoken: null, sounds: "base" },
      { sense: "the fish", example: "he landed a bass",
        spoken: "bas", sounds: "bass, rhyming with mass" },
    ],
  },
  {
    word: "sow",
    readings: [
      { sense: "to plant seed", example: "they sow the field",
        spoken: null, sounds: "soh" },
      { sense: "a female pig", example: "the sow in the mud",
        spoken: "sau", sounds: "sow, rhyming with now" },
    ],
  },
  {
    word: "aged",
    readings: [
      { sense: "became older", example: "the wine aged well",
        spoken: null, sounds: "ayjd, one syllable" },
      { sense: "elderly", example: "an aged man",
        spoken: "aijid", sounds: "ay-jid, two syllables" },
    ],
  },
  {
    word: "blessed",
    readings: [
      { sense: "past tense", example: "the priest blessed them",
        spoken: null, sounds: "blest, one syllable" },
      { sense: "holy or fortunate", example: "a blessed event",
        spoken: "blessid", sounds: "bless-id, two syllables" },
    ],
  },
  {
    word: "beloved",
    readings: [
      { sense: "a loved person", example: "her beloved returned",
        spoken: null, sounds: "bi-luvd" },
      { sense: "dearly loved (describing)", example: "a beloved author",
        spoken: "beluvvid", sounds: "bi-luv-id" },
    ],
  },
  {
    word: "dogged",
    readings: [
      { sense: "persistent", example: "dogged determination",
        spoken: null, sounds: "dog-id" },
      { sense: "followed persistently", example: "they dogged him",
        spoken: "dogd", sounds: "dogd, one syllable" },
    ],
  },
  {
    word: "moped",
    readings: [
      { sense: "the small motorbike", example: "a moped in the alley",
        spoken: null, sounds: "moh-ped" },
      { sense: "sulked", example: "he moped all day",
        spoken: "mohpt", sounds: "mohpt, one syllable" },
    ],
  },
  // ── Rare senses: muted by default ───────────────────────────────────────────
  {
    word: "does",
    rare: true,
    readings: [
      { sense: "a form of do", example: "she does everything",
        spoken: null, sounds: "duz" },
      { sense: "female deer", example: "two does at the treeline",
        spoken: "dohz", sounds: "dohz" },
    ],
  },
  {
    word: "minute",
    rare: true,
    readings: [
      { sense: "sixty seconds", example: "wait a minute",
        spoken: null, sounds: "min-it" },
      { sense: "extremely small", example: "a minute crack",
        spoken: "mynoot", sounds: "my-noot" },
    ],
  },
  {
    word: "use",
    rare: true,
    readings: [
      { sense: "the noun", example: "it has no use",
        spoken: null, sounds: "yoose" },
      { sense: "the verb", example: "use this tool",
        spoken: "yooz", sounds: "yooz" },
    ],
  },
  {
    word: "live",
    rare: true,
    readings: [
      { sense: "to reside", example: "they live nearby",
        spoken: null, sounds: "liv" },
      { sense: "happening now, or carrying current", example: "the wire is live",
        spoken: "lyve", sounds: "lyve" },
    ],
  },
  {
    word: "axes",
    rare: true,
    readings: [
      { sense: "the chopping tools", example: "axes above the hearth",
        spoken: null, sounds: "aks-iz" },
      { sense: "more than one axis", example: "both axes were labelled",
        spoken: "akseez", sounds: "ak-seez" },
    ],
  },
  {
    word: "sewer",
    rare: true,
    readings: [
      { sense: "the waste pipe", example: "the sewer under the street",
        spoken: null, sounds: "soo-er" },
      { sense: "a person who sews", example: "the sewer bit the thread",
        spoken: "sower", sounds: "soh-er" },
    ],
  },
];

/** Lookup by lowercased word -- the scanner matches case-insensitively so
 *  a sentence-initial "Read" is caught too (the spoken form is lowercase,
 *  which is what the engine wants anyway). */
export const HETERONYMS_BY_WORD: Map<string, HeteronymEntry> = new Map(
  HETERONYMS.map(entry => [entry.word.toLowerCase(), entry]));
