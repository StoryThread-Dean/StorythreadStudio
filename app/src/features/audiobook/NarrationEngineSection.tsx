// features/audiobook/NarrationEngineSection.tsx
// =============================================
// WHICH engine narrates, chosen once, here. The shelf is grouped by budget
// with Free leading, so the paid tiers read as a deliberate upgrade rather
// than the normal path.
//
// Three honesty rules this section exists to keep:
//   - A tier whose API key is missing says so in AMBER, right on the card,
//     with the provider's sign-up steps -- never a silent failure later.
//   - Hosted Kokoro says out loud that it keeps the local narrator's own
//     voices, because that is the one paid tier where the voice a writer
//     fell in love with survives.
//   - An engine we listened to and did not like drops OFF the main shelf
//     into a disclosure below it, carrying the reason. Demoted, never
//     hidden: it stays one click away and a book already pointed at one
//     keeps working, with its shelf opened so the choice is never
//     invisible.

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight } from "lucide-react";

import { WhatsThis } from "./WhatsThis";
import { VoicePicker } from "./VoicePicker";
import type { NarrationTier, TtsCatalog } from "./api";
import type { NarratorVoice } from "./types";

interface NarrationEngineSectionProps {
  catalog: TtsCatalog | null;
  chosenProvider: string;
  chosenModel: string;
  premiumVoice: string;
  localVoices: NarratorVoice[];
  onChoose: (tier: NarrationTier) => void;
  onPremiumVoiceChange: (voice: string) => void;
}

const TIER_BADGE: Record<string, string> = {
  free:     "bg-emerald-600 text-white",
  budget:   "bg-sky-500 text-zinc-950",
  standard: "bg-violet-500 text-white",
  pro:      "bg-red-500 text-white",
};

export function NarrationEngineSection({
  catalog, chosenProvider, chosenModel, premiumVoice, localVoices,
  onChoose, onPremiumVoiceChange,
}: NarrationEngineSectionProps) {
  const tiers = catalog?.recommended ?? [];
  // The shelf splits: engines we stand behind, and engines that work but
  // that we would not steer anyone toward.
  const shelf = tiers.filter(t => t.recommended !== false);
  const demoted = tiers.filter(t => t.recommended === false);
  const chosenIsDemoted = demoted.some(
    t => t.provider === chosenProvider && t.model === chosenModel);
  const [showOthers, setShowOthers] = useState(false);
  // Force the drawer open when the writer's own engine lives in it --
  // a selection you cannot see is worse than one you did not want.
  const othersOpen = showOthers || chosenIsDemoted;

  const chosen = tiers.find(
    t => t.provider === chosenProvider && t.model === chosenModel);
  // Nothing chosen = the free local narrator, which is the honest default.
  const activeTier = chosen ?? tiers.find(t => !t.requires_key) ?? null;

  // The premium voice list: hosted Kokoro speaks the LOCAL roster (all 54),
  // everything else brings its own cast.
  const catalogModel = catalog?.providers
    .find(p => p.provider === chosen?.provider)?.models
    .find(m => m.id === chosen?.model);
  const voiceOptions = chosen?.voices_same_as_local && localVoices.length > 0
    ? localVoices.map(v => ({ id: v.id, label: v.label }))
    : (catalogModel?.voices ?? []).map(v => ({ id: v.id, label: v.label }));

  // One row, used by both shelves -- a demoted engine must look and behave
  // exactly like a recommended one once you have chosen it.
  function renderTier(tier: NarrationTier) {
    const picked = activeTier?.provider === tier.provider
      && activeTier?.model === tier.model;
    const needsKey = tier.requires_key && !tier.has_api_key;
    return (
      <div key={`${tier.provider}:${tier.model}`}>
        <button
          onClick={() => onChoose(tier)}
          className={"flex w-full items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors "
            + (picked
              ? "border-blue-500 bg-blue-950/40"
              : "border-zinc-700 hover:border-blue-600")}
        >
          <span className={"mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase "
            + (TIER_BADGE[tier.tier] ?? "bg-zinc-600 text-white")}>
            {tier.tier_label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-zinc-100">
                {tier.model_label}
              </span>
              {picked && <Check size={11} className="shrink-0 text-blue-300" />}
            </span>
            <span className="block text-[10px] text-zinc-400">
              {tier.requires_key
                ? `${tier.provider_label} -- $${tier.price_per_million_chars} per million characters`
                : tier.blurb}
            </span>
            {tier.requires_key && tier.voices_same_as_local && (
              <span className="block text-[10px] text-emerald-400">
                Keeps every voice your free narrator has.
              </span>
            )}
            {tier.requires_key && !tier.voices_verified && (
              <span className="block text-[10px] text-zinc-500">
                This provider does not publish its voice list -- leave
                the voice blank for the model's default.
              </span>
            )}
            {/* The reason it was demoted, always on the card -- not buried
                in a tooltip a writer finds after paying. */}
            {tier.caveat && (
              <span className="mt-1 block text-[10px] leading-relaxed text-amber-300/80">
                {tier.caveat}
              </span>
            )}
          </span>
        </button>

        {/* AMBER: a real engine with no way to pay for it yet. */}
        {needsKey && picked && (
          <div className="mt-1 rounded border border-amber-800 bg-amber-950/40 px-2.5 py-2">
            <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-300">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              No {tier.provider_label} API key is connected, so this
              engine cannot narrate yet.
            </p>
            {tier.signup_steps.length > 0 && (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[10px] leading-relaxed text-amber-200/90">
                {tier.signup_steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            )}
            <p className="mt-1.5 text-[10px] text-amber-200/80">
              Add the key under Narration API Keys below.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <h3 className="mb-1 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Narration Engine
      </h3>
      <p className="mb-3 mt-2 text-[11px] leading-relaxed text-zinc-400">
        These are the engines Storythread knows how to narrate with.
        Drafting on the free local narrator is unlimited; the paid tiers
        are for the final pass, and you always see the price before
        anything is spent.
      </p>

      <div className="space-y-1.5">
        {shelf.map(renderTier)}
        {!catalog && (
          <p className="text-[11px] text-zinc-500">Loading engines...</p>
        )}
      </div>

      {/* Demoted engines: real, selectable, and honest about why they are
          down here rather than up there. */}
      {demoted.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowOthers(v => !v)}
            className="flex w-full items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            {othersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Other engines we tested but do not recommend ({demoted.length})
          </button>
          {othersOpen && (
            <div className="mt-1.5 space-y-1.5 border-l border-zinc-800 pl-2">
              {demoted.map(renderTier)}
            </div>
          )}
        </div>
      )}
      {/* The default premium voice for whichever paid engine is chosen. */}
      {chosen?.requires_key && (
        <div className="mt-3">
          <span className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-400">
              Default voice for {chosen.model_label}
            </span>
          </span>
          <VoicePicker
            axes={catalogModel?.voice_axes ?? null}
            voices={voiceOptions}
            value={premiumVoice}
            onChange={onPremiumVoiceChange}
            ariaLabel="Default premium voice"
            verified={catalogModel?.voices_verified ?? true}
            tone="blue"
          />
          <div className="mt-1">
            <WhatsThis label="Which voices survive?">
              Hosted Kokoro is the same engine as your free narrator, so
              every one of its voices is available there -- the voice you
              drafted with carries straight through. The Standard and Pro
              engines are different models with their own casts, so a local
              voice cannot follow you there; you pick from their list
              instead. A single book can override this default in the
              Premium Narration panel.
            </WhatsThis>
          </div>
        </div>
      )}
    </section>
  );
}
