// components/DialogueCheck.tsx -- hear a passage read aloud.
// ============================================================
// Reading your own writing silently is the worst way to judge it: you
// supply the rhythm, the pauses and the intent without noticing, so it
// always sounds better in your head than on the page. An indifferent
// voice supplies none of that.
//
// Dialogue is the obvious use and the one it was built for, but it earns
// its keep on narration too, because the ear catches a different class
// of problem than the eye: a word repeated three times in a paragraph,
// a sentence that only parses on the second read, and above all the
// RIGHT-WORD-WRONG-WORD errors no checker flags -- "Lara walked through
// the dessert" is perfect spelling, perfect grammar, and audibly absurd.
//
// Deliberately the smallest possible tool for that job:
//
//   ONE VOICE, four choices. A picker with fifty-four voices turns a
//   two-second check into a browsing session, and the point is to hear
//   the WORDS.
//   LOCAL ONLY. Free, unlimited, offline, no key, no account.
//   NOTHING IS KEPT. The audio exists in the browser for as long as the
//   window is open and is never written anywhere.
//   NO MARKERS, no pacing, no pauses. This is not a narration rehearsal
//   and must not become one -- the Audiobook Converter is where audio
//   gets produced.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, Headphones, Loader2, Play,
  Square, X,
} from "lucide-react";

const API_BASE = "http://localhost:8000";

interface DialogueCheckProps {
  /** The passage to read -- whatever the writer had selected. */
  text: string;
  /** False when nothing was selected and this is the whole chapter. */
  hadSelection?: boolean;
  /** The voice remembered for THIS book. */
  voiceId?: string;
  onVoiceChange?: (voiceId: string) => void;
  onClose: () => void;
}

interface Voice { id: string; label: string }

// Local Kokoro runs faster than realtime; measured around 2.4x on CPU.
// Prose reads at roughly 1,000 characters a minute, so this lands close
// enough to set an expectation, which is all it is for.
const SECONDS_PER_CHAR = 60 / 1000 / 2.4;

function estimateWait(chars: number): string {
  const seconds = Math.round(chars * SECONDS_PER_CHAR);
  if (seconds < 20) return "a few seconds";
  if (seconds < 90) return `about ${Math.round(seconds / 10) * 10} seconds`;
  return `about ${Math.round(seconds / 60)} minute${seconds >= 90 ? "s" : ""}`;
}

