// features/codex/WeaveContextBar.test.tsx
// ========================================
// One test per obligation in the locked context rule, because this screen is
// the only place any of them is kept:
//
//     AI may automatically receive story context relevant to the current
//     point in the story, but the writer must be able to INSPECT what will be
//     sent, REMOVE individual Threads, EXCLUDE categories, and TURN automatic
//     Weave context OFF entirely. No context is transmitted until the writer
//     initiates an AI action.
//
// The last clause is the one a test can most easily let rot, so it is pinned
// twice: assembling never sends, and what it assembles leaves this component
// only by being handed up to the send path.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeaveContextBar, type WeaveContextPrefs } from "./WeaveContextBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function piece(over: Record<string, unknown> = {}) {
  return {
    entity_id: "e-alex", name: "Alexandra Langford", type: "character",
    tokens: 120, relevance: 2, reason: "named in what you are writing",
    pinned: false, text: "Alexandra Langford (Character)",
    ...over,
  };
}

let posted: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(over: Record<string, unknown> = {}) {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
    }
    if (url.includes("/anchors")) {
      return { ok: true, json: async () => ({ chapters: [
        { chapter_id: "c-4", filename: "04.md", title: "Chapter Four",
          anchor: "c-4", act_id: null, act_title: "" },
      ] }) } as Response;
    }
    if (url.includes("/context")) {
      return { ok: true, json: async () => ({
        brief: "Alexandra Langford (Character)\nis hiding her theft from Dean.",
        threads: [piece()],
        omitted: [], token_estimate: 120, as_of: "c-4",
        enabled: true, refused: false, refusal: "",
        withheld_spoilers: 0, withheld_by_scope: 0,
        budget: { available: 8000 }, mentioned: [],
        ...over,
      }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

beforeEach(() => mockApi());

async function open(prefs: WeaveContextPrefs = {}) {
  const onPrefsChange = vi.fn();
  const onBriefChange = vi.fn();
  render(
    <WeaveContextBar
      projectPath={PROJECT}
      chapterFilename="04.md"
      text="Alexandra counted the coins again."
      pinnedTokens={0}
      prefs={prefs}
      onPrefsChange={onPrefsChange}
      onBriefChange={onBriefChange}
    />,
  );
  await waitFor(() => expect(onBriefChange).toHaveBeenCalled());
  return { onPrefsChange, onBriefChange };
}

async function openPanel(prefs: WeaveContextPrefs = {}) {
  const handles = await open(prefs);
  await userEvent.click(screen.getByRole("button", { name: "Inspect" }));
  const panel = await screen.findByTestId("weave-context-panel");
  return { ...handles, panel };
}

const contextCalls = () => posted.filter(c => c.url.includes("/context"));


describe("nothing is transmitted by assembling it", () => {
  it("only ever talks to the local codex endpoints", async () => {
    await open();
    // /context is the only write, and it is the endpoint whose entire job is
    // to answer "what WOULD be sent" without sending it.
    for (const call of posted) {
      expect(call.url).toMatch(/\/api\/codex\/context/);
    }
    expect(contextCalls().length).toBeGreaterThan(0);
  });

  it("hands the assembled brief up rather than sending it anywhere", async () => {
    // The send path is what transmits, on the writer's action. This component
    // never has an opinion about when that happens.
    const { onBriefChange } = await open();
    expect(onBriefChange).toHaveBeenCalledWith(
      expect.stringContaining("hiding her theft from Dean"));
  });

  it("says so on the panel, because a writer is entitled to doubt it", async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByText(/sends nothing anywhere/)).toBeTruthy();
  });
});


describe("inspect what will be sent", () => {
  it("names each Thread and WHY it is there", async () => {
    // A list of names answers "what" and leaves "why on earth" unanswered,
    // which is the question that makes the panel worth opening.
    const { panel } = await openPanel();
    expect(within(panel).getByText("Alexandra Langford")).toBeTruthy();
    expect(within(panel).getByText(/named in what you are writing/)).toBeTruthy();
  });

  it("offers the exact words the AI will get", async () => {
    const { panel } = await openPanel();
    await userEvent.click(within(panel).getByText(/Read it exactly as the AI will/));
    expect(within(panel).getByText(/hiding her theft from Dean/)).toBeTruthy();
  });

  it("says it is as of this point, not the whole book", async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByText(/Later chapters are deliberately left out/))
      .toBeTruthy();
  });

  it("reports what was dropped to fit rather than dropping it quietly", async () => {
    // A brief that quietly omitted half the world would be worse than one
    // never assembled, because the writer would trust it.
    mockApi({ omitted: [{ entity_id: "e-guild", name: "The Guild",
                          tokens: 400, reason: "no room left" }] });
    const { panel } = await openPanel();
    await userEvent.click(within(panel).getByText(/1 left out to fit/));
    expect(within(panel).getByText(/The Guild -- no room left/)).toBeTruthy();
  });

  it("refuses rather than truncating, and then sends nothing", async () => {
    // Half a character profile reads as a whole one and the model has no way
    // to tell it was handed a fragment.
    mockApi({ refused: true, refusal: "What you attached does not fit.",
              brief: "", threads: [] });
    const { onBriefChange, panel } = await openPanel();
    expect(within(panel).getByRole("alert").textContent)
      .toMatch(/does not fit/);
    expect(onBriefChange).toHaveBeenLastCalledWith("");
  });
});


