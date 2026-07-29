// features/audiobook/MarkerHelpPanel.tsx
// =======================================
// The "What's this?" panel for the marker toolbar: plain-language
// explanations plus a [Hear it] button per marker that plays a REAL
// rendered example -- synthesized through the actual pipeline in the
// default reference voice (Heart), with real stitched silence. Hearing a
// 1.5 second pause teaches more than any sentence about one.

import { useCallback, useRef, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";

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
    kind: "say",
    label: "[say] -- one-spot pronunciation",
    body: "Select a word, click [say], and type how it should sound "
        + "(like KAY-lith). Only that one spot changes. For every "
        + "occurrence of a word, use the Pronunciations dictionary instead.",
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
  const [playingKind, setPlayingKind] = useState<string | null>(null);
  const [loadingKind, setLoadingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Demos are deterministic -- cache each blob URL after the first fetch
  // so replays are instant and free of another synthesis round.
  const cacheRef = useRef<Map<string, string>>(new Map());

  const hearIt = useCallback(async (kind: string) => {
    if (loadingKind) return;
    setError(null);
    try {
      let url = cacheRef.current.get(kind);
      if (!url) {
        setLoadingKind(kind);
        const blob = await fetchMarkerDemo(kind);
        url = URL.createObjectURL(blob);
        cacheRef.current.set(kind, url);
      }
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingKind(kind);
      audio.onended = () => setPlayingKind(null);
      void audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play the example.");
    } finally {
      setLoadingKind(null);
    }
  }, [loadingKind]);

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="mb-2 text-[11px] text-zinc-500">
        Every example below is generated live by the free local narrator
        (Heart voice), exactly the way your book will sound.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {HELP_ITEMS.map(item => (
          <div key={item.kind} className="rounded border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-200">{item.label}</p>
              <button
                onClick={() => void hearIt(item.kind)}
                disabled={loadingKind !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
              >
                {loadingKind === item.kind
                  ? <Loader2 size={10} className="animate-spin" />
                  : <Volume2 size={10} className={playingKind === item.kind ? "text-emerald-400" : ""} />}
                Hear it
              </button>
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
