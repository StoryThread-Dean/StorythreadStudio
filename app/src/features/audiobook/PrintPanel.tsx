// features/audiobook/PrintPanel.tsx
// ==================================
// The print pass (spec 13/19): the writer drafts free on the local
// narrator, then -- when the book sounds right -- prints the final with
// a premium hosted voice. Everything paid lives in this one block and
// wears VIOLET, a color used nowhere else in the narration rail, so a
// button that can spend money never looks like one that cannot.
//
// The three money rules this panel exists to keep:
//   1. NOTHING SPENDS WITHOUT A NUMBER FIRST. The estimate is fetched
//      and shown before the confirm appears, and the confirm repeats it.
//   2. AUDITION BEFORE COMMITTING. One passage through the paid voice
//      costs a fraction of a cent and reports what it cost.
//   3. THE FREE PATH STAYS OBVIOUS. The free tier leads the shelf and
//      the panel says outright that drafting is unlimited.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Crown, Loader2, Lock, Play, Sparkles,
} from "lucide-react";

import { fetchPrintEstimate, fetchTtsCatalog, printPreview, startGeneration } from "./api";
import type { NarrationTier, PrintEstimate, TtsCatalog } from "./api";

interface PrintPanelProps {
  workspacePath: string;
  /** The voice picked in the free narration section, offered as the
      starting point when a hosted tier shares Kokoro's voice names. */
  localVoiceId: string;
  /** Current editor selection, so an audition can use the writer's own
      prose instead of a canned sample. */
  getSelectionText?: () => string;
  /** A paid run started -- the rail should start polling. */
  onRunStarted: () => void;
}

// Premium voice controls that do not exist yet. Listed deliberately:
// the writer asked what a premium engine could do beyond pace and
// pauses, and an honest greyed-out list beats a silent gap. Each one is
// a real capability of some hosted engine; none are wired.
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

