// utils/profileFormat.ts -- Shared Profile Formatting for AI Context
// ===================================================================
// Formats a profile into a readable text block that AI can use as context.
// Used in two places:
//   1. ProfileBuilder.tsx -- for profile chat and generate-full-summary
//   2. App.tsx (ChipPicker) -- when attaching a profile as a context chip
//
// This is the single source of truth for how profiles are represented in AI
// prompts. The raw traits with importance labels are the authoritative source.
// full_ai_summary is intentionally NOT included to avoid double-weighting.

import type { Profile, ProfileType } from "../types/profile";
import { SECTION_CONFIGS } from "../types/profile";


/**
 * Convert a Profile object into a plain-text block suitable for AI context.
 *
 * Includes section headings, trait blocks with importance labels, and text
 * content for non-trait sections (Overview, Notes, etc.). Does NOT include
 * full_ai_summary -- that's a synthesized rephrasing of the same traits
 * and including both would cause the AI to double-weight every detail.
 */
export function formatProfileForAI(p: Profile): string {
  const configs = SECTION_CONFIGS[p.type as ProfileType] ?? [];
  const lines: string[] = [`Profile: ${p.name} (${p.type})`, `Role: ${p.role || "unspecified"}`, ""];

  for (const cfg of configs) {
    const section = p.sections[cfg.key];
    if (!section) continue;

    // Decide if this section has any content worth sending. An empty section
    // still has a configured key but no trait blocks and no text -- we skip
    // those entirely rather than sending a lone heading that burns tokens.
    const hasTraits = cfg.hasTraitBlocks && section.trait_blocks.length > 0;
    const hasText   = !cfg.hasTraitBlocks && section.content && section.content.trim().length > 0;
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
