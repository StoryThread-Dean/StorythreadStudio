// CastPanel.test.tsx
// ===================
// The cast screen's contract. Two things here are not cosmetic:
//
//   The manuscript already knows the names. A writer who typed
//   [voice:Elena] before opening this panel must not have to retype
//   "Elena" -- the app read it, so the app offers it.
//
//   A name belongs to one voice. The narration says [voice:Name], so two
//   characters sharing a name would make that ambiguous, and the
//   ambiguity would be resolved silently at render time. Save is blocked
//   rather than letting it through.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { CastPanel } from "./CastPanel";

const WS = "C:/books/hollow-road-audio";

// The voice roster as the panel now reads it: grouped by engine, each
// group saying whether THIS book can use it.
const VOICE_OPTIONS = {
  current_label: "your local narrator",
  current_provider: "local-kokoro",
  groups: [
    { key: "local-kokoro:", label: "Free -- your local narrator", tier: "free",
      provider: "local-kokoro", model: "", is_current: true, usable: true,
      free_preview: true, note: "",
      voices: [
        { id: "af_heart", label: "Heart (American female)" },
        { id: "bf_emma", label: "Emma (British female)" },
      ] },
    { key: "openrouter:deepgram/aura-2", label: "Pro -- Deepgram Aura-2 (OpenRouter)",
      tier: "pro", provider: "openrouter", model: "deepgram/aura-2",
      is_current: false, usable: false, free_preview: false,
      note: "No OpenRouter API key is connected, so these voices cannot "
          + "narrate yet. Add one in Audiobook Settings.",
      voices: [{ id: "thalia", label: "Thalia (American female)" }] },
  ],
};

function report(over: Partial<Record<string, unknown>> = {}) {
  return {
    speakers: [
      { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
        voice_id: "af_heart" },
    ],
    unassigned_names: ["Elena"],
    single_engine: true,
    ...over,
  };
}

function mockFetch(initial = report()) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/speakers") && (init?.method ?? "GET") === "PUT") {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => report({
        speakers: [
          { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
            voice_id: body.narrator_voice ?? "af_heart" },
          ...body.speakers.map((s: { display_name: string; voice_id: string }) => ({
            speaker_id: `character-${s.display_name.toLowerCase()}`,
            display_name: s.display_name, role: "character", voice_id: s.voice_id,
          })),
        ],
        unassigned_names: [],
      }) };
    }
    if (url.includes("/speakers")) return { ok: true, json: async () => initial };
    if (url.includes("/voice-options")) return { ok: true, json: async () => VOICE_OPTIONS };
    if (url.includes("/preview")) return { ok: true, blob: async () => new Blob(["wav"]) };
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function open(fetchMock: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<CastPanel workspacePath={WS} onClose={vi.fn()} onSaved={onSaved} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Narrator voice")).toBeTruthy());
  return { onSaved };
}

function putBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CastPanel", () => {
  it("offers the names the manuscript already uses", async () => {
    await open(mockFetch());
    expect(screen.getByText(/not in the cast yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    expect((screen.getByLabelText("Character 1 name") as HTMLInputElement).value)
      .toBe("Elena");
  });

  it("saves characters and the narrator voice, and the narrator is not a character", async () => {
    // The narrator is implicit: it is the book's own voice, not a row
    // the writer can delete or duplicate.
    const fetchMock = mockFetch();
    const { onSaved } = await open(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    fireEvent.change(screen.getByLabelText("Voice for character 1"),
                     { target: { value: "bf_emma" } });
    fireEvent.change(screen.getByLabelText("Narrator voice"),
                     { target: { value: "af_heart" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Cast/ }));

    await waitFor(() => expect(putBodies(fetchMock).length).toBe(1));
    const body = putBodies(fetchMock)[0];
    expect(body.speakers).toEqual([{ display_name: "Elena", voice_id: "bf_emma" }]);
    expect(body.narrator_voice).toBe("af_heart");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("refuses to save two characters with the same name", async () => {
    const fetchMock = mockFetch();
    await open(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /Add a character/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add a character/ }));
    fireEvent.change(screen.getByLabelText("Character 1 name"),
                     { target: { value: "Elena" } });
    fireEvent.change(screen.getByLabelText("Character 2 name"),
                     { target: { value: "elena" } });

    expect(screen.getByText(/each name has to belong to one voice/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save Cast/ }) as HTMLButtonElement)
      .disabled).toBe(true);
    expect(putBodies(fetchMock)).toEqual([]);
  });

  it("says that one book means one engine", async () => {
    // The rule that stops a cast from mixing the free narrator with a
    // paid engine -- which would price and fail line by line.
    await open(mockFetch());
    fireEvent.click(screen.getByText(/Can characters use different engines\?/));
    expect(screen.getByText(/one book, one engine/)).toBeTruthy();
  });

  it("a character with no voice reads as the narrator, and says so", async () => {
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    const select = screen.getByLabelText("Voice for character 1") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getAllByText("Same as the narrator").length).toBeGreaterThan(0);
  });
  it("answers the first question a writer has: does this work for free?", async () => {
    // The panel used to open with a cast list and no context, so the
    // writer's own first reaction was "wait, can I even do this on
    // local generation?" -- after which they might invest an afternoon
    // before finding out.
    await open(mockFetch());
    expect(screen.getByText(/works on the free local narrator/)).toBeTruthy();
    expect(screen.getByText(/Before you cast a whole novel, the limits/))
      .toBeTruthy();
    expect(screen.getByText(/One book, one engine\./)).toBeTruthy();
    expect(screen.getByText(/not\s+performances\./)).toBeTruthy();
  });

  it("groups voices by engine and disables the ones this book cannot use", async () => {
    await open(mockFetch());
    const select = screen.getByLabelText("Narrator voice") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map(g => g.label)).toEqual([
      "Free -- your local narrator",
      "Pro -- Deepgram Aura-2 (OpenRouter) -- unavailable",
    ]);
    const hosted = select.querySelector('option[value="thalia"]') as HTMLOptionElement;
    expect(hosted.disabled).toBe(true);
  });

  it("says WHY an engine's voices are unavailable, on screen", async () => {
    // Greyed-out options with no reason read as a bug.
    await open(mockFetch());
    expect(screen.getByText(/No OpenRouter API key is connected/)).toBeTruthy();
    expect(screen.getByText(/Add one in Audiobook Settings/)).toBeTruthy();
  });

  it("samples a local voice for free", async () => {
    const fetchMock = mockFetch();
    await open(fetchMock);
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.URL.createObjectURL = vi.fn(() => "blob:sample");

    fireEvent.change(screen.getByLabelText("Narrator voice"),
                     { target: { value: "bf_emma" } });
    fireEvent.click(screen.getByLabelText("Sample Narrator voice"));
    await waitFor(() => expect(fetchMock.mock.calls.some(
      ([url]) => String(url).includes("/preview"))).toBe(true));
  });

  it("cannot sample a hosted voice from here, and says where to", async () => {
    // Hosted auditions cost money and belong behind the cost-quoted
    // flow in the Premium Narration panel.
    await open(mockFetch());
    fireEvent.change(screen.getByLabelText("Narrator voice"),
                     { target: { value: "thalia" } });
    const button = screen.getByLabelText("Sample Narrator voice") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/Premium Narration panel/);
  });
});
