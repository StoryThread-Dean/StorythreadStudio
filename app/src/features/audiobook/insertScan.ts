// features/audiobook/insertScan.ts
// =================================
// The Guided Insert Walkthrough's scanner (spec 18.4): walk the
// narration text and find every spot where a marker insert could
// improve the narration -- the small intentional beats a human reader
// adds that Kokoro does not ("From Ruins to Relics. I read it. The
// Cambodia chapter. My god! That tomb door."), plus malformed markers
// the parser can only warn about.
//
// Pure functions over the editor BUFFER: the walkthrough works on live
// text, applies edits exactly like typing, and manual save still owns
// persistence. Every rule is individually muteable in the panel.

import { HETERONYMS } from "./heteronyms";
import type { HeteronymReading } from "./heteronyms";

export type StopKind =
  | "dialogue-open"     // narration hands off to a quoted speech
  | "dialogue-close"    // a speech ends and narration resumes
  | "short-burst"       // consecutive clipped sentences (beat candidates)
  | "interjection"      // a short exclamation ("My god!")
  | "broken-marker"     // a marker the parser would reject or misread
  | "heteronym"         // a word whose spelling does not fix its sound
  | "heteronym-rare";   // ...where the wrong reading is unlikely in fiction

export interface InsertOption {
  label: string;
  /** The exact text to place at the stop ("" = remove what's there). */
  text: string;
  /** Heteronym stops only: the reading this option chooses, so the panel
   *  can offer it as AUDIO instead of as a respelling. */
  reading?: HeteronymReading;
}

export interface InsertStop {
  /** Where the edit happens (char offset into the narration text). */
  offset: number;
  /** Chars replaced -- 0 for a pure insert, >0 for marker repairs. */
  length: number;
  kind: StopKind;
  title: string;
  /** The plain-terms explanation the panel shows for this stop. */
  detail: string;
  /** Proposals, default first. Heteronym stops deliberately have NO
   *  default: nothing is pre-selected, because only the writer knows
   *  which reading they meant. */
  options: InsertOption[];
  /** Heteronym stops: every reading including the engine's own, so the
   *  panel can offer a Play for each. */
  readings?: HeteronymReading[];
  /** Heteronym stops: the word as the writer capitalized it. */
  word?: string;
}

export const STOP_KIND_LABELS: Record<StopKind, string> = {
  "dialogue-open": "Before dialogue",
  "dialogue-close": "After dialogue",
  "short-burst": "Short-sentence beats",
  "interjection": "Interjections",
  "broken-marker": "Marker problems",
  "heteronym": "Word readings",
  "heteronym-rare": "Rare word senses",
};

/** Kinds muted the moment the walkthrough opens. The rare heteronym
 *  senses are right nearly every time -- "does" the verb vastly
 *  outnumbers "does" the female deer -- so stopping on each one by
 *  default would be a tax the writer pays for a miss they will not hit. */
export const DEFAULT_MUTED_KINDS: StopKind[] = ["heteronym-rare"];

// Priority when two rules fire on (nearly) the same spot -- most
// specific wins. Lower = stronger.
const KIND_PRIORITY: StopKind[] = [
  "broken-marker", "heteronym", "heteronym-rare", "dialogue-open",
  "dialogue-close", "interjection", "short-burst",
];

/** A heteronym stop is about one WORD's sound, not about a pause. It is
 *  never auto-applied (only the writer knows which reading they meant)
 *  and it never competes with a nearby beat suggestion -- the two live on
 *  different axes and both can be right in the same spot. */
export function isHeteronymKind(kind: StopKind): boolean {
  return kind === "heteronym" || kind === "heteronym-rare";
}

/** Which axis a stop lives on. Three different questions get asked at
 *  these stops -- "should a beat go here", "which word did you mean", and
 *  "this marker is broken" -- and two of them landing on the same spot is
 *  not a duplicate. The near-duplicate collapse runs within one axis only,
 *  because a beat suggestion silently eating a marker REPAIR would hide
 *  the one stop that is never optional. */
type StopAxis = "beat" | "reading" | "repair";

export function stopAxis(kind: StopKind): StopAxis {
  if (kind === "broken-marker") return "repair";
  if (isHeteronymKind(kind)) return "reading";
  return "beat";
}

/** Kinds Auto-apply is allowed to touch: plain beats only. Marker
 *  repairs have a direction choice, heteronyms have a meaning choice --
 *  neither is ours to make. */
