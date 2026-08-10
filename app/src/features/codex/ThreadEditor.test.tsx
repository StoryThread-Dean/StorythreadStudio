// features/codex/ThreadEditor.test.tsx
// ====================================
// The Profile Builder covers four kinds. Everything else in the Weave --
// factions, deities, objects, events -- had nowhere to be written, so Weaving
// had to tell the writer so and stop. This is that editor.
//
// The two things these tests care most about are the ones a writing app cannot
// get wrong: SAVED MEANS SAVED (manual save is a locked product rule, so
// unsaved work must look unsaved and leaving must be confirmed), and a save
// that would overwrite somebody else's is REFUSED rather than merged.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadEditor } from "./ThreadEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

const TYPES = {
  schema_version: 1,
  relations: [],
  types: [
    { id: "faction", label: "Faction", folder: "factions", icon: "Flag",
      sections: [
        { id: "overview", heading: "Overview", trait_blocks: false },
        { id: "goals", heading: "Goals", trait_blocks: false },
      ] },
  ],
};

const LIST = {
  threads: [
    { entity_id: "e-vale", type: "faction", name: "House Vale",
      filename: "house-vale.md", status: "active" },
    { entity_id: "e-thorne", type: "faction", name: "House Thorne",
      filename: "house-thorne.md", status: "active" },
  ],
};

const ANCHORS = {
  chapters: [
    { chapter_id: "c-1", filename: "01.md", title: "The Raid", anchor: "c-1",
      act_id: "", act_title: "" },
    { chapter_id: "c-2", filename: "02.md", title: "The Letter", anchor: "c-2",
      act_id: "", act_title: "" },
  ],
};

function entry(over: Record<string, unknown> = {}) {
  return {
    entity_id: "e-vale", type: "faction", name: "House Vale",
    display_name: "", aliases: ["The Vale"], tags: [],
    filename: "house-vale.md",
    sections: {
      overview: { heading: "Overview", content: "An old house." },
      goals: { heading: "Goals", content: "" },
    },
    ties: [], run: [], revision: "rev-1",
    ...over,
  };
}

let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(options: {
  thread?: Record<string, unknown>;
  saveFails?: string;
  created?: string;
} = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });

    if (url.includes("/ties")) return ok({ ties: [] });
    if (url.includes("/types")) return ok(TYPES);
    if (url.includes("/list")) return ok(LIST);
    if (url.includes("/anchors")) return ok(ANCHORS);
    if (url.includes("/entity") && method === "GET") {
      return ok(options.thread ?? entry());
    }
    if (url.includes("/thread/new")) {
      return ok({ thread: { entity_id: options.created ?? "e-new" } });
    }
    if (url.includes("/entity") && method === "POST") {
      if (options.saveFails) {
        return {
          ok: false,
          json: async () => ({ detail: { code: "version_conflict",
                                         message: options.saveFails } }),
        } as Response;
      }
      return ok({ saved: true, revision: "rev-2" });
    }
    return ok({});
  }));
}

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body } as Response);

beforeEach(() => mockApi());

async function open(props: Record<string, unknown> = {}) {
  const onBack = vi.fn();
  const onDirtyChange = vi.fn();
  render(<ThreadEditor projectPath={PROJECT} typeId="faction"
                       onBack={onBack} onDirtyChange={onDirtyChange} {...props} />);
  await waitFor(() => expect(screen.getByTestId("thread-editor")).toBeTruthy());
  return { onBack, onDirtyChange };
}

async function openEntry(props: Record<string, unknown> = {}) {
  const handles = await open(props);
  await userEvent.click(await screen.findByRole("button", { name: /House Vale/ }));
  await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
  return handles;
}

const saves = () => calls.filter(c => c.method === "POST"
                                   && c.url.includes("/entity"));


