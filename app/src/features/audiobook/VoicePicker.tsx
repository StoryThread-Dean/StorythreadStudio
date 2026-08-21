// features/audiobook/VoicePicker.tsx
// ==================================
// One control for choosing a narrator, in whichever shape the engine
// actually has.
//
// Most engines publish a flat list of voices, so this renders one
// dropdown. Some publish a voice AND an accent as independent axes -- xAI
// does: each voice can speak American, British, or Australian, with the
// dialect encoded in the id (ara-en-GB). Multiplying the two out makes a
// wall of rows; as two dropdowns it is voices + 4.
//
// The VALUE is always the single composed id the provider wants, so
// nothing downstream (settings, the manifest, generation, the estimate)
// knows or cares which shape the picker took. That is what makes this
// cheap to extend as engines adopt universal voices with accent as its
// own option.

import { useMemo } from "react";

export interface VoiceAxes {
  compose: string;                 // "voice+accent"
  voice_label: string;
  accent_label: string;
  voices: Array<{
    id: string;                    // the stem, e.g. "iris"
    bare_id: string;               // the accent-less form, e.g. "Iris"
    name: string;
    label: string;
    gender_presentation: string;
  }>;
  accents: Array<{
    id: string;                    // "" = the bare form
    label: string;
    language: string;
    note: string;
  }>;
}

interface VoicePickerProps {
  /** Present when the engine separates voice from accent. */
  axes?: VoiceAxes | null;
  /** The flat list, used when there are no axes. */
  voices: Array<{ id: string; label: string }>;
  value: string;
  onChange: (voiceId: string) => void;
  ariaLabel: string;
  /** No published list: allow a typed id as well. */
  verified?: boolean;
  tone?: "violet" | "blue";
}

/** Compose an id from the two axes. Kept beside the decomposer so the two
 * can never drift apart. */
export function composeVoiceId(
  axes: VoiceAxes, voiceStem: string, accentId: string,
): string {
  const voice = axes.voices.find(v => v.id === voiceStem);
  if (!voice) return "";
  return accentId ? `${voice.id}-${accentId}` : voice.bare_id;
}

/** Split a stored id back into (voice, accent) so the dropdowns open on
 * what is actually saved. Unknown values fall back to the first voice
 * rather than showing a blank picker. */
export function decomposeVoiceId(
  axes: VoiceAxes, value: string,
): { voiceStem: string; accentId: string } {
  const fallback = { voiceStem: axes.voices[0]?.id ?? "", accentId: "" };
  if (!value) return fallback;
  // Longest suffix first, so "en-US" is not shadowed by a shorter match.
  const suffixes = axes.accents
    .filter(a => a.id)
    .sort((a, b) => b.id.length - a.id.length);
  for (const accent of suffixes) {
    const tail = `-${accent.id}`;
    if (value.endsWith(tail)) {
      const stem = value.slice(0, -tail.length);
      if (axes.voices.some(v => v.id === stem)) {
        return { voiceStem: stem, accentId: accent.id };
      }
    }
  }
  const bare = axes.voices.find(
    v => v.bare_id.toLowerCase() === value.toLowerCase()
      || v.id.toLowerCase() === value.toLowerCase());
  return bare ? { voiceStem: bare.id, accentId: "" } : fallback;
}

export function VoicePicker({
  axes, voices, value, onChange, ariaLabel, verified = true, tone = "violet",
}: VoicePickerProps) {
  const border = tone === "violet"
    ? "border-violet-800 focus:border-violet-500"
    : "border-zinc-700 focus:border-blue-500";
  const labelColor = tone === "violet" ? "text-violet-300" : "text-zinc-400";
  const select = `w-full rounded border bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none ${border}`;

  const parts = useMemo(
    () => (axes ? decomposeVoiceId(axes, value) : null),
    [axes, value]);

  // Two axes: a character, then where they are from.
  if (axes && parts) {
    const accent = axes.accents.find(a => a.id === parts.accentId);
    const byGender = axes.voices.reduce<Record<string, typeof axes.voices>>(
      (groups, voice) => {
        const key = voice.gender_presentation || "other";
        (groups[key] ??= []).push(voice);
        return groups;
      }, {});
    return (
      <div className="space-y-2">
        <div>
          <span className={`mb-1 block text-micro ${labelColor}`}>
            {axes.voice_label}
          </span>
          <select
            value={parts.voiceStem}
            onChange={e => onChange(composeVoiceId(axes, e.target.value, parts.accentId))}
            aria-label={ariaLabel}
            className={select}
          >
            {Object.entries(byGender).map(([gender, group]) => (
              <optgroup key={gender} label={gender === "female" ? "Feminine" : "Masculine"}>
                {group.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <span className={`mb-1 block text-micro ${labelColor}`}>
            {axes.accent_label}
          </span>
          <select
            value={parts.accentId}
            onChange={e => onChange(composeVoiceId(axes, parts.voiceStem, e.target.value))}
            aria-label={`${ariaLabel} accent`}
            className={select}
          >
            {axes.accents.map(option => (
              <option key={option.id || "default"} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {accent?.note && (
            <p className="mt-1 text-micro leading-relaxed text-zinc-500">
              {accent.note}
            </p>
          )}
        </div>
      </div>
    );
  }

  // One flat list.
  if (voices.length > 0) {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={select}
      >
        <option value="">The model's default voice</option>
        {voices.map(voice => (
          <option key={voice.id} value={voice.id}>{voice.label}</option>
        ))}
      </select>
    );
  }

  // Nothing published: let the writer type what the provider documents.
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={ariaLabel}
      placeholder={verified
        ? "Leave blank for the model's default voice"
        : "Type a voice id, or leave blank for the default"}
      className={`${select} placeholder:text-zinc-600`}
    />
  );
}