export function isBeatKind(kind: StopKind): boolean {
  return kind !== "broken-marker" && !isHeteronymKind(kind);
}

const PAUSE_OPTIONS: InsertOption[] = [
  { label: "Pause 0.4s", text: "[pause:0.4]" },
  { label: "Pause 0.8s", text: "[pause:0.8]" },
  { label: "Pause 1.5s", text: "[pause:1.5]" },
];

// A clipped sentence, in characters. Measured against a real 22k-word
// chapter: at 35 this caught ordinary prose ("I don't know their names."
// is 25, "I've thrown books before." is 25) and fired 394 times, one stop
// every 56 words, which is not a walk anyone finishes. The spec always
// said "~25"; the code had drifted well past it.
const SHORT_SENTENCE_MAX = 22;   // chars -- "The Cambodia chapter." is 21
// How many clipped sentences in a row make a BURST. Two short sentences
// back to back is just prose. Three or more is the deliberate rhythm this
// rule exists for -- "From Ruins to Relics. I read it. The Cambodia
// chapter. My god! That tomb door." is five. Requiring a run is what
// separates the writer's intent from their sentence lengths.
const MIN_BURST_RUN = 3;
const NEARBY_MARKER_RADIUS = 14; // an existing pause this close = writer chose

/** Character ranges of complete [marker] tokens -- suggestions never
 * land inside one. */
function markerRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\[[^\]\n]*\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function insideAny(ranges: Array<[number, number]>, pos: number): boolean {
  return ranges.some(([start, end]) => pos > start && pos < end);
}

function hasNearbyPause(text: string, pos: number): boolean {
  const window = text.slice(
    Math.max(0, pos - NEARBY_MARKER_RADIUS), pos + NEARBY_MARKER_RADIUS);
  return /\[(pause|scene-break|chapter-break)/i.test(window);
}

/**
 * How long a sentence is TO THE EAR: marker tokens removed, because none
 * of them are spoken. Two ways this matters, both of them real in a
 * worked chapter:
 *   - a genuinely clipped line carrying a [say:red] override measures 16
 *     characters longer than it sounds, and would miss its own beat;
 *   - a fragment that is nothing BUT markers is not clipped prose at all
 *     and must not extend a burst.
 */
function spokenLength(sentence: string): number {
  return sentence.replace(/\[[^\]\n]*\]/g, "").trim().length;
}

/** Line containing pos starts with "# " (a chapter heading). */
function onHeadingLine(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  return text.startsWith("# ", lineStart);
}

// ── The rules ─────────────────────────────────────────────────────────────────

