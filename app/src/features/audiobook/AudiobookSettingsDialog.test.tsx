// AudiobookSettingsDialog.test.tsx
// ================================
// The audiobook's settings surface. Two contracts matter more than the
// rest and are tested hardest:
//
//   1. A MASKED KEY IS NEVER SENT BACK. The input starts blank, an
//      untouched key is omitted from the save entirely, and a typed key
//      is sent once and then cleared from the form.
//   2. NOTHING SAVES SILENTLY. Manual save only, and closing with unsaved
//      changes asks first -- otherwise moving pacing into a modal would
//      create the very trap the amber "unsaved" tag exists to prevent.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { AudiobookSettingsDialog } from "./AudiobookSettingsDialog";

const WS = "C:\\Audiobooks\\Book";
const MASKED = "sk-or-...wxyz";

const SETTINGS = {
  use_writing_keys: true,
  openrouter_api_key: MASKED, openrouter_api_key_set: true,
  nanogpt_api_key: "", nanogpt_api_key_set: false,
  writing_openrouter_key_set: true, writing_nanogpt_key_set: false,
  writing_provider: "openrouter", writing_provider_label: "OpenRouter",
  narration_provider: "", narration_model: "", premium_voice: "",
};

const PACING = {
  narrator_pace: 1.0, dialogue_pace: 1.0,
  scene_break_ms: 2000, chapter_break_ms: 3000,
};

const CATALOG = {
  using_writing_keys: true,
  selection: { source: "none" },
  recommended: [
    { tier: "free", tier_label: "Free", blurb: "Runs on your computer.",
      provider: "local-kokoro", provider_label: "Local narrator", model: "",
      model_label: "Kokoro 82M (on this computer)", price_per_1k_chars: "0.000",
      price_per_million_chars: "0", same_as_local: true,
      voices_same_as_local: true, voices_verified: true,
      requires_key: false, has_api_key: true, signup_steps: [] },
    { tier: "budget", tier_label: "Budget", blurb: "Pennies a book.",
      provider: "openrouter", provider_label: "OpenRouter",
      model: "hexgrad/kokoro-82m", model_label: "Kokoro 82M (hosted)",
      price_per_1k_chars: "0.00062", price_per_million_chars: "0.62",
      same_as_local: true, voices_same_as_local: true, voices_verified: true,
      requires_key: true, has_api_key: true, signup_steps: ["Step one."] },
    { tier: "pro", tier_label: "Pro", blurb: "Studio-grade.",
      provider: "nanogpt", provider_label: "NanoGPT",
      model: "Elevenlabs-Turbo-V2.5", model_label: "ElevenLabs Turbo v2.5",
      price_per_1k_chars: "0.06", price_per_million_chars: "60",
      same_as_local: false, voices_same_as_local: false, voices_verified: false,
      requires_key: true, has_api_key: false,
      signup_steps: ["Create an account at nano-gpt.com.", "Copy your key."] },
  ],
  providers: [{
    provider: "openrouter", provider_label: "OpenRouter",
    key_hint: "openrouter.ai", has_api_key: true, signup_steps: [],
    models: [{
      id: "hexgrad/kokoro-82m", label: "Kokoro 82M (hosted)",
      price_per_1k_chars: "0.00062", price_per_million_chars: "0.62",
      same_as_local: true, voices_same_as_local: true, voices_verified: true,
      supports_speed: true, notes: "",
      voices: [{ id: "af_heart", label: "Heart (American female)", language: "en-US" }],
    }],
  }],
};

