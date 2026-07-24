// components/profiles/SpinePickers.tsx -- Personality-spine dropdowns
// =====================================================================
// Two selects rendered above the Personality Traits section of a CHARACTER
// profile: "Personality (Enneagram)" and "Story Role (Archetype)". Picking
// an option inserts that option's fiction-first summary into the section as
// a new editable trait block (importance: core) -- writer-initiated
// insertion of canned text, the same write-boundary logic as the Book
// Details suggestion chips. Zero AI calls.
//
// The selects are cheat-sheet inserters, not stored fields: after inserting
// they snap back to blank, and the inserted block is just a normal trait
// block the writer edits/deletes like any other. Picking BOTH stacks two
// blocks -- Caregiver + Enneagram 8 reads nothing like Caregiver + 2, and
// that composition is the point.

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  ENNEAGRAM_OPTIONS, ARCHETYPE_OPTIONS, spineOptionById, type SpineOption,
} from "../../data/characterSpines";

interface SpinePickersProps {
  // Called with (traitName, description) -- ProfileBuilder inserts a new
  // [core] trait block into the Personality Traits section.
  onInsert: (trait: string, description: string) => void;
}

// One labeled select + a "What's this?" toggle listing every option's
// one-line definition (same per-group help pattern as Book Details chips).
function SpineSelect({
  label, options, traitPrefix, onInsert,
}: {
  label: string;
  options: SpineOption[];
  traitPrefix: string;
  onInsert: (trait: string, description: string) => void;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="flex-1">
      <div className="mb-1 flex items-center gap-1.5">
        <label className="text-xs font-medium text-text-primary">{label}</label>
        <button
          type="button"
          onClick={() => setShowHelp(h => !h)}
          className={`flex items-center gap-0.5 text-[11px] transition-colors ${
            showHelp ? "text-indigo-300" : "text-faint hover:text-indigo-300"
          }`}
          title={`What do the ${label} options mean?`}
        >
          <HelpCircle size={11} />
          What's this?
        </button>
      </div>

      {showHelp && (
        <div className="mb-2 rounded border border-indigo-800/40 bg-indigo-950/20 p-2">
          {options.map(o => (
            <p key={o.id} className="mb-1 text-[11px] leading-snug text-text-muted">
              <span className="font-medium text-indigo-300">{o.label}:</span> {o.help}
            </p>
          ))}
        </div>
      )}

      <select
        // Always renders the blank placeholder: this is an insert action,
        // not a stored value, so it snaps back after each pick.
        value=""
        onChange={e => {
          const picked = spineOptionById(options, e.target.value);
          if (picked) onInsert(`${traitPrefix}: ${picked.label}`, picked.summary);
        }}
        className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-indigo-500"
      >
        <option value="">Pick to insert a starting point...</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function SpinePickers({ onInsert }: SpinePickersProps) {
  return (
    <div className="mb-3 rounded border border-border bg-bg-primary p-3" data-testid="spine-pickers">
      <p className="mb-2 text-xs text-text-muted">
        Personality spine -- pick one from each to insert an editable starting
        point below. They stack: the archetype is the character's job in the
        story, the Enneagram is the engine underneath it.
      </p>
      <div className="flex gap-3">
        <SpineSelect
          label="Personality (Enneagram)"
          options={ENNEAGRAM_OPTIONS}
          traitPrefix="Enneagram"
          onInsert={onInsert}
        />
        <SpineSelect
          label="Story Role (Archetype)"
          options={ARCHETYPE_OPTIONS}
          traitPrefix="Story role"
          onInsert={onInsert}
        />
      </div>
      <p className="mt-2 text-[11px] text-faint">
        These are starting points -- fill in the blanks and ask: what makes
        this character NOT a textbook type?
      </p>
    </div>
  );
}
