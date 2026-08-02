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

// Two rosters, because the app has two narration passes at once. The
// local one is always offered; the print one only when an engine is
// chosen AND its key is connected.
const DRAFT_ONLY = {
  draft: {
    label: "Free -- your local narrator", installed: true, note: "",
    voices: [
      { id: "af_heart", label: "Heart (American female)" },
      { id: "bf_emma", label: "Emma (British female)" },
    ],
  },
  print: {
    configured: false, has_api_key: false, voices: [], label: "",
    note: "No print engine is chosen, so this book prints with whatever you "
        + "pick in Audiobook Settings.",
  },
};

const WITH_PRINT = {
  draft: DRAFT_ONLY.draft,
  print: {
    configured: true, has_api_key: true, label: "Deepgram Aura-2 (OpenRouter)",
    tier_label: "Pro", note: "",
    voices: [{ id: "thalia", label: "Thalia (American female)" }],
  },
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

function mockFetch(initial = report(), options: unknown = DRAFT_ONLY) {
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
    if (url.includes("/voice-options")) return { ok: true, json: async () => options };
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
    expect(screen.getByText(/Already in your narration/)).toBeTruthy();

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
    expect(body.speakers).toEqual([
      { display_name: "Elena", voice_id: "bf_emma", premium_voice_id: "" },
    ]);
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

  it("explains the cost question where a writer will ask it", async () => {
    // "Does casting cost more?" is the question that stops people
    // trying the feature at all. The answer is no, and it belongs one
    // click away rather than in a paragraph nobody reads.
    await open(mockFetch());
    fireEvent.click(screen.getByText(/Does casting cost more\?/));
    expect(screen.getByText(/free and unlimited/)).toBeTruthy();
    expect(screen.getByText(/billed by the character whether one voice/))
      .toBeTruthy();
  });

  it("a character with no voice reads as the narrator, and says so", async () => {
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    const select = screen.getByLabelText("Voice for character 1") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getAllByText("Same as the narrator").length).toBeGreaterThan(0);
  });
  it("says in one line that this is free, and shows the marker", async () => {
    // The writer's own first reaction was "wait, can I even do this on
    // local generation?". The answer is the first thing on screen, and
    // it fits on one line -- the wall of text it replaced is now behind
    // What's this.
    await open(mockFetch());
    expect(screen.getByText(/Free on your local narrator/)).toBeTruthy();
    expect(screen.getByText("[voice:Elena]")).toBeTruthy();
  });

  it("always offers the local roster, print engine or not", async () => {
    // Live finding: choosing a hosted print engine greyed out EVERY
    // local voice -- the ones the writer had been drafting with all
    // along. Availability is not "is this the current engine".
    await open(mockFetch(report(), WITH_PRINT));
    const draft = screen.getByLabelText("Narrator voice") as HTMLSelectElement;
    const enabled = Array.from(draft.querySelectorAll("option"))
      .filter(o => !o.disabled).map(o => o.value);
    expect(enabled).toContain("af_heart");
    expect(enabled).toContain("bf_emma");
  });

  it("offers a print voice only when a print engine is connected", async () => {
    await open(mockFetch());
    expect(screen.queryByLabelText("Narrator print voice")).toBeNull();

    cleanup();
    await open(mockFetch(report(), WITH_PRINT));
    const print = screen.getByLabelText("Narrator print voice") as HTMLSelectElement;
    expect(Array.from(print.querySelectorAll("option")).map(o => o.value))
      .toContain("thalia");
  });

  it("does not warn about engines nobody chose", async () => {
    // Live finding: the panel opened with five alert tiles for engines
    // the writer had never selected.
    await open(mockFetch());
    expect(screen.queryByText(/API key is connected/)).toBeNull();
    expect(screen.queryByText(/Switch engines/)).toBeNull();
  });

  it("warns once when the chosen print engine has no key", async () => {
    await open(mockFetch(report(), {
      draft: DRAFT_ONLY.draft,
      print: { configured: true, has_api_key: false, label: "Deepgram Aura-2",
               voices: [], note: "No OpenRouter API key is connected." },
    }));
    expect(screen.getAllByText(/No OpenRouter API key is connected/)).toHaveLength(1);
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

  it("keeps the deep explanation behind What's this, not on the page", async () => {
    // The panel used to open with a wall of text nobody would read. One
    // line and an example up front; depth on request.
    await open(mockFetch());
    expect(screen.queryByText(/A voice is not a performance/)).toBeNull();
    fireEvent.click(screen.getByText(/What are the limits\?/));
    expect(screen.getByText(/A voice is not a performance/)).toBeTruthy();
  });

  it("offers the marking tools here, and only once somebody is cast", async () => {
    // They exist ONLY for a writer who chose to use a cast, so they do
    // not belong on the main toolbar.
    await open(mockFetch());
    expect((screen.getByRole("button", { name: /Cast Walkthrough/ }) as HTMLButtonElement)
      .disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Elena" }));
    expect((screen.getByRole("button", { name: /Mark selection/ }) as HTMLButtonElement)
      .disabled).toBe(false);
  });
});
