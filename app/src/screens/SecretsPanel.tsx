// screens/SecretsPanel.tsx -- every secret on this page, in one place
// ===================================================================
// The writer asked for hidden traits to be grouped together, and suggested
// moving them into the Hidden and Foreshadowing section to do it.
//
// This gives them the grouping without the move, because the move would cost
// something real: a secret belongs in the section it EXPLAINS. The reason a
// villain avoids hospitals belongs under Motivations, beside the motivation it
// causes -- relocated to a secrets bucket it becomes a floating fact with
// nothing to attach it to, for the model and for the writer reading the page.
//
// So nothing is relocated. This is a view: one list, drawn from wherever the
// traits already live, saying which section each came from.
//
// It also does the job that made the axis split necessary in the first place.
// `importance: hidden` recorded no weight -- it was busy meaning "secret" -- so
// every trait written before the split reads as Present. Some of them are Core:
// the reason a character avoids something can be the most load-bearing fact
// about them. Rather than guess, the panel shows the weight beside each one and
// lets it be changed here, which turns an invisible wrong default into a short,
// finite job.

import { useMemo, useState } from "react";
import { BookOpen, EyeOff } from "lucide-react";

import type { ImportanceLevel, Profile } from "../types/profile";
import { IMPORTANCE_LABELS, SECTION_CONFIGS } from "../types/profile";
import { Explain } from "../components/learn/Explain";
import { isSecret } from "./characterTemplate";
import { SubtextGuide } from "./SubtextGuide";

interface SecretsPanelProps {
  profile: Profile;
  /** Change one trait's weight in place. Marks the profile unsaved, like any
   *  other edit -- this panel writes nothing on its own. */
  onSetWeight: (sectionKey: string, blockId: string,
                importance: ImportanceLevel) => void;
}

export function SecretsPanel({ profile, onSetWeight }: SecretsPanelProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const headings = useMemo(() => {
    const map = new Map<string, string>();
    for (const config of SECTION_CONFIGS[profile.type] ?? []) {
      map.set(config.key, config.heading);
    }
    return map;
  }, [profile.type]);

  const secrets = useMemo(
    () => Object.entries(profile.sections).flatMap(([key, section]) =>
      (section.trait_blocks ?? [])
        .filter(isSecret)
        .map(block => ({ sectionKey: key, block }))),
    [profile.sections]);

  if (secrets.length === 0) return null;

  return (
    <div
      data-testid="secrets-panel"
      className="mb-6 rounded border border-violet-900/60 bg-violet-950/10 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <EyeOff size={13} className="text-violet-300" />
        <p className="flex-1 text-xs font-medium text-violet-200">
          {secrets.length} thing{secrets.length === 1 ? "" : "s"} AI will never
          say out loud
        </p>
        <button
          onClick={() => setGuideOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-violet-800 px-1.5 py-0.5 text-[10px] text-violet-200 hover:border-violet-500"
        >
          <BookOpen size={10} /> Show me how this works
        </button>
        <Explain of="character.subtext" compact />
      </div>

      {guideOpen && <SubtextGuide onClose={() => setGuideOpen(false)} />}

      <p className="mb-2 text-xs text-text-muted">
        These stay where you wrote them, next to what they explain. AI uses each
        one at the weight below and is forbidden from naming it.
      </p>

      <div className="space-y-1.5">
        {secrets.map(({ sectionKey, block }) => (
          <div
            key={block.id}
            className="flex items-start gap-2 rounded bg-bg-panel px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">
                {block.trait || "(unnamed)"}
              </p>
              <p className="truncate text-xs text-faint">
                {headings.get(sectionKey) ?? sectionKey}
              </p>
            </div>
            <select
              value={block.importance}
              onChange={e => onSetWeight(sectionKey, block.id,
                                         e.target.value as ImportanceLevel)}
              aria-label={`Weight for ${block.trait || "this secret"}`}
              className="shrink-0 rounded border border-border bg-bg-surface px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-violet-500"
            >
              {(Object.keys(IMPORTANCE_LABELS) as ImportanceLevel[]).map(level => (
                <option key={level} value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-faint">
        Anything you wrote before secrecy and weight were separate settings reads
        as Present, because the old single setting never recorded a weight. If
        one of these drives half a character's scenes, make it Core.
      </p>
    </div>
  );
}
