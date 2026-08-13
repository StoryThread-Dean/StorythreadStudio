// types/sectionRegistry.ts -- what sections a kind of entry has, from the world
// =============================================================================
// This replaces a hardcoded table. `SECTION_CONFIGS` in types/profile.ts listed
// the sections for four kinds, and the same list existed twice more in Python.
// Binding them with tests (R2.2a) stopped them drifting; deleting two of the
// three copies is better, and it is what makes the OTHER six kinds work.
//
// A Government, a Faction, a Deity, a Religion, a Creature, a Culture -- and
// anything a writer invents this afternoon -- all have sections declared in the
// world's own types.json. A form built from that table works for every one of
// them without a line of per-kind code. A form built from a hardcoded list works
// for four and renders an empty page for the rest, which is what it did.
//
// THE ONE THING THIS FILE MUST NOT DO is invent a fallback table. A fetch that
// fails must say so, because a silent default would be the fourth copy of the
// list, and the copy nobody remembers to update.

import { useEffect, useState } from "react";

import {
  fetchSections, fetchTypes, type SectionsTree, type TypeEntry,
} from "../features/codex/api";

export interface SectionConfig {
  key: string;              // matches the key in Profile.sections
  heading: string;          // displayed as the section title
  hasTraitBlocks: boolean;  // true = trait cards, false = a text box
  /**
   * Its job is done elsewhere now, so the form hides it unless it already holds
   * something the writer wrote.
   *
   * Retired rather than deleted, because both parsers work from this list: a
   * section removed from it is a section dropped from the file on the next save.
   */
  retired?: boolean;
}

/**
 * A COLOUR PER SECTION, so a writer finds Motivations by its stripe rather than
 * by reading six identical headings.
 *
 * Assigned by POSITION rather than by name, which is what lets it work for the
 * six kinds that had no editor last week and for anything a writer invents this
 * afternoon. The palette is muted on purpose: this is a stripe beside a heading,
 * not a highlighter.
 */
const SECTION_COLOURS = [
  { bar: "bg-sky-500/70", border: "border-sky-700/60" },
  { bar: "bg-emerald-500/70", border: "border-emerald-700/60" },
  { bar: "bg-amber-500/70", border: "border-amber-700/60" },
  { bar: "bg-rose-500/70", border: "border-rose-700/60" },
  { bar: "bg-teal-500/70", border: "border-teal-700/60" },
  { bar: "bg-fuchsia-500/70", border: "border-fuchsia-700/60" },
  { bar: "bg-lime-500/70", border: "border-lime-700/60" },
  { bar: "bg-cyan-500/70", border: "border-cyan-700/60" },
];

/**
 * The one section that is not just another colour.
 *
 * Asked for in these words: "should also be both a different color section
 * entirely and visually look and appear shadowy while still eye catching and
 * functional. I want it to stand out as different while keeping with the theme."
 *
 * So: violet, which is the Weave's colour everywhere else in this app, over a
 * darker ground than its neighbours. It reads as a room with the lights lower
 * rather than as a warning, which is right -- there is nothing wrong with a
 * secret, it is simply not for saying out loud.
 */
export const SHADOWED = {
  bar: "bg-violet-400/80",
  border: "border-violet-700/70",
  panel: "border-violet-900/70 bg-violet-950/30",
};

/** True for the section a kind keeps its secrets in. Matched on the key rather
 *  than hardcoded per kind, so a writer's own "hidden_history" gets it too. */
export function isShadowed(key: string): boolean {
  return key.includes("hidden");
}

/** The stripe and the trait border for one section. */
export function sectionColour(key: string, index: number):
    { bar: string; border: string; panel?: string } {
  if (isShadowed(key)) return SHADOWED;
  return SECTION_COLOURS[index % SECTION_COLOURS.length];
}

export type SectionsByType = Record<string, SectionConfig[]>;

// Words a heading keeps lowercase. Mirrors _SMALL_WORDS in
// backend/app/codex/types_registry.py -- the two only meet when a heading has to
// be rebuilt from a key, which is rare, but "Hidden And Foreshadowing Traits" is
// wrong in both languages.
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the",
  "to", "with",
]);

/**
 * A readable heading from a section key, for the few places that have a key and
 * no registry: `physical_traits` -> `Physical Traits`.
 */
export function headingFromKey(key: string): string {
  return key.split("_").filter(Boolean).map((word, i) =>
    i > 0 && SMALL_WORDS.has(word)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1),
  ).join(" ");
}

/** The registry's types, as the form's section table. */
export function sectionsFromRegistry(types: TypeEntry[]): SectionsByType {
  const out: SectionsByType = {};
  for (const type of types) {
    out[type.id] = (type.sections ?? []).map(section => ({
      key: section.id,
      heading: section.heading || headingFromKey(section.id),
      hasTraitBlocks: Boolean(section.trait_blocks),
      retired: Boolean(section.retired),
    }));
  }
  return out;
}

/** Type id -> the label a writer reads. */
export function labelsFromRegistry(types: TypeEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const type of types) out[type.id] = type.label || type.id;
  return out;
}

/**
 * Which kinds the Profile Builder offers as tabs.
 *
 * THE SIDEBAR'S RULE, not a second one: a section appears when it holds
 * something, or when it is a default. `GET /sections` already applies it, so
 * this reads that answer rather than recomputing it -- which is the difference
 * between "Governments turns up in both screens when you add it" and "the two
 * screens disagree about your world".
 *
 * Filtering on the Profiles group alone would put ten tabs on a page whose main
 * problem is already crowding, including six kinds the writer has never used.
 * The Other group (objects, concepts, events, languages) stays in the Weave's
 * own editor.
 */
export function tabsFromSections(tree: SectionsTree): string[] {
  const profiles = tree.groups.find(group => group.id === "profiles");
  return (profiles?.sections ?? [])
    .filter(section => section.kind === "type")
    .map(section => section.id);
}

export interface TypeRegistryState {
  sections: SectionsByType;
  labels: Record<string, string>;
  tabs: string[];
  loading: boolean;
  /** Set when the world could not be read. The screen says so rather than
   *  rendering an empty form, which would look like an empty project. */
  error: string | null;
}

export function useTypeRegistry(projectPath: string): TypeRegistryState {
  const [state, setState] = useState<TypeRegistryState>({
    sections: {}, labels: {}, tabs: [], loading: true, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    // Both, together: what each kind HOLDS comes from the registry, and which
    // kinds are on screen comes from the sidebar's own answer.
    Promise.all([fetchTypes(projectPath), fetchSections(projectPath)])
      .then(([registry, tree]) => {
        if (cancelled) return;
        const types = registry.types ?? [];
        setState({
          sections: sectionsFromRegistry(types),
          labels: labelsFromRegistry(types),
          tabs: tabsFromSections(tree),
          loading: false,
          error: null,
        });
      })
      .catch(e => {
        if (cancelled) return;
        setState({
          sections: {}, labels: {}, tabs: [], loading: false,
          error: e instanceof Error
            ? e.message
            : "This project's kinds of entry could not be read.",
        });
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  return state;
}
