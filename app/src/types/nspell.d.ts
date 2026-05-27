// types/nspell.d.ts -- Minimal type declaration for the `nspell` package
// =======================================================================
// nspell ships no TypeScript types and there is no @types/nspell pinned in
// this project, so we declare just the slice of its API we actually use.
// nspell is the Hunspell-compatible spell checker that powers the editor's
// right-click correction suggestions (see utils/spellcheck.ts).

declare module "nspell" {
  interface NSpell {
    // Returns true if the word is spelled correctly per the loaded dictionary.
    correct(word: string): boolean;
    // Returns an ordered list of suggested corrections (best first).
    suggest(word: string): string[];
    // Adds a word to the runtime dictionary (used for a personal word list).
    add(word: string): NSpell;
  }

  // nspell accepts the affix + dictionary data as strings (what Vite's ?raw
  // import gives us) or as a {aff, dic} object.
  function nspell(aff: string, dic: string): NSpell;
  function nspell(dictionary: { aff: string; dic: string }): NSpell;

  export default nspell;
}
