// data/names/fantasyNames.ts -- Fantasy name assembly (12 races)
// ================================================================
// The fantasy half of the Name Generator. Unlike the real-world pools
// (SQLite-backed, finite lists), fantasy names are ASSEMBLED from curated
// per-race components: start + optional middle + ending, so output is
// effectively endless while always sounding like the race -- liquid vowels
// for elves, harsh plosives for orcs, Norse tones for dwarves.
//
// Components are curated by hand (the "hybrid" in the design): random
// assembly gives variety, curated syllables give the phonology a floor.
// Deliberately avoids assembling famous published names -- the component
// sets steer around exact matches.
//
// Everything is deterministic under an injected rng (same contract as
// traitPools.rollTraitOptions) so tests can pin behavior.

export type FantasyGender = "male" | "female";

interface GenderComponents {
  starts: string[];
  mids: string[];
  ends: string[];
  // Optional standalone names dealt whole (~30% of draws when present).
  // Some races name short and blunt -- an orc can just be Grok -- and
  // assembly alone always produces two units.
  solos?: string[];
}

// Surnames are either compounds (first + second: Moon + whisper) or
// standalone epithets ("Nine-Fingers") for races that name by reputation.
type SurnameComponents =
  | { firsts: string[]; seconds: string[] }
  | { epithets: string[] };

export interface FantasyRace {
  id: string;
  label: string;
  given: Record<FantasyGender, GenderComponents>;
  surname: SurnameComponents;
}

