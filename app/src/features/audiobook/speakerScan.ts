// features/audiobook/speakerScan.ts
// ==================================
// Finding the dialogue in a chapter, locally, instantly, for free.
//
// Everything the Cast workbench does rests on this file, and it is all
// plain string work: no network, no model, nothing to wait for. Finding
// WHERE dialogue is needs no intelligence -- it is quotation marks --
// and most lines name their own speaker in a tag the prose already
// carries. The AI is only ever asked about what is left over.
//
// The unit is a PARAGRAPH, not a quotation. "I heard a noise," Alexandra
// said. "I was just checking." is one decision, not two: the same person
// says both halves, and asking twice would double the work of a chatty
// chapter for no choice gained. Assigning wraps each quoted run inside
// the paragraph, so the dialogue tag itself stays with the narrator --
// which is how audiobooks are actually read.

/** One paragraph of the chapter that contains dialogue. */
export interface DialogueStop {
  /** Offsets into the WHOLE narration buffer. */
  start: number;
  end: number;
  /** The paragraph text as it currently stands, markers and all. */
  text: string;
  /** Quoted runs inside it, offsets relative to `text`. */
  quotes: Array<{ start: number; end: number; text: string }>;
  /** Character already assigned here, "" when the narrator reads it. */
  assigned: string;
  /** Suggested speaker, from a dialogue tag or the AI. */
  guess: string;
  guessSource: "tag" | "ai" | "";
  confidence?: number;
}

export interface ChapterRange {
  title: string;
  /** Offsets into the whole buffer, body only (heading excluded). */
  start: number;
  end: number;
}

const SAID_VERBS =
  "said|asked|replied|answered|whispered|shouted|murmured|muttered|called"
  + "|cried|snapped|breathed|added|admitted|agreed|announced|argued|barked"
  + "|begged|began|complained|conceded|confessed|continued|countered|demanded"
  + "|explained|gasped|growled|hissed|insisted|laughed|managed|mumbled"
  + "|noted|objected|observed|offered|ordered|promised|protested|purred"
  + "|rasped|remarked|repeated|retorted|roared|sighed|sneered|snarled"
  + "|stammered|suggested|urged|warned|wondered|yelled";

// One to three capitalized words, allowing an internal apostrophe or
// hyphen: "O'Brien", "Mary-Anne", "Elena Vasquez", "Lara Croft".
const NAME = "[A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*){0,2}";

const TAG_NAME_FIRST = new RegExp(`(${NAME})\\s+(?:${SAID_VERBS})\\b`);
const TAG_VERB_FIRST = new RegExp(`(?:${SAID_VERBS})\\s+(${NAME})\\b`);

// Words that open a sentence looking like a name and never are. "he
// said" is the commonest tag in fiction and names nobody; a scanner that
// offered "He" as a cast member would be worse than one that offered
// nothing.
const NOT_A_NAME = new Set([
  "The", "A", "An", "He", "She", "They", "It", "I", "We", "You", "His",
  "Her", "Their", "That", "This", "There", "Then", "But", "And", "So",
  "When", "What", "Why", "How", "Who", "If", "As", "At", "In", "On",
  "One", "Both", "Neither", "Someone", "Nobody", "Everyone", "Nothing",
]);

const QUOTE_RE = /"[^"\n]{2,}"|“[^”\n]{2,}”/g;
const VOICE_SPAN_RE = /\[voice:([^\]]*)\]([\s\S]*?)\[\/voice\]/gi;

function cleanName(raw: string | undefined): string {
  const name = (raw ?? "").trim().replace(/[\s,.;:]+$/, "");
  if (!name) return "";
  return NOT_A_NAME.has(name.split(/\s+/)[0]) ? "" : name;
}

/** Chapter bodies, by their '# ' headings -- the same split the backend
 *  parser uses, so the workbench and the narrator agree on what a
 *  chapter is. */
