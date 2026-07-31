// PremiumNarrationPanel.test.tsx
// ==============================
// The money gate. This panel is the only place in the app that can spend a
// writer's credits, so its contract is tested as such: the engine is
// reported (never chosen) here, an unusable engine offers no buttons at
// all, the estimate arrives before any confirm exists, and -- the one that
// matters most -- a stale estimate can never survive an engine change.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { PremiumNarrationPanel } from "./PremiumNarrationPanel";
import type { NarrationSelection } from "./api";

const WS = "C:\\Audiobooks\\Book";

const USABLE: NarrationSelection = {
  source: "settings",
  provider: "nanogpt", model: "Elevenlabs-Turbo-V2.5",
  provider_label: "NanoGPT", model_label: "ElevenLabs Turbo v2.5",
  tier: "pro", tier_label: "Pro",
  price_per_1k_chars: "0.06", price_per_million_chars: "60",
  is_recommended: true, requires_key: true, has_api_key: true,
  using_writing_keys: true, key_setting: "nanogpt_api_key",
  key_hint: "nano-gpt.com", signup_steps: [],
  voices_same_as_local: false,
  voices: [{ id: "Rachel", label: "Rachel (warm)", language: "en-US" }],
  voice_axes: null,
  voices_are_fallback: false, voices_verified: false, supports_speed: false,
  default_voice: "", book_voice: null,
  can_spend: true, warning: null, fallback_note: null,
};

const ESTIMATE = {
  provider: "nanogpt", provider_label: "NanoGPT",
  model: "Elevenlabs-Turbo-V2.5", model_label: "ElevenLabs Turbo v2.5",
  characters: 520_000, segments: 410, chapters: 21, flow_segments: 96,
  price_per_1k_chars: "0.06", price_per_million_chars: "60",
  estimate_usd: "31.20", note: "",
};

function mockFetch(
  selection: NarrationSelection,
  overrides: { estimateUsd?: string; generateFails?: string } = {},
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/narration-selection")) {
      return { ok: true, json: async () => selection };
    }
    if (url.includes("/narration-choice")) {
      return { ok: true, json: async () => selection };
    }
    if (url.includes("/print-estimate")) {
      return { ok: true, json: async () => ({
        ...ESTIMATE, estimate_usd: overrides.estimateUsd ?? ESTIMATE.estimate_usd,
      }) };
    }
    if (url.includes("/print-preview")) {
      return {
        ok: true,
        headers: { get: (h: string) => (h === "X-Preview-Cost-Usd" ? "0.02" : null) },
        blob: async () => new Blob(["wav"]),
      };
    }
    if (url.includes("/generate")) {
      if (overrides.generateFails) {
        return { ok: false, status: 400,
                 json: async () => ({ detail: overrides.generateFails }) };
      }
      return { ok: true, json: async () => ({ run_id: "r1", status: "generating" }) };
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function open(
  fetchMock: ReturnType<typeof mockFetch>,
  extra: Record<string, unknown> = {},
) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x") });
  vi.stubGlobal("Audio", class { play = vi.fn(); pause = vi.fn(); });
  const props = { workspacePath: WS, onRunStarted: vi.fn(),
                  onOpenSettings: vi.fn(), ...extra };
  const view = render(<PremiumNarrationPanel {...props} />);
  fireEvent.click(screen.getByText("Premium Narration"));
  return { props, view };
}

