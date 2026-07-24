// components/profiles/QuickBuildPanel.tsx -- Side-character quick build
// =======================================================================
// Shown on SIDE/BACKGROUND character profiles (the simplified template
// where every section is one free-text field). Pick a story role, roll a
// few options per trait section, click the ones that fit -- every click
// APPENDS the option to the matching section's text as a new line. Canned
// text, writer-initiated, zero AI calls, fully editable after insert.
//
// Repeat protection: each row remembers what it has already dealt (per
// tier) and pages through the whole pool before anything comes back.
//
// NSFW semantics (the writer's chosen design, see docs/features.md):
//   - toggle OFF: normal pools only; the Explicit checkbox is greyed out
//   - toggle ON:  NSFW pools REPLACE the normal ones; Explicit becomes
//     clickable
//   - toggle ON + Explicit: a third, spicier tier REPLACES the NSFW
//     options -- mostly fill-in-the-blank phrasing ("secretly wants to be
//     ____") so the writer personalizes instead of the app prescribing.
// Deliberately NOT gated on the AI content-mode setting and never
// auto-enabled by genre -- always the writer's explicit, per-character call.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Dices } from "lucide-react";
import { ARCHETYPE_OPTIONS, archetypeIdForRole, spineOptionById } from "../../data/characterSpines";
import { rollTraitOptions, type TraitSection } from "../../data/traitPools";

// How many options each row shows per roll -- enough for a real choice,
// few enough that rerolling stays fun.
const ROLL_COUNT = 4;

// Row order + display labels + where each section's picks land in the
// profile (the profile section key the caller appends into).
export const QUICK_BUILD_ROWS: { section: TraitSection; label: string; targetSectionKey: string }[] = [
  { section: "physical",  label: "Physical",  targetSectionKey: "physical_traits" },
  { section: "mannerism", label: "Mannerism", targetSectionKey: "personality_traits" },
  { section: "voice",     label: "Voice",     targetSectionKey: "voice_notes" },
  { section: "want",      label: "Want / Motivation", targetSectionKey: "motivations" },
  { section: "hidden",    label: "Hidden / Foreshadowing", targetSectionKey: "hidden_and_foreshadowing" },
];

interface QuickBuildPanelProps {
  // Called with (profileSectionKey, text) -- the caller appends the text to
  // that section as a new line.
  onInsert: (sectionKey: string, text: string) => void;
  // Append the chosen archetype's summary to the Personality section.
  onInsertRoleSummary: (trait: string, description: string) => void;
  // The profile's Role field. The Story Role select is session-only state,
  // so on reopen it defaults to whichever archetype matches this role
  // ("Villain" -> Shadow / Villain); blank or unmatched -> Any role.
  initialRoleLabel?: string;
}

