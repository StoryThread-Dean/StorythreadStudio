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
  free:     "bg-accent-fill text-white",
  budget:   "bg-secondary-fill text-on-accent",
  standard: "bg-weave-fill text-white",
  pro:      "bg-danger-fill text-white",
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

  // A whole price tier can end up empty -- every Standard engine we
  // auditioned came off the shelf. Say so rather than leaving a silent
  // gap between Budget and Pro that reads like a failed load.
  const emptyTiers = Array.from(new Set(
    demoted.filter(d => !shelf.some(s => s.tier === d.tier))
      .map(d => d.tier_label)));

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
              ? "border-secondary-fill bg-secondary-soft"
              : "border-border hover:border-secondary-fill")}
        >
          <span className={"mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-2xs font-bold uppercase "
            + (TIER_BADGE[tier.tier] ?? "bg-bg-raised text-white")}>
            {tier.tier_label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-mini font-medium text-text-primary">
                {tier.model_label}
              </span>
              {picked && <Check size={11} className="shrink-0 text-secondary" />}
            </span>
            <span className="block text-micro text-text-muted">
              {tier.requires_key
                ? `${tier.provider_label} -- $${tier.price_per_million_chars} per million characters`
                : tier.blurb}
            </span>
            {tier.requires_key && tier.voices_same_as_local && (
              <span className="block text-micro text-accent-muted">
                Keeps every voice your free narrator has.
              </span>
            )}
            {tier.requires_key && !tier.voices_verified && (
              <span className="block text-micro text-faint">
                Voice ids for this engine are unconfirmed -- type one, or
                leave it blank for the model's own default.
              </span>
            )}
            {/* Pace is engine-relative and this one is being re-scaled.
                Say so: a silent change to speech RATE is exactly the kind
                of invisible transform that reads as a bug when the writer
                notices it in the audio. */}
            {tier.requires_key && tier.pace_baseline !== undefined
              && tier.pace_baseline !== 1 && (
              <span className="block text-micro text-secondary/80">
                Reads {tier.pace_baseline < 1 ? "slower" : "faster"} than the
                free narrator by nature, so your pace settings are re-scaled
                to sound the same here.
              </span>
            )}
            {/* The reason it was demoted, always on the card -- not buried
                in a tooltip a writer finds after paying. */}
            {tier.caveat && (
              <span className="mt-1 block text-micro leading-relaxed text-warn/80">
                {tier.caveat}
              </span>
            )}
          </span>
        </button>

        {/* AMBER: a real engine with no way to pay for it yet. */}
        {needsKey && picked && (
          <div className="mt-1 rounded border border-warn-fill bg-warn-soft px-2.5 py-2">
            <p className="flex items-start gap-1.5 text-mini font-medium text-warn">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              No {tier.provider_label} API key is connected, so this
              engine cannot narrate yet.
            </p>
            {tier.signup_steps.length > 0 && (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-micro leading-relaxed text-warn-strong/90">
                {tier.signup_steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            )}
            <p className="mt-1.5 text-micro text-warn-strong/80">
              Add the key under Narration API Keys below.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <section>
      <h3 className="mb-1 border-b border-border pb-2 text-mini font-semibold uppercase tracking-wider text-faint">
        Narration Engine
      </h3>
      <p className="mb-3 mt-2 text-mini leading-relaxed text-text-muted">
        These are the engines Storythread knows how to narrate with.
        Drafting on the free local narrator is unlimited; the paid tiers
        are for the final pass, and you always see the price before
        anything is spent.
      </p>

      <div className="space-y-1.5">
        {shelf.map(renderTier)}
        {!catalog && (
          <p className="text-mini text-faint">Loading engines...</p>
        )}
      </div>

      {/* An empty price tier, named out loud. */}
      {emptyTiers.length > 0 && (
        <p className="mt-2 text-micro leading-relaxed text-faint">
          No {emptyTiers.join(" or ")} engine has earned a recommendation
          yet -- the ones we auditioned are below, each with what it does
          wrong. Any of them still narrates if you want it.
        </p>
      )}

      {/* Demoted engines: real, selectable, and honest about why they are
          down here rather than up there. */}
      {demoted.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowOthers(v => !v)}
            className="flex w-full items-center gap-1 text-micro text-faint hover:text-text-primary"
          >
            {othersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Other engines we tested but do not recommend ({demoted.length})
          </button>
          {othersOpen && (
            <div className="mt-1.5 space-y-1.5 border-l border-border pl-2">
              {demoted.map(renderTier)}
            </div>
          )}
        </div>
      )}
      {/* The default premium voice for whichever paid engine is chosen. */}
      {chosen?.requires_key && (
        <div className="mt-3">
          <span className="mb-1 flex items-center justify-between gap-2">
            <span className="text-micro text-text-muted">
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
