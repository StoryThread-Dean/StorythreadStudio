// features/audiobook/speakerScan.ts
// ==================================
// Find the dialogue in a passage, locally, instantly, for free.
//
// The Cast walkthrough is built on this rather than on the AI, and that
// order matters. Finding WHERE the dialogue is needs no intelligence at
// all -- it is quotation marks -- and a feature that has to call a model
// before it can show you anything is a feature that can hang, cost
// money, and fail offline. Guessing WHO is speaking is the part that
// benefits from a model, and even that has a decent local heuristic:
// most dialogue in a novel carries its own tag.
//
// So: the walk always works. The AI is an optional pass that fills in
// names the tags do not give, and if it never answers, the writer still
// has every stop in front of them with the cast one click away.

/** One passage of dialogue found in the text. */
export interface SpeakerStop {
  /** Char offsets into the scanned text -- the quoted span itself. */
  start: number;
  end: number;
  /** The quoted words, exactly as they appear. */
  quote: string;
  /** Name found in a dialogue tag next to this line, "" if none. */
  guess: string;
  /** How the guess was found, for the panel to show honestly. */
  guessSource: "tag" | "ai" | "";
  /** Set by the AI pass when it has an opinion (0-1). */
  confidence?: number;
}

// Verbs that mark a dialogue tag. Deliberately narrow: "said" and its
// close relatives carry almost all real tags, and a loose list starts
// attributing lines to whatever noun sits nearby.
const SAID_VERBS =
  "said|asked|replied|answered|whispered|shouted|murmured|muttered|called"
  + "|cried|snapped|breathed|added|admitted|agreed|announced|argued|barked"
  + "|begged|began|complained|conceded|confessed|continued|countered|demanded"
  + "|explained|gasped|growled|hissed|insisted|laughed|managed|mumbled"
  + "|nodded|noted|objected|observed|offered|ordered|promised|protested"
  + "|purred|rasped|remarked|repeated|retorted|roared|sighed|sneered"
  + "|snarled|stammered|suggested|thought|urged|warned|wondered|yelled";

// A name: one to three capitalized words, allowing an internal
// apostrophe or hyphen ("O'Brien", "Mary-Anne", "Elena Vasquez").
const NAME = "[A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*){0,2}";

// "<name> said" and "said <name>", the two shapes a tag takes. Both are
// anchored to the boundary of the quote so a capitalized word elsewhere
// in the sentence cannot be mistaken for the speaker.
const TAG_AFTER = new RegExp(
  `^[\\s,.;:!?-]*(?:${NAME}\\s+(?:${SAID_VERBS})\\b|(?:${SAID_VERBS})\\s+(${NAME})\\b)`,
);
const TAG_AFTER_NAME_FIRST = new RegExp(`^[\\s,.;:!?-]*(${NAME})\\s+(?:${SAID_VERBS})\\b`);
// Only spaces and punctuation may sit between a leading tag and its
// quote -- never a line break. Allowing whitespace generally let the tag
// from the PREVIOUS paragraph attach itself to the next line of
// dialogue, which in an alternating exchange gives every second line the
// wrong speaker (found by test).
const TAG_BEFORE = new RegExp(`(${NAME})\\s+(?:${SAID_VERBS})\\b[ \\t,.:-]*$`);

// Words that look like names at the start of a sentence but never are.
const NOT_A_NAME = new Set([
  "The", "A", "An", "He", "She", "They", "It", "I", "We", "You", "His",
  "Her", "Their", "That", "This", "There", "Then", "But", "And", "So",
  "When", "What", "Why", "How", "Who", "If", "As", "At", "In", "On",
  "One", "Both", "Neither", "Someone", "Nobody", "Everyone",
]);

/** Complete [marker] spans -- a quote already inside a [voice:...] span
 *  is one the writer has answered, and the walk should not ask again. */
function voiceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /\[voice:[^\]]*\][\s\S]*?\[\/voice\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function cleanName(raw: string | undefined): string {
  const name = (raw ?? "").trim().replace(/[\s,.;:]+$/, "");
  if (!name) return "";
  const first = name.split(/\s+/)[0];
  return NOT_A_NAME.has(first) ? "" : name;
}

/**
 * Every quoted passage in `text`, in reading order, with a speaker guess
 * from any dialogue tag beside it.
 *
 * Quotes already wrapped in a [voice:...] span are skipped: the writer
 * has answered those, and re-asking would make the walk feel like it
 * never ends.
 */
export function scanSpeakers(text: string): SpeakerStop[] {
  const answered = voiceSpans(text);
  const stops: SpeakerStop[] = [];

  // Straight and curly pairs. Kept as one alternation so a book that
  // mixes them (most do, after a paste) still scans in one pass.
  const quoteRe = /"[^"\n]{2,}"|“[^”\n]{2,}”/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (answered.some(([from, to]) => start >= from && end <= to)) continue;

    const after = text.slice(end, end + 80);
    const before = text.slice(Math.max(0, start - 80), start);

    let guess = "";
    const afterNameFirst = TAG_AFTER_NAME_FIRST.exec(after);
    if (afterNameFirst) {
      guess = cleanName(afterNameFirst[1]);
    } else {
      const afterVerbFirst = TAG_AFTER.exec(after);
      if (afterVerbFirst) guess = cleanName(afterVerbFirst[1]);
    }
    if (!guess) {
      const beforeTag = TAG_BEFORE.exec(before);
      if (beforeTag) guess = cleanName(beforeTag[1]);
    }

    stops.push({
      start, end, quote: match[0],
      guess, guessSource: guess ? "tag" : "",
    });
  }
  return stops;
}

/**
 * Fold AI proposals into a local scan.
 *
 * The scan owns the STOPS -- where the dialogue is, which is a fact. The
 * AI only fills in names, and only for stops it matched exactly. A
 * proposal that does not line up with a quote the scan found is
 * discarded: the model is allowed an opinion about who speaks, never
 * about where the writer's words begin and end.
 */
export function mergeAiGuesses(
  stops: SpeakerStop[],
  proposals: Array<{ quote: string; speaker: string; confidence: number }>,
): SpeakerStop[] {
  return stops.map(stop => {
    const hit = proposals.find(p => p.quote === stop.quote
      || stop.quote.includes(p.quote) || p.quote.includes(stop.quote));
    if (!hit || !hit.speaker) return stop;
    // A tag in the prose beats a model's guess: the writer wrote the tag.
    if (stop.guessSource === "tag") return { ...stop, confidence: hit.confidence };
    return {
      ...stop, guess: hit.speaker, guessSource: "ai" as const,
      confidence: hit.confidence,
    };
  });
}