describe("remove one Thread", () => {
  it("drops it from what gets assembled", async () => {
    const { onPrefsChange, panel } = await openPanel();
    await userEvent.click(within(panel).getByRole("button",
      { name: "Remove Alexandra Langford" }));
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ excludedIds: ["e-alex"] }));
  });

  it("sends the exclusions to the assembler", async () => {
    await open({ excludedIds: ["e-alex"] });
    expect(contextCalls()[0].body.exclude_ids).toEqual(["e-alex"]);
  });

  it("lists what was removed so one can be put back", async () => {
    // A removal with no way back is a decision the writer cannot revisit.
    const { onPrefsChange, panel } = await openPanel({ excludedIds: ["e-alex"] });
    await userEvent.click(within(panel).getByRole("button", { name: /e-alex/ }));
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ excludedIds: [] }));
  });
});


describe("exclude a whole category", () => {
  it("offers the kinds actually present, not all fourteen", async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByRole("button", { name: "Character" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Language" })).toBeNull();
  });

  it("drops the kind and says it is dropped", async () => {
    const { onPrefsChange, panel } = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: "Character" }));
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ excludedTypes: ["character"] }));
  });

  it("sends the excluded kinds to the assembler", async () => {
    await open({ excludedTypes: ["deity"] });
    expect(contextCalls()[0].body.exclude_types).toEqual(["deity"]);
  });
});


describe("turn it off entirely", () => {
  it("assembles nothing at all when off", async () => {
    const { onBriefChange } = await open({ off: true });
    expect(onBriefChange).toHaveBeenLastCalledWith("");
    expect(contextCalls()).toEqual([]);
  });

  it("says what off MEANS, in the writer's terms", async () => {
    await open({ off: true });
    expect(screen.getByText(/only what you attach is sent/)).toBeTruthy();
  });

  it("is reachable without opening the panel first", async () => {
    // A writer who wants it off wants it off now, not after reading a list
    // of what they are turning off.
    const { onPrefsChange } = await open();
    await userEvent.click(screen.getByRole("button", { name: "Send world context" }));
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ off: true }));
  });

  it("can be turned back on from the bar", async () => {
    const { onPrefsChange } = await open({ off: true });
    await userEvent.click(screen.getByRole("button", { name: "Send world context" }));
    expect(onPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({ off: false }));
  });
});