describe("finding an entry of this kind", () => {
  it("lists them", async () => {
    await open();
    expect(await screen.findByRole("button", { name: /House Vale/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /House Thorne/ })).toBeTruthy();
  });

  it("says what kind it is showing, in the writer's word", async () => {
    await open();
    expect(await screen.findByText("Faction")).toBeTruthy();
  });

  it("says so plainly when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/types")) return ok(TYPES);
      if (url.includes("/list")) return ok({ threads: [] });
      return ok(ANCHORS);
    }));
    await open();
    expect(await screen.findByText("Nothing here yet.")).toBeTruthy();
  });

  it("opens one straight away when told which", async () => {
    // Weaving sends the writer to a named entry, and landing on the list would
    // be a different promise from "open it".
    await open({ initialFilename: "house-vale.md" });
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());
    expect((screen.getByLabelText("Name") as HTMLInputElement).value)
      .toBe("House Vale");
  });

  it("adds one and opens it", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add faction/ }));
    await userEvent.type(screen.getByLabelText("Name"), "House Ash");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(calls.some(c => c.url.includes("/thread/new"))).toBe(true));
    const made = calls.filter(c => c.url.includes("/thread/new"))[0];
    expect(made.body).toMatchObject({ type: "faction", name: "House Ash" });
  });
});


describe("the sections come from the registry", () => {
  it("shows the headings this KIND has, not a fixed set", async () => {
    // A Faction's headings are whatever types.json says, including for a kind
    // added this morning. Nothing about the shape of an entry is hardcoded.
    await openEntry();
    expect(screen.getByLabelText("Overview")).toBeTruthy();
    expect(screen.getByLabelText("Goals")).toBeTruthy();
  });

  it("shows what is already written", async () => {
    await openEntry();
    expect((screen.getByLabelText("Overview") as HTMLTextAreaElement).value)
      .toBe("An old house.");
  });

  it("keeps the name and the label apart", async () => {
    // Two different questions: what it IS, and what the story calls it.
    await openEntry();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Shown as")).toBeTruthy();
  });

  it("shows every word the entry answers to", async () => {
    await openEntry();
    expect((screen.getByLabelText("Also called") as HTMLTextAreaElement).value)
      .toBe("The Vale");
  });
});


describe("saved means saved", () => {
  // Manual save is a locked product rule. Unsaved work must LOOK unsaved,
  // leaving must be confirmed, and nothing is written until the writer says so.

  it("writes nothing while the writer types", async () => {
    await openEntry();
    await userEvent.type(screen.getByLabelText("Overview"), " Older than most.");
    expect(saves()).toEqual([]);
  });

  it("says out loud that there are unsaved changes", async () => {
    await openEntry();
    expect(screen.queryByTestId("unsaved")).toBeNull();
    await userEvent.type(screen.getByLabelText("Goals"), "Hold the pass.");
    expect(screen.getByTestId("unsaved")).toBeTruthy();
  });

  it("tells the shell, so its own indicator agrees", async () => {
    const { onDirtyChange } = await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
  });

  it("will not save when there is nothing to save", async () => {
    await openEntry();
    expect(screen.getByRole("button", { name: /Save/ })
      .hasAttribute("disabled")).toBe(true);
  });

  it("saves the whole entry in one write", async () => {
    // Which is also why facts are edited here rather than through a per-fact
    // endpoint: one Save, one file, one moment where the writer said yes.
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "Hold the pass.");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(saves().length).toBe(1));
    const sent = saves()[0].body.thread as Record<string, unknown>;
    expect((sent.sections as Record<string, { content: string }>).goals.content)
      .toBe("Hold the pass.");
  });

  it("stops saying unsaved once it is saved", async () => {
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(screen.queryByTestId("unsaved")).toBeNull();
  });

  it("confirms before leaving with unsaved work", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const { onBack } = await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(confirm).toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("leaves when the writer says to", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { onBack } = await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("does not ask when there is nothing to lose", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const { onBack } = await openEntry();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it("confirms before switching to another entry too", async () => {
    // Losing work by clicking a name in a list is the same loss as losing it
    // by pressing Back.
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: /House Thorne/ }));
    expect(confirm).toHaveBeenCalled();
  });
});