export function DialogueCheck({
  text, hadSelection = true, voiceId: rememberedVoice, onVoiceChange, onClose,
}: DialogueCheckProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  // Heart until the writer picks otherwise; their pick then follows the
  // book, not the machine.
  const [voiceId, setVoiceId] = useState(rememberedVoice || "af_heart");
  const [engine, setEngine] = useState<"checking" | "ready" | "missing">("checking");
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState<null | "reading" | "sample">(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  // ONE player: the visible <audio> element. An earlier version also
  // created a detached Audio() to start playback, which meant two
  // elements on the same blob and a pause() from one aborting the
  // other's play() -- a rejected promise reported as an error over
  // audio that was playing perfectly.
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const chars = text.trim().length;
  const long = chars > 4000;

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/audiobook/dialogue-check/voices`);
        const body = await res.json();
        setVoices(body.voices ?? []);
      } catch { /* the four ids below still work */ }
    })();
  }, []);

  const checkEngine = useCallback(async () => {
    setEngine("checking");
    try {
      const res = await fetch(`${API_BASE}/api/audiobook/local-engine/status`);
      const body = await res.json();
      setEngine(body.installed ? "ready" : "missing");
    } catch {
      setEngine("missing");
    }
  }, []);

  useEffect(() => { void checkEngine(); }, [checkEngine]);

  // Poll while the engine downloads, then carry straight on.
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/audiobook/local-engine/status`);
        const body = await res.json();
        if (body.installed || body.install?.state === "done") {
          window.clearInterval(timer);
          setInstalling(false);
          setEngine("ready");
        } else if (body.install?.state === "error") {
          window.clearInterval(timer);
          setInstalling(false);
          setError(body.install.error ?? "The voice download failed.");
        }
      } catch { /* keep waiting */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [installing]);

  // Nothing is kept: the object URL dies with the window. Cleanup is
  // tied to UNMOUNT, not to the url changing -- the old version tore
  // down on every new clip, which paused the player a beat after it had
  // been told to start.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Play whatever clip is current. Autoplay is allowed here because
  // every clip arrives from a button the writer just pressed.
  useEffect(() => {
    if (!url || !playerRef.current) return;
    playerRef.current.play().catch((e: unknown) => {
      // AbortError means something replaced this clip before it got
      // going -- the writer pressing the button twice. Not a failure,
      // and certainly not one to report over working audio.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Could not play that audio.");
    });
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function speak(passage: string, kind: "reading" | "sample") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/audiobook/dialogue-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: passage, voice_id: voiceId }),
      });
      if (!res.ok) {
        let detail = `Could not read that (${res.status}).`;
        try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      playerRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const fresh = URL.createObjectURL(blob);
      urlRef.current = fresh;
      setUrl(fresh);
      // Playback is started by the effect above, once the element has
      // actually been given the new src. Calling play() here would race
      // React's render and reject for no reason.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that passage.");
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    setError(null);
    try {
      await fetch(`${API_BASE}/api/audiobook/local-engine/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setInstalling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the download.");
    }
  }

  const options = voices.length ? voices : [
    { id: "af_heart", label: "Heart (American female)" },
    { id: "am_michael", label: "Michael (American male)" },
    { id: "bf_emma", label: "Emma (British female)" },
    { id: "bm_george", label: "George (British male)" },
  ];

  return (
    <div
      role="dialog"
      aria-label="Passage / Dialogue Check"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Headphones size={15} className="text-accent" />
          <h2 className="flex-1 text-sm font-semibold text-text-primary">
            Passage / Dialogue Check
          </h2>
          <button onClick={onClose} aria-label="Close dialogue check"
                  className="rounded p-1 text-text-secondary hover:text-text-primary">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-[12px] leading-relaxed text-text-secondary">
            Hear this passage read aloud. Your ear catches what your eye
            skims.
          </p>

          {/* Everything else on request. A writer who opened this knows
              what they came for; the reasoning is worth reading once and
              should not sit between them and the button every time. */}
          <div>
            <button
              onClick={() => setShowWhy(v => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
            >
              {showWhy ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              What's this for?
            </button>
            {showWhy && (
              <div className="mt-1.5 space-y-2 rounded border border-border bg-bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
                <p>
                  Reading your own words silently hides their rhythm. You
                  supply the pauses and the emphasis without noticing, so it
                  always sounds better in your head than on the page. An
                  indifferent voice supplies none of that.
                </p>
                <p>
                  Dialogue is the obvious use: whether an exchange sounds
                  like people talking, or like one person writing both
                  halves. It works just as well on narration, where the ear
                  catches a different class of problem -- a word repeated
                  three times in a paragraph, a sentence that only parses
                  on the second read, and the right-word-wrong-word errors
                  no checker flags. "Lara walked through the dessert" is
                  perfect spelling and perfect grammar.
                </p>
                <p>
                  Pick a voice, press the button, listen. Nothing is saved
                  and nothing is changed in your manuscript.
                </p>
              </div>
            )}
          </div>

          {!hadSelection && (
            <p className="rounded border border-border bg-bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
              Nothing was selected, so this is the whole chapter. Select a
              scene or a passage first and it will read just that -- faster
              to prepare, and easier to judge.
            </p>
          )}

          {engine === "missing" ? (
            <div className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2.5">
              <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-200">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                The free voice engine is not installed yet.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
                Dialogue Check reads entirely on your computer -- no account,
                no key, nothing sent anywhere. It needs a one-time download of
                about 372 MB, shared with the Audiobook Converter.
              </p>
              <button
                onClick={() => void install()}
                disabled={installing}
                className="mt-2 inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
              >
                {installing && <Loader2 size={12} className="animate-spin" />}
                {installing ? "Downloading the voices..." : "Install the voices"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-text-secondary" htmlFor="dc-voice">
                  Read by
                </label>
                <select
                  id="dc-voice"
                  value={voiceId}
                  onChange={e => {
                    setVoiceId(e.target.value);
                    onVoiceChange?.(e.target.value);
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1 text-[12px] text-text-primary"
                >
                  {options.map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => void speak(
                    "The road disappeared beneath the gathering snow.", "sample")}
                  disabled={busy !== null || engine !== "ready"}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40"
                >
                  {busy === "sample"
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Play size={11} />}
                  Sample
                </button>
              </div>

              <p className="text-[11px] text-text-secondary">
                {chars.toLocaleString()} characters selected -- around{" "}
                {estimateWait(chars)} to prepare.
                {long && (
                  <span className="text-amber-300">
                    {" "}Long passages are fine; they just take a while. A
                    single scene is usually enough to hear the problem.
                  </span>
                )}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void speak(text, "reading")}
                  disabled={busy !== null || engine !== "ready" || chars === 0}
                  className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-[12px] font-semibold text-black disabled:opacity-40"
                >
                  {busy === "reading"
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Play size={13} />}
                  {busy === "reading" ? "Preparing..." : "Read it to me"}
                </button>
                {url && (
                  <button
                    onClick={() => { playerRef.current?.pause(); }}
                    className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <Square size={12} /> Stop
                  </button>
                )}
              </div>

              {url && (
                <audio ref={playerRef} controls src={url} className="w-full"
                       aria-label="Playback" />
              )}
            </>
          )}

          {error && (
            <p className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </p>
          )}

          {/* Faded on purpose: this is a boundary statement, not
              instructions. It matters the first time and never again. */}
          <p className="border-t border-border pt-3 text-[10px] leading-relaxed text-faint">
            This is listening, not producing. Nothing is saved, no markers or
            pacing apply, and the audio disappears when you close this window.
            To make an actual audiobook -- chapter files, an M4B, character
            voices -- use the <span className="text-text-muted">Audiobook
            Converter</span> from the project home.
          </p>
        </div>
      </div>
    </div>
  );
}
