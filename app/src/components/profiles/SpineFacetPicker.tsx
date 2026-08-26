// components/profiles/SpineFacetPicker.tsx -- take the parts that fit
// ====================================================================
// Spec: docs/character-spine-spec.md sections 3 and 4.
//
// The writer's report, about picking Enneagram 1 for Saki Murakami, a
// recurring merchant who only ever appears in her own shop:
//
//     "'some' of the above can be used, but most of it serves zero purpose for
//      this character. Wants to be good and beyond reproach and dreads being
//      corrupt or wrong. That's a good trait for a merchant. notices the
//      crooked picture frame in any room isn't helpful as they only ever
//      appear situationally in their own store."
//
// Both judgements are right. Neither could be acted on, because the type
// inserted one paragraph and a paragraph is all-or-nothing. So this screen
// exists to make "most of it serves zero purpose" a two-second edit instead of
// a reason to stop using the feature.
//
// ── WHY THE HABITS ARE SEPARATE LINES ───────────────────────────────────────
//
// This is the load-bearing decision and it is easy to undo by accident. Type 1
// has THREE habits, and the writer wanted to keep "holds everyone to a standard
// no one agreed to" while dropping "notices the crooked picture frame". A
// decomposition that kept behaviour as one facet would have read as progress
// and failed the exact report it was written for.
//
// ── NOTHING IS TICKED WHEN THIS OPENS ───────────────────────────────────────
//
// It writes into the writer's own file. Same rule the Sweep and the storage
// dialog follow. But an empty list every time would make the quick path slower
// than the thing it replaced -- and "I want to give her a personality quickly"
// is the reported use case -- so Essentials and Everything tick a set in one
// click. They only move ticks; inserting is always a separate press.

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import { Explain } from "../learn/Explain";
import {
  ESSENTIAL_KINDS, FACET_KIND_LABELS,
  type FacetKind, type SpineFacet, type SpineOption,
} from "../../data/characterSpines";

interface Props {
  option: SpineOption;
  /**
   * The Personality section as it stands in the LIVE EDITOR BUFFER.
   *
   * Not the saved file. Same rule the outline presets follow: an unsaved insert
   * greys immediately and Ctrl+Z un-greys it, so the screen answers "what have
   * I already taken" from what the writer can actually see.
   */
  existingText: string;
  /** Insert these, in the order they appear in the type. */
  onInsert: (facets: SpineFacet[]) => void;
  onClose: () => void;
}

/** Is this sentence already in the writer's Personality section?
 *
 *  Exact match on the facet text. If they have EDITED the sentence the match
 *  fails and the facet offers itself again -- which is the correct failure
 *  direction: offering twice costs a glance, and greying a line they rewrote
 *  would hide a facet they never took. */
function alreadyTaken(facet: SpineFacet, existingText: string): boolean {
  return existingText.includes(facet.text);
}

export function SpineFacetPicker({ option, existingText, onInsert, onClose }: Props) {
  const facets = option.facets ?? [];
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const taken = useMemo(
    () => new Set(facets.filter(f => alreadyTaken(f, existingText)).map(f => f.id)),
    [facets, existingText]);

  // What is left to decide about. A type whose every line is already in stops
  // pretending there is a choice to make.
  const open = facets.filter(f => !taken.has(f.id));
  const chosen = open.filter(f => ticked.has(f.id));

  // Grouped by kind, in the order the type declares them, so eight lines read
  // as a shape rather than a wall.
  const groups = useMemo(() => {
    const out: { kind: FacetKind; rows: SpineFacet[] }[] = [];
    for (const facet of facets) {
      const last = out[out.length - 1];
      if (last && last.kind === facet.kind) last.rows.push(facet);
      else out.push({ kind: facet.kind, rows: [facet] });
    }
    return out;
  }, [facets]);

  const toggle = (id: string) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Tick a set without writing anything. */
  const tickKinds = (kinds: FacetKind[] | "all") =>
    setTicked(new Set(open
      .filter(f => kinds === "all" || kinds.includes(f.kind))
      .map(f => f.id)));

  return (
    <div
      role="dialog"
      aria-label={`Pick what fits from ${option.label}`}
      data-testid="spine-facet-picker"
      className="flex max-h-[80vh] flex-col"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {option.label}
        </h3>
        <span className="ml-auto shrink-0">
          <Explain of="spine.facets" />
        </span>
      </div>

      <p className="mt-1 text-mini text-faint">
        Take the lines that fit this character and leave the rest. A type is a
        starting point, not a description of anyone in particular, so most
        characters only want part of one.
      </p>

      {/* THE ONE-CLICK SETS. Above the list, because they are how the fast path
          stays fast -- and they only move ticks, so nothing is written until
          the button at the bottom. */}
      {open.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => tickKinds(ESSENTIAL_KINDS)}
            data-testid="spine-essentials"
            className="rounded border border-accent-fill/50 px-2 py-0.5 text-mini text-accent hover:border-accent-fill"
          >
            Essentials
          </button>
          <button
            type="button"
            onClick={() => tickKinds("all")}
            data-testid="spine-everything"
            className="rounded border border-border px-2 py-0.5 text-mini text-text-muted hover:text-text-primary"
          >
            Everything
          </button>
          {ticked.size > 0 && (
            <button
              type="button"
              onClick={() => setTicked(new Set())}
              data-testid="spine-clear"
              className="rounded px-1.5 py-0.5 text-mini text-faint hover:text-text-primary"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-micro text-faint">
            what they want, dread and sound like
          </span>
        </div>
      )}

      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {groups.map(group => (
          <div key={`${group.kind}-${group.rows[0].id}`}>
            <p className="mb-0.5 text-micro font-semibold uppercase tracking-label text-faint">
              {FACET_KIND_LABELS[group.kind]}
            </p>
            <ul className="space-y-0.5">
              {group.rows.map(facet => {
                const isTaken = taken.has(facet.id);
                return (
                  <li key={facet.id}>
                    <label
                      className={`flex items-start gap-2 rounded border px-2 py-1.5 text-mini ${
                        isTaken
                          ? "cursor-default border-border/50 bg-bg-surface/30 text-faint"
                          : "cursor-pointer border-border text-text-primary hover:bg-white/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isTaken || ticked.has(facet.id)}
                        disabled={isTaken}
                        onChange={() => toggle(facet.id)}
                        aria-label={facet.text}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        {facet.text}
                        {/* SAID, not just greyed. A disabled row with no reason
                            reads as broken. */}
                        {isTaken && (
                          <span className="ml-1 text-micro text-success-muted"
                                data-testid="spine-facet-taken">
                            already added
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => { onInsert(chosen); onClose(); }}
          disabled={chosen.length === 0}
          data-testid="spine-insert"
          className="inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
        >
          <Check size={11} />
          Add {chosen.length === 0 ? "" : `${chosen.length} `}
          to Personality
        </button>
        {open.length === 0 && (
          <p className="text-mini text-success-muted" data-testid="spine-all-taken">
            Every line of this type is already in this character.
          </p>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          data-testid="spine-facet-close"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-mini text-faint hover:text-text-primary"
        >
          <X size={10} /> Done
        </button>
      </div>
    </div>
  );
}
