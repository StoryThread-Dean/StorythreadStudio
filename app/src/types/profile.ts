// types/profile.ts -- TypeScript Types for the Profile System
// =============================================================
// These types mirror the Pydantic models in backend/app/routers/profiles.py.
// Both sides must agree on the data shape -- if you change one, change the other.

import type { Fact } from "../features/codex/api";

// ── Enums / Literals ─────────────────────────────────────────────────────────

// All profile types supported in Phase 2 MVP
export type ProfileType =
  | "character"
  | "relationship"
  | "location"
  | "lore"
  | "chapter_summary"
  | "scene_summary";

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
  status: string;            // e.g. "active", "archived"
  tags: string[];
  filename: string;          // e.g. "elara-voss.md"
  sections: Record<string, ProfileSection>;  // keyed by section.key from SECTION_CONFIGS
  full_ai_summary: string;   // The # Full AI Summary section at the bottom of the file
  created_at: string;        // ISO datetime string
  updated_at: string;
  character_kind?: CharacterKind;  // characters only; absent/main for non-characters
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


// ── Section Config (frontend mirror of backend SECTION_CONFIGS) ───────────────
// Tells the ProfileBuilder form which sections to render for each profile type,
// and whether each section uses trait blocks or plain text.

export interface SectionConfig {
  key: string;              // Matches the key in Profile.sections
  heading: string;          // Displayed as the section title
  hasTraitBlocks: boolean;  // true = render TraitBlock cards; false = render textarea
}

export const SECTION_CONFIGS: Record<ProfileType, SectionConfig[]> = {
  character: [
    { key: "overview",                heading: "Overview",                        hasTraitBlocks: false },
    { key: "physical_traits",          heading: "Physical Traits",                 hasTraitBlocks: true  },
    { key: "personality_traits",       heading: "Personality Traits",              hasTraitBlocks: true  },
    { key: "motivations",              heading: "Motivations",                     hasTraitBlocks: true  },
    { key: "voice_notes",              heading: "Voice Notes",                     hasTraitBlocks: true  },
    // The key must be what the backend derives from the HEADING -- section ids
    // come from headings when a file is read, so a key that disagrees with its
    // own heading points at a section that will never exist.
    { key: "hidden_and_foreshadowing_traits", heading: "Hidden and Foreshadowing Traits", hasTraitBlocks: true  },
    { key: "relationships_overview",   heading: "Relationships Overview",          hasTraitBlocks: false },
    { key: "notes",                    heading: "Notes",                           hasTraitBlocks: false },
  ],
  relationship: [
    { key: "overview",            heading: "Overview",           hasTraitBlocks: false },
    { key: "history",             heading: "History",            hasTraitBlocks: false },
    { key: "current_dynamic",     heading: "Current Dynamic",    hasTraitBlocks: false },
    { key: "hidden_tensions",     heading: "Hidden Tensions",    hasTraitBlocks: false },
    { key: "emotional_direction", heading: "Emotional Direction", hasTraitBlocks: false },
    { key: "notes",               heading: "Notes",              hasTraitBlocks: false },
  ],
  location: [
    { key: "overview",                heading: "Overview",                hasTraitBlocks: false },
    { key: "physical_description",    heading: "Physical Description",    hasTraitBlocks: false },
    { key: "tone_and_atmosphere",     heading: "Tone and Atmosphere",     hasTraitBlocks: false },
    { key: "historical_significance", heading: "Historical Significance", hasTraitBlocks: false },
    { key: "cultural_significance",   heading: "Cultural Significance",   hasTraitBlocks: false },
    { key: "scene_use_notes",         heading: "Scene Use Notes",         hasTraitBlocks: false },
    { key: "notes",                   heading: "Notes",                   hasTraitBlocks: false },
  ],
  lore: [
    { key: "overview",             heading: "Overview",             hasTraitBlocks: false },
    { key: "rule_or_concept",      heading: "Rule or Concept",      hasTraitBlocks: false },
    { key: "what_it_affects",      heading: "What It Affects",      hasTraitBlocks: false },
    { key: "what_characters_know", heading: "What Characters Know", hasTraitBlocks: false },
    { key: "story_relevance",      heading: "Story Relevance",      hasTraitBlocks: false },
    { key: "notes",                heading: "Notes",                hasTraitBlocks: false },
  ],
  // Chapter/scene summary profile types are dormant in the profile builder.
  // Phase 6 moved chapter summaries to plain Markdown files (summaries/chapters/)
  // edited via a standalone CodeMirror view, not via this profile config.
  // The entries below exist only so legacy chapter_summary and scene_summary
  // profile files (if any) still render in the Profile Builder.
  chapter_summary: [
    { key: "overview",          heading: "Chapter Overview",    hasTraitBlocks: false },
    { key: "key_events",        heading: "Key Events",          hasTraitBlocks: false },
    { key: "character_moments", heading: "Character Moments",   hasTraitBlocks: false },
    { key: "notes",             heading: "Notes",               hasTraitBlocks: false },
  ],
  scene_summary: [
    { key: "overview",           heading: "Scene Overview",      hasTraitBlocks: false },
    { key: "characters_present", heading: "Characters Present",  hasTraitBlocks: false },
    { key: "setting",            heading: "Setting",             hasTraitBlocks: false },
    { key: "notes",              heading: "Notes",               hasTraitBlocks: false },
  ],
};

// Human-readable labels for each profile type tab
export const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
  character:       "Characters",
  relationship:    "Relationships",
  location:        "Locations",
  lore:            "Lore",
  chapter_summary: "Chapter Summaries",
  scene_summary:   "Scene Summaries",
};

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
