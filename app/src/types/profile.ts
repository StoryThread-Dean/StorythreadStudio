// types/profile.ts -- TypeScript Types for the Profile System
// =============================================================
// These types mirror the Pydantic models in backend/app/routers/profiles.py.
// Both sides must agree on the data shape -- if you change one, change the other.

import type { Fact } from "../features/codex/api";

// ── Enums / Literals ─────────────────────────────────────────────────────────

/**
 * WHAT KIND OF THING AN ENTRY IS.
 *
 * A string, not a closed list, and that is the whole point. This used to be a
 * union of six, which meant the app could hold exactly six kinds of thing --
 * so a Government, a Faction, a Deity or anything a writer invented on a Tuesday
 * had no editor and rendered an empty page.
 *
 * The kinds a world has are declared in its own `codex/types.json` and read at
 * runtime (see types/sectionRegistry.ts). The type system cannot check a value
 * that only exists in the writer's file, and pretending otherwise is what kept
 * the list closed.
 */
export type ProfileType = string;

/**
 * HOW MUCH a trait shapes the character. Weight, and nothing else.
 *
 * `hidden` used to be a fifth level here, and that was the mistake: it answered
 * a different question. The writer's example is the proof -- a villain avoids
 * hospitals because he watched his parents die in one, which decides where the
 * plot can go (core) and which he would never say out loud (secret). As one
 * scale he could only be one of those, and choosing secret filed the most
 * load-bearing fact about him as the least important thing on the page.
 *
 * Secrecy is `TraitBlock.subtext` now. The two are independent, and the pair is
 * ordinary rather than exotic.
 */
export type ImportanceLevel =
  | "core"           // defining trait, reflected when on stage
  | "present"        // regularly active, surfaces when scene calls for it
  | "background"     // true but rarely foregrounded, used as flavor
  | "contextual";    // only relevant when its specific situation is in play


// ── Core Data Models ─────────────────────────────────────────────────────────

// One trait entry within a trait-block section.
// A block may represent a single trait or a grouped set of related traits.
export interface TraitBlock {
  id: string;                  // UUID used as React key (not stored in Markdown)
  trait: string;               // e.g. "observant, punctual, eloquent"
  description: string;         // Human-written description of the trait
  importance: ImportanceLevel; // WEIGHT: how much this shapes them
  /**
   * WHETHER IT MAY BE SAID OUT LOUD. Independent of weight.
   *
   * True means: AI receives it and uses it at its full weight, and is
   * instructed never to name, quote or reveal it -- it shows only as behaviour,
   * a gesture, a hesitation, something the character avoids. The reader feels
   * the effect without being told the cause.
   *
   * NOT the same as withholding it. Withholding a secret stops the model naming
   * it by stopping the model knowing it, which produces a character who behaves
   * like somebody else entirely.
   */
  subtext?: boolean;
  /**
   * AVAILABILITY: whether the Weave volunteers this trait in an automatic
   * brief, or holds it back until asked. NOT the same question as `subtext`.
   *
   * The conversion used to set `on-request` on every hidden trait, which was a
   * worse trade than the problem: withholding a secret stops the model naming it
   * by stopping the model knowing it. That is undone -- a secret is sent,
   * weighted, and never named.
   *
   * Carried through rather than edited here; nothing in this screen sets it.
   * Absent means the default, which is always.
   */
  ai_scope?: "always" | "on-request" | "never";
  /**
   * WHEN IT IS TRUE: the chapters this trait holds in, as anchors.
   *
   * The third axis, and the one a profile had no way to say. Weight says how
   * much a trait matters, `subtext` says whether it may be spoken, and this
   * says whether it applies here at all -- which a character who CHANGES needs
   * and nothing else provides.
   *
   * The writer's own case: Serena is slight and unremarkable in chapter one
   * and, after her transformation, tall and built like an athlete. Both are
   * true descriptions of her. Neither is true of the book. A profile that can
   * only hold one of them makes the writer choose which half of their
   * protagonist the AI is allowed to know.
   *
   * THREE STATES, and the middle one is the whole point:
   *   undefined   always true. Every trait ever written before this.
   *   ["c-a"]     true in those chapters, and dropped from AI context
   *               everywhere else.
   *   []          true nowhere -- switched off without being deleted.
   *
   * Same shape as an entry's `appears_in` on purpose: it is the same question
   * one level down, so it gets the same answer, the same chapter-level
   * comparison, and the same room to grow scenes later.
   */
  true_in?: string[];
}

