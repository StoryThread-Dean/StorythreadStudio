// features/audiobook/NarrationPacingSection.tsx
// =============================================
// The book's base pacing: how fast the narrator reads, how fast dialogue
// reads, and how long the scene and chapter silences run. Moved here out
// of the narration rail, where four numeric fields were crowding the work.
//
// Its own labelled, collapsible section so it is findable at a glance
// rather than hunted for. The amber "unsaved" tag rides on the header for
// the same reason it always has: previews and generation use the SAVED
// values, so a writer who tweaks the pace and previews without saving
// would otherwise hear no change and blame the engine.

import { useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";

import type { NarrationSettings } from "./api";

interface NarrationPacingSectionProps {
  pacing: NarrationSettings;
  dirty: boolean;
  saved: boolean;
  onChange: (next: NarrationSettings) => void;
}

// [key, label, min, max, step, hint] -- the wording is deliberately the
// same as it was in the rail; it was tuned by live listening tests.
const FIELDS: [keyof NarrationSettings, string, number, number, number, string][] = [
  ["narrator_pace", "Narrator pace", 0.5, 2.0, 0.05,
   "Base speed for all narration. 1.0 = the voice's natural pace. Sounds most natural between 0.8 and 1.2."],
  ["dialogue_pace", "Dialogue pace", 0.5, 2.0, 0.05,
   "Speed for dialogue paragraphs -- where the engine's own pacing goes wildest. Try 0.9 if dialogue races. Sounds most natural between 0.8 and 1.2."],
  ["paragraph_gap_ms", "Paragraph beat (ms)", 0, 5000, 50,
   "Silence at every paragraph break, inserted automatically. No engine "
   + "can be relied on to pause between paragraphs on its own -- without "
   + "this, the next paragraph starts milliseconds later and the reading "
   + "sounds rushed. 550 is a natural breath; set 0 for the old tight "
   + "join. A [pause] you write yourself always wins over this."],
  ["scene_break_ms", "Scene break (ms)", 0, 15000, 250,
   "Silence at every [scene-break]."],
  ["chapter_break_ms", "Chapter break (ms)", 0, 15000, 250,
   "Silence at every [chapter-break]."],
];

export function NarrationPacingSection({
  pacing, dirty, saved, onChange,
}: NarrationPacingSectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <h3 className="mb-1 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Narration Settings
      </h3>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="mt-2 flex w-full items-center justify-between rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-left transition-colors hover:border-blue-700"
      >
        <span className="flex items-center gap-2">
          <Gauge size={13} className="text-blue-300" />
          <span className="text-[11px] font-semibold text-zinc-200">
            Pacing and pauses for this book
          </span>
        </span>
        <span className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] font-normal text-amber-400"
                  title="Previews and generation use the SAVED values -- save to apply">
              unsaved
            </span>
          )}
          {!dirty && saved && (
            <span className="text-[10px] font-normal text-emerald-400">saved</span>
          )}
          <ChevronDown
            size={12}
            className={"text-zinc-500 transition-transform " + (open ? "rotate-180" : "")}
          />
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-zinc-800 bg-zinc-950/40 p-3">
          {FIELDS.map(([key, label, min, max, step, hint]) => (
            <label key={key} className="block" title={hint}>
              <span className="mb-0.5 block text-[10px] text-zinc-400">{label}</span>
              <input
                type="number"
                min={min} max={max} step={step}
                value={pacing[key]}
                onChange={e => onChange({ ...pacing, [key]: Number(e.target.value) })}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-emerald-500"
              />
              <span className="mt-0.5 block text-[9px] leading-relaxed text-zinc-600">
                {hint}
              </span>
            </label>
          ))}
          <p className="text-[9px] leading-relaxed text-zinc-600">
            Pace changes mark affected audio as outdated -- the next Generate
            re-does exactly those segments. [pace] markers step up or down
            from these base speeds.
          </p>
        </div>
      )}
    </section>
  );
}
