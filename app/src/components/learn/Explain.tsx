// components/learn/Explain.tsx -- the help a screen owes, in one control
// ======================================================================
// Answers four things the product rule requires -- what this is, why it is
// happening, whether it is necessary, and what it spends -- plus the steps,
// when the order matters.
//
// TWO EARLIER MISTAKES, BOTH VISIBLE IN A SCREENSHOT, BOTH FIXED HERE.
//
// 1. IT WAS TWO BUTTONS. "What's this?" and "Show me how to do this" side by
//    side, on the theory that they are different questions asked at different
//    moments. On screen that theory cost about 240px of chrome per use, and two
//    of them stacked on the Weaving panel read as clutter rather than as help.
//    Reported as "I'm not sure two What'sThis? and Show me how to do this is
//    needed."
//
//    So it is one trigger and one panel, with the steps inside it under their
//    own heading. Nothing is lost: somebody who only wants the steps looks down
//    past four short lines instead of pressing a different button.
//
// 2. THE PANEL WAS PART OF THE LAYOUT. Inside the Smart Advisor toolbar --
//    a wrapping flex row -- opening it grew the row, shoved Readability and
//    Structure sideways, wrapped Context onto a second line and pushed the
//    manuscript down the page. A disclosure that rearranges the screen around
//    it is worse than no disclosure.
//
//    So the panel FLOATS: absolutely positioned, out of flow, over whatever is
//    beneath it. The trigger keeps its place and nothing else moves. This is how
//    the issue and thesaurus popovers in this app already behave.
//
// `compact` exists for toolbars, where even one worded button is too wide: the
// trigger becomes a single question mark and the panel is unchanged.

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Coins, CircleCheck, ListOrdered } from "lucide-react";

import { EXPLAIN, NEED_WORDING, type Explains } from "./explanations";

interface ExplainProps {
  /** Key into the registry. Preferred, so the text lives in one place. */
  of?: string;
  /** Or the entry itself, for something genuinely local to one screen. */
  entry?: Explains;
  /** Override the trigger's wording where the default reads oddly. */
  label?: string;
  /**
   * Icon-only trigger, for a crowded row.
   *
   * The words are the better affordance -- nobody has to guess what "What's
   * this?" does -- so this is for places where they genuinely will not fit,
   * not a default to reach for.
   */
  compact?: boolean;
  /** Open the panel to the right of the trigger instead of the left. */
  align?: "left" | "right";
}

export function Explain({ of, entry, label, compact, align = "left" }: ExplainProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const info = entry ?? (of ? EXPLAIN[of] : undefined);

  // Escape and a click elsewhere both close it. A floating panel that can only
  // be dismissed by finding the button again is a panel people leave open.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // A missing key is a bug, not something to paper over with an empty box --
  // but it must not take the screen down with it. A contract test catches these
  // before they ship; this is the belt to that braces.
  if (!info) return null;

  return (
    // relative + inline: the trigger sits in the flow exactly as a word would,
    // and the panel hangs off it without occupying space.
    <span ref={wrapRef} className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={compact ? (label ?? "What's this?") : undefined}
        title={compact ? (label ?? "What's this?") : undefined}
        className="inline-flex shrink-0 items-center gap-1 rounded text-micro text-text-muted transition-colors hover:text-accent"
      >
        <HelpCircle size={compact ? 13 : 11} />
        {!compact && (label ?? "What's this?")}
      </button>

      {open && (
        <div
          data-testid="explain-panel"
          role="note"
          className={`absolute top-full z-50 mt-1 w-[min(30rem,80vw)] space-y-1.5 rounded border border-border bg-bg-panel px-2.5 py-2 text-micro leading-relaxed text-text-muted shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="text-text-primary">{info.what}</p>

          {/* WHY, labelled, because it is the part writers ask for and the part
              that gets left out. Naming it also stops it being written as more
              description of what the thing is. */}
          <p><span className="text-faint">Why: </span>{info.why}</p>

          <p className="flex items-start gap-1">
            <CircleCheck size={10} className="mt-0.5 shrink-0 text-success-muted/80" />
            <span>{NEED_WORDING[info.needed]}</span>
          </p>

          {/* WHAT IT SPENDS, when the entry says. A nice-to-have rather than an
              obligation -- but worth the line more often than not, because most
              of this app costs nothing and a model-shaped app trains people to
              expect a meter running. */}
          {info.cost && (
            <p className="flex items-start gap-1">
              <Coins size={10} className="mt-0.5 shrink-0 text-warn/80" />
              <span>
                {info.cost.kind === "free"
                  ? "Free. No AI is called, so this costs nothing."
                  : info.cost.note}
              </span>
            </p>
          )}

          {/* The steps, in the same panel under their own heading. They used to
              be a second button; the heading does the same job for none of the
              width. */}
          {info.how && info.how.length > 0 && (
            <div data-testid="explain-how" className="border-t border-border pt-1.5">
              <p className="mb-1 flex items-center gap-1 text-micro uppercase tracking-wide text-faint">
                <ListOrdered size={10} /> How to do this
              </p>
              <ol className="list-decimal space-y-0.5 pl-4">
                {info.how.map(step => <li key={step}>{step}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
