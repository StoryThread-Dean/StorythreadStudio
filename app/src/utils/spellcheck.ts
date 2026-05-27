// utils/spellcheck.ts -- Dictionary-backed spell checking for the editor
// =======================================================================
// The editor's red squiggle comes from the WebView2 native spell checker,
// but the browser does NOT expose its correction suggestions to JavaScript.
// So when the right-click Thesaurus popover opens on a word, it has no way to
// show spelling fixes from the native checker.
//
// This module fills that gap with `nspell` (a Hunspell-compatible checker)
// loaded from the bundled `dictionary-en` data. It answers two questions for
// the popover:
//   - isMisspelled(word) -> should we show a "Spellcheck" section at all?
//   - suggestCorrections(word) -> what corrections do we list there?
//
// Why import vendored .aff/.dic from src/assets instead of `dictionary-en`?
//   1. dictionary-en's index.js reads the data files with Node's fs module,
//      which does not exist in the WebView.
//   2. Its package.json `exports` only exposes index.js, so Vite refuses to
//      resolve subpath `?raw` imports like "dictionary-en/index.aff?raw".
//   So we vendor the two files into src/assets/dictionary/en/ (see the README
//   there for provenance + how to refresh) and inline them with Vite's `?raw`,
//   which gives plain strings that nspell accepts directly.

import nspell from "nspell";
// ?raw tells Vite to inline the file as a string (typed via vite/client).
// en.dic is ~540 KB, en.aff ~3 KB -- a one-time parse cost on first use.
import affData from "../assets/dictionary/en/en.aff?raw";
import dicData from "../assets/dictionary/en/en.dic?raw";

// Only letters, apostrophes, and internal hyphens are real "words" worth
// spell-checking. This mirrors the word pattern the editor uses when deciding
// whether a right-click target is a word at all, so the two stay consistent.
const WORD_PATTERN = /^[A-Za-z][A-Za-z'-]*$/;

// Lazily-built singleton. Building the speller parses the whole dictionary,
// so we do it once on first use and reuse it for every later lookup rather
// than paying that cost on each right-click.
let speller: ReturnType<typeof nspell> | null = null;

function getSpeller() {
  if (speller === null) {
    speller = nspell(affData, dicData);
  }
  return speller;
}

/**
 * True when the word looks like a real word AND the dictionary rejects it.
 *
 * Non-words (punctuation, numbers, empty strings) return false so the popover
 * never shows a Spellcheck section for something the writer can't "correct."
 */
export function isMisspelled(word: string): boolean {
  if (!WORD_PATTERN.test(word)) return false;
  return !getSpeller().correct(word);
}

/**
 * Ordered correction candidates for a misspelled word, best first.
 *
 * Capped at `max` so the popover stays compact. Returns [] for non-words or
 * when the dictionary has no suggestions (e.g. an invented character name),
 * which the popover treats as "no Spellcheck section to show."
 */
export function suggestCorrections(word: string, max = 6): string[] {
  if (!WORD_PATTERN.test(word)) return [];
  return getSpeller().suggest(word).slice(0, max);
}
