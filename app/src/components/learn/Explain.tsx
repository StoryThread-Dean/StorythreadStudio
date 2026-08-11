// components/learn/Explain.tsx -- the two questions every screen must answer
// =========================================================================
// "What's this?" and "Show me how to do this", from one registry entry, so a
// screen cannot offer help that leaves out why it exists, whether it is
// necessary, or what it spends.
//
// Two buttons rather than one, because they are different questions asked at
// different moments. "What's this?" is asked by someone deciding whether to
// care. "Show me how" is asked by someone who has already decided and is stuck.
// Folding them together means the second person reads three paragraphs of
// justification to find a list of steps.
//
// The old free-form WhatsThis still exists and still works -- it is the right
// thing for a one-sentence aside next to a checkbox. This is for anything a
// writer could reasonably be stuck on, and its job is to be impossible to fill
// in badly.

import { useState } from "react";
import { HelpCircle, ListOrdered, Coins, CircleCheck } from "lucide-react";

import { EXPLAIN, NEED_WORDING, type Explains } from "./explanations";

interface ExplainProps {
  /** Key into the registry. Preferred, so the text lives in one place. */
  of?: string;
  /** Or the entry itself, for something genuinely local to one screen. */
  entry?: Explains;
  /** Override the first button's wording where the default reads oddly. */
  label?: string;
  /** Lay the buttons out on their own line rather than inline. */
  block?: boolean;
}

export function Explain({ of, entry, label, block }: ExplainProps) {
  const [open, setOpen] = useState<"what" | "how" | null>(null);
  const info = entry ?? (of ? EXPLAIN[of] : undefined);

  // A missing key is a bug, not something to paper over with an empty box --
  // but it must not take the screen down with it. A contract test catches these
  // before they ship; this is the belt to that braces.
  if (!info) return null;

  const toggle = (which: "what" | "how") =>
    setOpen(current => (current === which ? null : which));

  return (
    <div className={block ? "mt-1" : "inline-flex flex-col"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => toggle("what")}
          aria-expanded={open === "what"}
          className="inline-flex shrink-0 items-center gap-1 rounded text-[10px] text-text-muted transition-colors hover:text-blue-300"
        >
          <HelpCircle size={11} /> {label ?? "What's this?"}
        </button>

        {/* Only when there are steps. An empty "show me how" is worse than none:
            it promises instructions and delivers a shrug. */}
        {info.how && info.how.length > 0 && (
          <button
            type="button"
            onClick={() => toggle("how")}
            aria-expanded={open === "how"}
            className="inline-flex shrink-0 items-center gap-1 rounded text-[10px] text-text-muted transition-colors hover:text-blue-300"
          >
            <ListOrdered size={11} /> Show me how to do this
          </button>
        )}
      </div>

      {open === "what" && (
        <div data-testid="explain-what"
             className="mt-1 space-y-1.5 rounded border border-border bg-bg-surface/70 px-2 py-1.5 text-[10px] leading-relaxed text-text-muted">
          <p className="text-text-primary">{info.what}</p>

          {/* WHY, labelled, because it is the part writers ask for and the part
              that gets left out. Naming it also stops it being written as more
              description of what the thing is. */}
          <p><span className="text-faint">Why: </span>{info.why}</p>

          <p className="flex items-start gap-1">
            <CircleCheck size={10} className="mt-0.5 shrink-0 text-emerald-400/80" />
            <span>{NEED_WORDING[info.needed]}</span>
          </p>

          {/* WHAT IT SPENDS, always, including when the answer is nothing.
              Most of this app costs nothing and writers assume the opposite --
              a model-shaped app trains people to expect a meter running. */}
          <p className="flex items-start gap-1">
            <Coins size={10} className="mt-0.5 shrink-0 text-amber-300/80" />
            <span>
              {info.cost.kind === "free"
                ? "Free. No AI is called, so this costs nothing."
                : info.cost.note}
            </span>
          </p>
        </div>
      )}

      {open === "how" && info.how && (
        <ol data-testid="explain-how"
            className="mt-1 list-decimal space-y-1 rounded border border-border bg-bg-surface/70 py-1.5 pl-6 pr-2 text-[10px] leading-relaxed text-text-muted">
          {info.how.map(step => <li key={step}>{step}</li>)}
        </ol>
      )}
    </div>
  );
}
