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

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, GraduationCap, Loader2, Play, X,
} from "lucide-react";

import { fetchMarkerDemo } from "./api";

export interface WalkDemo {
  /** A DEMO_SCRIPTS key on the backend (marker_demos.py). */
  kind: string;
  /** What the writer is about to hear, in their terms. */
  label: string;
}

export interface WalkStep {
  title: string;
  body: React.ReactNode;
  /** What this step looks like in the app. Optional, but a step with a
   *  concrete example teaches roughly twice as much as one without. */
  example?: React.ReactNode;
  /** A caution the writer should read before deciding, set apart from the
   *  body so it is not skimmed with it. Amber in both tones on purpose:
   *  a warning is not part of the feature's identity, and re-tinting it
   *  per panel would make it read as decoration. Sits ABOVE the demos so
   *  a note about what a clip does lands before the clip is played. */
  note?: React.ReactNode;
  /** Clips to hear. Where a step describes something AUDIBLE, describing
   *  it is the weakest option available -- two buttons and four seconds
   *  settle what a paragraph of prose only gestures at. Rendered through
   *  the real pipeline in the reference voice and cached on the backend,
   *  so the second press of any of them is instant. */
  demos?: WalkDemo[];
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

  // Demo playback. Clips are cached by URL here and by rendered bytes on
  // the backend, so replaying an A/B comparison a few times -- which is
  // exactly how a listener decides -- costs nothing after the first pass.
  const [loading, setLoading] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const clips = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => {
    audioRef.current?.pause();
    for (const url of clips.current.values()) URL.revokeObjectURL(url);
  }, []);

  async function playDemo(kind: string) {
    setDemoError(null);
    const cached = clips.current.get(kind);
    if (cached) {
      audioRef.current?.pause();
      audioRef.current = new Audio(cached);
      void audioRef.current.play();
      return;
    }
    setLoading(kind);
    try {
      const url = URL.createObjectURL(await fetchMarkerDemo(kind));
      clips.current.set(kind, url);
      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      void audioRef.current.play();
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : "Could not play that.");
    } finally {
      setLoading(null);
    }
  }

  return (
    // Tagged so a test can assert what this CARD says without matching
    // the panel behind it -- several step titles are also control labels
    // out there, which is how an assertion ends up passing on the wrong
    // element.
    <div data-testid="guided-walk" className={`rounded border px-3 py-2.5 ${c.box}`}>
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

      {step.note && (
        // Set apart by a left accent rather than a filled box: it has to
        // read as a different KIND of sentence without competing with the
        // step it belongs to.
        <p className="mt-1.5 flex items-start gap-1.5 rounded-r border-l-2 border-amber-600/70 bg-amber-950/20 px-2 py-1 text-[10.5px] leading-relaxed text-amber-200/90">
          <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400/80" />
          <span>{step.note}</span>
        </p>
      )}

      {step.demos && step.demos.length > 0 && (
        <div className={`mt-1.5 overflow-hidden rounded border bg-zinc-950/60 ${c.example}`}>
          {step.demos.map(demo => (
            <div key={demo.kind}
                 className="flex items-center gap-2 border-b border-zinc-800/60 px-2 py-1.5 last:border-b-0">
              <button
                onClick={() => void playDemo(demo.kind)}
                disabled={loading !== null}
                aria-label={`Play: ${demo.label}`}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
              >
                {loading === demo.kind
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Play size={11} />}
                Play
              </button>
              <span className="min-w-0 flex-1 text-[11px] leading-tight text-zinc-300">
                {demo.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {demoError && (
        <p className="mt-1.5 rounded border border-rose-800 bg-rose-950/60 px-2 py-1 text-[10px] text-rose-300">
          {demoError}
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