export const FANTASY_RACES: FantasyRace[] = [
  {
    id: "wood_elf",
    label: "Wood Elf",
    given: {
      male: {
        starts: ["ael", "thal", "cael", "lor", "gal", "syl", "fen", "ari", "elo", "nim", "cor", "tael", "vae", "ryl"],
        mids: ["a", "e", "ora", "ith", "en", "ael", "ir"],
        ends: ["dir", "las", "ion", "dan", "ras", "orn", "del", "mir", "thas", "wyn"],
      },
      female: {
        starts: ["ael", "syl", "lia", "fae", "ery", "nim", "tha", "ari", "elo", "cael", "mel", "yla", "sera", "iva"],
        mids: ["a", "e", "ie", "ora", "ael", "en", "il"],
        ends: ["wen", "iel", "ara", "anna", "ythe", "ia", "ess", "ona", "ael", "is"],
      },
    },
    surname: {
      firsts: ["Leaf", "Oak", "Willow", "Fern", "Brook", "Thorn", "Green", "Wild", "Dew", "Bark", "Root", "Ivy"],
      seconds: ["whisper", "runner", "song", "shade", "dancer", "heart", "wind", "stride", "gleam", "watcher", "bloom", "step"],
    },
  },
  {
    id: "moon_elf",
    label: "Moon Elf",
    given: {
      male: {
        starts: ["sel", "lun", "cel", "ith", "nael", "syr", "vel", "myr", "esil", "thel", "aris", "quel"],
        mids: ["a", "e", "io", "une", "eth", "il"],
        ends: ["dir", "rian", "thil", "vain", "nor", "dral", "mir", "las", "uin", "ryn"],
      },
      female: {
        starts: ["sel", "lun", "mira", "esta", "cel", "syl", "nae", "ithe", "vela", "lyra", "sere", "ael"],
        mids: ["a", "e", "iu", "une", "eth", "is"],
        ends: ["wen", "riel", "una", "ythe", "elle", "ia", "iss", "ara", "ine", "eth"],
      },
    },
    surname: {
      firsts: ["Moon", "Star", "Night", "Silver", "Dusk", "Frost", "Twilight", "Mist", "Pale", "Gleam", "Winter", "Dream"],
      seconds: ["whisper", "gleam", "veil", "brook", "song", "mantle", "glow", "shard", "weaver", "fall", "beam", "watch"],
    },
  },
  {
    id: "sun_elf",
    label: "Sun Elf",
    given: {
      male: {
        starts: ["sol", "aur", "hel", "val", "cor", "lum", "rad", "auren", "sor", "cal", "dor", "phae"],
        mids: ["a", "e", "io", "ar", "iel", "or"],
        ends: ["ion", "dan", "rion", "ius", "mon", "ric", "dor", "las", "ean", "os"],
      },
      female: {
        starts: ["sol", "aur", "hela", "vala", "cora", "luma", "sera", "aria", "cal", "elia", "sunna", "dawn"],
        mids: ["a", "e", "ie", "ara", "iel", "is"],
        ends: ["ara", "iel", "ina", "elle", "ora", "ia", "isse", "wen", "ene", "ys"],
      },
    },
    surname: {
      firsts: ["Sun", "Gold", "Dawn", "Flame", "Bright", "Amber", "Ray", "Summer", "Radiant", "High", "Glory", "Aurel"],
      seconds: ["crest", "spire", "ward", "blaze", "crown", "mantle", "singer", "rise", "gleam", "field", "brand", "light"],
    },
  },
  {
    id: "high_elf",
    label: "High Elf",
    given: {
      male: {
        starts: ["aran", "eld", "cele", "fin", "thran", "elen", "iri", "gala", "veran", "cael", "tirion", "aeth"],
        mids: ["a", "e", "ion", "ath", "iel", "or", "en"],
        ends: ["dil", "rond", "dor", "thir", "nor", "mar", "wion", "las", "uir", "amar"],
      },
      female: {
        starts: ["aran", "elen", "cele", "fin", "iri", "gala", "vala", "aeth", "sila", "meri", "tinu", "elis"],
        mids: ["a", "e", "iel", "ath", "ien", "or", "il"],
        ends: ["riel", "wen", "odel", "ithe", "anna", "iel", "ara", "iss", "eth", "ien"],
      },
    },
    surname: {
      firsts: ["Star", "Silver", "Ever", "Crystal", "Winter", "Noble", "Eldest", "True", "Spell", "Dawn", "Grey", "Aether"],
      seconds: ["brook", "crown", "light", "spell", "guard", "throne", "petal", "spire", "vale", "wing", "banner", "quill"],
    },
  },
  {
    id: "dark_elf",
    label: "Dark Elf",
    given: {
      male: {
        starts: ["vex", "dra", "zar", "mal", "kri", "ryl", "xil", "vor", "quel", "zek", "nal", "dur'", "vy'"],
        mids: ["az", "ir", "ul", "yx", "ath", "or"],
        ends: ["rax", "dax", "gar", "thil", "oth", "rik", "zt", "van", "dyn", "mor"],
      },
      female: {
        starts: ["vex", "zar", "mal", "nyx", "ryl", "xil", "quel", "vier", "sin", "zes", "dra", "yas'"],
        mids: ["az", "ir", "yn", "yx", "ith", "ur"],
        ends: ["ith", "ara", "yss", "ixa", "une", "eth", "ra", "isse", "yne", "ova"],
      },
    },
    surname: {
      firsts: ["Shadow", "Void", "Night", "Blood", "Gloom", "Dread", "Ash", "Hex", "Spider", "Venom", "Hollow", "Black"],
      seconds: ["bane", "weaver", "thorn", "veil", "fang", "shade", "whisper", "coil", "mark", "spite", "chant", "grasp"],
    },
  },
  {
    id: "orc",
    label: "Orc",
    given: {
      male: {
        starts: ["gro", "thok", "urz", "mog", "karg", "dur", "ska", "bru", "zug", "gha", "krum", "nar"],
        mids: ["g", "z", "ur", "ok", "ag"],
        ends: ["mash", "gash", "tusk", "nak", "rok", "gul", "uk", "thar", "dug", "zag"],
        solos: ["grok", "karz", "throk", "durn", "zag", "mog", "krug", "bork", "skar", "thok", "ruk", "gor", "snag", "drog"],
      },
      female: {
        starts: ["ur", "sha", "gro", "maz", "kur", "bol", "zag", "dra", "hur", "gna", "ska", "mor"],
        mids: ["g", "z", "ur", "ak", "om"],
        ends: ["sha", "ga", "zra", "ka", "ura", "gra", "zha", "ma", "kka", "rga"],
        solos: ["heka", "ular", "loar", "sha", "vosh", "naz", "urka", "zil", "mek", "ruga", "grisz", "okka"],
      },
    },
    surname: {
      firsts: ["Skull", "Bone", "Iron", "Blood", "Rage", "Gut", "Stone", "War", "Fang", "Doom", "Rust", "Grim"],
      seconds: ["crusher", "splitter", "biter", "render", "breaker", "mangler", "chewer", "smasher", "howler", "cleaver", "gouger", "stomper"],
    },
  },
  {
    id: "gnome",
    label: "Gnome",
    given: {
      male: {
        starts: ["fizz", "pip", "bim", "tink", "nib", "zook", "fen", "wob", "snick", "glim", "pock", "dib"],
        mids: ["le", "er", "in", "o", "a"],
        ends: ["wick", "bin", "gle", "kins", "bert", "us", "o", "ple", "dget", "nock"],
      },
      female: {
        starts: ["fizz", "pip", "bree", "tilli", "nissa", "zook", "fenna", "wixi", "glim", "dot", "minni", "tock"],
        mids: ["le", "er", "in", "a", "e"],
        ends: ["bella", "wink", "ina", "ette", "issa", "y", "da", "pins", "belle", "nock"],
      },
    },
    surname: {
      firsts: ["Copper", "Cog", "Fizzle", "Bramble", "Tinker", "Whistle", "Button", "Marble", "Pepper", "Quill", "Spring", "Gimble"],
      seconds: ["spark", "bang", "whistle", "gadget", "bottom", "top", "spring", "snap", "wick", "widget", "fuse", "pocket"],
    },
  },
  {
    id: "hobbit",
    label: "Hobbit / Halfling",
    given: {
      male: {
        starts: ["tob", "wil", "hal", "ned", "pol", "ber", "fal", "mun", "ott", "cor", "dud", "rob"],
        mids: ["li", "de", "ba", "no", "co"],
        ends: ["kin", "to", "der", "bert", "ric", "cott", "by", "doc", "fer", "man"],
      },
      female: {
        starts: ["rosa", "lil", "mari", "dai", "prim", "bell", "tansy", "poppy", "cla", "hatti", "may", "elba"],
        mids: ["li", "de", "an", "et", "o"],
        ends: ["ie", "a", "wyn", "rose", "ina", "y", "belle", "gold", "la", "sy"],
      },
    },
    surname: {
      firsts: ["Under", "Fern", "Apple", "Honey", "Bramble", "Meadow", "Puddle", "Burrow", "Butter", "Hedge", "Clover", "Barley"],
      seconds: ["hill", "bottom", "brook", "field", "foot", "barrel", "thistle", "down", "combe", "garden", "burr", "pipe"],
    },
  },
  {
    id: "dwarf",
    label: "Dwarf",
    // Recurated (user feedback: v1 combos read as gibberish). These
    // components follow the Old Norse / Eddic Dvergatal patterns the whole
    // fantasy-dwarf tradition descends from -- every start+end pair lands
    // on a solid two-beat name: Borin, Thorgrim, Balmund, Kazgar, Thrain;
    // Bryndis, Dagrun, Thorhild, Solveig, Gudrun.
    given: {
      male: {
        starts: ["bor", "thor", "bal", "grom", "har", "stur", "kaz", "mor", "bram", "dag", "orm", "brun", "thra"],
        mids: ["a", "o", "ur", "al"],
        ends: ["in", "din", "dur", "grim", "nar", "mund", "rik", "olf", "gar", "brand", "ain"],
      },
      female: {
        starts: ["bryn", "dag", "thor", "grun", "sig", "ast", "helg", "ing", "sol", "tor", "berg", "gud"],
        mids: ["a", "i", "ur", "el"],
        ends: ["a", "dis", "hild", "run", "veig", "ny", "ga", "borg", "unn", "frid", "gerd"],
      },
    },
    surname: {
      firsts: ["Iron", "Stone", "Gold", "Copper", "Granite", "Steel", "Deep", "Anvil", "Ore", "Flint", "Coal", "Ember"],
      seconds: ["beard", "fist", "helm", "brow", "forge", "hammer", "delver", "shield", "breaker", "hewer", "brand", "axe"],
    },
  },
  {
    id: "goblin",
    label: "Goblin",
    given: {
      male: {
        starts: ["sni", "grub", "zik", "mux", "rat", "ska", "nib", "gri", "splurt", "fli", "yeg", "krik"],
        mids: ["ik", "ug", "az", "ob", "it"],
        ends: ["kit", "zle", "gob", "nik", "git", "zag", "x", "snout", "pin", "wort"],
      },
      female: {
        starts: ["sni", "zik", "mux", "rikka", "ska", "nib", "gri", "fli", "yagga", "krez", "pib", "wix"],
        mids: ["ik", "az", "ug", "et", "il"],
        ends: ["za", "kit", "zi", "ga", "ni", "xa", "tka", "zip", "nit", "sha"],
      },
    },
    surname: {
      epithets: [
        "the Sneak", "the Rat", "Three-Teeth", "Nine-Fingers", "Quickpocket",
        "Mudfoot", "the Weasel", "Halfnose", "Knifegrin", "the Louse",
        "Twitch", "Coincounter", "the Sniff", "Bentback", "Two-Shivs",
        "the Ferret", "Greaselip", "Pocketful", "the Itch", "Onelug",
      ],
    },
  },
  {
    id: "dragonkin",
    label: "Dragonkin",
    given: {
      male: {
        starts: ["sar", "kri", "bala", "zar", "ryn", "xar", "tor", "ner", "vor", "ssath", "mor", "hesk"],
        mids: ["ra", "ss", "ka", "ax", "ur"],
        ends: ["rax", "ssus", "gar", "don", "ith", "moth", "rex", "dros", "khan", "zor"],
      },
      female: {
        starts: ["sar", "ssa", "vyra", "zar", "ryn", "xara", "tia", "nera", "vess", "kava", "myr", "isza"],
        mids: ["ra", "ss", "ki", "ax", "ir"],
        ends: ["ssa", "yra", "ixis", "esh", "ara", "une", "ith", "issa", "era", "yx"],
      },
    },
    surname: {
      firsts: ["Flame", "Ember", "Scale", "Storm", "Cinder", "Brass", "Onyx", "Crimson", "Thunder", "Ash", "Gilded", "Molten"],
      seconds: ["scale", "wing", "claw", "breath", "heart", "maw", "crest", "spine", "fire", "horn", "brand", "gaze"],
    },
  },
  {
    id: "fae",
    label: "Fae / Fairy",
    given: {
      male: {
        starts: ["fli", "glim", "pix", "tha", "bree", "lu", "wick", "moth", "fer", "dew", "sorrel", "twill"],
        mids: ["a", "e", "il", "o", "ari"],
        ends: ["kin", "fell", "pip", "ling", "bright", "wing", "thorn", "puck", "spry", "gale"],
      },
      female: {
        starts: ["fli", "glim", "pixa", "thist", "bree", "lua", "nia", "wisp", "fera", "dova", "seri", "tulle"],
        mids: ["a", "e", "il", "ora", "ie"],
        ends: ["belle", "la", "wing", "ina", "ette", "shine", "dew", "lys", "fey", "mist"],
      },
    },
    surname: {
      firsts: ["Thistle", "Dew", "Gossamer", "Petal", "Glimmer", "Moth", "Cobweb", "Bluebell", "Fog", "Wisp", "Clover", "Sprig"],
      seconds: ["down", "wing", "light", "dance", "dust", "gleam", "shimmer", "veil", "drift", "lace", "hollow", "step"],
    },
  },
];

