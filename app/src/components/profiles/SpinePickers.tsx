// components/profiles/SpinePickers.tsx -- the personality spine
// ==============================================================
// Spec: docs/character-spine-spec.md.
//
// ONE control now, not two. It shows the character's personality type and opens
// the pick-and-choose screen; the Story Role select that used to sit beside it
// is gone, because there were two Role controls and this was the weaker of them
// (spec 1.5). Role now lives entirely next to the Role field, where it always
// belonged.
//
// ── WHAT CHANGED, AND WHY THE OLD SHAPE WAS WRONG ───────────────────────────
//
// It was a select that rendered `value=""` forever, so picking a type snapped
// it straight back to "Pick to insert a starting point...". The old comment in
// this file said that "looks broken until you know that, which is exactly the
// kind of thing 'show me how' is for" -- documenting around the problem instead
// of fixing it. Reported as "the functionality and purpose of picking the
// ennegram never stays put", which is the correct reading: a control that
// forgets is a control that has no state to show.
//
// So the type is a STORED FIELD and this shows it. Insertion is a separate,
// explicit act on a separate screen.

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { Explain } from "../learn/Explain";
import { SpineFacetPicker } from "./SpineFacetPicker";
import {
  ENNEAGRAM_OPTIONS, spineOptionById, type SpineFacet,
} from "../../data/characterSpines";

interface SpinePickersProps {
  /** The stored type id, or "" for not set. */
  enneagram: string;
  onEnneagramChange: (id: string) => void;
  /** Insert the chosen facets into Personality Traits. */
  onInsertFacets: (typeLabel: string, facets: SpineFacet[]) => void;
  /**
   * The Personality section as the writer currently sees it, unsaved edits
   * included -- so an already-taken line greys the moment it lands and un-greys
   * on undo. Spec 4.3.
   */
  personalityText: string;
}

export function SpinePickers({
  enneagram, onEnneagramChange, onInsertFacets, personalityText,
}: SpinePickersProps) {
  const [picking, setPicking] = useState(false);
  const chosen = spineOptionById(ENNEAGRAM_OPTIONS, enneagram);

  return (
    <div data-testid="spine-pickers">
      <div className="mb-1.5 flex items-center gap-2">
        <label className="text-xs text-text-muted"
               htmlFor="spine-enneagram-select">
          Personality (Enneagram)
        </label>
        <Explain of="spine.what" compact />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* A REAL FIELD. It shows what is stored and keeps showing it. */}
        <select
          id="spine-enneagram-select"
          value={enneagram}
          onChange={e => onEnneagramChange(e.target.value)}
          aria-label="Personality type"
          className="flex-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-fill"
        >
          <option value="">Not set</option>
          {ENNEAGRAM_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        {/* Choosing a type writes NOTHING into the profile text on its own.
            That separation is the whole fix: the type is a fact about the
            character, and the sentences are a decision about the page. */}
        <button
          type="button"
            onClick={() => setPicking(true)}
          disabled={!chosen}
          data-testid="spine-open-facets"
          title={chosen
            ? "Choose which lines of this type fit this character"
            : "Pick a type first"}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-accent-fill/50 px-2 py-1.5 text-xs text-accent hover:border-accent-fill disabled:opacity-40"
        >
          <Sparkles size={11} />
          Pick what fits
        </button>
      </div>

      <p className="mt-1.5 text-mini text-faint">
        {chosen
          ? "A starting point, not a verdict. Take the lines that fit and ask "
            + "what makes this character NOT a textbook type."
          : "Optional. Pick a pattern if you want somewhere to start; a "
            + "character written without one is not missing anything."}
      </p>

      {picking && chosen && (
        // A dialog over the page rather than an expanding panel, so opening it
        // does not shove the profile form around underneath the writer.
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-16"
          // Backdrop closes it. Nothing here is unsaved work: ticks are not
          // writes, and the writer would have to press Add to change anything.
          onMouseDown={event => {
            if (event.target === event.currentTarget) setPicking(false);
          }}
        >
          <div className="w-full max-w-xl rounded-lg border border-border-strong bg-bg-panel p-3 shadow-e3">
            <SpineFacetPicker
              option={chosen}
              existingText={personalityText}
              onInsert={facets => onInsertFacets(chosen.label, facets)}
              onClose={() => setPicking(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
