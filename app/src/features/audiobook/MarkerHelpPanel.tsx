// features/audiobook/MarkerHelpPanel.tsx
// =======================================
// The "What's this?" panel for the marker toolbar: plain-language
// explanations plus a [Hear it] button per marker that plays a REAL
// rendered example -- synthesized through the actual pipeline in the
// default reference voice (Heart), with real stitched silence. Hearing a
// 1.5 second pause teaches more than any sentence about one.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Volume2 } from "lucide-react";

import { fetchMarkerDemo } from "./api";

const HELP_ITEMS: { kind: string; label: string; body: string }[] = [
  {
    kind: "pause",
    label: "Pauses",
    body: "Insert a silence of exactly the length you choose (0.4s, 0.8s, "
        + "1.5s presets). Use them for beats the punctuation alone doesn't "
        + "carry -- a held breath before a reveal.",
  },
  {
    kind: "scene-break",
    label: "Scene Break",
    body: "A 2-second silence marking a scene change. Longer than any "
        + "pause, so the listener feels the shift without a narrator "
        + "saying so.",
  },
  {
    kind: "chapter-break",
    label: "Chapter Break",
    body: "A 3-second silence for a mid-file transition. It does NOT "
        + "start a new chapter -- chapters come from your '# ' headings; "
        + "this is only the sound of one.",
  },
  {
    kind: "pace",
    label: "Pace -- slow down, speed up",
    body: "Wrap a passage to change its narration speed in steps off your "
        + "book's base pace: Slow ([pace:-2]) drops two steps to let a "
        + "heavy moment breathe; Fast ([pace:+2]) rises two steps to carry "
        + "an action beat. Normal is simply unmarked text. Each step is a "
        + "small, safe increment -- adjust by hand like [pace:-1] or "
        + "[pace:+3]. Steps stop at the tested limits (0.8 to 1.2), so no "
        + "stack of steps can crawl or chipmunk the voice. When "
        + "previewing, select the WHOLE span including its [pace] tags -- "
        + "a selection that cuts into a span plays at normal pace (and "
        + "says so).",
  },
  {
    kind: "say",
    label: "[say] -- one-spot pronunciation",
    body: "Select a word, click [say], and type how it should sound "
        + "(Jesus becomes Hay-SOOS for a Spanish character). Only that one "
        + "spot changes. Perfect for names with regional pronunciations -- "
        + "Lara can be LOR-ah, LAR-ah, or LAIR-ah depending on who is "
        + "speaking and where. For every occurrence of a word, use the "
        + "Pronunciations dictionary instead -- and where both apply, [say] "
        + "wins, so the dictionary sets the rule and [say] makes the "
        + "exception.",
  },
  {
    kind: "exclude",
    label: "Exclude",
    body: "Wrap text that should stay in your file but never be read "
        + "aloud -- author notes, structural headings, reminders. The "
        + "narration flows past it as if it wasn't there.",
  },
];

export function MarkerHelpPanel() {
  // One demo plays at a time. status distinguishes an actively speaking
  // demo from one the writer paused mid-sentence -- clicking the same
  // button toggles between the two (accidental clicks, "heard enough").
  const [nowPlaying, setNowPlaying] =
    useState<{ kind: string; status: "playing" | "paused" } | null>(null);
  const [loadingKind, setLoadingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Demos are deterministic -- cache each blob URL after the first fetch
  // so replays are instant and free of another synthesis round. (The
  // backend caches the rendered WAV too, so even a remount only pays
  // synthesis once per app session.)
  const cacheRef = useRef<Map<string, string>>(new Map());

  // Leaving the panel mid-demo should silence it.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const hearIt = useCallback(async (kind: string) => {
    if (loadingKind) return;
    setError(null);

    // Same button while its demo is up: toggle pause/resume in place.
    if (nowPlaying?.kind === kind && audioRef.current) {
      if (nowPlaying.status === "playing") {
        audioRef.current.pause();
        setNowPlaying({ kind, status: "paused" });
      } else {
        void audioRef.current.play();
        setNowPlaying({ kind, status: "playing" });
      }
      return;
    }

    try {
      let url = cacheRef.current.get(kind);
      if (!url) {
        setLoadingKind(kind);
        const blob = await fetchMarkerDemo(kind);
        url = URL.createObjectURL(blob);
        cacheRef.current.set(kind, url);
      }
      audioRef.current?.pause();          // a different demo takes over
      const audio = new Audio(url);
      audioRef.current = audio;
      setNowPlaying({ kind, status: "playing" });
      audio.onended = () => setNowPlaying(null);
      void audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play the example.");
    } finally {
      setLoadingKind(null);
    }
  }, [loadingKind, nowPlaying]);

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="mb-2 text-[11px] text-zinc-500">
        Every example below is generated live by the free local narrator
        (Heart voice), exactly the way your book will sound. The narrator is
        quite good at standard pronunciations on its own -- you don't need to
        test every word. Save your markers for names and phrases that need a
        SPECIFIC sound: regional variations, invented names, the way one
        character says another's name.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {HELP_ITEMS.map(item => (
          <div key={item.kind} className="rounded border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-200">{item.label}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                {/* Writers used to metered AI need to know this button is
                    free -- it runs on their own machine, no tokens spent. */}
                <span className="text-[9px] text-zinc-600" title="Generated on your computer -- no tokens or credits are spent">
                  local &middot; free
                </span>
                <button
                  onClick={() => void hearIt(item.kind)}
                  disabled={loadingKind !== null && loadingKind !== item.kind}
                  title={nowPlaying?.kind === item.kind
                    ? (nowPlaying.status === "playing" ? "Click to pause" : "Click to continue")
                    : "Play the example"}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
                    nowPlaying?.kind === item.kind
                      ? "border-emerald-600 text-emerald-300"
                      : "border-zinc-700 text-zinc-300 hover:border-emerald-600 hover:text-emerald-300"
                  }`}
                >
                  {loadingKind === item.kind ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : nowPlaying?.kind === item.kind && nowPlaying.status === "playing" ? (
                    <Pause size={10} />
                  ) : nowPlaying?.kind === item.kind ? (
                    <Play size={10} />
                  ) : (
                    <Volume2 size={10} />
                  )}
                  {nowPlaying?.kind === item.kind
                    ? (nowPlaying.status === "playing" ? "Pause" : "Resume")
                    : "Hear it"}
                </button>
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">{item.body}</p>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-3 py-1.5 text-[11px] text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
