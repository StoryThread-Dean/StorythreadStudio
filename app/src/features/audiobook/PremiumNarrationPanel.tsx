// features/audiobook/PremiumNarrationPanel.tsx
// ============================================
// The final pass: narrating the finished book with a hosted premium voice.
// Everything in the app that can SPEND money lives in this one block, and
// it wears VIOLET -- a color used nowhere else in the narration rail -- so
// a button that bills never looks like one that cannot.
//
// The engine is NOT chosen here. It is chosen once in Audiobook Settings
// and this panel reports it, because a writer who picks an engine in two
// places eventually spends on the wrong one. What IS here is the part that
// belongs next to your ears: the voice for this book, a sample, the price,
// and the confirm.
//
// The money rules, in the order they matter:
//   1. NOTHING SPENDS WITHOUT A NUMBER FIRST -- the estimate is fetched
//      and shown before any spend control exists, the confirm repeats it,
//      and a changed engine drops the old number instantly.
//   2. NO KEY, NO CONTROLS. An engine that cannot pay shows instructions,
//      not buttons.
//   3. THE FREE PATH IS SOMEWHERE ELSE. There is deliberately no "free"
//      option in here: the narration section above IS the free path, and
//      offering free inside "premium" only confused people.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, Crown, Loader2, Lock, Play,
  Settings as SettingsIcon, Sparkles,
} from "lucide-react";

import {
  fetchNarrationSelection, fetchPrintEstimate, printPreview,
  saveNarrationChoice, startGeneration,
} from "./api";
import type { NarrationSelection, PrintEstimate } from "./api";
import type { NarratorVoice } from "./types";
import { VoicePicker } from "./VoicePicker";

interface PremiumNarrationPanelProps {
  workspacePath: string;
  /** The local narrator's voices, so hosted Kokoro (the same engine) can
      offer the full roster rather than a curated handful. */
  localVoices?: NarratorVoice[];
  /** Current editor selection, so a sample can use the writer's own prose
      instead of a canned sentence. */
  getSelectionText?: () => string;
  /** Bumped when Audiobook Settings are saved -- refetch the engine. */
  settingsVersion?: number;
  onOpenSettings?: () => void;
  /** A paid run started -- the rail should start polling. */
  onRunStarted: () => void;
}

// Premium voice controls that do not exist yet. Listed deliberately: the
// question "what else could a premium engine do?" deserves an honest
// greyed-out answer rather than a silent gap. Each is a real capability of
// some hosted engine; none are wired.
const FUTURE_CONTROLS: Array<{ label: string; detail: string }> = [
  { label: "Emphasis: strong / moderate / none",
    detail: "Lean on a word the way a narrator would, without respelling it." },
  { label: "Whisper",
    detail: "Drop a line to a whisper for a secret or an aside." },
  { label: "Volume per span",
    detail: "Push a shout louder or pull a murmur back inside one paragraph." },
  { label: "Pitch and intonation",
    detail: "Raise or lower the voice; shape a question that is punctuated flat." },
  { label: "Emotion / delivery style",
    detail: "Ask for grief, wry amusement, urgency by name." },
  { label: "Per-character voices",
    detail: "Cast a different voice for each speaker and let dialogue play itself." },
];