// One section of a profile (e.g. "Physical Traits", "Overview")
export interface ProfileSection {
  content: string;           // Plain Markdown text (for non-trait-block sections)
  trait_blocks: TraitBlock[]; // Structured entries (for trait-block sections)
  ai_summary: string;        // Content under the ## AI Summary: subheading
}

// Full structured profile data -- what the backend parses from and writes to Markdown
// Characters come in two templates (v1.0.10). "main" = the full trait-block
// editor for viewpoint characters; "side" = the simplified side/background
// template where every section is a single free-text field and Quick Build
// appends lines. Older files have no kind on disk and load as "main".
export type CharacterKind = "main" | "side";

export interface Profile {
  /**
   * The entry's id, whichever folder it lives in.
   *
   * Called `profile_id` in a profiles/ file and `entity_id` in a codex/ one.
   * The screen uses ONE name for it and profileSource.ts does the mapping --
   * two names for the same thing across one screen is how a load and a save
   * end up pointed at different entries.
   */
  entity_id: string;
  type: ProfileType;
  name: string;
  role: string;              // e.g. "protagonist", "antagonist", "mentor"
  /**
   * M, F, or whatever the writer typed instead.
   *
   * Three choices and a box, rather than a list somebody has to maintain: two
   * cover most books, and the third is the writer's own word for everything
   * else. Stored as free text either way, so the file says what they meant.
   */
  sex?: string;
  /**
   * How old, in the writer's own words.
   *
   * FREE TEXT ON PURPOSE, and this is the field most likely to be "improved"
   * into a number by somebody who has not written fiction. All of these are real
   * answers a novelist gives: "18 months", "18" (years, obviously), "18ish",
   * "approx 30", "Unknown" -- which can mean the character does not know, or the
   * book never says, or the species lives to 155 -- and blank, because it does
   * not matter for this person. A number field refuses five of the six.
   */
  age?: string;
  status: string;            // e.g. "active", "archived"
  tags: string[];
  filename: string;          // e.g. "elara-voss.md"
  sections: Record<string, ProfileSection>;  // keyed by section.key from SECTION_CONFIGS
  full_ai_summary: string;   // The # Full AI Summary section at the bottom of the file
  created_at: string;        // ISO datetime string
  updated_at: string;
  character_kind?: CharacterKind;  // characters only; absent/main for non-characters
  /**
   * The character's Enneagram type, as an OPTION ID ("e1"), never a label.
   *
   * An id survives a relabelling and a label does not: "1 -- The Reformer" on
   * disk means the next wording change silently orphans every profile that
   * used it.
   *
   * Absent means not set, which is where every profile ever written already is
   * and stays. See docs/character-spine-spec.md section 5 -- and note that no
   * facet SELECTION is stored: the sentences are text in the Personality
   * section, which is their only master.
   */
  enneagram?: string;
  /**
   * What the file looked like when it was opened (codex/ entries only).
   *
   * Sent back with a save so the backend can refuse one that would overwrite
   * work saved since -- by the writer in another window, or by the Weave
   * recording a connection. Absent means "do not check", which is what a
   * profiles/ file has always done.
   */
  revision?: string;
  /**
   * HOW THIS ENTRY CHANGES ACROSS THE BOOK. Codex entries only.
   *
   * Surfaced as its own field rather than left inside `weave` because it is
   * edited on screen now: a fact with a chapter attached is what lets the app
   * say who somebody was in chapter seven. A profiles/ file has no Run in its
   * format at all, so this is undefined there and the editor says why.
   *
   * Uses the Weave's own Fact type rather than re-declaring its fields, since a
   * shape written down twice is a shape that drifts -- which this recovery has
   * now found five times.
   */
  run?: Fact[];
  /** Which chapters this entry appears in -- anchors, the writer's own
   *  statement. Filters what the AI brief carries and greys the map where it
   *  is absent. Empty means "not said", which is treated as everywhere. */
  appears_in?: string[];
  /**
   * What an import left behind, in the writer's words.
   *
   * An entry from another book carries ids that mean nothing here -- its
   * connections, the chapters its facts happen in, whose beliefs they were --
   * so those are dropped. Dropped SILENTLY they would be a quiet loss the writer
   * discovers weeks later; said out loud they are a short list of things to
   * redo. Present only on a freshly imported entry.
   */
  importWarnings?: string[];
  /**
   * Everything the Weave's file format holds that this screen does not edit:
   * aliases, the story's own name for the thing, its connections, and the Run
   * -- the facts that change across the book.
   *
   * Carried through a load and handed straight back on save. Without it, the
   * first time a writer fixed a typo on a character they would lose every
   * connection that character had, and nothing would say so. Never rendered,
   * never edited here; see profileSource.ts.
   */
  weave?: Record<string, unknown>;
}