function scanDialogueTransitions(text: string, stops: InsertStop[]): void {
  // Narration sentence ends, a quote OPENS -- inside one paragraph.
  const open = /([.!?])[ \t]+(?=["“])/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text)) !== null) {
    stops.push({
      offset: match.index + 1, length: 0, kind: "dialogue-open",
      title: "Narration hands off to dialogue",
      detail: "Natural speech does not jump straight from describing the "
        + "scene into a character talking. A short pause lets the reader's "
        + "ear switch speakers.",
      options: PAUSE_OPTIONS,
    });
  }
  // The same hand-off ACROSS a paragraph break used to be offered here
  // too. It no longer is: `paragraph_gap_ms` (550ms by default, set in
  // Audiobook Settings) already puts a real beat at every paragraph
  // boundary, so this rule was asking the writer to hand-place a pause
  // the pipeline inserts for them. Only the SAME-paragraph hand-offs
  // below are left, and those genuinely have nothing covering them:
  // dialogue is detected per PARAGRAPH in the segmenter, so a quote that
  // opens mid-paragraph gets no seam of any kind.
  //
  // A speech CLOSES (.!? then the closing quote) and narration resumes
  // with a capitalized word -- inside one paragraph.
  const close = /[.!?](["”])[ \t]+(?=[A-Z])/g;
  while ((match = close.exec(text)) !== null) {
    stops.push({
      offset: match.index + 2, length: 0, kind: "dialogue-close",
      title: "Narration resumes after a speech",
      detail: "The voice returns from the character to the narrator. A "
        + "short pause marks the exit from the quote.",
      options: PAUSE_OPTIONS,
    });
  }
}

function scanInterjections(text: string, stops: InsertStop[]): void {
  // A short exclamation sentence ("My god!", "No!") -- offer a beat
  // after it so the emphasis lands before the next thought.
  const re = /(^|[.!?]["”]?[ \t]+)([A-Z][^.!?\n[\]]{0,18}!)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (text[end] === '"' || text[end] === "”") continue; // speech-final: dialogue-close covers it
    stops.push({
      offset: end, length: 0, kind: "interjection",
      title: `A beat after "${match[2]}"`,
      detail: "A short exclamation carries more weight with a breath after "
        + "it -- otherwise the engine rolls straight into the next sentence.",
      options: PAUSE_OPTIONS,
    });
  }
}

function scanShortBursts(text: string, stops: InsertStop[]): void {
  // A RUN of clipped sentences is the target: "From Ruins to Relics. I
  // read it. The Cambodia chapter. My god! That tomb door." Every
  // boundary inside the run is a beat candidate; a lone pair of short
  // sentences is not, because that is what ordinary prose looks like.
  //
  // Walked line by line: a rhythm never carries across a paragraph break,
  // and keeping each line self-contained means a run cannot accidentally
  // stitch the end of one paragraph to the start of the next.
  const lineRe = /[^\n]+/g;
  let line: RegExpExecArray | null;
  while ((line = lineRe.exec(text)) !== null) {
    const base = line.index;
    const body = line[0];

    // The line's sentences, each with the boundary that FOLLOWS it. The
    // final sentence has none inside this line, so it can extend a run
    // without being a place to insert.
    const sentences: Array<{ length: number; boundary: number | null }> = [];
    const sentenceEnd = /([.!?])[ \t]+/g;
    let match: RegExpExecArray | null;
    let start = 0;
    while ((match = sentenceEnd.exec(body)) !== null) {
      sentences.push({
        length: spokenLength(body.slice(start, match.index + 1)),
        boundary: base + match.index + 1,
      });
      start = match.index + match[0].length;
    }
    if (start < body.length) {
      sentences.push({
        length: spokenLength(body.slice(start)), boundary: null,
      });
    }

    // Maximal runs of consecutive clipped sentences; a run of MIN_BURST_RUN
    // or more earns beats at every boundary it contains.
    let runStart = 0;
    for (let i = 0; i <= sentences.length; i++) {
      const clipped = i < sentences.length
        && sentences[i].length <= SHORT_SENTENCE_MAX;
      if (clipped) continue;
      if (i - runStart >= MIN_BURST_RUN) {
        for (let j = runStart; j < i - 1; j++) {
          const at = sentences[j].boundary;
          if (at === null) continue;
          stops.push({
            offset: at, length: 0, kind: "short-burst",
            title: "Beat between short sentences",
            detail: `${i - runStart} clipped sentences in a row is usually `
              + "deliberate rhythm on the page. The engine reads them in one "
              + "breath -- a small pause restores the beat a human reader "
              + "would take.",
            options: PAUSE_OPTIONS,
          });
        }
      }
      runStart = i + 1;
    }
  }
}

function scanBrokenMarkers(text: string, stops: InsertStop[]): void {
  // Invalid pace values: [pace:=2] and friends. Valid = signed step
  // (+2 / -1) or a bare 0.5-2.0 multiplier.
  const pace = /\[pace:([^\]\n]*)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = pace.exec(text)) !== null) {
    const value = match[1].trim();
    if (/^[+-]\d+$/.test(value)) continue;
    const asFloat = Number(value);
    if (value !== "" && !value.startsWith("=") && Number.isFinite(asFloat)
        && asFloat >= 0.5 && asFloat <= 2.0) continue;
    const digits = value.match(/\d+/)?.[0] ?? "2";
    stops.push({
      offset: match.index, length: match[0].length, kind: "broken-marker",
      title: `Unreadable pace value "${value}"`,
      detail: "The parser cannot read this pace and plays the span at "
        + "normal speed. Steps need a sign: +2 is two steps faster, -2 "
        + "two steps slower.",
      options: [
        { label: `Fix to [pace:+${digits}]`, text: `[pace:+${digits}]` },
        { label: `Fix to [pace:-${digits}]`, text: `[pace:-${digits}]` },
        { label: "Remove the marker", text: "" },
      ],
    });
  }
  // Unclosed pauses: "[pause:0.4 Lexa." -- the missing ] makes the
  // marker swallow the words after it.
  const pauseOpen = /\[pause:\s*([\d.]+)/gi;
  while ((match = pauseOpen.exec(text)) !== null) {
    const after = match.index + match[0].length;
    if (text[after] === "]") continue;
    stops.push({
      offset: after, length: 0, kind: "broken-marker",
      title: "This pause is missing its closing bracket",
      detail: "Without the ] the marker swallows the words after it and "
        + "the whole thing is ignored with a warning.",
      options: [{ label: "Close the bracket", text: "]" }],
    });
  }
  // Unreadable pause durations: [pause:soon]. The value class excludes
  // "[" so an UNCLOSED pause (handled above) is not double-reported by
  // matching through to the NEXT marker's bracket.
  const pauseBad = /\[pause:\s*([^\][\n]*)\]/gi;
  while ((match = pauseBad.exec(text)) !== null) {
    const value = match[1].trim();
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) continue;
    stops.push({
      offset: match.index, length: match[0].length, kind: "broken-marker",
      title: `Unreadable pause duration "${value}"`,
      detail: "Pauses take seconds, like [pause:0.8]. This one is ignored "
        + "with a warning.",
      options: [
        { label: "Fix to [pause:0.4]", text: "[pause:0.4]" },
        { label: "Fix to [pause:0.8]", text: "[pause:0.8]" },
        { label: "Remove the marker", text: "" },
      ],
    });
  }
}

/** Already inside a [say:...]...[/say] span? Then the writer has settled
 *  this spot and we must not stop on it again. The word itself sits
 *  BETWEEN two marker tokens rather than inside one, so markerRanges
 *  cannot see it -- look back for an unclosed [say: instead. */
function insideSaySpan(text: string, pos: number): boolean {
  const before = text.slice(Math.max(0, pos - 200), pos);
  return before.lastIndexOf("[say:") > before.lastIndexOf("[/say]");
}

function scanHeteronyms(text: string, stops: InsertStop[]): void {
  // One stop per occurrence of a verified heteronym. No guessing which
  // reading is meant -- the engine cannot tell and neither can we, so the
  // walk asks, and the answer arrives as audio (spec 18.6).
  for (const entry of HETERONYMS) {
    const escaped = entry.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9'’])${escaped}(?![A-Za-z0-9'’])`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (insideSaySpan(text, match.index)) continue;
      const found = match[0];              // the writer's own capitalization
      const engineReading = entry.readings.find(r => r.spoken === null);
      stops.push({
        offset: match.index,
        length: found.length,
        kind: entry.rare ? "heteronym-rare" : "heteronym",
        title: `Which "${found}" is this?`,
        // Say what the SOUND will be, not what the marker does. The
        // writer is being asked a question about their own sentence.
        detail: `The narrator will say "${engineReading?.sounds ?? "one reading"}" `
          + "here unless you choose otherwise. Play them and pick the one "
          + "you meant -- your ear settles this faster than any spelling can.",
        options: entry.readings
          .filter(reading => reading.spoken !== null)
          .map(reading => ({
            label: reading.sense,
            text: `[say:${reading.spoken}]${found}[/say]`,
            reading,
          })),
        readings: entry.readings,
        word: found,
      });
    }
  }
}

// ── The scanner ───────────────────────────────────────────────────────────────

export function scanForStops(text: string, from = 0): InsertStop[] {
  const stops: InsertStop[] = [];
  scanBrokenMarkers(text, stops);
  scanHeteronyms(text, stops);
  scanDialogueTransitions(text, stops);
  scanInterjections(text, stops);
  scanShortBursts(text, stops);

  const ranges = markerRanges(text);
  const filtered = stops.filter(stop => {
    if (stop.offset < from) return false;
    if (onHeadingLine(text, stop.offset)) return false;
    if (stop.kind === "broken-marker") return true;  // targets markers by design
    if (insideAny(ranges, stop.offset)) return false;
    // A heteronym asks about a word, not about a gap: a pause the writer
    // already placed beside it says nothing about which reading they
    // meant, so the nearby-pause suppression must not apply.
    if (isHeteronymKind(stop.kind)) return true;
    if (hasNearbyPause(text, stop.offset)) return false; // the writer already chose
    return true;
  });

  // Order by position; when rules collide on (nearly) the same spot,
  // the most specific explanation wins.
  filtered.sort((a, b) =>
    a.offset - b.offset
    || KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
  const deduped: InsertStop[] = [];
  for (const stop of filtered) {
    // Collision collapse runs WITHIN an axis only -- see stopAxis. A beat
    // landing beside a word-reading question or a marker repair is not a
    // duplicate of it, and dropping either would silently lose a real stop.
    const axis = stopAxis(stop.kind);
    const prev = [...deduped].reverse().find(
      other => stopAxis(other.kind) === axis);
    if (prev && Math.abs(stop.offset - prev.offset) <= 2) continue;
    deduped.push(stop);
  }
  return deduped;
}

/**
 * The sentence containing `offset`, for a preview clip that sounds like
 * the book rather than like a word read off a card. Marker-aware: the "."
 * inside [pause:0.8] is not a sentence ending, and mistaking it for one
 * is exactly the bug that pushed the say popout onto a fixed carrier
 * phrase. Falls back to a generous window when no boundary is found.
 */
export function sentenceAround(
  text: string, offset: number,
): { start: number; end: number } {
  const ranges = markerRanges(text);
  const guarded = (pos: number) => insideAny(ranges, pos);

  let start = 0;
  for (let i = Math.min(offset, text.length) - 1; i > 0; i--) {
    const ch = text[i];
    if (ch === "\n" && text[i - 1] === "\n") { start = i + 1; break; }
    if ((ch === "." || ch === "!" || ch === "?") && !guarded(i)) {
      // Step past the punctuation and any closing quote or space.
      let j = i + 1;
      while (j < text.length && /["”'’\s]/.test(text[j])) j++;
      if (j <= offset) { start = j; break; }
    }
  }

  let end = text.length;
  for (let i = offset; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n" && text[i + 1] === "\n") { end = i; break; }
    if ((ch === "." || ch === "!" || ch === "?") && !guarded(i)) {
      let j = i + 1;
      while (j < text.length && /["”'’]/.test(text[j])) j++;
      end = j;
      break;
    }
  }
  return { start, end: Math.max(end, offset) };
}

/**
 * Auto-apply: every remaining stop's DEFAULT beat in one motion -- the
 * brunt of the listening work, writer-reviewed afterward. Two kinds are
 * deliberately EXCLUDED: a broken [pace:=2] has a direction choice
 * (+2 or -2) only the writer can make, and a heteronym has a MEANING
 * choice -- "read" as past or present -- that no amount of scanning can
 * settle. Both stay manual stops. Returns the new text plus honest
 * counts for the panel.
 */
export function bulkApplyDefaults(
  text: string, stops: InsertStop[],
): { next: string; applied: number; skippedRepairs: number } {
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  let next = text;
  let shift = 0;
  let applied = 0;
  let skippedRepairs = 0;
  for (const stop of ordered) {
    if (!isBeatKind(stop.kind)) {
      skippedRepairs += 1;
      continue;
    }
    const shifted = { ...stop, offset: stop.offset + shift };
    const result = applyStop(next, shifted, stop.options[0]);
    next = result.next;
    shift += result.delta;
    applied += 1;
  }
  return { next, applied, skippedRepairs };
}

/** Apply one option at a stop: spacing handled like the toolbar's inline
 * inserts (add a space only where one is missing; never inject blank
 * lines). Returns the new text, the caret after the edit, and how much
 * later offsets must shift. */
export function applyStop(
  text: string, stop: InsertStop, option: InsertOption,
): { next: string; caret: number; delta: number } {
  const before = text.slice(0, stop.offset);
  const after = text.slice(stop.offset + stop.length);
  let insert = option.text;
  if (stop.length === 0 && insert.startsWith("[")) {
    if (before.length > 0 && !/\s$/.test(before)) insert = " " + insert;
    if (after.length > 0 && !/^[\s.,;:!?]/.test(after)) insert = insert + " ";
  }
  if (stop.length > 0 && insert === "") {
    // Removing a marker: swallow one neighboring space so no double gap.
    if (/\s$/.test(before) && /^\s/.test(after)) {
      return {
        next: before + after.replace(/^[ \t]/, ""),
        caret: before.length,
        delta: -(stop.length + (/^[ \t]/.test(after) ? 1 : 0)),
      };
    }
  }
  const next = before + insert + after;
  return {
    next,
    caret: stop.offset + insert.length,
    delta: insert.length - stop.length,
  };
}