export function fantasyRaceById(id: string): FantasyRace | undefined {
  return FANTASY_RACES.find(r => r.id === id);
}

const pick = <T,>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

/** Join two components, smoothing the seam: collapse a doubled letter at
 *  the boundary so "thal" + "las" gives "thalas", never "thallas"-with-
 *  triple risk further in, and never a stutter like "aa". */
function joinParts(a: string, b: string): string {
  if (a.length > 0 && b.length > 0 && a[a.length - 1].toLowerCase() === b[0].toLowerCase()) {
    return a + b.slice(1);
  }
  return a + b;
}

/** Collapse any run of 3+ identical letters down to 2 -- LOOPED until
 *  stable, because a single regex pass doesn't rescan what it just wrote:
 *  dragonkin's "vess" + "ss" + "ssa" stacks four esses, and one pass of
 *  sss->ss leaves "Vesssa" still holding a triple. */
function collapseTriples(s: string): string {
  let prev;
  do {
    prev = s;
    s = s.replace(/([a-z])\1\1/gi, "$1$1");
  } while (s !== prev);
  return s;
}

/**
 * Assemble one given name for a race + gender. Deterministic under an
 * injected rng. Shape: start [+ mid ~40% of the time, skipped when it
 * would run long] + end, capitalized.
 */
