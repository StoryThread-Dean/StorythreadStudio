// features/audiobook/GuidedWalk.tsx
// ==================================
// The shared "Show me how this works" card: a numbered walk through a
// feature, one step at a time, with an example of what each step looks
// like on screen.
//
// This app is a teaching tool before it is a production tool, and the
// "what's this?" answers scattered around it are REFERENCE -- good when
// somebody has a question, useless when they do not yet know what to
// ask. A guided walk is the other half, and the roadmap makes one
// standard for every feature. Shared here so each new one is a list of
// steps rather than a new screen.
//
// Deliberately not a tour that spotlights, blocks, or moves the screen
// around. A writer should be able to read step 3, DO step 3, and come
// back -- so it sits inside the panel it describes and everything
// underneath stays usable while it is open.

import { useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, X } from "lucide-react";

export interface WalkStep {
  title: string;
  body: React.ReactNode;
  /** What this step looks like in the app. Optional, but a step with a
   *  concrete example teaches roughly twice as much as one without. */
  example?: React.ReactNode;
}

interface GuidedWalkProps {
  steps: WalkStep[];
  /** Colour family, so the card belongs to the panel it explains. */
  tone?: "violet" | "blue";
  onClose: () => void;
}

const TONES = {
  violet: {
    box: "border-violet-800 bg-violet-950/30",
    icon: "text-violet-300",
    title: "text-violet-100",
    body: "text-violet-100/80",
    example: "border-violet-900",
    back: "border-violet-800 text-violet-200 hover:border-violet-500",
    next: "bg-violet-600 hover:bg-violet-500",
    hint: "text-violet-300/60",
    close: "text-violet-400 hover:text-violet-100",
  },
  blue: {
    box: "border-blue-800 bg-blue-950/30",
    icon: "text-blue-300",
    title: "text-blue-100",
    body: "text-blue-100/80",
    example: "border-blue-900",
    back: "border-blue-800 text-blue-200 hover:border-blue-500",
    next: "bg-blue-600 hover:bg-blue-500",
    hint: "text-blue-300/60",
    close: "text-blue-400 hover:text-blue-100",
  },
};

export function GuidedWalk({ steps, tone = "violet", onClose }: GuidedWalkProps) {
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const c = TONES[tone];

  return (
    <div className={`rounded border px-3 py-2.5 ${c.box}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <GraduationCap size={13} className={`shrink-0 ${c.icon}`} />
        <span className={`flex-1 text-[12px] font-semibold ${c.title}`}>
          {index + 1}. {step.title}
        </span>
        <button
          onClick={onClose}
          aria-label="Close the walkthrough"
          className={`rounded p-0.5 ${c.close}`}
        >
          <X size={13} />
        </button>
      </div>

      <p className={`text-[11px] leading-relaxed ${c.body}`}>{step.body}</p>

      {step.example && (
        <p className={`mt-1.5 rounded border bg-zinc-950/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-400 ${c.example}`}>
          {step.example}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous step"
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] disabled:opacity-40 ${c.back}`}
        >
          <ChevronLeft size={11} /> Back
        </button>
        {index < steps.length - 1 ? (
          <button
            onClick={() => setIndex(i => i + 1)}
            aria-label="Next step"
            className={`inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] font-semibold text-white ${c.next}`}
          >
            Next <ChevronRight size={11} />
            <span data-testid="tutorial-progress">
              {index + 1} of {steps.length}
            </span>
          </button>
        ) : (
          <button
            onClick={onClose}
            className="rounded bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
          >
            Done --{" "}
            <span data-testid="tutorial-progress">
              {steps.length} of {steps.length}
            </span>
          </button>
        )}
        <span className={`text-[10px] ${c.hint}`}>
          Everything below stays usable while this is open.
        </span>
      </div>
    </div>
  );
}