export function chapterRanges(content: string): ChapterRange[] {
  const ranges: ChapterRange[] = [];
  const lines = content.split("\n");
  let offset = 0;
  let open: ChapterRange | null = null;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    if (line.startsWith("# ")) {
      if (open) { open.end = offset; ranges.push(open); }
      open = { title: line.slice(2).trim() || "Untitled Chapter",
               start: Math.min(lineEnd + 1, content.length), end: content.length };
    }
    offset = lineEnd + 1;
  }
  if (open) { open.end = content.length; ranges.push(open); }
  if (ranges.length === 0) {
    ranges.push({ title: "Chapter 1", start: 0, end: content.length });
  }
  return ranges;
}

/** Strip voice wrappers from a paragraph, keeping every word. Removing a
 *  marker must never remove prose -- that is the line this whole feature
 *  is not allowed to cross. */
export function stripVoiceSpans(text: string): string {
  return text.replace(VOICE_SPAN_RE, (_all, _name, inner) => inner);
}

/** Every dialogue paragraph in a range of the buffer, in reading order. */
export function scanDialogue(content: string, range: ChapterRange): DialogueStop[] {
  const body = content.slice(range.start, range.end);
  const stops: DialogueStop[] = [];
  let cursor = 0;

  for (const paragraph of body.split("\n\n")) {
    const start = range.start + cursor;
    cursor += paragraph.length + 2;
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Quotes are found on the paragraph WITHOUT its markers, so an
    // already-assigned paragraph still reports the same dialogue.
    const bare = stripVoiceSpans(paragraph);
    QUOTE_RE.lastIndex = 0;
    const quotes: DialogueStop["quotes"] = [];
    let match: RegExpExecArray | null;
    while ((match = QUOTE_RE.exec(bare)) !== null) {
      quotes.push({ start: match.index, end: match.index + match[0].length,
                    text: match[0] });
    }
    if (quotes.length === 0) continue;

    VOICE_SPAN_RE.lastIndex = 0;
    const existing = VOICE_SPAN_RE.exec(paragraph);

    // The tag hunt runs on the words AROUND the quotes in this paragraph
    // only. Looking further would let one paragraph's tag claim the
    // next line, which in an alternating exchange gives every second
    // line the wrong speaker -- confidently, and in the writer's own
    // vocabulary, so it reads as correct until you hear it.
    const outside = quotes.reduce(
      (acc, q, i) => acc + bare.slice(i === 0 ? 0 : quotes[i - 1].end, q.start),
      "") + bare.slice(quotes[quotes.length - 1].end);
    const guess = cleanName(TAG_NAME_FIRST.exec(outside)?.[1])
      || cleanName(TAG_VERB_FIRST.exec(outside)?.[1]);

    stops.push({
      start, end: start + paragraph.length, text: paragraph, quotes,
      assigned: existing ? (existing[1] ?? "").trim() : "",
      guess, guessSource: guess ? "tag" : "",
    });
  }
  return stops;
}

/**
 * Set (or clear) the speaker of one paragraph, returning the new buffer.
 *
 * Always rebuilt from the STRIPPED paragraph, so clicking through three
 * characters in a row cannot nest or double up markers -- the last click
 * is simply what the paragraph says.
 */
export function setStopVoice(content: string, stop: DialogueStop,
                             name: string | null): string {
  const bare = stripVoiceSpans(stop.text);
  let next = bare;
  if (name) {
    QUOTE_RE.lastIndex = 0;
    const spans: Array<[number, number]> = [];
    let match: RegExpExecArray | null;
    while ((match = QUOTE_RE.exec(bare)) !== null) {
      spans.push([match.index, match.index + match[0].length]);
    }
    // Right to left so each splice leaves the earlier offsets valid.
    for (const [from, to] of spans.reverse()) {
      next = next.slice(0, from) + `[voice:${name}]` + next.slice(from, to)
        + "[/voice]" + next.slice(to);
    }
  }
  return content.slice(0, stop.start) + next + content.slice(stop.end);
}