describe("the bar states the shape without being opened", () => {
  it("counts the Threads and what they cost", async () => {
    await open();
    expect(screen.getByText(/1 Thread/)).toBeTruthy();
    expect(screen.getByText(/about 120 tokens/)).toBeTruthy();
  });

  it("says plainly when there is nothing to send", async () => {
    mockApi({ threads: [], brief: "", token_estimate: 0 });
    await open();
    expect(screen.getByText(/Nothing from your world to send yet/)).toBeTruthy();
  });

  it("fails closed when the brief cannot be built", async () => {
    // Sending a stale brief would describe a world the writer has since
    // changed, which is worse than sending none.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/anchors")) {
        return { ok: true, json: async () => ({ chapters: [] }) } as Response;
      }
      return { ok: false, json: async () => ({
        detail: { code: "unknown", message: "The world could not be read." },
      }) } as Response;
    }));
    const onPrefsChange = vi.fn();
    const onBriefChange = vi.fn();
    render(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="04.md" text=""
        pinnedTokens={0} prefs={{}}
        onPrefsChange={onPrefsChange} onBriefChange={onBriefChange} />,
    );
    await waitFor(() =>
      expect(onBriefChange).toHaveBeenCalledWith(""));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});


describe("assembling is not tied to typing", () => {
  it("does not re-assemble on every keystroke", async () => {
    // The text decides who counts as named here, but re-assembling per letter
    // would make the count flicker while the writer works and fire a request
    // per keypress. It is read at assembly time instead.
    const onPrefsChange = vi.fn();
    const onBriefChange = vi.fn();
    const view = render(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="04.md" text="Alexandra c"
        pinnedTokens={0} prefs={{}}
        onPrefsChange={onPrefsChange} onBriefChange={onBriefChange} />,
    );
    await waitFor(() => expect(screen.getByText(/1 Thread/)).toBeTruthy());
    const settled = contextCalls().length;
    view.rerender(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="04.md" text="Alexandra cou"
        pinnedTokens={0} prefs={{}}
        onPrefsChange={onPrefsChange} onBriefChange={onBriefChange} />,
    );
    await new Promise(r => setTimeout(r, 20));
    expect(contextCalls().length).toBe(settled);
  });

  it("assembles nothing until it knows WHERE the writer is", async () => {
    // With no anchor the brief is assembled as of the END of the book. A
    // writer who opened chapter four and sent immediately would have been
    // handed a brief that knew chapter nineteen -- the one thing a
    // time-aware world model must never do.
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL,
                                        init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/anchors")) {
        // Slow, the way a real request is: the assembly must WAIT for it.
        await new Promise(r => setTimeout(r, 30));
        return { ok: true, json: async () => ({ chapters: [
          { chapter_id: "c-4", filename: "04.md", title: "Chapter Four",
            anchor: "c-4", act_id: null, act_title: "" },
        ] }) } as Response;
      }
      seen.push(String(JSON.parse(String(init?.body ?? "{}")).at));
      return { ok: true, json: async () => ({
        brief: "b", threads: [piece()], omitted: [], token_estimate: 1,
        as_of: "c-4", enabled: true, refused: false, refusal: "",
        withheld_spoilers: 0, withheld_by_scope: 0, budget: {}, mentioned: [],
      }) } as Response;
    }));

    render(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="04.md" text=""
        pinnedTokens={0} prefs={{}}
        onPrefsChange={vi.fn()} onBriefChange={vi.fn()} />,
    );
    await waitFor(() => expect(seen.length).toBe(1));
    // Every assembly names the chapter. None was made as of nowhere.
    expect(seen).toEqual(["c-4"]);
  });

  it("re-assembles when the writer asks", async () => {
    const { panel } = await openPanel();
    const before = contextCalls().length;
    await userEvent.click(within(panel).getByRole("button",
      { name: /Work it out again/ }));
    await waitFor(() =>
      expect(contextCalls().length).toBeGreaterThan(before));
  });

  it("re-assembles when the chapter changes, because the brief is as-of", async () => {
    const onPrefsChange = vi.fn();
    const onBriefChange = vi.fn();
    const view = render(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="04.md" text=""
        pinnedTokens={0} prefs={{}}
        onPrefsChange={onPrefsChange} onBriefChange={onBriefChange} />,
    );
    await waitFor(() => expect(contextCalls().length).toBe(1));
    view.rerender(
      <WeaveContextBar
        projectPath={PROJECT} chapterFilename="09.md" text=""
        pinnedTokens={0} prefs={{}}
        onPrefsChange={onPrefsChange} onBriefChange={onBriefChange} />,
    );
    await waitFor(() => expect(contextCalls().length).toBeGreaterThan(1));
  });
});
