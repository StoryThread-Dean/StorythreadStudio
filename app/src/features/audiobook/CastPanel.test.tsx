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

const VOICES = [
  { id: "af_heart", label: "Heart (American female)", language: "en-US", gender_presentation: "female" },
  { id: "bf_emma", label: "Emma (British female)", language: "en-GB", gender_presentation: "female" },
];

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
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function open(fetchMock: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<CastPanel workspacePath={WS} voices={VOICES}
                    onClose={vi.fn()} onSaved={onSaved} />);
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
});
