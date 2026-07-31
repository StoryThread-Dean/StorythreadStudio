// PrintPanel.test.tsx
// ====================
// The money gate. This panel is the only place in the app that can spend
// a writer's credits, so its contract is tested as such: the estimate
// arrives before any confirm exists, the confirm repeats the number, the
// paid run posts the chosen provider AND model, an audition reports what
// it cost, and the future-only controls are inert.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { PrintPanel } from "./PrintPanel";

const WS = "C:\\Audiobooks\\Book";

const CATALOG = {
  using_writing_keys: true,
  recommended: [
    { tier: "free", tier_label: "Free", blurb: "Runs on your computer.",
      provider: "local-kokoro", provider_label: "Local narrator", model: "",
      model_label: "Kokoro 82M (on this computer)", price_per_1k_chars: "0.000",
      same_as_local: true, requires_key: false, has_api_key: true },
    { tier: "budget", tier_label: "Budget", blurb: "Pennies a book.",
      provider: "nanogpt", provider_label: "NanoGPT", model: "kokoro-82m",
      model_label: "Kokoro 82M (hosted)", price_per_1k_chars: "0.001",
      same_as_local: true, requires_key: true, has_api_key: true },
    { tier: "pro", tier_label: "Pro", blurb: "Studio-grade.",
      provider: "nanogpt", provider_label: "NanoGPT", model: "elevenlabs-turbo",
      model_label: "ElevenLabs Turbo", price_per_1k_chars: "0.06",
      same_as_local: false, requires_key: true, has_api_key: true },
  ],
  providers: [{
    provider: "nanogpt", provider_label: "NanoGPT", key_hint: "nano-gpt.com",
    has_api_key: true,
    models: [
      { id: "kokoro-82m", label: "Kokoro 82M (hosted)", price_per_1k_chars: "0.001",
        same_as_local: true, supports_speed: true, notes: "",
        voices: [{ id: "af_heart", label: "Heart (American female)", language: "en-US" }] },
      { id: "elevenlabs-turbo", label: "ElevenLabs Turbo", price_per_1k_chars: "0.06",
        same_as_local: false, supports_speed: false, notes: "",
        voices: [{ id: "rachel", label: "Rachel (warm)", language: "en-US" }] },
    ],
  }],
};

const ESTIMATE = {
  provider: "nanogpt", provider_label: "NanoGPT", model: "elevenlabs-turbo",
  model_label: "ElevenLabs Turbo", characters: 520_000, segments: 410,
  chapters: 21, flow_segments: 96, price_per_1k_chars: "0.06",
  estimate_usd: "31.20", note: "",
};