/** Names this chapter actually uses: already-marked speakers first, then
 *  anyone the prose names in a dialogue tag. This is what makes a
 *  thirty-character book show three buttons -- and what keeps the AI
 *  prompt from offering names that are not in the scene. */
export function chapterCast(content: string, range: ChapterRange): string[] {
  const found: string[] = [];
  const add = (name: string) => {
    if (name && !found.some(n => n.toLowerCase() === name.toLowerCase())) {
      found.push(name);
    }
  };
  const body = content.slice(range.start, range.end);
  VOICE_SPAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VOICE_SPAN_RE.exec(body)) !== null) add((match[1] ?? "").trim());
  for (const stop of scanDialogue(content, range)) add(stop.guess);
  return found;
}

/**
 * Every name the book's dialogue tags speak for, book-wide, in first-use
 * order -- the pool the cast panel offers.
 *
 * People who SPEAK, not people who are mentioned: the pool comes from
 * dialogue tags, which is why "the Librarian said" is found and why a
 * name that only ever appears in description is not. A cast list padded
 * with everyone the book names would be worse than no list at all.
 */
export function detectSpeakerNames(content: string): string[] {
  const found: string[] = [];
  for (const range of chapterRanges(content)) {
    for (const stop of scanDialogue(content, range)) {
      const name = stop.guess;
      if (name && !found.some(n => n.toLowerCase() === name.toLowerCase())) {
        found.push(name);
      }
    }
    // Names already marked count too: a hand-typed [voice:Lexi] is the
    // writer telling us Lexi speaks.
    VOICE_SPAN_RE.lastIndex = 0;
    const body = content.slice(range.start, range.end);
    let match: RegExpExecArray | null;
    while ((match = VOICE_SPAN_RE.exec(body)) !== null) {
      const name = (match[1] ?? "").trim();
      if (name && !found.some(n => n.toLowerCase() === name.toLowerCase())) {
        found.push(name);
      }
    }
  }
  return found;
}

/** Where a character is used across the WHOLE book, for the removal
 *  warning: how many lines, and which chapters. */
export function countCharacterUsage(content: string, name: string): {
  lines: number; chapters: string[];
} {
  const wanted = name.trim().toLowerCase();
  let lines = 0;
  const chapters: string[] = [];
  for (const range of chapterRanges(content)) {
    const body = content.slice(range.start, range.end);
    VOICE_SPAN_RE.lastIndex = 0;
    let hits = 0;
    let match: RegExpExecArray | null;
    while ((match = VOICE_SPAN_RE.exec(body)) !== null) {
      if ((match[1] ?? "").trim().toLowerCase() === wanted) hits += 1;
    }
    if (hits > 0) { lines += hits; chapters.push(range.title); }
  }
  return { lines, chapters };
}

/** Remove every one of a character's markers from the book. The quoted
 *  WORDS survive -- those lines simply go back to the narrator. */
export function removeCharacterMarkers(content: string, name: string): string {
  const wanted = name.trim().toLowerCase();
  return content.replace(VOICE_SPAN_RE, (all, spanName, inner) =>
    (String(spanName).trim().toLowerCase() === wanted ? inner : all));
}

/**
 * Fold AI proposals into a local scan.
 *
 * The scan owns the STOPS -- where the dialogue is, which is a fact. The
 * AI only fills in names, and a tag the writer wrote always outranks the
 * model's guess.
 */
export function mergeAiGuesses(
  stops: DialogueStop[],
  proposals: Array<{ quote: string; speaker: string; confidence: number }>,
): DialogueStop[] {
  return stops.map(stop => {
    const hit = proposals.find(p =>
      stop.quotes.some(q => q.text === p.quote
        || q.text.includes(p.quote) || p.quote.includes(q.text)));
    if (!hit || !hit.speaker) return stop;
    if (stop.guessSource === "tag") return { ...stop, confidence: hit.confidence };
    return { ...stop, guess: hit.speaker, guessSource: "ai" as const,
             confidence: hit.confidence };
  });
}