export function QuickBuildPanel({ onInsert, onInsertRoleSummary, initialRoleLabel }: QuickBuildPanelProps) {
  const [open, setOpen] = useState(true);
  const [archetypeId, setArchetypeId] = useState(() => archetypeIdForRole(initialRoleLabel));
  const [nsfw, setNsfw] = useState(false);
  const [explicit, setExplicit] = useState(false);

  // The currently visible options per row. Rolled on mount (the panel
  // starts open) and rerolled per row (or all rows) on demand.
  const [rolls, setRolls] = useState<Record<TraitSection, string[]>>({
    physical: [], mannerism: [], voice: [], want: [], hidden: [],
  });

  // Per-row-per-tier memory of options already dealt this cycle, so
  // rerolling pages through the pool instead of circling back. A ref, not
  // state: it never drives rendering, only the next deal.
  const seenRef = useRef<Record<string, Set<string>>>({});

  const tierKey = (section: TraitSection, o: { nsfw: boolean; explicit: boolean }) =>
    `${section}:${o.nsfw ? (o.explicit ? "explicit" : "nsfw") : "normal"}`;

  const rollRow = (section: TraitSection, opts?: { nsfw: boolean; explicit: boolean; archetypeId: string }) => {
    const effective = opts ?? { nsfw, explicit, archetypeId };
    const key = tierKey(section, effective);
    const seen = seenRef.current[key] ?? new Set<string>();
    const dealt = rollTraitOptions(section, ROLL_COUNT, {
      nsfw: effective.nsfw,
      explicit: effective.explicit,
      archetypeId: effective.archetypeId || null,
      exclude: seen,
    });
    // If anything dealt was already seen, the pool cycled -- start the
    // memory over from this hand.
    if (dealt.some(o => seen.has(o))) {
      seenRef.current[key] = new Set(dealt);
    } else {
      for (const o of dealt) seen.add(o);
      seenRef.current[key] = seen;
    }
    setRolls(prev => ({ ...prev, [section]: dealt }));
  };

  const rollAll = (opts?: { nsfw: boolean; explicit: boolean; archetypeId: string }) => {
    for (const row of QUICK_BUILD_ROWS) rollRow(row.section, opts);
  };

  // Tier/role changes re-deal every row immediately -- stale options from
  // the previous tier lingering on screen would be confusing.
  const setNsfwAndReroll = (next: boolean) => {
    const nextExplicit = next ? explicit : false;  // greying out also clears it
    setNsfw(next);
    setExplicit(nextExplicit);
    rollAll({ nsfw: next, explicit: nextExplicit, archetypeId });
  };
  const setExplicitAndReroll = (next: boolean) => {
    setExplicit(next);
    rollAll({ nsfw, explicit: next, archetypeId });
  };
  const setArchetypeAndReroll = (id: string) => {
    setArchetypeId(id);
    rollAll({ nsfw, explicit, archetypeId: id });
  };

  const chosenArchetype = archetypeId ? spineOptionById(ARCHETYPE_OPTIONS, archetypeId) : undefined;

  // The panel starts open, so deal the first hands on mount (the toggle
  // handler only covers reopen-after-collapse). Runs once; archetypeId is
  // already initialized from the Role field at this point.
  useEffect(() => {
    rollAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-4 rounded border border-border bg-bg-primary" data-testid="quick-build-panel">

      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && rolls.physical.length === 0) rollAll();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-surface"
      >
        {open ? <ChevronDown size={14} className="text-faint" /> : <ChevronRight size={14} className="text-faint" />}
        <span className="text-xs font-medium text-text-primary">Quick Build</span>
        <span className="text-xs text-faint">-- roll traits, click to add them below</span>
      </button>

      {open && (
        <div className="border-t border-border p-3">

          {/* Role picker -- weights the rolls toward the chosen archetype */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-text-primary">
              Story Role (weights the rolls)
            </label>
            <div className="flex items-center gap-2">
              <select
                value={archetypeId}
                onChange={e => setArchetypeAndReroll(e.target.value)}
                className="flex-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-indigo-500"
              >
                <option value="">Any role</option>
                {ARCHETYPE_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {chosenArchetype && (
                <button
                  type="button"
                  onClick={() => onInsertRoleSummary(`Story role: ${chosenArchetype.label}`, chosenArchetype.summary)}
                  className="shrink-0 rounded border border-border px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
                  title="Add this role's summary to the Personality section"
                >
                  + Add role summary
                </button>
              )}
            </div>
          </div>

          {/* NSFW tier controls -- red styling per the house NSFW pattern */}
          <div className="mb-3 flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5" title="Replace the normal options with NSFW ones. Per character, always your call -- never switched on automatically.">
              <input
                type="checkbox"
                checked={nsfw}
                onChange={e => setNsfwAndReroll(e.target.checked)}
                className="accent-red-500"
              />
              <span className={`text-xs ${nsfw ? "font-medium text-red-400" : "text-faint"}`}>
                NSFW options
              </span>
            </label>
            <label
              className={`flex items-center gap-1.5 ${nsfw ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
              title={nsfw
                ? "Swap in the spiciest tier -- mostly fill-in-the-blank prompts you complete yourself."
                : "Turn on NSFW options first."}
            >
              <input
                type="checkbox"
                checked={explicit}
                disabled={!nsfw}
                onChange={e => setExplicitAndReroll(e.target.checked)}
                className="accent-red-600"
              />
              <span className={`text-xs ${explicit ? "font-medium text-red-300" : nsfw ? "text-red-700" : "text-faint"}`}>
                Explicit (fill-in-the-blank)
              </span>
            </label>
          </div>

          {/* The four roll rows */}
          {QUICK_BUILD_ROWS.map(row => (
            <div key={row.section} className="mb-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">{row.label}</span>
                <button
                  type="button"
                  onClick={() => rollRow(row.section)}
                  className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
                  title={`Reroll the ${row.label} options -- pages through the pool without repeating`}
                >
                  <Dices size={11} />
                  Reroll
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rolls[row.section].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onInsert(row.targetSectionKey, option)}
                    className={`rounded-lg border px-2.5 py-1 text-left text-[11px] leading-snug transition-colors ${
                      nsfw
                        ? "border-red-800/50 bg-red-950/20 text-red-300 hover:border-red-500 hover:text-red-200"
                        : "border-border bg-bg-surface text-text-muted hover:border-indigo-500 hover:text-text-primary"
                    }`}
                    title="Add to the matching section as a new line"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="text-[11px] text-faint">
            Each click adds the line to the matching section below -- edit
            freely and fill any ____ blanks with your own specifics.
          </p>
        </div>
      )}
    </div>
  );
}
