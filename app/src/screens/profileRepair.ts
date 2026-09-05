// screens/profileRepair.ts -- content this page cannot show you
// =============================================================
// The Profile Builder renders from the type REGISTRY: Overview, Physical
// Traits, Personality Traits, Motivations, Voice Notes, Hidden and
// Foreshadowing, Relationships, Notes. That is the right way round -- it is
// how a section added to the registry appears on every existing profile
// without touching a single file.
//
// It has one consequence, and it is the whole reason this module exists: a
// section in the FILE that the registry does not know about is rendered by
// nothing. It sits on disk, it survives every save, and the writer has no way
// to see it, edit it, or suspect it is there. All it takes is a slip in a
// hand-edited heading:
//
//     # Physcial Traits           <- one transposed letter
//     - trait: Hazel Eyes
//       description: "Inherited from her father."
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not "restore missing sections".
// A section absent from a file is the NORMAL state -- empty sections are never
// written to disk, so every profile lacks every section its writer has not
// filled in, and all of them already render as empty fields in the right
// place. Adding them would write meaningless headings into every file a writer
// owns and show a diff on all of them, repairing nothing.
//
// And it never applies anything on its own. A near-miss heading is OFFERED as
// a rename, because that is the repair that keeps a trait list a trait list;
// folding it into Notes is offered beside it, because the guess can be wrong.
// Both write to the editor buffer only, so the writer saves in the usual way
// and can walk away from a repair they did not want.

import type { Profile } from "../types/profile";
import type { SectionConfig } from "../types/sectionRegistry";

/** One section in the file that the form cannot render. */
export interface UnshownSection {
  key: string;
  /** The heading as the file spells it, which is what the writer will
   *  recognise. Falls back to the key when the wire did not carry one. */
  heading: string;
  /** Structured traits, where the parser managed to read them. */
  traitCount: number;
  /** Words of prose, so the writer can tell a stray line from real work. */
  wordCount: number;
  /**
   * The registry section this looks like a misspelling of, when one is close
   * enough to be worth offering. Undefined means no guess -- the heading is
   * simply not one of ours, and Notes is the only offer.
   */
  looksLike?: { key: string; heading: string };
}

const words = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

/** Letters and digits only, lowercased. "Physcial  Traits!" -> "physcialtraits" */
const squash = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Levenshtein distance, iterative and small.
 *
 * Written out rather than pulled in: this is the only place in the app that
 * needs it, and a dependency for thirty lines that runs on eight headings is
 * a dependency to explain forever.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Which registry section a stray heading is probably a misspelling of.
 *
 * CONSERVATIVE ON PURPOSE, because a wrong guess offered confidently is worse
 * than no guess: the writer would click Rename and file their traits under a
 * heading they never meant. So the allowance scales with length and never
 * exceeds two edits -- "Physcial Traits" finds Physical Traits, and "Notes"
 * does not find "Motivations" just because both are short.
 */
export function nearestSection(
  heading: string,
  sections: SectionConfig[],
): { key: string; heading: string } | undefined {
  const target = squash(heading);
  if (!target) return undefined;

  let best: { key: string; heading: string } | undefined;
  let bestDistance = Infinity;

  for (const section of sections) {
    const candidate = squash(section.heading || section.key);
    if (!candidate) continue;
    const gap = distance(target, candidate);
    // One edit for a short heading, two for a longer one. Anything looser
    // starts matching unrelated words.
    const allowed = candidate.length >= 12 ? 2 : 1;
    if (gap <= allowed && gap < bestDistance) {
      bestDistance = gap;
      best = { key: section.key, heading: section.heading || section.key };
    }
  }
  return best;
}

/**
 * Every section in this profile that the form will not render.
 *
 * Empty ones are skipped: an empty stray heading is nothing to repair, and
 * offering it would make the notice appear on profiles where nothing is wrong.
 */
export function findUnshownSections(
  profile: Profile,
  sections: SectionConfig[],
): UnshownSection[] {
  const known = new Set(sections.map(s => s.key));
  const out: UnshownSection[] = [];

  for (const [key, section] of Object.entries(profile.sections ?? {})) {
    if (known.has(key)) continue;
    const traits = section?.trait_blocks?.length ?? 0;
    const prose = words(section?.content ?? "");
    const summary = words(section?.ai_summary ?? "");
    if (!traits && !prose && !summary) continue;
    out.push({
      key,
      heading: section?.heading || key.replace(/_/g, " "),
      traitCount: traits,
      wordCount: prose,
      looksLike: nearestSection(section?.heading || key, sections),
    });
  }
  return out;
}

/**
 * Move a stray section's content into the section it belongs to.
 *
 * NOTHING IS OVERWRITTEN. If the destination already holds something -- which
 * happens when a writer typed into the real Physical Traits as well -- the
 * two are joined, traits appended after traits and prose after prose. Losing
 * either would make this repair the thing that destroyed their work.
 */
export function renameSection(
  profile: Profile,
  fromKey: string,
  toKey: string,
): Profile["sections"] {
  const source = profile.sections?.[fromKey];
  if (!source || fromKey === toKey) return profile.sections;

  const next = { ...profile.sections };
  const target = next[toKey] ?? { content: "", ai_summary: "", trait_blocks: [] };

  next[toKey] = {
    ...target,
    content: [target.content?.trim(), source.content?.trim()]
      .filter(Boolean).join("\n\n"),
    trait_blocks: [...(target.trait_blocks ?? []), ...(source.trait_blocks ?? [])],
    // The destination's own summary wins; a summary written FOR the stray
    // heading describes a section that is about to stop existing.
    ai_summary: target.ai_summary || "",
  };
  delete next[fromKey];
  return next;
}

/**
 * Fold a stray section into Notes, keeping its heading as a label.
 *
 * For the case where the heading is not a near miss of anything -- a writer's
 * own invention, or something an outside tool left behind. The heading is kept
 * in the text because it is the only remaining clue about what the words were
 * for, and losing it would leave an unexplained paragraph in Notes.
 *
 * A trait list becomes text here, which is why this is the SECOND offer and
 * not the first: renaming keeps the structure and this cannot.
 */
export function foldIntoNotes(
  profile: Profile,
  fromKey: string,
  notesKey = "notes",
): Profile["sections"] {
  const source = profile.sections?.[fromKey];
  if (!source || fromKey === notesKey) return profile.sections;

  const next = { ...profile.sections };
  const notes = next[notesKey] ?? { content: "", ai_summary: "", trait_blocks: [] };

  const asText = [
    source.content?.trim(),
    ...(source.trait_blocks ?? []).map(
      block => `- ${block.trait}: ${block.description}`.trim()),
  ].filter(Boolean).join("\n");

  const heading = source.heading || fromKey.replace(/_/g, " ");
  next[notesKey] = {
    ...notes,
    content: [notes.content?.trim(), `**${heading}**`, asText]
      .filter(Boolean).join("\n\n"),
  };
  delete next[fromKey];
  return next;
}
