// CastPanel.test.tsx
// ===================
// The Cast workbench. What is pinned here is the behaviour that makes it
// a workbench rather than a settings dialog: the dialogue is the work
// surface, a click lands on the writer's real text immediately, and
// nothing reaches disk from this window at all.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { CastPanel } from "./CastPanel";

const WS = "C:/books/hollow-road-audio";

const BOOK =
  "# Chapter One\n\n"
  + "The gate stood open.\n\n"
  + '"This cannot continue," Lara said.\n\n'
  + '"I heard a noise," Alexandra said.\n';

function report(over: Record<string, unknown> = {}) {
  return {
    speakers: [
      { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
        voice_id: "af_heart", premium_voice_id: "" },
    ],
    unassigned_names: [],
    single_engine: true,
    ...over,
  };
}

const CAST_WITH_TWO = report({
  speakers: [
    { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
      voice_id: "af_heart", premium_voice_id: "" },
    { speaker_id: "character-lara", display_name: "Lara", role: "character",
      voice_id: "bf_emma", premium_voice_id: "" },
    { speaker_id: "character-alexandra", display_name: "Alexandra",
      role: "character", voice_id: "af_bella", premium_voice_id: "" },
  ],
});

const DRAFT_ONLY = {
  draft: {
    label: "Free -- your local narrator", installed: true, note: "",
    voices: [
      { id: "af_heart", label: "Heart (American female)" },
      { id: "bf_emma", label: "Emma (British female)" },
    ],
  },
  print: { configured: false, has_api_key: false, voices: [], label: "", note: "" },
};

const WITH_PRINT = {
  draft: DRAFT_ONLY.draft,
  print: {
    configured: true, has_api_key: true, label: "Deepgram Aura-2 (OpenRouter)",
    tier_label: "Pro", note: "",
    voices: [{ id: "thalia", label: "Thalia (American female)" }],
  },
};

