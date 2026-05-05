// types/profile.ts -- TypeScript Types for the Profile System
// =============================================================
// These types mirror the Pydantic models in backend/app/routers/profiles.py.
// Both sides must agree on the data shape -- if you change one, change the other.

// ── Enums / Literals ─────────────────────────────────────────────────────────

// All profile types supported in Phase 2 MVP
export type ProfileType =
  | "character"
  | "relationship"
  | "location"
  | "lore"
  | "chapter_summary"
  | "scene_summary";

// Importance levels control how the AI weights a trait when it's in context.
// Core = defining trait, always reflected in behavior when on stage.
// Hidden = sent to the AI as influence material, but the AI is instructed
//          NEVER to name or quote it directly. Hidden traits shape subtext:
//          gestures, dialogue choices, what the character avoids. The reader
//          should feel the effect without ever being told the cause.
export type ImportanceLevel =
  | "core"           // defining trait, reflected when on stage
  | "present"        // regularly active, surfaces when scene calls for it
  | "background"     // true but rarely foregrounded, used as flavor
  | "contextual"     // only relevant when its specific situation is in play
  | "hidden";        // never named directly, drives subtext only


// ── Core Data Models ─────────────────────────────────────────────────────────

// One trait entry within a trait-block section.
// A block may represent a single trait or a grouped set of related traits.
export interface TraitBlock {
  id: string;                  // UUID used as React key (not stored in Markdown)
  trait: string;               // e.g. "observant, punctual, eloquent"
  description: string;         // Human-written description of the trait
  importance: ImportanceLevel; // Controls AI visibility and prompt position
}

// One section of a profile (e.g. "Physical Traits", "Overview")
export interface ProfileSection {
  content: string;           // Plain Markdown text (for non-trait-block sections)
  trait_blocks: TraitBlock[]; // Structured entries (for trait-block sections)
  ai_summary: string;        // Content under the ## AI Summary: subheading
}

// Full structured profile data -- what the backend parses from and writes to Markdown
export interface Profile {
  profile_id: string;
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
}

// Lightweight profile summary for the left-panel list (no sections loaded)
export interface ProfileListItem {
  filename: string;
  name: string;
  type: ProfileType;
  role: string;
  status: string;
}


// ── API Payloads ──────────────────────────────────────────────────────────────

export interface CreateProfilePayload {
  folder_path: string;
  type: ProfileType;
  name: string;
  role: string;
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
    { key: "hidden_and_foreshadowing", heading: "Hidden and Foreshadowing Traits", hasTraitBlocks: true  },
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
  hidden:      "Hidden -- never named directly, drives subtext only",
};