function mockFetch(overrides: { generateFails?: string } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/tts-catalog")) {
      return { ok: true, json: async () => CATALOG };
    }
    if (url.includes("/print-estimate")) {
      return { ok: true, json: async () => ESTIMATE };
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

async function openPanel(fetchMock: ReturnType<typeof mockFetch>, extra = {}) {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x") });
  vi.stubGlobal("Audio", class { play = vi.fn(); pause = vi.fn(); });
  const props = {
    workspacePath: WS, localVoiceId: "af_heart",
    onRunStarted: vi.fn(), ...extra,
  };
  render(<PrintPanel {...props} />);
  fireEvent.click(screen.getByText(/Print with a Premium Voice/));
  await waitFor(() => expect(screen.getByText("ElevenLabs Turbo")).toBeTruthy());
  return props;
}

describe("PrintPanel", () => {
  it("offers the tier shelf with free first and prices on the paid ones", async () => {
    await openPanel(mockFetch());
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Budget")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText(/\$0\.06 per 1,000 characters/)).toBeTruthy();
    // Drafting free is stated outright, not implied.
    expect(screen.getByText(/free and unlimited/)).toBeTruthy();
  });

  it("shows the estimate BEFORE any way to spend exists", async () => {
    await openPanel(mockFetch());
    // No print button until a paid tier is chosen and priced.
    expect(screen.queryByText("Print the Audiobook")).toBeNull();

    fireEvent.click(screen.getByText("ElevenLabs Turbo"));
    await waitFor(() =>
      expect(screen.getByText(/about \$31\.20/)).toBeTruthy());
    expect(screen.getByText(/520,000 characters across 410 passages/)).toBeTruthy();
    expect(screen.getByText("Print the Audiobook")).toBeTruthy();
  });

  it("the confirm repeats the number and can be declined", async () => {
    const props = await openPanel(mockFetch());
    fireEvent.click(screen.getByText("ElevenLabs Turbo"));
    await waitFor(() => expect(screen.getByText("Print the Audiobook")).toBeTruthy());

    fireEvent.click(screen.getByText("Print the Audiobook"));
    expect(screen.getByText(/Spend about \$31\.20 printing this book/)).toBeTruthy();

    fireEvent.click(screen.getByText("Keep drafting free"));
    expect(screen.queryByText(/Spend about/)).toBeNull();
    expect(props.onRunStarted).not.toHaveBeenCalled();
  });

  it("confirming posts the provider, model, and voice", async () => {
    const fetchMock = mockFetch();
    const props = await openPanel(fetchMock);
    fireEvent.click(screen.getByText("ElevenLabs Turbo"));
    await waitFor(() => expect(screen.getByText("Print the Audiobook")).toBeTruthy());
    fireEvent.click(screen.getByText("Print the Audiobook"));
    fireEvent.click(screen.getByText("Yes, print it"));

    await waitFor(() => expect(props.onRunStarted).toHaveBeenCalledOnce());
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/generate"));
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.provider).toBe("nanogpt");
    expect(body.model).toBe("elevenlabs-turbo");
    expect(body.voice_id).toBe("rachel");        // the tier's own voice
    expect(body.force).toBe(true);               // a print IS a full rerender
  });

  it("an audition uses the selection and reports what it cost", async () => {
    const fetchMock = mockFetch();
    await openPanel(fetchMock, { getSelectionText: () => "  A chosen line.  " });
    fireEvent.click(screen.getByText("ElevenLabs Turbo"));
    await waitFor(() => expect(screen.getByText("Preview This Voice")).toBeTruthy());

    fireEvent.click(screen.getByText("Preview This Voice"));
    await waitFor(() =>
      expect(screen.getByText(/audition cost about \$0\.02/)).toBeTruthy());
    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/print-preview"));
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body.text).toBe("A chosen line.");
    expect(body.model).toBe("elevenlabs-turbo");
  });

  it("the free tier offers no spending controls at all", async () => {
    await openPanel(mockFetch());
    fireEvent.click(screen.getByText("Kokoro 82M (on this computer)"));
    expect(screen.queryByText("Print the Audiobook")).toBeNull();
    expect(screen.queryByText("Preview This Voice")).toBeNull();
  });

  it("premium voice controls are listed but inert", async () => {
    await openPanel(mockFetch());
    fireEvent.click(screen.getByText(/Premium voice controls/));
    const whisper = screen.getByText("Whisper").closest("li")!;
    expect(whisper.getAttribute("title")).toBe("Future development");
    expect(whisper.getAttribute("aria-disabled")).not.toBeNull();
    expect(whisper.className).toContain("cursor-not-allowed");
    expect(screen.getByText(/none are wired yet/)).toBeTruthy();
  });

  it("a refused run surfaces the backend's reason", async () => {
    await openPanel(mockFetch({ generateFails: "NanoGPT reports insufficient credits." }));
    fireEvent.click(screen.getByText("ElevenLabs Turbo"));
    await waitFor(() => expect(screen.getByText("Print the Audiobook")).toBeTruthy());
    fireEvent.click(screen.getByText("Print the Audiobook"));
    fireEvent.click(screen.getByText("Yes, print it"));
    await waitFor(() =>
      expect(screen.getByText(/insufficient credits/)).toBeTruthy());
  });
});