export function PrintPanel({
  workspacePath, localVoiceId, getSelectionText, onRunStarted,
}: PrintPanelProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  const [tier, setTier] = useState<NarrationTier | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [estimate, setEstimate] = useState<PrintEstimate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"estimate" | "preview" | "print" | null>(null);
  const [lastPreviewCost, setLastPreviewCost] = useState<string | null>(null);
  const [futureOpen, setFutureOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open || catalog) return;
    void (async () => {
      try { setCatalog(await fetchTtsCatalog()); }
      catch (e) {
        setError(e instanceof Error ? e.message : "Could not load narration options.");
      }
    })();
  }, [open, catalog]);

  useEffect(() => () => audioRef.current?.pause(), []);

  /** Voices for the picked tier, from the full catalog. */
  const voicesFor = useCallback((picked: NarrationTier) => {
    const provider = catalog?.providers.find(p => p.provider === picked.provider);
    const model = provider?.models.find(m => m.id === picked.model);
    return model?.voices ?? [];
  }, [catalog]);

  const pickTier = useCallback(async (picked: NarrationTier) => {
    setTier(picked);
    setEstimate(null);
    setConfirming(false);
    setLastPreviewCost(null);
    setError(null);
    const voices = voicesFor(picked);
    // Hosted Kokoro shares the local voice names, so keep the writer's
    // pick; otherwise start at the tier's first voice.
    setVoiceId(voices.some(v => v.id === localVoiceId) ? localVoiceId
      : (voices[0]?.id ?? ""));
    if (!picked.requires_key) return;          // the free tier needs no quote
    setBusy("estimate");
    try {
      setEstimate(await fetchPrintEstimate(workspacePath, picked.provider, picked.model));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not price that voice.");
    } finally {
      setBusy(null);
    }
  }, [localVoiceId, voicesFor, workspacePath]);

  const handleAudition = useCallback(async () => {
    if (!tier || !tier.requires_key || busy) return;
    setBusy("preview");
    setError(null);
    try {
      const selected = (getSelectionText?.() ?? "").trim();
      const { blob, costUsd } = await printPreview(
        workspacePath, tier.provider, tier.model, voiceId, selected);
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      void audio.play();
      setLastPreviewCost(costUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The audition failed.");
    } finally {
      setBusy(null);
    }
  }, [busy, getSelectionText, tier, voiceId, workspacePath]);

  const handlePrint = useCallback(async () => {
    if (!tier || !tier.requires_key || busy) return;
    setBusy("print");
    setError(null);
    try {
      await startGeneration(workspacePath, voiceId, true, false,
                            tier.provider, tier.model);
      setConfirming(false);
      onRunStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the print run.");
    } finally {
      setBusy(null);
    }
  }, [busy, onRunStarted, tier, voiceId, workspacePath]);

  const voices = tier ? voicesFor(tier) : [];

  return (
    <div className="rounded-lg border border-violet-800/70 bg-violet-950/20 p-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Crown size={12} /> Print with a Premium Voice
      </button>

      {open && (
        <div className="mt-3">
          <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
            Drafting on the local narrator is free and unlimited. When the
            book sounds the way you hear it, print the final with a hosted
            voice. You always see the price first, and nothing is spent
            until you confirm it.
          </p>

          {/* The shelf: one honest pick per budget, free first. */}
          <div className="mb-3 space-y-1">
            {(catalog?.recommended ?? []).map(entry => {
              const picked = tier?.model === entry.model
                && tier?.provider === entry.provider;
              const free = !entry.requires_key;
              return (
                <button
                  key={`${entry.provider}:${entry.model}`}
                  onClick={() => void pickTier(entry)}
                  className={"flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition-colors "
                    + (picked
                      ? "border-violet-500 bg-violet-900/40"
                      : "border-zinc-700 hover:border-violet-600")}
                >
                  <span className={"mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase "
                    + (free ? "bg-emerald-600 text-white" : "bg-violet-600 text-white")}>
                    {entry.tier_label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium text-zinc-100">
                      {entry.model_label}
                    </span>
                    <span className="block text-[10px] text-zinc-400">
                      {free
                        ? entry.blurb
                        : `$${entry.price_per_1k_chars} per 1,000 characters`
                          + (entry.same_as_local ? " -- same voices as free" : "")}
                    </span>
                    {!free && !entry.has_api_key && (
                      <span className="mt-0.5 block text-[10px] text-amber-400">
                        Needs an API key in Settings
                        {catalog?.using_writing_keys
                          ? " (your writing key is used unless you set a separate audiobook key)"
                          : " (audiobook narration keys)"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {!catalog && (
              <p className="text-[11px] text-zinc-500">
                <Loader2 size={11} className="mr-1 inline animate-spin" />
                Loading narration options...
              </p>
            )}
          </div>

          {tier?.requires_key && (
            <>
              {voices.length > 0 && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-[10px] text-violet-300">
                    {tier.provider_label} voice
                  </span>
                  <select
                    value={voiceId}
                    onChange={e => setVoiceId(e.target.value)}
                    aria-label="Premium narrator voice"
                    className="w-full rounded border border-violet-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
                  >
                    {voices.map(voice => (
                      <option key={voice.id} value={voice.id}>{voice.label}</option>
                    ))}
                  </select>
                </label>
              )}

              {/* Audition: the cheapest possible way to hear this voice. */}
              <button
                onClick={() => void handleAudition()}
                disabled={busy !== null}
                title="Hear this paid voice on your selected passage (or a short sample). Costs a fraction of a cent."
                className="mb-1 inline-flex items-center gap-1.5 rounded border border-violet-600 bg-violet-900/40 px-3 py-1.5 text-[11px] font-medium text-violet-100 hover:border-violet-400 hover:bg-violet-900/70 disabled:opacity-40"
              >
                {busy === "preview"
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Play size={11} />}
                Preview This Voice
              </button>
              {lastPreviewCost && (
                <p className="mb-2 text-[10px] text-zinc-400">
                  That audition cost about ${lastPreviewCost}.
                </p>
              )}

              {/* The estimate, always before the spend. */}
              {busy === "estimate" && (
                <p className="mb-2 text-[11px] text-violet-300">
                  <Loader2 size={11} className="mr-1 inline animate-spin" />
                  Pricing this book...
                </p>
              )}
              {estimate && (
                <div className="mb-2 rounded border border-violet-800 bg-zinc-950/60 px-2.5 py-2">
                  <p className="text-xs font-semibold text-violet-200">
                    Printing with {estimate.model_label}: about $
                    {estimate.estimate_usd}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                    {estimate.characters.toLocaleString()} characters across{" "}
                    {estimate.segments} passages in {estimate.chapters} chapter
                    {estimate.chapters === 1 ? "" : "s"}, at $
                    {estimate.price_per_1k_chars} per 1,000.
                  </p>
                  {estimate.note && (
                    <p className="mt-1 text-[10px] leading-relaxed text-amber-300">
                      {estimate.note}
                    </p>
                  )}
                </div>
              )}

              {/* The gate. Nothing above this line spends a full book. */}
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={!estimate || busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                  <Sparkles size={13} /> Print the Audiobook
                </button>
              ) : (
                <div className="rounded border border-violet-600 bg-violet-950/60 px-3 py-2.5">
                  <p className="mb-1 text-[13px] font-semibold text-violet-100">
                    Spend about ${estimate?.estimate_usd} printing this book
                    with {estimate?.model_label}?
                  </p>
                  <p className="mb-2 text-[13px] leading-relaxed text-violet-200/90">
                    This regenerates every passage with the paid voice. Your
                    free local audio stays on disk until the new audio
                    replaces it, and the run can be paused at any time --
                    you are only charged for what has been narrated.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handlePrint()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded bg-violet-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-400 disabled:opacity-40"
                    >
                      {busy === "print" && <Loader2 size={11} className="animate-spin" />}
                      Yes, print it
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