export function PremiumNarrationPanel({
  workspacePath, localVoices = [], getSelectionText,
  settingsVersion = 0, onOpenSettings, onRunStarted,
}: PremiumNarrationPanelProps) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<NarrationSelection | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [estimate, setEstimate] = useState<PrintEstimate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"estimate" | "preview" | "narrate" | null>(null);
  const [lastPreviewCost, setLastPreviewCost] = useState<string | null>(null);
  const [futureOpen, setFutureOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Which engine is in effect, straight from the backend resolver -- the
  // same answer Settings and generation see, so they cannot disagree.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await fetchNarrationSelection(workspacePath);
        if (cancelled) return;
        setSelection(fresh);
        setVoiceId(fresh.book_voice || fresh.default_voice
          || fresh.voices[0]?.id || "");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message
            : "Could not read the narration engine.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, workspacePath, settingsVersion]);

  // THE money guard: a stale estimate must never sit under a live confirm.
  // If the engine changes (in Settings, or between books), the old number
  // and any pending confirmation are dropped -- otherwise a $31 quote
  // could survive a switch to a cheaper engine and be confirmed as if it
  // still applied.
  useEffect(() => {
    setEstimate(null);
    setConfirming(false);
    setLastPreviewCost(null);
  }, [selection?.provider, selection?.model]);

  useEffect(() => () => audioRef.current?.pause(), []);

  // Price the book as soon as a usable engine is known.
  useEffect(() => {
    if (!open || !selection?.can_spend) return;
    let cancelled = false;
    setBusy("estimate");
    void (async () => {
      try {
        const priced = await fetchPrintEstimate(
          workspacePath, selection.provider, selection.model);
        if (!cancelled) setEstimate(priced);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not price this book.");
        }
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, selection?.can_spend, selection?.provider, selection?.model, workspacePath]);

  const voiceOptions = selection?.voices_same_as_local && localVoices.length > 0
    ? localVoices.map(v => ({ id: v.id, label: v.label }))
    : (selection?.voices ?? []).map(v => ({ id: v.id, label: v.label }));

  const changeVoice = useCallback((next: string) => {
    setVoiceId(next);
    // Per-book override, fire-and-forget like the local narrator's voice.
    void saveNarrationChoice(workspacePath, { premium_voice: next }).catch(() => {});
  }, [workspacePath]);

  const handleAudition = useCallback(async () => {
    if (!selection?.can_spend || busy) return;
    setBusy("preview");
    setError(null);
    try {
      const selected = (getSelectionText?.() ?? "").trim();
      const { blob, costUsd } = await printPreview(
        workspacePath, selection.provider, selection.model, voiceId, selected);
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      void audio.play();
      setLastPreviewCost(costUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sample failed.");
    } finally {
      setBusy(null);
    }
  }, [busy, getSelectionText, selection, voiceId, workspacePath]);

  const handleNarrate = useCallback(async () => {
    if (!selection?.can_spend || busy) return;
    setBusy("narrate");
    setError(null);
    try {
      await startGeneration(workspacePath, voiceId, true, false,
                            selection.provider, selection.model);
      setConfirming(false);
      onRunStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the narration run.");
    } finally {
      setBusy(null);
    }
  }, [busy, onRunStarted, selection, voiceId, workspacePath]);

  const settingsLink = (label: string) => (
    <button
      onClick={onOpenSettings}
      className="inline-flex items-center gap-1 rounded border border-violet-700 px-2 py-1 text-[10px] text-violet-200 hover:border-violet-400 hover:text-violet-100"
    >
      <SettingsIcon size={10} /> {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-violet-800/70 bg-violet-950/20 p-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Crown size={12} /> Premium Narration
      </button>

      {open && (
        <div className="mt-3">
          <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
            The narration section above is the free path, and drafting there
            is unlimited. When the book sounds the way you hear it, narrate
            the final version with a hosted premium voice. You always see
            the price first, and nothing is spent until you confirm.
          </p>

          {!selection && !error && (
            <p className="text-[11px] text-zinc-500">
              <Loader2 size={11} className="mr-1 inline animate-spin" />
              Reading the narration engine...
            </p>
          )}

          {/* ── The engine: reported here, chosen in Settings ── */}
          {selection && selection.source === "none" && (
            <div className="rounded border border-zinc-700 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[11px] text-zinc-300">
                No premium engine chosen, so narration stays free and local.
              </p>
              <div className="mt-1.5">{settingsLink("Choose an engine in Settings")}</div>
            </div>
          )}

          {selection && selection.source === "writing-fallback" && (
            /* Deliberately a DIFFERENT colour from a usable engine: this is
               the writing model, and it will not narrate. */
            <div className="rounded border border-rose-800 bg-rose-950/50 px-2.5 py-2">
              <p className="flex items-start gap-1.5 text-[11px] font-medium text-rose-300">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {selection.model_label} ({selection.provider_label})
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-rose-200/90">
                {selection.fallback_note}
              </p>
              <div className="mt-1.5">{settingsLink("Pick a narration engine")}</div>
            </div>
          )}

          {selection && (selection.source === "settings" || selection.source === "book") && (
            <>
              <div className="rounded border border-violet-800 bg-zinc-950/60 px-2.5 py-2">
                <p className="flex items-center gap-1.5">
                  <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                    {selection.tier_label}
                  </span>
                  <span className="text-[11px] font-medium text-zinc-100">
                    {selection.model_label}
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] text-zinc-400">
                  {selection.provider_label}
                  {selection.price_per_million_chars
                    && ` -- $${selection.price_per_million_chars} per million characters`}
                </p>
                <p className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] italic text-zinc-500">
                    {selection.source === "book"
                      ? "Chosen for this book"
                      : "Chosen in Audiobook Settings"}
                  </span>
                  {settingsLink("Change")}
                </p>
              </div>

              {/* No key: instructions, never buttons. */}
              {selection.warning && (
                <div className="mt-2 rounded border border-amber-800 bg-amber-950/40 px-2.5 py-2">
                  <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-300">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {selection.warning}
                  </p>
                  {selection.signup_steps.length > 0 && (
                    <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[10px] leading-relaxed text-amber-200/90">
                      {selection.signup_steps.map(step => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                  <div className="mt-1.5">{settingsLink("Add the key in Settings")}</div>
                </div>
              )}

              {selection.can_spend && (
                <>
                  {/* The voice for THIS book: an ear decision, so it lives
                      beside the sample rather than in Settings. */}
                  <div className="mt-3">
                    <span className="mb-1 block text-[10px] text-violet-300">
                      Voice for this book
                    </span>
                    <VoicePicker
                      axes={selection.voice_axes}
                      voices={voiceOptions}
                      value={voiceId}
                      onChange={changeVoice}
                      ariaLabel="Premium narrator voice"
                      verified={selection.voices_verified}
                      tone="violet"
                    />
                    <p className="mt-1 text-[10px] text-zinc-500">
                      The default comes from Settings; this book can differ.
                      {selection.voices_are_fallback
                        && " Install the local narrator to see its full voice list here."}
                    </p>
                  </div>

                  <button
                    onClick={() => void handleAudition()}
                    disabled={busy !== null}
                    title="Hear this paid voice on your selected passage (or a short sample). Costs a fraction of a cent."
                    className="mt-2 inline-flex items-center gap-1.5 rounded border border-violet-600 bg-violet-900/40 px-3 py-1.5 text-[11px] font-medium text-violet-100 hover:border-violet-400 hover:bg-violet-900/70 disabled:opacity-40"
                  >
                    {busy === "preview"
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Play size={11} />}
                    Sample This Voice
                  </button>
                  {lastPreviewCost && (
                    <p className="mt-1 text-[10px] text-zinc-400">
                      That sample cost about ${lastPreviewCost}.
                    </p>
                  )}

                  {busy === "estimate" && (
                    <p className="mt-2 text-[11px] text-violet-300">
                      <Loader2 size={11} className="mr-1 inline animate-spin" />
                      Pricing this book...
                    </p>
                  )}
                  {estimate && (
                    <div className="mt-2 rounded border border-violet-800 bg-zinc-950/60 px-2.5 py-2">
                      <p className="text-xs font-semibold text-violet-200">
                        Narrating with {estimate.model_label}: about $
                        {estimate.estimate_usd}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                        {estimate.characters.toLocaleString()} characters across{" "}
                        {estimate.segments} passages in {estimate.chapters} chapter
                        {estimate.chapters === 1 ? "" : "s"}.
                      </p>
                      {estimate.note && (
                        <p className="mt-1 text-[10px] leading-relaxed text-amber-300">
                          {estimate.note}
                        </p>
                      )}
                    </div>
                  )}

                  {/* The gate. Nothing above this line spends a whole book. */}
                  {!confirming ? (
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={!estimate || busy !== null}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                    >
                      <Sparkles size={13} /> Narrate the Final Version
                    </button>
                  ) : (
                    <div className="mt-2 rounded border border-violet-600 bg-violet-950/60 px-3 py-2.5">
                      <p className="mb-1 text-[13px] font-semibold text-violet-100">
                        Spend about ${estimate?.estimate_usd} narrating this book
                        with {estimate?.model_label}?
                      </p>
                      <p className="mb-2 text-[13px] leading-relaxed text-violet-200/90">
                        This re-narrates every passage with the paid voice.
                        Your free local audio stays on disk until the new
                        audio replaces it, and the run can be paused at any
                        time -- you are only charged for what has been
                        narrated.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleNarrate()}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1.5 rounded bg-violet-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-400 disabled:opacity-40"
                        >
                          {busy === "narrate" && <Loader2 size={11} className="animate-spin" />}
                          Yes, narrate it
                        </button>
                        <button
                          onClick={() => setConfirming(false)}
                          className="rounded border border-zinc-600 px-3 py-1.5 text-[11px] text-zinc-200 hover:border-zinc-400"
                        >
                          Keep drafting free
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Coming later: the premium-only vocal controls. */}
          <button
            onClick={() => setFutureOpen(v => !v)}
            className="mt-3 flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"
          >
            {futureOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Lock size={10} /> Premium voice controls
          </button>
          {futureOpen && (
            <ul className="mt-1 space-y-1 rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <li className="mb-1 text-[10px] leading-relaxed text-zinc-500">
                These need an engine that takes direction beyond pace and
                pauses. Reserved here so you can see where narration is
                heading; none are wired yet.
              </li>
              {FUTURE_CONTROLS.map(control => (
                <li
                  key={control.label}
                  title="Future development"
                  aria-disabled
                  className="cursor-not-allowed select-none rounded border border-zinc-800 px-2 py-1 opacity-50"
                >
                  <span className="block text-[11px] font-medium text-zinc-400">
                    {control.label}
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    {control.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="mt-2 rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[10px] text-rose-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
