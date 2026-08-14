// features/codex/DomainBoard.tsx -- the whole world, and how much of it is decided
// ================================================================================
// R6.4. Unwoven used to be a drip: a bounded handful of questions, one after
// another, with no way to see what they were a handful OF. A writer could not
// tell whether they had four questions left or ninety, could not choose to
// spend an evening on their religion, and could not see that they had finished
// anything -- because a domain with nothing left simply stopped appearing.
//
// The board is the answer to all three. Every part of the world, always, with a
// real count on each; pick one and the walk asks about that part only. The
// sitting stays bounded, which is what keeps a walk finishable -- what changes
// is that the bound is no longer the only thing the writer can see.
//
// It is a BOARD rather than a list on purpose. A list implies an order to work
// through; a board says these are all yours, start anywhere. Nothing here is
// wrong or overdue: Unwoven is the one pass that finds absence rather than
// mistakes, and the screen should not feel like a backlog.

import { Check } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import type { WorldDomain } from "./weavingApi";

interface DomainBoardProps {
  domains: WorldDomain[];
  /** Which part is chosen, or null for "all of it". */
  chosen: string | null;
  onChoose: (domainId: string | null) => void;
  /** Open the walkthrough. Offered HERE because this is the surface a writer
   *  is looking at when they wonder what any of this is for, and a guide
   *  nothing offers is documentation rather than help. */
  onShowGuide: () => void;
}

/** The proportion decided, for the little bar. Unknown totals never happen:
 *  the corpus is fixed, so "open" plus "answered" is a real fraction. */
function decidedFraction(domain: WorldDomain, total: number): number {
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (total - domain.open) / total));
}

export function DomainBoard({ domains, chosen, onChoose,
                              onShowGuide }: DomainBoardProps) {
  if (domains.length === 0) return null;

  // Every domain ships with the same number of questions today, but reading it
  // off the data rather than hardcoding ten means the bar stays honest when the
  // corpus grows again.
  const biggest = Math.max(...domains.map(d => d.open), 1);
  const openTotal = domains.reduce((sum, d) => sum + d.open, 0);
  const finished = domains.filter(d => d.open === 0).length;

  return (
    <div className="mt-3" data-testid="domain-board">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold text-text-primary">
          Your world, part by part
        </h3>
        <span className="ml-auto text-[11px] text-faint">
          {openTotal} still open
        </span>
        <Explain of="weaving.board" />
      </div>

      {/* Said before the grid, because it is the thing that makes the numbers
          safe to look at. A hundred open questions is alarming if it reads as a
          list of mistakes and unalarming if it reads as a world with room in
          it. */}
      <p className="mt-1 text-[11px] text-faint">
        Nothing here is wrong or overdue. These are ground rules your story
        stands on that you have not had to decide yet, and you never have to
        decide all of them.
      </p>
      <button
        onClick={onShowGuide}
        className="mt-1 text-[11px] text-violet-300 underline-offset-2 hover:underline"
      >
        Show me how this works
      </button>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {domains.map(domain => {
          const done = domain.open === 0;
          const active = chosen === domain.id;
          return (
            <button
              key={domain.id}
              // A finished part is not a button to nowhere: choosing it shows
              // the writer that it is finished, which is a real answer.
              onClick={() => onChoose(active ? null : domain.id)}
              className={`flex flex-col items-start rounded border px-2 py-1.5 text-left ${
                active
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-border hover:border-text-muted"
              }`}
            >
              <span className="flex w-full items-baseline gap-1.5">
                <span className="text-[11px] font-medium text-text-primary">
                  {domain.label}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-faint">
                  {done ? <Check size={11} className="text-emerald-400" />
                        : domain.open}
                </span>
              </span>
              {/* How much of this part is decided. A count alone says how much
                  is left; the bar says how far they have come, and progress the
                  writer cannot see is progress that does not encourage them. */}
              <span className="mt-1 h-0.5 w-full rounded bg-border">
                <span
                  className={`block h-full rounded ${
                    done ? "bg-emerald-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.round(
                      decidedFraction(domain, Math.max(biggest, domain.open)) * 100,
                    )}%`,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {finished > 0 && (
        <p className="mt-1.5 text-[11px] text-emerald-300/90">
          {finished} {finished === 1 ? "part is" : "parts are"} fully decided.
        </p>
      )}

      {chosen && (
        <p className="mt-1.5 text-[11px] text-violet-300" data-testid="board-chosen">
          This sitting will ask about{" "}
          {domains.find(d => d.id === chosen)?.label ?? "that part"} only.
          Choose it again to go back to all of it.
        </p>
      )}
    </div>
  );
}
