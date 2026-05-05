// utils/profileFormat.ts -- Shared Profile Formatting for AI Context
// ===================================================================
// Formats a profile into a readable text block that AI can use as context.
// Used in two places:
//   1. ProfileBuilder.tsx -- for profile chat and generate-full-summary
//      (passes no options -> uses LEGACY_INCLUDE = traits + overview + details)
//   2. App.tsx (ChipPicker) -- when attaching a profile as a context chip
//      (passes user-chosen include flags from the chip picker UI)
//
// This is the single source of truth for how profiles are represented in AI
// prompts. The raw traits with importance labels are the authoritative source.

import type { Profile, ProfileType } from "../types/profile";
import { SECTION_CONFIGS } from "../types/profile";


// Which slices of a profile to include when serializing for the AI.
// Maps to the four checkboxes in ChipPicker:
//   summary  -> the synthesized "## AI Summary" block (full_ai_summary field)
//   traits   -> all sections that use trait blocks (Physical, Personality, etc.)
//   overview -> the "overview" section specifically (free-text intro)
//   details  -> all OTHER non-trait prose sections (Notes, Relationships
//               Overview, History, Current Dynamic, Hidden Tensions,
//               Physical Description, Rule or Concept, etc.)
export interface ChipIncludeOptions {
  summary:  boolean;
  traits:   boolean;
  overview: boolean;
  details:  boolean;
}


// Default behavior used by ProfileBuilder code paths (profile chat,
// generate-full-summary): include traits + overview + details, but NOT the
// AI summary. This matches the previous formatter exactly so existing
// calls keep working without any change.
const LEGACY_INCLUDE: ChipIncludeOptions = {
  summary:  false,
  traits:   true,
  overview: true,
  details:  true,
};


/**
 * Convert a Profile object into a plain-text block suitable for AI context.
 *
 * Sections are grouped into four buckets controlled by `include`:
 *   - summary  -> profile.full_ai_summary (the synthesized gist)
 *   - traits   -> sections where hasTraitBlocks=true (importance-labeled)
 *   - overview -> the "overview" section specifically
 *   - details  -> all other non-trait prose sections
 *
 * If a profile has no content for a selected bucket, the bucket is silently
 * skipped (no empty heading sent). If no buckets are selected, only the
 * profile header is emitted, which the writer would not normally do.
 */
export function formatProfileForAI(
  p: Profile,
  include: ChipIncludeOptions = LEGACY_INCLUDE,
): string {
  const configs = SECTION_CONFIGS[p.type as ProfileType] ?? [];
  const lines: string[] = [`Profile: ${p.name} (${p.type})`, `Role: ${p.role || "unspecified"}`, ""];

  // 1. AI Summary first -- when the writer chose to include it, the model
  //    sees the gist before it sees the trait detail. The base prompt tells
  //    the AI to use the summary to orient and the traits to act.
  if (include.summary && p.full_ai_summary && p.full_ai_summary.trim().length > 0) {
    lines.push("## AI Summary");
    lines.push(p.full_ai_summary.trim());
    lines.push("");
  }

  // 2. Walk each configured section and decide whether it goes in based on
  //    its type (trait vs prose) and key (overview vs other prose).
  for (const cfg of configs) {
    const section = p.sections[cfg.key];
    if (!section) continue;

    const isTrait    = cfg.hasTraitBlocks;
    const isOverview = !isTrait && cfg.key === "overview";
    const isDetail   = !isTrait && !isOverview;

    // Bucket gating: skip the section entirely if its bucket is off.
    if (isTrait    && !include.traits)   continue;
    if (isOverview && !include.overview) continue;
    if (isDetail   && !include.details)  continue;

    const hasTraits = isTrait && section.trait_blocks.length > 0;
    const hasText   = !isTrait && section.content && section.content.trim().length > 0;
    if (!hasTraits && !hasText) continue;

    lines.push(`## ${cfg.heading}`);
    if (hasTraits) {
      for (const block of section.trait_blocks) {
        lines.push(`- ${block.trait} [${block.importance}]: ${block.description}`);
      }
    } else if (hasText) {
      lines.push(section.content);
    }
    lines.push("");
  }

  return lines.join("\n");
}


// Default include flags for newly-attached chips. Most writer use cases
// (dialogue checks, voice consistency, continuation drafting) want both
// the orienting gist and the operational trait detail. Overview and
// Details are off by default so light tasks stay token-cheap; the writer
// can opt in when they need richer context.
export const DEFAULT_CHIP_INCLUDE: ChipIncludeOptions = {
  summary:  true,
  traits:   true,
  overview: false,
  details:  false,
};


// Rough character-to-token estimate for the chip picker's running total.
// Most English models settle around 3.5 to 4 chars per token; we use 4 as
// a friendly underestimate so the writer's actual cost is rarely larger
// than the displayed number.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
