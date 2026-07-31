// VoicePicker.test.tsx
// =====================
// One picker, three shapes: two dropdowns when the engine separates voice
// from accent, one dropdown for a flat roster, a text field when nothing
// is published. The contract that matters is that the VALUE stays a single
// composed id in every shape -- everything downstream (settings, the
// manifest, generation, the estimate) depends on that.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { VoicePicker, composeVoiceId, decomposeVoiceId } from "./VoicePicker";
import type { VoiceAxes } from "./VoicePicker";

const AXES: VoiceAxes = {
  compose: "voice+accent",
  voice_label: "Voice",
  accent_label: "Accent",
  voices: [
    { id: "ara", bare_id: "Ara", name: "Ara", label: "Ara (female) -- warm",
      gender_presentation: "female" },
    { id: "iris", bare_id: "Iris", name: "Iris", label: "Iris (female) -- friendly",
      gender_presentation: "female" },
    { id: "orion", bare_id: "Orion", name: "Orion", label: "Orion (male) -- cinematic",
      gender_presentation: "male" },
  ],
  accents: [
    { id: "", label: "Provider default", language: "en-US", note: "The bare name." },
    { id: "en-US", label: "American", language: "en-US", note: "" },
    { id: "en-GB", label: "British", language: "en-GB", note: "" },
    { id: "en-AU", label: "Australian", language: "en-AU", note: "" },
  ],
};

afterEach(cleanup);

describe("composeVoiceId / decomposeVoiceId", () => {
  it("composes a dialect id from the two axes", () => {
    expect(composeVoiceId(AXES, "iris", "en-GB")).toBe("iris-en-GB");
    // The bare form uses the provider's documented capitalisation.
    expect(composeVoiceId(AXES, "iris", "")).toBe("Iris");
  });

  it("splits a stored id back into its axes", () => {
    expect(decomposeVoiceId(AXES, "iris-en-AU"))
      .toEqual({ voiceStem: "iris", accentId: "en-AU" });
    expect(decomposeVoiceId(AXES, "Ara"))
      .toEqual({ voiceStem: "ara", accentId: "" });
    // Case-insensitive, because providers are inconsistent about it.
    expect(decomposeVoiceId(AXES, "orion"))
      .toEqual({ voiceStem: "orion", accentId: "" });
  });

  it("falls back to the first voice instead of showing a blank picker", () => {
    expect(decomposeVoiceId(AXES, "some-retired-id"))
      .toEqual({ voiceStem: "ara", accentId: "" });
    expect(decomposeVoiceId(AXES, ""))
      .toEqual({ voiceStem: "ara", accentId: "" });
  });

  it("round-trips every combination", () => {
    for (const voice of AXES.voices) {
      for (const accent of AXES.accents) {
        const id = composeVoiceId(AXES, voice.id, accent.id);
        expect(decomposeVoiceId(AXES, id))
          .toEqual({ voiceStem: voice.id, accentId: accent.id });
      }
    }
  });
});

describe("VoicePicker", () => {
  it("offers two dropdowns when the engine separates voice from accent", () => {
    const onChange = vi.fn();
    render(<VoicePicker axes={AXES} voices={[]} value="iris-en-GB"
                        onChange={onChange} ariaLabel="Narrator voice" />);
    const voice = screen.getByLabelText("Narrator voice") as HTMLSelectElement;
    const accent = screen.getByLabelText("Narrator voice accent") as HTMLSelectElement;
    // Opens on what is stored, not on a default.
    expect(voice.value).toBe("iris");
    expect(accent.value).toBe("en-GB");
    // 3 voices, not 3 x 4 rows.
    expect(voice.querySelectorAll("option")).toHaveLength(3);
    expect(accent.querySelectorAll("option")).toHaveLength(4);
    // Voices group by gender so a 26-long list stays scannable.
    expect(voice.querySelectorAll("optgroup")).toHaveLength(2);
  });

  it("changing either axis reports one composed id", () => {
    const onChange = vi.fn();
    render(<VoicePicker axes={AXES} voices={[]} value="iris-en-GB"
                        onChange={onChange} ariaLabel="Narrator voice" />);
    fireEvent.change(screen.getByLabelText("Narrator voice"),
                     { target: { value: "orion" } });
    expect(onChange).toHaveBeenLastCalledWith("orion-en-GB");

    fireEvent.change(screen.getByLabelText("Narrator voice accent"),
                     { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("Iris");   // bare form
  });

  it("shows the accent note, which is where the 404 advice lives", () => {
    render(<VoicePicker axes={AXES} voices={[]} value="Ara"
                        onChange={vi.fn()} ariaLabel="Narrator voice" />);
    expect(screen.getByText("The bare name.")).toBeTruthy();
  });

  it("falls back to one dropdown for a flat roster", () => {
    const onChange = vi.fn();
    render(<VoicePicker
      voices={[{ id: "aura-2-zeus-en", label: "Zeus (American male)" }]}
      value="aura-2-zeus-en" onChange={onChange} ariaLabel="Narrator voice" />);
    const select = screen.getByLabelText("Narrator voice") as HTMLSelectElement;
    expect(select.value).toBe("aura-2-zeus-en");
    expect(screen.queryByLabelText("Narrator voice accent")).toBeNull();
  });

  it("accepts a typed id when nothing is published", () => {
    const onChange = vi.fn();
    render(<VoicePicker voices={[]} value="" onChange={onChange}
                        ariaLabel="Narrator voice" verified={false} />);
    const input = screen.getByLabelText("Narrator voice");
    fireEvent.change(input, { target: { value: "some-provider-voice" } });
    expect(onChange).toHaveBeenCalledWith("some-provider-voice");
  });
});