function mockFetch(overrides: { settings?: Partial<typeof SETTINGS> } = {}) {
  const settings = { ...SETTINGS, ...overrides.settings };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/audiobook/settings") && method === "PUT") {
      const patch = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ ...settings, ...patch }) };
    }
    if (url.includes("/audiobook/settings")) {
      return { ok: true, json: async () => settings };
    }
    if (url.includes("/narration-settings") && method === "PUT") {
      return { ok: true, json: async () => JSON.parse(String(init?.body)) };
    }
    if (url.includes("/narration-settings")) {
      return { ok: true, json: async () => PACING };
    }
    if (url.includes("/tts-catalog")) return { ok: true, json: async () => CATALOG };
    if (url.includes("/voices")) {
      return { ok: true, json: async () => ({ voices: [
        { id: "bf_lily", label: "Lily (British female)", language: "en-GB",
          gender_presentation: "female" },
      ] }) };
    }
    throw new Error(`unexpected fetch ${url} ${method}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(fetchMock: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchMock);
  const props = { workspacePath: WS, onClose: vi.fn(), onSaved: vi.fn() };
  render(<AudiobookSettingsDialog {...props} />);
  await waitFor(() =>
    expect(screen.getByText("Narration Engine")).toBeTruthy());
  return props;
}

function putBodies(fetchMock: ReturnType<typeof mockFetch>, fragment: string) {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes(fragment)
      && (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("AudiobookSettingsDialog", () => {
  it("shows all three sections", async () => {
    await open(mockFetch());
    expect(screen.getByText("Narration Engine")).toBeTruthy();
    expect(screen.getByText("Narration API Keys")).toBeTruthy();
    expect(screen.getByText("Narration Settings")).toBeTruthy();
    expect(screen.getByText("Pacing and pauses for this book")).toBeTruthy();
  });

  it("warns in amber with sign-up steps when a chosen engine has no key", async () => {
    await open(mockFetch());
    // The Pro tier has no key in the fixture.
    fireEvent.click(screen.getByText("ElevenLabs Turbo v2.5"));
    await waitFor(() =>
      expect(screen.getByText(/No NanoGPT API key is connected/)).toBeTruthy());
    expect(screen.getByText("Create an account at nano-gpt.com.")).toBeTruthy();
  });

  it("never sends a masked key back, and omits an untouched key", async () => {
    const fetchMock = mockFetch();
    await open(fetchMock);
    // The key input starts blank even though a key IS saved.
    fireEvent.click(screen.getByRole("switch", { name: /Use my writing API keys/ }));
    const input = await screen.findByLabelText(/OpenRouter key for narration/);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByText(new RegExp(`Current key: ${MASKED.replace(/\./g, "\\.")}`)))
      .toBeTruthy();

    fireEvent.click(screen.getByText("Save Settings"));
    await waitFor(() => expect(putBodies(fetchMock, "/audiobook/settings").length).toBe(1));
    const body = putBodies(fetchMock, "/audiobook/settings")[0];
    expect("openrouter_api_key" in body).toBe(false);   // untouched = omitted
    expect(JSON.stringify(body)).not.toContain(MASKED);
    expect(body.use_writing_keys).toBe(false);
  });

  it("sends a typed key once and then clears the field", async () => {
    const fetchMock = mockFetch();
    await open(fetchMock);
    fireEvent.click(screen.getByRole("switch", { name: /Use my writing API keys/ }));
    const input = await screen.findByLabelText(/NanoGPT key for narration/);
    fireEvent.change(input, { target: { value: "sk-new-key-value" } });

    fireEvent.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const body = putBodies(fetchMock, "/audiobook/settings")[0];
      expect(body.nanogpt_api_key).toBe("sk-new-key-value");
    });
    await waitFor(() =>
      expect((screen.getByLabelText(/NanoGPT key for narration/) as HTMLInputElement).value)
        .toBe(""));
  });

  it("saves the chosen engine", async () => {
    const fetchMock = mockFetch();
    const props = await open(fetchMock);
    fireEvent.click(screen.getByText("Kokoro 82M (hosted)"));
    fireEvent.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const body = putBodies(fetchMock, "/audiobook/settings")[0];
      expect(body.narration_provider).toBe("openrouter");
      expect(body.narration_model).toBe("hexgrad/kokoro-82m");
    });
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("offers the LOCAL voice roster for hosted Kokoro (the parity fix)", async () => {
    await open(mockFetch());
    fireEvent.click(screen.getByText("Kokoro 82M (hosted)"));
    const select = await screen.findByLabelText("Default premium voice");
    // Lily comes from the live local engine, not the curated fallback --
    // the voice a writer drafted with survives into the paid tier.
    expect(screen.getByText("Lily (British female)")).toBeTruthy();
    expect(select).toBeTruthy();
  });

  it("pacing edits mark unsaved and save to the narration endpoint", async () => {
    const fetchMock = mockFetch();
    await open(fetchMock);
    fireEvent.change(screen.getByLabelText(/Narrator pace/, { selector: "input" }) ??
                     screen.getAllByRole("spinbutton")[0],
                     { target: { value: "0.85" } });
    expect(screen.getByText("unsaved")).toBeTruthy();

    fireEvent.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const body = putBodies(fetchMock, "/narration-settings")[0];
      expect(body.narrator_pace).toBe(0.85);
      expect(body.workspace_path).toBe(WS);
    });
  });

  it("closing with unsaved changes asks first", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = await open(mockFetch());
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "0.9" } });

    fireEvent.click(screen.getByText("Close"));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();   // declined

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes without asking when nothing changed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const props = await open(mockFetch());
    fireEvent.click(screen.getByText("Close"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
