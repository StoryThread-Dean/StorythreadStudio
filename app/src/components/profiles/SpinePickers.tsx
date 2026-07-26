// components/profiles/SpinePickers.tsx -- Personality-spine dropdowns
// =====================================================================
// Two selects in the profile HEADER card (under Status/Tags) of a CHARACTER
// profile: "Personality (Enneagram)" and "Story Role (Archetype)". Picking
// an option inserts that option's fiction-first summary into the
// Personality Traits section -- as an editable [core] trait block on the
// main template, or appended text on the side template (the caller decides;
// this component just reports the pick). Writer-initiated insertion of
// canned text, zero AI calls.
//
// Picking a Story Role ALSO fills the profile's Role field and adds a few
// key-aspect tags (via onRolePicked) -- one pick wires up the whole header.
//
// The selects are cheat-sheet inserters, not stored fields: after inserting
// they snap back to blank, a confirmation note shows where the text went,
// and the inserted content is normal profile text the writer edits or
// deletes like any other.

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  ENNEAGRAM_OPTIONS, ARCHETYPE_OPTIONS, spineOptionById, type SpineOption,
} from "../../data/characterSpines";

interface SpinePickersProps {
  // Called with (traitName, description) -- the caller inserts into the
  // Personality Traits section (trait block or appended text per template).
  onInsert: (trait: string, description: string) => void;
  // Story Role picks also report the option so the caller can fill the
  // Role field and merge the archetype's key-aspect tags.
  onRolePicked?: (option: SpineOption) => void;
}

// One labeled select + a "What's this?" toggle listing every option's
// one-line definition (same per-group help pattern as Book Details chips).
function SpineSelect({
  label, options, onPick,
}: {
  label: string;
  options: SpineOption[];
  onPick: (option: SpineOption) => void;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="flex-1">
      <div className="mb-1 flex items-center gap-1.5">
        <label className="text-xs text-text-muted">{label}</label>
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
          if (picked) onPick(picked);
        }}
        className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-indigo-500"
      >
        <option value="">Pick to insert a starting point...</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function SpinePickers({ onInsert, onRolePicked }: SpinePickersProps) {
  // Confirmation note ("Added to Personality Traits") shown briefly after a
  // pick, so the writer knows where the text landed without scrolling.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  return (
    <div data-testid="spine-pickers">
      <div className="flex gap-3">
        <SpineSelect
          label="Personality (Enneagram)"
          options={ENNEAGRAM_OPTIONS}
          onPick={picked => {
            onInsert(`Enneagram: ${picked.label}`, picked.summary);
            showNotice(`${picked.label} added to Personality Traits below.`);
          }}
        />
        <SpineSelect
          label="Story Role (Archetype)"
          options={ARCHETYPE_OPTIONS}
          onPick={picked => {
            onInsert(`Story role: ${picked.label}`, picked.summary);
            onRolePicked?.(picked);
            showNotice(`${picked.label} added to Personality Traits -- Role and Tags updated above.`);
          }}
        />
      </div>
      {notice ? (
        <p className="mt-1.5 text-[11px] text-emerald-400">{notice}</p>
      ) : (
        <p className="mt-1.5 text-[11px] text-faint">
          Starting points, not verdicts -- fill in the blanks and ask what
          makes this character NOT a textbook type.
        </p>
      )}
    </div>
  );
}