describe("PremiumNarrationPanel", () => {
  it("reports the engine chosen in Settings and offers no way to pick one", async () => {
    await open(mockFetch(USABLE));
    await waitFor(() =>
      expect(screen.getByText("ElevenLabs Turbo v2.5")).toBeTruthy());
    expect(screen.getByText("Chosen in Audiobook Settings")).toBeTruthy();
    expect(screen.getByText(/\$60 per million characters/)).toBeTruthy();
    // No tier shelf in here any more -- and above all, no FREE option
    // inside the premium section (it confused people).
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText(/Kokoro 82M \(on this computer\)/)).toBeNull();
    // It says where the free path actually is.
    expect(screen.getByText(/section above is the free path/)).toBeTruthy();
  });

  it("shows the estimate BEFORE any way to spend exists, then confirms it", async () => {
    const { props } = await open(mockFetch(USABLE));
    await waitFor(() => expect(screen.getByText(/about \$31\.20/)).toBeTruthy());
    expect(screen.getByText(/520,000 characters across 410 passages/)).toBeTruthy();

    fireEvent.click(screen.getByText("Narrate the Final Version"));
    expect(screen.getByText(/Spend about \$31\.20 narrating this book/)).toBeTruthy();
    fireEvent.click(screen.getByText("Keep drafting free"));
    expect(screen.queryByText(/Spend about/)).toBeNull();
    expect(props.onRunStarted).not.toHaveBeenCalled();
  });

  it("a changed engine DROPS the old estimate and any pending confirm", async () => {
    // THE money bug this guards: a $31.20 quote surviving a switch to a
    // cheaper engine, sitting under a live confirm button.
    const { props, view } = await open(mockFetch(USABLE));
    await waitFor(() => expect(screen.getByText(/about \$31\.20/)).toBeTruthy());
    fireEvent.click(screen.getByText("Narrate the Final Version"));
    expect(screen.getByText(/Spend about \$31\.20/)).toBeTruthy();

    // Settings saved: a different, cheaper engine is now in effect.
    const cheaper: NarrationSelection = {
      ...USABLE, model: "Kokoro-82m", model_label: "Kokoro 82M (hosted)",
      tier: "budget", tier_label: "Budget", price_per_million_chars: "1",
    };
    vi.stubGlobal("fetch", mockFetch(cheaper, { estimateUsd: "0.56" }));
    view.rerender(<PremiumNarrationPanel {...props} settingsVersion={1} />);

    await waitFor(() => expect(screen.getByText("Kokoro 82M (hosted)")).toBeTruthy());
    // The old number and the confirm are gone, not carried over. (queryAll,
    // because before the switch the price appeared in BOTH the estimate
    // card and the confirm text.)
    await waitFor(() => expect(screen.queryAllByText(/\$31\.20/)).toHaveLength(0));
    expect(screen.queryByText(/Spend about/)).toBeNull();
    await waitFor(() => expect(screen.getByText(/about \$0\.56/)).toBeTruthy());
  });

  it("confirming posts the engine, model, and voice", async () => {
    const fetchMock = mockFetch(USABLE);
    const { props } = await open(fetchMock);
    // The button exists but stays disabled until a price is on screen --
    // that IS the gate, so wait for the number, not just the button.
    await waitFor(() => expect(screen.getByText(/about \$31\.20/)).toBeTruthy());
    fireEvent.click(screen.getByText("Narrate the Final Version"));
    fireEvent.click(screen.getByText("Yes, narrate it"));

    await waitFor(() => expect(props.onRunStarted).toHaveBeenCalledOnce());
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/generate"));
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.provider).toBe("nanogpt");
    expect(body.model).toBe("Elevenlabs-Turbo-V2.5");
    expect(body.voice_id).toBe("Rachel");
    expect(body.force).toBe(true);            // a final pass IS a full rerender
  });

  it("an engine with no key shows instructions and NO spend controls", async () => {
    const noKey: NarrationSelection = {
      ...USABLE, has_api_key: false, can_spend: false,
      warning: "No NanoGPT API key is connected, so this engine cannot narrate yet.",
      signup_steps: ["Create an account at nano-gpt.com.", "Copy your key."],
    };
    const { props } = await open(mockFetch(noKey));
    await waitFor(() =>
      expect(screen.getByText(/No NanoGPT API key is connected/)).toBeTruthy());
    expect(screen.getByText("Create an account at nano-gpt.com.")).toBeTruthy();
    expect(screen.queryByText("Narrate the Final Version")).toBeNull();
    expect(screen.queryByText("Sample This Voice")).toBeNull();

    fireEvent.click(screen.getByText("Add the key in Settings"));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("the writing-model fallback warns in red and cannot spend", async () => {
    const fallback: NarrationSelection = {
      ...USABLE, source: "writing-fallback",
      provider: "openrouter", model: "openai/gpt-4o-mini",
      provider_label: "OpenRouter", model_label: "openai/gpt-4o-mini",
      tier: "", tier_label: "", price_per_1k_chars: null,
      price_per_million_chars: null, is_recommended: false, can_spend: false,
      warning: null, voices: [],
      fallback_note: "openai/gpt-4o-mini is your writing model, not one of the "
        + "recommended narration models. It will most likely refuse to narrate.",
    };
    const { props } = await open(mockFetch(fallback));
    await waitFor(() =>
      expect(screen.getByText(/not one of the recommended narration models/)).toBeTruthy());
    // Rose, not the usual violet -- visibly a different state.
    const note = screen.getByText(/not one of the recommended/).closest("div")!;
    expect(note.className).toContain("rose");
    expect(screen.queryByText("Narrate the Final Version")).toBeNull();

    fireEvent.click(screen.getByText("Pick a narration engine"));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("with nothing chosen it says narration stays free", async () => {
    const none: NarrationSelection = {
      ...USABLE, source: "none", provider: "", model: "", model_label: "",
      provider_label: "", can_spend: false, is_recommended: false, voices: [],
    };
    await open(mockFetch(none));
    await waitFor(() =>
      expect(screen.getByText(/narration stays free and local/)).toBeTruthy());
    expect(screen.queryByText("Narrate the Final Version")).toBeNull();
  });

  it("a sample uses the selection and reports what it cost", async () => {
    const fetchMock = mockFetch(USABLE);
    await open(fetchMock, { getSelectionText: () => "  A chosen line.  " });
    await waitFor(() => expect(screen.getByText("Sample This Voice")).toBeTruthy());

    fireEvent.click(screen.getByText("Sample This Voice"));
    await waitFor(() =>
      expect(screen.getByText(/sample cost about \$0\.02/)).toBeTruthy());
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/print-preview"));
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.text).toBe("A chosen line.");
    expect(body.model).toBe("Elevenlabs-Turbo-V2.5");
  });

  it("hosted Kokoro offers the LOCAL voice roster (the parity fix)", async () => {
    const parity: NarrationSelection = {
      ...USABLE, model: "Kokoro-82m", model_label: "Kokoro 82M (hosted)",
      tier: "budget", tier_label: "Budget", voices_same_as_local: true,
      voices: [{ id: "af_heart", label: "Heart (American female)", language: "en-US" }],
    };
    await open(mockFetch(parity), {
      localVoices: [
        { id: "bf_lily", label: "Lily (British female)", language: "en-GB",
          gender_presentation: "female" },
        { id: "af_heart", label: "Heart (American female)", language: "en-US",
          gender_presentation: "female" },
      ],
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Premium narrator voice")).toBeTruthy());
    // Lily exists locally and NOT in the curated hosted list -- she must
    // still be offered, because it is the same engine.
    expect(screen.getByText("Lily (British female)")).toBeTruthy();
  });

  it("a per-book voice change is saved as an override", async () => {
    const fetchMock = mockFetch(USABLE);
    await open(fetchMock);
    const select = await screen.findByLabelText("Premium narrator voice");
    fireEvent.change(select, { target: { value: "Rachel" } });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) =>
        String(u).includes("/narration-choice"));
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body.premium_voice).toBe("Rachel");
      expect(body.workspace_path).toBe(WS);
    });
  });

  it("a refused run surfaces the backend's reason", async () => {
    await open(mockFetch(USABLE,
      { generateFails: "NanoGPT reports insufficient credits." }));
    await waitFor(() => expect(screen.getByText(/about \$31\.20/)).toBeTruthy());
    fireEvent.click(screen.getByText("Narrate the Final Version"));
    fireEvent.click(screen.getByText("Yes, narrate it"));
    await waitFor(() =>
      expect(screen.getByText(/insufficient credits/)).toBeTruthy());
  });

  it("premium voice controls are listed but inert", async () => {
    await open(mockFetch(USABLE));
    fireEvent.click(screen.getByText(/Premium voice controls/));
    const whisper = screen.getByText("Whisper").closest("li")!;
    expect(whisper.getAttribute("title")).toBe("Future development");
    expect(whisper.getAttribute("aria-disabled")).not.toBeNull();
    expect(whisper.className).toContain("cursor-not-allowed");
    expect(screen.getByText(/none are wired yet/)).toBeTruthy();
  });
});