// Lightweight profile summary for the left-panel list (no sections loaded)
export interface ProfileListItem {
  filename: string;
  name: string;
  type: ProfileType;
  role: string;
  status: string;
  character_kind?: CharacterKind;
  /**
   * The id a codex/ entry is loaded and deleted by. Absent for a profiles/
   * file, which is addressed by folder and filename -- the reason the source
   * layer exists rather than the screen guessing which one it is holding.
   */
  entity_id?: string;
}


// ── API Payloads ──────────────────────────────────────────────────────────────

export interface CreateProfilePayload {
  folder_path: string;
  type: ProfileType;
  name: string;
  role: string;
  character_kind?: CharacterKind;
}

export interface SaveProfilePayload {
  folder_path: string;
  filename: string;
  profile: Profile;
}

export interface ImportProfilePayload {
  folder_path: string;  // Target project root
  source_path: string;  // Absolute path to the source .md file
}


// SECTION_CONFIGS and PROFILE_TYPE_LABELS USED TO LIVE HERE.
//
// They were a hardcoded mirror of the backend's own list, kept in step by a
// contract test (R2.2a) after they had drifted three times. R2.2b deleted them
// instead: the sections a kind has, and what it is called, come from the world's
// `codex/types.json` at runtime -- see types/sectionRegistry.ts.
//
// That is what gave the six kinds with no editor a real one, and it is why a
// kind a writer invents this afternoon works without a release.
//
// SectionConfig itself moved to sectionRegistry.ts, beside the code that builds
// it.

// Human-readable labels for each importance level, used in the dropdown
export const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
  core:        "Core -- defining trait, always reflected when on stage",
  present:     "Present -- regularly active, surfaces when scene calls for it",
  background:  "Background -- true but rarely foregrounded, used as flavor",
  contextual:  "Contextual -- only when its specific situation is in play",
};

/** The other axis, in the words the screen uses for it. */
export const SUBTEXT_LABEL =
  "Shows, never named -- AI uses it, and never says it";

/**
 * What a writer needs to know about the pair, in one sentence each.
 *
 * Kept beside the labels because the commonest confusion is thinking secrecy is
 * a low weight: it is not, and a secret at Core is the ordinary case.
 */
export const SUBTEXT_HELP = {
  on: "AI is told this and lets it drive behaviour, and is forbidden from "
    + "naming or hinting at it in prose. Its weight above still decides how "
    + "much it shapes a scene.",
  off: "AI may refer to this openly, like anything else on the page.",
};
