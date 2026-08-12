// screens/characterTemplate.ts -- moving a character between the two templates
// ============================================================================
// A character has one of two pages:
//
//   MAIN  every trait section is a list of trait BLOCKS, each with its own
//         importance level (core / present / background / contextual / hidden).
//         Six sections of structure, for someone the book follows.
//
//   SIDE  every section is one plain box. Right for the shopkeeper who appears
//         in chapter four, and what Quick Build appends into.
//
// Until now the choice was made once, at creation, and could never be revisited.
// Weaving made it worst of all: it could not send a template at all, so every
// character it created from a name in the prose arrived as a Main -- and a
// book's walk-ons all landed in the Main group with, in the writer's words, "no
// way to move them to side".
//
// So: a converter. Their instruction was "the transition should be relatively
// smooth as its nearly a one-to-one move", and it is, in one direction more than
// the other.
//
// SIDE TO MAIN moves nothing. Both templates keep their words in the same place
// in the file (a section holds prose AND a trait list -- the format has always
// allowed both). The Main page simply also shows the trait list, which is empty.
// The prose stays visible because ProfileSectionEditor shows the box whenever
// there is something in it.
//
// MAIN TO SIDE has one real decision. The Side page has no trait list, so trait
// blocks have to become prose or they would be on disk and invisible -- the
// worst outcome, since the next save would look like it had eaten them. Each
// block becomes one line, "trait -- description", appended under whatever prose
// the section already had.
//
// THE ONE THING THAT IS NOT ONE-TO-ONE, and the reason convertToSide reports
// what it did rather than just doing it: importance. A Side character has no
// importance levels, so `core` and `background` stop being distinguishable --
// which costs nothing, they were only ever weighting. `hidden` is different. A
// hidden trait carries `ai_scope: on-request`, which is the mechanism that
// actually keeps it out of a prompt; dissolved into a plain line it becomes
// ordinary text the AI may use like any other. That is a real change to what
// the writer was promised, so those lines are labelled "Hidden:" and the count
// is handed back for the screen to say out loud BEFORE the writer commits.

import type { Profile, ProfileSection, TraitBlock } from "../types/profile";
import { SECTION_CONFIGS } from "../types/profile";

export interface Conversion {
  profile: Profile;
  /** How many trait blocks became lines of prose. */
  dissolved: number;
  /** How many of those were Hidden, and so lost the thing that withheld them
   *  from AI. Named separately because it is the only lossy part. */
  hidden: number;
  /** Sections whose text was moved somewhere else, and where it went. Empty in
   *  both directions today; carried because the writer's instruction was
   *  explicit about the case ("group it in the Overview section and let the
   *  Writer sort it out manually") and a future section set may need it. */
  moved: string[];
}

/** One trait block as a line a person would write. */
export function traitAsLine(block: TraitBlock): string {
  const trait = block.trait.trim();
  const description = block.description.trim();
  // A hidden trait says so. The word carries what the importance level carried,
  // and it is findable later with a search for it.
  const prefix = block.importance === "hidden" || block.ai_scope === "on-request"
    ? "Hidden: " : "";
  if (trait && description) return `${prefix}${trait} -- ${description}`;
  return prefix + (trait || description);
}

function withText(section: ProfileSection, lines: string[]): ProfileSection {
  const existing = (section.content ?? "").trimEnd();
  const added = lines.filter(Boolean).join("\n");
  return {
    ...section,
    // APPENDED, never replaced. Whatever the writer already typed in the box
    // comes first and is left exactly as it was.
    content: existing && added ? `${existing}\n${added}` : existing || added,
    trait_blocks: [],
  };
}

/**
 * Main -> Side. Trait blocks become lines; nothing is deleted.
 */
export function convertToSide(profile: Profile): Conversion {
  const sections: Profile["sections"] = {};
  let dissolved = 0;
  let hidden = 0;

  for (const [key, section] of Object.entries(profile.sections)) {
    const blocks = section.trait_blocks ?? [];
    if (blocks.length === 0) {
      sections[key] = { ...section, trait_blocks: [] };
      continue;
    }
    dissolved += blocks.length;
    hidden += blocks.filter(
      b => b.importance === "hidden" || b.ai_scope === "on-request").length;
    sections[key] = withText(section, blocks.map(traitAsLine));
  }

  return {
    profile: { ...profile, character_kind: "side", sections },
    dissolved, hidden, moved: [],
  };
}

/**
 * Side -> Main. Nothing moves.
 *
 * The prose stays exactly where it is, in the same section, and the trait list
 * starts empty for the writer to promote lines into at their own pace. Every
 * section the Main page shows is created if the file lacks it, so no part of the
 * page is an uneditable gap.
 */
export function convertToMain(profile: Profile): Conversion {
  const sections: Profile["sections"] = {};
  for (const config of SECTION_CONFIGS.character) {
    const existing = profile.sections[config.key];
    sections[config.key] = existing
      ? { ...existing, trait_blocks: existing.trait_blocks ?? [] }
      : { content: "", trait_blocks: [], ai_summary: "" };
  }
  // Anything the file had that this template does not list is KEPT. A section
  // the writer added by hand is theirs, and dropping it here would delete it on
  // the next save.
  for (const [key, section] of Object.entries(profile.sections)) {
    if (!sections[key]) sections[key] = section;
  }

  return {
    profile: { ...profile, character_kind: "main", sections },
    dissolved: 0, hidden: 0, moved: [],
  };
}

export function convertCharacter(
  profile: Profile, to: "main" | "side",
): Conversion {
  return to === "side" ? convertToSide(profile) : convertToMain(profile);
}
