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
// MAIN TO SIDE dissolves ordinary trait blocks into prose, one line each
// ("trait -- description"), appended under whatever the section already said.
// Weight is what goes: a Side page has no importance levels, and that costs
// nothing real -- weighting is all it was.
//
// A SECRET IS NOT DISSOLVED. It stays a trait block, in the section it was
// already in.
//
// That is a change from the first version, and the reason is the whole point of
// splitting disclosure from weight. Secrecy lives on the trait; a line of prose
// has nowhere to carry it. Flattening a secret would strip the one thing
// stopping the model from writing it out loud -- so the Side page shows its
// plain box AND any secrets the section holds, and the conversion is lossless in
// both directions. A Side character can keep a secret now, which they could not
// before.

import type { Profile, ProfileSection, TraitBlock } from "../types/profile";
import type { SectionConfig } from "../types/sectionRegistry";

export interface Conversion {
  profile: Profile;
  /** How many trait blocks became lines of prose. */
  dissolved: number;
  /** How many secrets were KEPT as traits rather than flattened. Reported so
   *  the screen can say what it did with them, not as a warning: nothing is
   *  lost, and their protection is intact. */
  hidden: number;
  /** Sections whose text was moved somewhere else, and where it went. Empty in
   *  both directions today; carried because the writer's instruction was
   *  explicit about the case ("group it in the Overview section and let the
   *  Writer sort it out manually") and a future section set may need it. */
  moved: string[];
}

/** True when a trait must never be said out loud. */
export function isSecret(block: TraitBlock): boolean {
  // `ai_scope: on-request` is read as a secret too: it is what the old
  // conversion set on hidden traits, so an unconverted file may still say it.
  return Boolean(block.subtext) || block.ai_scope === "on-request";
}

/** One ordinary trait block as a line a person would write. */
export function traitAsLine(block: TraitBlock): string {
  const trait = block.trait.trim();
  const description = block.description.trim();
  if (trait && description) return `${trait} -- ${description}`;
  return trait || description;
}

function withText(section: ProfileSection, lines: string[],
                  keep: TraitBlock[]): ProfileSection {
  const existing = (section.content ?? "").trimEnd();
  const added = lines.filter(Boolean).join("\n");
  return {
    ...section,
    // APPENDED, never replaced. Whatever the writer already typed in the box
    // comes first and is left exactly as it was.
    content: existing && added ? `${existing}\n${added}` : existing || added,
    // The secrets stay structured, in the section they were already in.
    trait_blocks: keep,
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
    const secrets = blocks.filter(isSecret);
    const ordinary = blocks.filter(b => !isSecret(b));
    dissolved += ordinary.length;
    hidden += secrets.length;
    sections[key] = withText(section, ordinary.map(traitAsLine), secrets);
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
export function convertToMain(profile: Profile,
                              characterSections: SectionConfig[]): Conversion {
  const sections: Profile["sections"] = {};
  for (const config of characterSections) {
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
  profile: Profile, to: "main" | "side", characterSections: SectionConfig[],
): Conversion {
  return to === "side"
    ? convertToSide(profile)
    : convertToMain(profile, characterSections);
}