function mockFetch(initial = report(), options: unknown = DRAFT_ONLY) {
  return vi.fn(async (url: string) => {
    if (url.includes("/speakers")) return { ok: true, json: async () => initial };
    if (url.includes("/voice-options")) return { ok: true, json: async () => options };
    if (url.includes("/preview")) return { ok: true, blob: async () => new Blob(["wav"]) };
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function open(fetchMock: ReturnType<typeof mockFetch>, content = BOOK) {
  vi.stubGlobal("fetch", fetchMock);
  const onContentChange = vi.fn();
  const onSaved = vi.fn();
  render(<CastPanel workspacePath={WS} content={content}
                    onContentChange={onContentChange}
                    onClose={vi.fn()} onSaved={onSaved} />);
  // Ready = the panel rendered. NOT the voice picker: with a cast
  // present the voice list is folded away, which is the point.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Is this needed\?/ })).toBeTruthy());
  return { onContentChange, onSaved };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CastPanel workbench", () => {
  it("opens on the first line that still needs deciding", async () => {
    // The writer opened this to work, not to scroll past what they
    // already did.
    const assigned = BOOK.replace('"This cannot continue,"',
                                  '[voice:Lara]"This cannot continue,"[/voice]');
    await open(mockFetch(CAST_WITH_TWO), assigned);
    expect(screen.getByText(/line 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/1 line left/)).toBeTruthy();
  });

  it("leads with what happens, not with instructions", async () => {
    await open(mockFetch());
    expect(screen.getByText(/you mark as theirs is read in that voice/)).toBeTruthy();
  });

  it("keeps every explanation closed until asked, starting with 'is this needed'", async () => {
    // The panel used to open with a wall of text. Depth is one click
    // away and the honest answer -- no, you do not need this -- leads.
    await open(mockFetch());
    expect(screen.queryByText(/A book read entirely by one narrator/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Is this needed\?/ }));
    expect(screen.getByText(/A book read entirely by one narrator/)).toBeTruthy();
  });

  it("opens the voice list when nothing is cast, and folds it when something is", async () => {
    await open(mockFetch());
    expect(screen.getByText(/start here -- add the characters who speak/)).toBeTruthy();
    expect(screen.getByLabelText("Narrator voice")).toBeTruthy();

    cleanup();
    await open(mockFetch(CAST_WITH_TWO));
    expect(screen.getByText(/2 characters -- narrator reads the rest/)).toBeTruthy();
    expect(screen.queryByLabelText("Voice for character 1")).toBeNull();
  });

  it("shows a Pro voice column only when a print engine is connected, defaulting to none", async () => {
    // "-- None chosen" is a sanity check: a writer who never set these
    // can be sure they have not quietly armed a paid render.
    await open(mockFetch());
    expect(screen.queryByLabelText("Narrator Pro voice")).toBeNull();

    cleanup();
    await open(mockFetch(report(), WITH_PRINT));
    const pro = screen.getByLabelText("Narrator Pro voice") as HTMLSelectElement;
    expect(pro.value).toBe("");
    expect(screen.getByText("-- None chosen")).toBeTruthy();
  });

  it("offers only the characters this chapter actually uses", async () => {
    // A thirty-character book must not show thirty buttons.
    const cast = report({
      speakers: [
        ...CAST_WITH_TWO.speakers,
        { speaker_id: "character-marcus", display_name: "Marcus",
          role: "character", voice_id: "", premium_voice_id: "" },
      ],
    });
    await open(mockFetch(cast));
    expect(screen.getByRole("button", { name: "Lara" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alexandra" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Marcus" })).toBeNull();
    expect(screen.getByText(/\+ 1 more in this book/)).toBeTruthy();
  });

  it("a click lands on the writer's real text straight away", async () => {
    // Click-applies is the point of the window: you see the marker
    // appear on your own line rather than staging a decision.
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO));
    fireEvent.click(screen.getByRole("button", { name: "Lara" }));
    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange.mock.calls[0][0])
      .toContain('[voice:Lara]"This cannot continue,"[/voice] Lara said.');
  });

  it("the narrator is a real answer, not a skip", async () => {
    // Most books have far more speakers than cast members -- the store
    // clerk with one line should never be cast.
    const assigned = BOOK.replace('"This cannot continue,"',
                                  '[voice:Lara]"This cannot continue,"[/voice]');
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO), assigned);
    // The walk opens on the first UNDECIDED line, so step back to the
    // one already given to Lara.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.click(screen.getByRole("button", { name: "Narrator" }));
    expect(onContentChange.mock.calls[0][0]).not.toContain("[voice:Lara]");
    expect(onContentChange.mock.calls[0][0]).toContain('"This cannot continue,"');
  });

  it("offers the name the writer's own tag gives", async () => {
    await open(mockFetch(CAST_WITH_TWO));
    expect(screen.getByText(/your text says/)).toBeTruthy();
  });

  it("Back walks to the previous line", async () => {
    await open(mockFetch(CAST_WITH_TWO));
    expect(screen.getByText(/line 1 of 2/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Back/ }) as HTMLButtonElement).disabled)
      .toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByText(/line 2 of 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/line 1 of 2/)).toBeTruthy();
  });

  it("counts what is left, and says nothing is saved from here", async () => {
    await open(mockFetch(CAST_WITH_TWO));
    expect(screen.getByText(/2 lines left/)).toBeTruthy();
    expect(screen.getByText(/press Save there to keep them/)).toBeTruthy();
  });

  it("removes an unused character without ceremony", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { onContentChange } = await open(
      mockFetch(CAST_WITH_TWO), "# Chapter One\n\nNo dialogue at all.\n");
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    fireEvent.click(screen.getByLabelText("Remove Lara"));
    expect(confirm).not.toHaveBeenCalled();
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("warns before removing a character who is used, and keeps the words", async () => {
    const assigned = BOOK.replace('"This cannot continue,"',
                                  '[voice:Lara]"This cannot continue,"[/voice]');
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO), assigned);

    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    fireEvent.click(screen.getByLabelText("Remove Lara"));
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain("1 line");
    expect(message).toContain("Chapter One");
    expect(message).toContain("everywhere in the book");
    expect(message).toContain("go back to the narrator");

    const next = onContentChange.mock.calls[0][0] as string;
    expect(next).not.toContain("[voice:Lara]");
    expect(next).toContain('"This cannot continue," Lara said.');
  });

  it("declining the removal changes nothing at all", async () => {
    const assigned = BOOK.replace('"This cannot continue,"',
                                  '[voice:Lara]"This cannot continue,"[/voice]');
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO), assigned);
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    fireEvent.click(screen.getByLabelText("Remove Lara"));
    expect(onContentChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Lara" })).toBeTruthy();
  });
});
