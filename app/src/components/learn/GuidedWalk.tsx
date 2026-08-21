// components/learn/GuidedWalk.tsx
// ================================
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
//
// R8.8: MOVED HERE FROM features/audiobook/. It was written as a shared
// component, described as one in its own header, and lived inside one
// feature's folder -- so the second feature that wanted it would have had to
// reach across a feature boundary or copy it, and copying is how two
// walkthroughs end up teaching in two different shapes. The Weave uses it now
// (see codex/RunWalk.tsx).
//
// The demo type is a UNION for the same reason. It used to mean one thing --
// a clip rendered by the audiobook pipeline -- which is a perfectly good
// demonstration of something audible and no use at all for something a writer
// READS. A Weave step showing what a brief looks like with and without a
// belief recorded needs to show text, and it should not have to invent its own
// way to do that.

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, GraduationCap, Loader2, Play, X,
} from "lucide-react";

import { fetchMarkerDemo } from "../../features/audiobook/api";

/**
 * One thing a step can demonstrate rather than describe.
 *
 * Discriminated on `play`, and `"audio"` is the default when it is absent so
 * every existing audiobook step keeps working untouched -- there were two dozen
 * of them and rewriting them all to say what they already meant would be churn
 * with a chance of a typo.
 */
export type WalkDemo = AudioDemo | ShownDemo;

export interface AudioDemo {
  play?: "audio";
  /** A DEMO_SCRIPTS key on the backend (marker_demos.py). */
  kind: string;
  /** What the writer is about to hear, in their terms. */
  label: string;
}

/** Something to READ side by side: what the app produces with and without the
 *  thing the step is teaching. The Weave's demonstrations are all of this
 *  kind -- there is nothing to listen to in a context brief. */
export interface ShownDemo {
  play: "shown";
  /** Stable key for React, since two shown demos have no `kind` to tell them
   *  apart. */
  kind: string;
  label: string;
  body: React.ReactNode;
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
    box: "border-weave/60 bg-weave-soft",
    icon: "text-weave",
    title: "text-weave-strong",
    body: "text-text-primary",
    example: "border-weave/40",
    back: "border-weave/60 text-weave hover:border-weave",
    next: "bg-weave-fill hover:bg-weave-muted",
    hint: "text-text-muted",
    close: "text-weave hover:text-weave-strong",
  },
  blue: {
    box: "border-accent/60 bg-accent-soft",
    icon: "text-accent",
    title: "text-accent-strong",
    body: "text-text-primary",
    example: "border-accent/40",
    back: "border-accent/60 text-accent hover:border-accent",
    next: "bg-accent-fill hover:bg-accent-muted",
    hint: "text-text-muted",
    close: "text-accent hover:text-accent-strong",
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
    <div
      data-testid="guided-walk"
      className={`overflow-hidden rounded-lg border shadow-e2 ${c.box}`}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-bg-surface/40 px-3 py-1.5">
        <GraduationCap size={13} className={`shrink-0 ${c.icon}`} />
        {/* THE NUMBER STAYS IN FRONT OF THE TITLE. Moving it to a separate
            counter on the right looked tidier and broke eleven tests, which
            is the useful part: they navigate by "3. Title" because a bare
            title ALSO matches the mute-checkbox labels sitting behind this
            card. The prefix is what makes the heading unambiguous, for a
            test and for anyone reading the screen. */}
        <span className={`flex-1 text-xs font-semibold ${c.title}`}>
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

      <div className="px-3 py-2.5">
      <p className={`text-mini leading-relaxed ${c.body}`}>{step.body}</p>

      {step.example && (
        <p className={`mt-1.5 rounded border bg-bg-surface px-2 py-1 font-mono text-micro leading-relaxed text-text-muted ${c.example}`}>
          {step.example}
        </p>
      )}

      {step.note && (
        // Set apart by a left accent rather than a filled box: it has to
        // read as a different KIND of sentence without competing with the
        // step it belongs to.
        <p className="mt-1.5 flex items-start gap-1.5 rounded-r border-l-2 border-warn-fill/70 bg-warn-soft px-2 py-1 text-micro leading-relaxed text-warn-strong/90">
          <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn/80" />
          <span>{step.note}</span>
        </p>
      )}

      {step.demos && step.demos.length > 0 && (
        <div className={`mt-1.5 overflow-hidden rounded border bg-bg-surface ${c.example}`}>
          {step.demos.map(demo => (
            <div key={demo.kind}
                 className="flex items-start gap-2 border-b border-border px-2 py-1.5 last:border-b-0">
              {/* A shown demo has nothing to press. Rendering a dead Play
                  button beside it would be the clearest possible way to say
                  "this feature does not understand what it is showing you". */}
              {demo.play === "shown" ? (
                <span className="shrink-0 rounded border border-border px-2 py-0.5 text-micro uppercase tracking-wide text-faint">
                  {demo.label}
                </span>
              ) : (
                <button
                  onClick={() => void playDemo(demo.kind)}
                  disabled={loading !== null}
                  aria-label={`Play: ${demo.label}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-mini text-text-primary hover:border-success-fill hover:text-success disabled:opacity-40"
                >
                  {loading === demo.kind
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Play size={11} />}
                  Play
                </button>
              )}
              <span className="min-w-0 flex-1 text-mini leading-tight text-text-primary">
                {demo.play === "shown" ? demo.body : demo.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {demoError && (
        <p className="mt-1.5 rounded border border-danger/60 bg-danger-soft px-2 py-1 text-micro text-danger">
          {demoError}
        </p>
      )}

      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-bg-surface/40 px-3 py-2">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous step"
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-mini disabled:opacity-40 ${c.back}`}
        >
          <ChevronLeft size={11} /> Back
        </button>
        {index < steps.length - 1 ? (
          <button
            onClick={() => setIndex(i => i + 1)}
            aria-label="Next step"
            className={`inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-mini font-semibold text-white ${c.next}`}
          >
            Next <ChevronRight size={11} />
            <span data-testid="tutorial-progress">
              {index + 1} of {steps.length}
            </span>
          </button>
        ) : (
          <button
            onClick={onClose}
            className="rounded bg-success-fill px-2.5 py-0.5 text-mini font-semibold text-white hover:bg-success-muted"
          >
            Done --{" "}
            <span data-testid="tutorial-progress">
              {steps.length} of {steps.length}
            </span>
          </button>
        )}
        <span className={`text-micro ${c.hint}`}>
          Everything below stays usable while this is open.
        </span>
      </div>
    </div>
  );
}