export function generateFantasyGivenName(
  raceId: string,
  gender: FantasyGender,
  rng: () => number = Math.random,
): string {
  const race = fantasyRaceById(raceId);
  if (!race) return "";
  const parts = race.given[gender];

  // Solo names first (races that have them): ~30% of draws come out whole
  // and short -- Grok, Karz, Heka -- instead of always two assembled units.
  if (parts.solos && parts.solos.length > 0 && rng() < 0.3) {
    const solo = pick(parts.solos, rng);
    return solo.charAt(0).toUpperCase() + solo.slice(1);
  }

  const start = pick(parts.starts, rng);
  const end = pick(parts.ends, rng);
  let name = start;
  if (rng() < 0.4) {
    const mid = pick(parts.mids, rng);
    // Length cap keeps names speakable -- skip the middle when the full
    // assembly would exceed ~12 letters.
    if (start.length + mid.length + end.length <= 12) {
      name = joinParts(name, mid);
    }
  }
  name = joinParts(name, end);
  name = collapseTriples(name);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Assemble one surname/epithet for a race. Deterministic under rng. */
export function generateFantasySurname(
  raceId: string,
  rng: () => number = Math.random,
): string {
  const race = fantasyRaceById(raceId);
  if (!race) return "";
  if ("epithets" in race.surname) {
    return pick(race.surname.epithets, rng);
  }
  const first = pick(race.surname.firsts, rng);
  const second = pick(race.surname.seconds, rng);
  return collapseTriples(joinParts(first, second));
}