describe("a conflicting save is refused, not merged", () => {
  it("sends the revision it opened at", async () => {
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(saves().length).toBe(1));
    expect(saves()[0].body.base_revision).toBe("rev-1");
  });

  it("shows the refusal and keeps the writer's work in the buffer", async () => {
    // Silently winning would lose whoever wrote first. Silently discarding
    // would lose whoever is here now.
    mockApi({ saveFails: "This entry changed on disk since you opened it." });
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "Hold the pass.");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(screen.getByText(/changed on disk/)).toBeTruthy());
    expect((screen.getByLabelText("Goals") as HTMLTextAreaElement).value)
      .toBe("Hold the pass.");
    expect(screen.getByTestId("unsaved")).toBeTruthy();
  });

  it("moves to the new revision after a save, so the next one is clean", async () => {
    await openEntry();
    await userEvent.type(screen.getByLabelText("Goals"), "x");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    await userEvent.type(screen.getByLabelText("Goals"), "y");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(saves().length).toBe(2));
    expect(saves()[1].body.base_revision).toBe("rev-2");
  });
});


describe("how the entry changes through the story", () => {
  // The reason the Weave exists. A fact with no point in the story is true
  // everywhere or nowhere, and Weaving sends writers here to place them.

  const withFact = entry({
    run: [{ id: "f-1", at: "", axis: "allegiance",
            value: "Sworn to the crown.", ai_scope: "always" }],
  });

  it("says what this part is for, not just what it is called", async () => {
    await openEntry();
    expect(screen.getByText(/who someone was in chapter seven/)).toBeTruthy();
  });

  it("offers the writer's own chapters, never a date", async () => {
    mockApi({ thread: withFact });
    await openEntry();
    const when = screen.getByLabelText("From when 1");
    const options = Array.from(when.querySelectorAll("option"))
      .map(o => o.textContent);
    expect(options).toContain("1. The Raid");
    expect(options).toContain("2. The Letter");
  });

  it("lets an unplaced fact be seen as unplaced", async () => {
    // If "not placed" were not selectable the writer could not tell that it IS
    // the state Weaving is complaining about.
    mockApi({ thread: withFact });
    await openEntry();
    expect((screen.getByLabelText("From when 1") as HTMLSelectElement).value)
      .toBe("");
    expect(within(screen.getByLabelText("From when 1"))
      .getByText("Not placed yet")).toBeTruthy();
  });

  it("places it, and that is an unsaved change like any other", async () => {
    mockApi({ thread: withFact });
    await openEntry();
    await userEvent.selectOptions(screen.getByLabelText("From when 1"), "c-2");
    expect(screen.getByTestId("unsaved")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(saves().length).toBe(1));
    const sent = saves()[0].body.thread as { run: { at: string }[] };
    expect(sent.run[0].at).toBe("c-2");
  });

  it("adds one, and removes one", async () => {
    await openEntry();
    await userEvent.click(
      screen.getByRole("button", { name: /Something that changes/ }));
    expect(screen.getAllByTestId("fact")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /^Remove/ }));
    expect(screen.queryAllByTestId("fact")).toHaveLength(0);
  });

  it("offers the three AI visibilities in the writer's words", async () => {
    mockApi({ thread: withFact });
    await openEntry();
    const scope = screen.getByLabelText("AI may see 1");
    const options = Array.from(scope.querySelectorAll("option"))
      .map(o => o.textContent);
    expect(options).toEqual(["Always", "Only when asked", "Never"]);
  });

  it("says nothing is here yet rather than showing an empty table", async () => {
    await openEntry();
    expect(screen.getByText(/for what is true throughout/)).toBeTruthy();
  });
});


describe("connections", () => {
  it("are reached from the entry, not reimplemented here", async () => {
    // One editor for connections, used from the map and from here. Two would
    // drift.
    await openEntry();
    await userEvent.click(screen.getByRole("button", { name: /Connections/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
  });
});
