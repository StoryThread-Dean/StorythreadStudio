// headings.ts -- which sections the outline already has
// ======================================================
// The section dropdown greys out an entry the outline already contains. This
// is how it decides, and the two choices below are the whole design.
//
// THE BUFFER IS THE TRUTH, NOT A RECORD OF WHAT WAS INSERTED. The toolbar
// reads the live document every time the menu opens. So a preset added and
// then undone with Ctrl+Z is immediately available again, a heading the
// writer renamed stops matching, and a section they deleted comes back on the
// list. There is no bookkeeping to fall out of step, because there is no
// bookkeeping -- and the claim the menu makes is "already in your outline",
// which is only honest if it actually looked.
//
// EXACT AFTER NORMALISATION, NEVER SUBSTRING. Substring matching is the
// tempting shortcut and it is a trap: a writer who merges two sections into
// `## Climax and Resolution` would find BOTH Climax and Resolution greyed
// out, with no way to get either back short of renaming their own heading.
// Exact-after-normalisation is predictable and always reversible.

/** `## Heading` lines. Only H2 -- that is the level presets write. */
const H2 = /^##[ \t]+(.+?)[ \t]*$/gm;

/**
 * Reduce a heading to the form two spellings of the same section share.
 *
 * Lower-cased, whitespace collapsed, trailing punctuation dropped, and
 * anything after a ` -- ` suffix removed. That last one is what lets the
 * repeatable presets work: `## Identity -- (name)` and `## Identity -- Vera`
 * are both the Identity section, so a writer can have several without the
 * matcher treating each as a different thing.
 */
export function normaliseHeading(heading: string): string {
  return heading
    .split(" -- ")[0]
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.:;,!?]+$/, "")
    .trim()
    .toLowerCase();
}

/** Every H2 in the document, normalised. */
export function headingsIn(doc: string): Set<string> {
  const found = new Set<string>();
  for (const match of doc.matchAll(H2)) {
    const value = normaliseHeading(match[1]);
    if (value) found.add(value);
  }
  return found;
}

/**
 * Character offset of a heading in the document, or -1.
 *
 * Used to scroll to a section the writer already has, so a disabled menu
 * entry still does something useful instead of just refusing.
 */
export function findHeadingOffset(doc: string, heading: string): number {
  const wanted = normaliseHeading(heading);
  for (const match of doc.matchAll(H2)) {
    if (normaliseHeading(match[1]) === wanted) return match.index ?? -1;
  }
  return -1;
}
