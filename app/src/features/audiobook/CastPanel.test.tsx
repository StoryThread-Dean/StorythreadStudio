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
        voice_id: "af_heart", aliases: [], premium_voice_id: "" },
    ],
    unassigned_names: [],
    ignored_names: [],
    single_engine: true,
    ...over,
  };
}

const CAST_WITH_TWO = report({
  speakers: [
    { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
      voice_id: "af_heart", aliases: [], premium_voice_id: "" },
    { speaker_id: "character-lara", display_name: "Lara", role: "character",
      voice_id: "bf_emma", aliases: [], premium_voice_id: "" },
    { speaker_id: "character-alexandra", display_name: "Alexandra",
      role: "character", voice_id: "af_bella", aliases: [], premium_voice_id: "" },
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

function mockFetch(initial = report(), options: unknown = DRAFT_ONLY,
                   proposals: unknown[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (url.includes("/speaker-pass-estimate")) {
      return { ok: true, json: async () => ({
        model_id: "some/model", price_known: true, cost_usd: 0.03, note: "" }) };
    }
    if (url.includes("/analyze-speakers")) {
      return { ok: true, json: async () => ({ proposals, dropped: 0 }) };
    }
    if (url.includes("/speakers")) return { ok: true, json: async () => initial };
    if (url.includes("/voice-options")) return { ok: true, json: async () => options };
    if (url.includes("/preview")) {
      return { ok: true, blob: async () => new Blob(["wav"]),
               headers: new Headers() };
    }
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

function pick(mode: string) {
  fireEvent.change(screen.getByLabelText("Marking mode"), { target: { value: mode } });
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
          role: "character", voice_id: "", aliases: [], premium_voice_id: "" },
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
  it("nothing runs until Start is pressed", async () => {
    // A stray click on a dropdown must never spend money.
    const fetchMock = mockFetch(CAST_WITH_TWO);
    const { onContentChange } = await open(fetchMock);
    pick("free-ai");
    expect(onContentChange).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(
      ([url]) => String(url).includes("/analyze-speakers"))).toBe(false);
  });

  it("quotes the cost of an AI mode before it is started", async () => {
    await open(mockFetch(CAST_WITH_TWO));
    pick("free-ai");
    await waitFor(() =>
      expect(screen.getByText(/About \$0\.03 for this chapter/)).toBeTruthy());
  });

  it("opens on the free rung and prices nothing until an AI mode is picked", async () => {
    // A panel that opens already pointed at a paid action presumes.
    const fetchMock = mockFetch(CAST_WITH_TWO);
    await open(fetchMock);
    expect(screen.getByText(/No AI, no cost, instant/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(
      ([url]) => String(url).includes("estimate"))).toBe(false);

    pick("free-ai");
    await waitFor(() => expect(fetchMock.mock.calls.some(
      ([url]) => String(url).includes("estimate"))).toBe(true));
  });

  it("the free pass marks what the prose already names, and asks for nothing", async () => {
    // The rung that sits above every paid one: a tag the writer wrote is
    // not a guess.
    const fetchMock = mockFetch(CAST_WITH_TWO);
    const { onContentChange } = await open(fetchMock);
    pick("free");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    const next = onContentChange.mock.calls[0][0] as string;
    expect(next).toContain('[voice:Lara]"This cannot continue,"[/voice]');
    expect(next).toContain('[voice:Alexandra]"I heard a noise,"[/voice]');
    expect(fetchMock.mock.calls.some(
      ([url]) => String(url).includes("/analyze-speakers"))).toBe(false);
    expect(screen.getByText(
      /Marked 2 lines from your own prose \(2 from dialogue tags, 0 from action beats\)/))
      .toBeTruthy();
  });

  it("names anybody the prose speaks for who is not cast yet", async () => {
    // Otherwise those lines silently stay with the narrator and the
    // writer never learns why.
    const soloCast = report({
      speakers: [
        { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
          voice_id: "af_heart", aliases: [], premium_voice_id: "" },
        { speaker_id: "character-lara", display_name: "Lara", role: "character",
          voice_id: "bf_emma", aliases: [], premium_voice_id: "" },
      ],
    });
    await open(mockFetch(soloCast));
    pick("free");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(screen.getByText(/Not cast yet: Alexandra/)).toBeTruthy());
  });

  it("Automatic + AI applies confident guesses and leaves the rest", async () => {
    const book = '# Chapter One\n\n"Enough."\n\n"Or what?"\n';
    const { onContentChange } = await open(
      mockFetch(CAST_WITH_TWO, DRAFT_ONLY, [
        { quote: '"Enough."', speaker: "Lara", confidence: 0.95 },
        { quote: '"Or what?"', speaker: "Alexandra", confidence: 0.4 },
      ]), book);
    pick("free-ai");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    const next = onContentChange.mock.calls[0][0] as string;
    expect(next).toContain('[voice:Lara]"Enough."[/voice]');
    expect(next).not.toContain("[voice:Alexandra]");   // 0.4 is not confident
  });

  it("Fully automatic marks the unsure ones too, and offers to review them", async () => {
    const book = '# Chapter One\n\n"Enough."\n\n"Or what?"\n';
    const { onContentChange } = await open(
      mockFetch(CAST_WITH_TWO, DRAFT_ONLY, [
        { quote: '"Enough."', speaker: "Lara", confidence: 0.95 },
        { quote: '"Or what?"', speaker: "Alexandra", confidence: 0.4 },
      ]), book);
    pick("auto");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    const next = onContentChange.mock.calls[0][0] as string;
    expect(next).toContain('[voice:Lara]"Enough."[/voice]');
    expect(next).toContain('[voice:Alexandra]"Or what?"[/voice]');
    expect(screen.getByText(/Use Review AI choices to check its work/)).toBeTruthy();
  });

  it("an AI pass that fails leaves the manual walk working", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/analyze-speakers")) {
        return { ok: false, status: 504,
                 json: async () => ({ detail: "The model did not answer in time." }) };
      }
      if (url.includes("/speaker-pass-estimate")) {
        return { ok: true, json: async () => ({
          model_id: "m", price_known: false, cost_usd: null, note: "unknown" }) };
      }
      if (url.includes("/speakers")) return { ok: true, json: async () => CAST_WITH_TWO };
      if (url.includes("/voice-options")) return { ok: true, json: async () => DRAFT_ONLY };
      throw new Error(`unexpected fetch ${url}`);
    });
    await open(fetchMock as never);
    pick("free-ai");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(screen.getByText(/did not answer in time/)).toBeTruthy());
    expect(screen.getByText(/manual walk below still work/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lara" })).toBeTruthy();
  });

  it("a pass never overrules a line the writer already decided", async () => {
    // The writer outranks both their tags and the model.
    const assigned = BOOK.replace('"This cannot continue,"',
                                  '[voice:Alexandra]"This cannot continue,"[/voice]');
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO), assigned);
    pick("free");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    const next = onContentChange.mock.calls[0][0] as string;
    // Still Alexandra, even though the prose says "Lara said".
    expect(next).toContain('[voice:Alexandra]"This cannot continue,"[/voice]');
    expect(next).not.toContain('[voice:Lara]"This cannot continue,"');
  });

  it("Start is refused until somebody is cast", async () => {
    await open(mockFetch());
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
      .disabled).toBe(true);
  });
  it("offers the names the book speaks for, with two answers each", async () => {
    // A detected name is not automatically a character: the Librarian
    // with one line should usually just be the narrator.
    await open(mockFetch());
    expect(screen.getByText(/Names found in your book/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Lara" })).toBeTruthy();
    expect(screen.getByLabelText("Ignore Lara")).toBeTruthy();
  });

  it("adding a detected name takes it out of the pool", async () => {
    // A name belongs to exactly one character, or [voice:Lexi] is
    // ambiguous and the ambiguity gets resolved silently at render.
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: "+ Lara" }));
    expect(screen.queryByRole("button", { name: "+ Lara" })).toBeNull();
    expect((screen.getByLabelText("Character 1 name") as HTMLInputElement).value)
      .toBe("Lara");
  });

  it("ignoring a name hands it to the narrator and stops offering it", async () => {
    await open(mockFetch());
    fireEvent.click(screen.getByLabelText("Ignore Lara"));
    expect(screen.queryByRole("button", { name: "+ Lara" })).toBeNull();
    expect(screen.getByText(/Narrator reads:/)).toBeTruthy();
    // And it can be taken back.
    fireEvent.click(screen.getByLabelText("Stop ignoring Lara"));
    expect(screen.getByRole("button", { name: "+ Lara" })).toBeTruthy();
  });

  it("nicknames are folded away until asked for", async () => {
    // Most characters have none; a row of empty alias boxes would make
    // the common case look complicated.
    await open(mockFetch(CAST_WITH_TWO));
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    expect(screen.queryByText(/Nicknames your book uses/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Also called/ })[0]);
    expect(screen.getByText(/Nicknames your book uses/)).toBeTruthy();
    // Every detected name here is already cast, so there is nothing left
    // to attach -- and the panel says so rather than showing an empty box.
    expect(screen.getByText(/No unclaimed names left to add/)).toBeTruthy();
  });

  it("a nickname attaches from the detected pool and leaves it", async () => {
    const book = "# Chapter One\n\n"
      + '"Enough," Alexandra said.\n\n'
      + '"Not yet," Lexi said.\n';
    const soloCast = report({
      speakers: [
        { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
          voice_id: "af_heart", aliases: [], premium_voice_id: "" },
        { speaker_id: "character-alexandra", display_name: "Alexandra",
          role: "character", voice_id: "bf_emma", aliases: [], premium_voice_id: "" },
      ],
    });
    await open(mockFetch(soloCast), book);
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    fireEvent.click(screen.getByRole("button", { name: /Also called/ }));
    fireEvent.change(screen.getByLabelText("Add a nickname for character 1"),
                     { target: { value: "Lexi" } });

    expect(screen.getByRole("button", { name: /Also called Lexi/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Lexi" })).toBeNull();
  });

  it("a line tagged with a nickname marks the character, by their real name", async () => {
    // The marker always says Alexandra. One character, one spelling in
    // the file -- which is what keeps counting and recasting honest.
    const book = "# Chapter One\n\n" + '"Not yet," Lexi said.\n';
    const withAlias = report({
      speakers: [
        { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
          voice_id: "af_heart", aliases: [], premium_voice_id: "" },
        { speaker_id: "character-alexandra", display_name: "Alexandra",
          role: "character", voice_id: "bf_emma", aliases: ["Lexi"],
          premium_voice_id: "" },
      ],
    });
    const { onContentChange } = await open(mockFetch(withAlias), book);
    pick("free");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    expect(onContentChange.mock.calls[0][0])
      .toContain('[voice:Alexandra]"Not yet,"[/voice] Lexi said.');
  });

  it("the suggestion names the character even when the prose used a nickname", async () => {
    const book = "# Chapter One\n\n" + '"Not yet," Lexi said.\n';
    const withAlias = report({
      speakers: [
        { speaker_id: "narrator", display_name: "Narrator", role: "narrator",
          voice_id: "af_heart", aliases: [], premium_voice_id: "" },
        { speaker_id: "character-alexandra", display_name: "Alexandra",
          role: "character", voice_id: "bf_emma", aliases: ["Lexi"],
          premium_voice_id: "" },
      ],
    });
    await open(mockFetch(withAlias), book);
    expect(screen.getByText(/your text says Lexi/)).toBeTruthy();
    expect(screen.getByLabelText("Use Alexandra")).toBeTruthy();
  });
  it("keeps the reference answers on one row, and only one open at a time", async () => {
    // Four stacked accordions ate the panel. They are chips now.
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: /Is this needed\?/ }));
    expect(screen.getByText(/A book read entirely by one narrator/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Does casting cost more\?/ }));
    expect(screen.queryByText(/A book read entirely by one narrator/)).toBeNull();
    expect(screen.getByText(/free and unlimited/)).toBeTruthy();
  });

  it("offers a step-by-step walk for somebody who has never done this", async () => {
    // The reference answers are useless to a writer who does not yet
    // know what to ask. This is the other half.
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    expect(screen.getByText(/1\. Add the people who speak/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Next step"));
    expect(screen.getByText(/2\. Give each character a voice/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous step"));
    expect(screen.getByText(/1\. Add the people who speak/)).toBeTruthy();
  });

  it("the walk skips the Pro step when there is no paid engine", async () => {
    // A step about a control that is not on screen teaches nothing.
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    const withoutPro = screen.getByTestId("tutorial-progress").textContent ?? "";

    cleanup();
    await open(mockFetch(report(), WITH_PRINT));
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    const withPro = screen.getByTestId("tutorial-progress").textContent ?? "";
    expect(withPro).not.toBe(withoutPro);
  });

  it("opening the walk closes a reference answer, and the other way round", async () => {
    await open(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: /Is this needed\?/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show me how this works/ }));
    expect(screen.queryByText(/A book read entirely by one narrator/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Is this needed\?/ }));
    expect(screen.queryByText(/1\. Add the people who speak/)).toBeNull();
  });

  it("a character's colour can be changed, and the choice is what gets saved", async () => {
    const fetchMock = mockFetch(CAST_WITH_TWO);
    await open(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Also called/ })[0]);
    fireEvent.change(screen.getByLabelText("Colour for character 1"),
                     { target: { value: "#00796B" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Cast/ }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put![1] as RequestInit).body));
      expect(body.speakers[0].color).toBe("#00796B");
    });
  });
  it("plays the line exactly as it will be narrated", async () => {
    // The strongest guesswork-remover available, and free locally: the
    // same renderer generation uses, so the voice spans in this
    // paragraph are resolved through the cast.
    const fetchMock = mockFetch(CAST_WITH_TWO);
    await open(fetchMock);
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.URL.createObjectURL = vi.fn(() => "blob:line");

    fireEvent.click(screen.getByLabelText("Hear this line"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url).includes("/preview-selection"));
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body.text).toContain('"This cannot continue,"');
    });
  });

  it("number keys pick a speaker and Enter accepts", async () => {
    // A hundred lines is the difference between tedious and fast.
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO));
    fireEvent.keyDown(window, { key: "2" });          // 1 = Narrator
    expect(onContentChange.mock.calls[0][0])
      .toContain('[voice:Lara]"This cannot continue,"[/voice]');

    expect(screen.getByText(/line 1 of 2/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText(/line 2 of 2/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/line 1 of 2/)).toBeTruthy();
  });

  it("never steals a keystroke from a name box", async () => {
    // The panel is full of text inputs. A shortcut that ate "1" while
    // somebody typed a name would be worse than no shortcut.
    const { onContentChange } = await open(mockFetch(CAST_WITH_TWO));
    fireEvent.click(screen.getByRole("button", { name: /Voices/ }));
    const input = screen.getByLabelText("Character 1 name");
    fireEvent.keyDown(input, { key: "2" });
    expect(onContentChange).not.toHaveBeenCalled();
  });
});
