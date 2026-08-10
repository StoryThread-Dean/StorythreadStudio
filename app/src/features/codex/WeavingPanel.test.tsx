// features/codex/WeavingPanel.test.tsx
// =====================================
// A walkthrough people click through is worse than no walkthrough: it costs
// time and finds nothing. Everything here protects against that.
//
//   - the count it quotes is REAL, because the scan is free and runs first
//   - every stop shows the text that triggered it and the rule that fired
//   - "not a connection" and "not yet" are different answers, and stay so
//   - the one-click action creates an EMPTY entry; it never writes for you

import {
  render, screen, cleanup, fireEvent, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeavingPanel } from "./WeavingPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function stop(overrides: Record<string, unknown> = {}) {
  return {
    kind: "unspun",
    key: "unspun|garrick",
    title: "'Garrick' has no entry",
    why: "It reads like a name and appears 4 times, and nothing in the Weave answers to it.",
    entity_id: "",
    chapter_id: "c-1",
    quote: "Garrick rode north through the ash.",
    evidence_hash: "abc123",
    detail: { name: "Garrick", count: 4 },
    ...overrides,
  };
}

let calls: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(options: {
  stops?: Record<string, unknown>[];
  total?: number;
  unreadable?: string[];
  runs?: Record<string, unknown>[];
  failWrites?: boolean;
} = {}) {
  const stops = options.stops ?? [stop()];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (init?.method === "POST") calls.push({ url, body });

    if (url.includes("/graph")) {
      return { ok: true, json: async () => ({ nodes: [], edges: [],
                                              as_of: null, hidden_nodes: 0,
                                              hidden_edges: 0 }) } as Response;
    }
    if (url.includes("/ties")) {
      return { ok: true, json: async () => ({ ties: [] }) } as Response;
    }
    if (url.includes("/runs")) {
      return { ok: true, json: async () => ({ runs: options.runs ?? [] }) } as Response;
    }
    if (url.includes("/scan")) {
      return {
        ok: true,
        json: async () => ({
          run_id: null, stops, counts: {},
          total: options.total ?? stops.length,
          unreadable: options.unreadable ?? [], resumed: {},
        }),
      } as Response;
    }
    if (url.endsWith("/run")) {
      return { ok: true, json: async () => ({ run_id: "run-abc123abc123" }) } as Response;
    }
    if (options.failWrites) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "type_invalid",
                                       message: "That could not be created." } }),
      } as Response;
    }
    return { ok: true, json: async () => ({ run: {}, returned: 0, thread: {} }) } as Response;
  }));
}

beforeEach(() => mockApi());

async function open(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(<WeavingPanel projectPath={PROJECT} onClose={onClose} {...props} />);
  await waitFor(() => expect(screen.getByTestId("weaving-count")).toBeTruthy());
  return { onClose };
}

async function start(props: Record<string, unknown> = {}) {
  const handles = await open(props);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(screen.getByTestId("weaving-progress")).toBeTruthy());
  return handles;
}

function posted(fragment: string) {
  return calls.filter(c => c.url.includes(fragment));
}


describe("before anything starts", () => {
  it("says what Weaving is and that nothing happens without you", async () => {
    await open();
    expect(screen.getByText(/Nothing is changed without you choosing it/)).toBeTruthy();
  });

  it("quotes a real count, because the scan already ran", async () => {
    // Not an estimate. An estimate that turns out wrong two hours in is how
    // a writer learns not to trust the app.
    mockApi({ stops: [stop(), stop({ key: "b" }), stop({ key: "c" })], total: 3 });
    await open();
    expect(screen.getByTestId("weaving-count").textContent)
      .toMatch(/found 3 things/);
  });

  it("warns in hours rather than in units when the list is long", async () => {
    // "340" is information. "many sessions" is what a writer decides with.
    mockApi({ stops: [stop()], total: 340 });
    await open();
    expect(screen.getByText(/many sessions of work/)).toBeTruthy();
    expect(screen.getByText(/stop anywhere and come back/)).toBeTruthy();
  });

  it("does not warn about a short list", async () => {
    mockApi({ stops: [stop()], total: 1 });
    await open();
    expect(screen.queryByText(/many sessions of work/)).toBeNull();
  });

  it("names the chapters it could not read", async () => {
    // "We found 4 things" reads very differently when a chapter was skipped.
    mockApi({ unreadable: ["07-chapter.md"] });
    await open();
    expect(screen.getByText(/07-chapter.md/)).toBeTruthy();
  });

  it("offers a quick pass that asks nothing of your imagination", async () => {
    await open();
    expect(screen.getByText(/Nothing that asks you to invent anything/)).toBeTruthy();
  });

  it("rescans when the depth changes, so the count matches the choice", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Quick pass/ }));
    await waitFor(() =>
      expect(posted("/scan").some(c => c.body.depth === "quick")).toBe(true));
  });

  it("has nothing to start when the book and the world agree", async () => {
    mockApi({ stops: [], total: 0 });
    await open();
    expect(screen.getByTestId("weaving-count").textContent)
      .toMatch(/your world and your book agree/i);
    expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled"))
      .toBe(true);
  });

  it("says an earlier session is not undone by a new one", async () => {
    mockApi({ runs: [{ run_id: "run-old", depth: "full", answered: 3,
                       deferred: 1, created_at: "", updated_at: "" }] });
    await open();
    expect(screen.getByText(/does not undo anything you already applied/)).toBeTruthy();
  });
});


describe("one stop", () => {
  it("shows the text that triggered it", async () => {
    // A decision made without seeing what prompted it is not a decision.
    await start();
    expect(screen.getByText(/Garrick rode north through the ash/)).toBeTruthy();
  });

  it("can always say why it is here", async () => {
    await start();
    expect(screen.getByText("Why am I seeing this?")).toBeTruthy();
    expect(screen.getByText(/appears 4 times/)).toBeTruthy();
  });

  it("names the kind in the writer's words, not the code", async () => {
    await start();
    expect(screen.getByText("Unspun")).toBeTruthy();
    expect(screen.queryByText("unspun")).toBeNull();
  });

  it("offers the longer explanation of the kind", async () => {
    await start();
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/an innkeeper with one line/)).toBeTruthy();
  });

  it("says where it is in the walk", async () => {
    mockApi({ stops: [stop(), stop({ key: "b", title: "Second" })], total: 2 });
    await start();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
  });

  it("says how many were found in all when some are already answered", async () => {
    // "12 of 340" means something. Showing only what is left makes a long
    // session look like it had barely started.
    mockApi({ stops: [stop()], total: 40 });
    await start();
    expect(screen.getByTestId("weaving-progress").textContent)
      .toMatch(/40 found in all/);
  });
});


describe("the four ways to answer", () => {
  it("creates an EMPTY entry, and never writes it for you", async () => {
    // The only one-click action in the whole walk, and what it produces is a
    // named entry with nothing in it.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.name).toBe("Garrick");
  });

  it("records the creation as applied, because the file was written", async () => {
    // "applied" has to mean SAVED. This one genuinely is.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() =>
      expect(posted("/run/answer").some(c => c.body.state === "applied")).toBe(true));
  });

  it("retires the PHRASE when a name is not a connection", async () => {
    // The same word in another chapter must not be asked either.
    await start();
    await userEvent.click(screen.getByRole("button", { name: "Not a connection" }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body).toMatchObject({
      state: "dismissed", retire_phrase: "Garrick",
    });
  });

  it("keeps not-yet separate from not-a-connection", async () => {
    // Collapsing them means either nagging about settled things or losing
    // things that were only postponed.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.state).toBe("deferred");
    expect(posted("/run/answer")[0].body.retire_phrase).toBeUndefined();
  });

  it("can turn a whole kind off", async () => {
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.mute).toBe("unspun");
  });

  it("says that turning a kind off is reversible", async () => {
    await start();
    expect(screen.getByRole("button", { name: /Never ask/ }).getAttribute("title"))
      .toMatch(/turn it back on/);
  });

  it("moves on after an answer", async () => {
    mockApi({ stops: [stop(), stop({ key: "b", title: "Second thing" })], total: 2 });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByText("Second thing")).toBeTruthy());
  });

  it("lets the writer go back", async () => {
    mockApi({ stops: [stop(), stop({ key: "b", title: "Second thing" })], total: 2 });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByText("Second thing")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/'Garrick' has no entry/)).toBeTruthy();
  });

  it("keeps the writer's place when an answer fails", async () => {
    // Losing their place because a write failed would be its own small
    // betrayal.
    mockApi({ failWrites: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/'Garrick' has no entry/)).toBeTruthy();
  });
});


describe("stops that are not about a name", () => {
  const frayed = stop({
    kind: "frayed", key: "frayed|e-1", entity_id: "e-1",
    title: "Mira Kell is missing Overview", quote: "",
    detail: { name: "Mira Kell", type: "character", filename: "mira-kell.md",
              missing: ["Overview"] },
  });

  it("offers to open it rather than to fill it in for you", async () => {
    mockApi({ stops: [frayed] });
    await start();
    expect(screen.getByRole("button", { name: /Open it and fill it in/ })).toBeTruthy();
  });

  it("takes the writer to the Thread", async () => {
    mockApi({ stops: [frayed] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Open it and fill it in/ }));
    // With the KIND and the FILE, so "open it" opens the entry rather than
    // landing on a list and leaving the writer to find her again.
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith(
      "e-1", { type: "character", filename: "mira-kell.md" }));
  });

  it("does not create anything for a stop that already has an entry", async () => {
    mockApi({ stops: [frayed] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Open it and fill it in/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-panel")).toBeTruthy());
    expect(posted("/thread/new")).toEqual([]);
  });

  it("does not retire a phrase for a stop that is not a name", async () => {
    mockApi({ stops: [frayed] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: "Not a connection" }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.retire_phrase).toBeUndefined();
  });
});


describe("the end of the walk", () => {
  it("explains what comes back and what does not", async () => {
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() =>
      expect(screen.getByText(/That is everything this pass found/)).toBeTruthy());
    expect(screen.getByText(/Anything you put off comes back next time/)).toBeTruthy();
  });

  it("explains that the list looks after itself as the book changes", async () => {
    // The point of never storing stops, said in the writer's terms.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() =>
      expect(screen.getByText(/worked out fresh every time/)).toBeTruthy());
  });
});


describe("what is left to do", () => {
  it("shows the shape of the work, not just the next question", async () => {
    // "Most of this is one kind of problem" is worth knowing before
    // answering forty of them one at a time.
    mockApi({
      stops: [stop(), stop({ key: "b" }),
              stop({ kind: "loose_thread", key: "c", entity_id: "e-9" })],
      total: 3,
    });
    await start();
    const rail = screen.getByTestId("weaving-panel");
    expect(within(rail).getByText(/Unspun 2/)).toBeTruthy();
    expect(within(rail).getByText(/Loose thread 1/)).toBeTruthy();
  });
});


describe("questions your world has not answered", () => {
  const unwoven = {
    kind: "unwoven",
    key: "unwoven|gov_succession",
    title: "When the person in charge dies, how is the next one decided?",
    why: "You answered: \"Who actually holds power here, and how did they get it?\" -- which raises this. Succession is where politics turns into plot.",
    entity_id: "", chapter_id: "", quote: "", evidence_hash: "",
    detail: {
      question_id: "gov_succession", domain: "governance",
      domain_label: "Power and who holds it",
      lands_as: ["lore", "details"],
      touches: ["What is the worst thing a person can be accused of here?"],
      depth: 2,
    },
  };

  it("asks the question rather than reporting a problem", async () => {
    // The one stop kind that is not about a mistake.
    mockApi({ stops: [unwoven] });
    await start();
    expect(screen.getByText(/how is the next one decided/)).toBeTruthy();
  });

  it("says what raised it", async () => {
    // A question arriving with no reason behind it is what makes
    // worldbuilding prompts feel like homework.
    mockApi({ stops: [unwoven] });
    await start();
    await userEvent.click(screen.getByText("Why am I seeing this?"));
    expect(screen.getByText(/which raises this/)).toBeTruthy();
  });

  it("says where the answer belongs", async () => {
    // "Answer it" with no address is an instruction to write a note, and a
    // note is not part of the world.
    mockApi({ stops: [unwoven] });
    await start();
    expect(screen.getByText(/lore > details/)).toBeTruthy();
  });

  it("says what else the answer reaches into", async () => {
    // A world is a web. This is what stops it feeling like a form.
    mockApi({ stops: [unwoven] });
    await start();
    expect(screen.getByText(/worst thing a person can be accused of/)).toBeTruthy();
  });

  it("takes the writer to the kind of entry it belongs in", async () => {
    mockApi({ stops: [unwoven] });
    const onOpenKind = vi.fn();
    await start({ onOpenKind });
    await userEvent.click(screen.getByRole("button", { name: /Go and answer it/ }));
    await waitFor(() => expect(onOpenKind).toHaveBeenCalledWith("lore"));
  });

  it("creates nothing, because the answer does not exist yet", async () => {
    mockApi({ stops: [unwoven] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Go and answer it/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-panel")).toBeTruthy());
    expect(posted("/thread/new")).toEqual([]);
  });
});


describe("where it sits", () => {
  // It began as a third column, between the sidebar and the Writing
  // Companion, which left the writer's own prose as the narrowest thing on
  // screen -- backwards for an app whose rule is that the manuscript is the
  // visual focus. It is now the same shape as the audiobook's guided walk.

  it("is a dialog over the page, not a panel beside it", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: "Weaving" });
    expect(dialog).toBeTruthy();
    // No width reserved in the layout: it paints its own backdrop.
    expect(dialog.parentElement?.className).toContain("fixed");
  });

  it("closes on the backdrop", async () => {
    const { onClose } = await open();
    const backdrop = screen.getByRole("dialog", { name: "Weaving" }).parentElement!;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the writer clicks inside it", async () => {
    // Losing a walkthrough mid-session because a click landed on the card
    // would be its own small betrayal.
    const { onClose } = await open();
    await userEvent.click(screen.getByRole("dialog", { name: "Weaving" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onClose } = await open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});


describe("every shipped kind now has somewhere to go", () => {
  // The dead end this replaces: factions, governments, concepts and events had
  // no editor, so the walk had to say so. The Thread editor covers them all
  // now, and these pin that the walk actually routes there.

  const faction = stop({
    kind: "frayed", key: "frayed|e-f", entity_id: "e-f",
    title: "House Vale is missing Overview", quote: "",
    detail: { name: "House Vale", type: "faction", filename: "house-vale.md",
              missing: ["Overview"] },
  });

  it("offers to open a faction, which it could not before", async () => {
    mockApi({ stops: [faction] });
    await start();
    expect(screen.getByRole("button", { name: /Open it and fill it in/ }))
      .toBeTruthy();
  });

  it("sends the writer to that faction, by kind and file", async () => {
    mockApi({ stops: [faction] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Open it and fill it in/ }));
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith(
      "e-f", { type: "faction", filename: "house-vale.md" }));
  });

  it("no longer apologises for a shipped kind", async () => {
    mockApi({ stops: [faction] });
    await start();
    expect(screen.queryByText(/no editor for this kind of entry yet/)).toBeNull();
  });

  it("takes an Unwoven answer to the kind it belongs in", async () => {
    mockApi({ stops: [stop({
      kind: "unwoven", key: "unwoven|gov_power", title: "Who holds power?",
      why: "Because.", entity_id: "", quote: "",
      detail: { lands_as: ["government", "overview"], touches: [] },
    })] });
    const onOpenKind = vi.fn();
    await start({ onOpenKind });
    await userEvent.click(screen.getByRole("button", { name: /Go and answer it/ }));
    await waitFor(() => expect(onOpenKind).toHaveBeenCalledWith("government"));
  });
});


describe("a kind the writer invented", () => {
  // The one case that IS still a dead end, and honestly so: a custom kind has
  // no sections of its own until the writer gives it some, so an editor would
  // open on nothing to type in. Saying so beats sending them to a blank screen.

  const race = stop({
    kind: "frayed", key: "frayed|e-r", entity_id: "e-r",
    title: "Drow is missing Overview", quote: "",
    detail: { name: "Drow", type: "race", filename: "drow.md",
              missing: ["Overview"] },
  });

  it("offers no action rather than one that leads nowhere", async () => {
    mockApi({ stops: [race] });
    await start();
    expect(screen.queryByRole("button", { name: /Open it/ })).toBeNull();
  });

  it("says why there is nothing to click", async () => {
    mockApi({ stops: [race] });
    await start();
    expect(screen.getByText(/no editor for this kind of entry yet/)).toBeTruthy();
  });

  it("still lets the writer put it off or stop being asked", async () => {
    mockApi({ stops: [race] });
    await start();
    expect(screen.getByRole("button", { name: /Not yet/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Never ask/ })).toBeTruthy();
  });

  it("says those answers are remembered", async () => {
    // They are, now that permanence is per book rather than per session.
    mockApi({ stops: [race] });
    await start();
    expect(screen.getByText(/both are remembered/)).toBeTruthy();
  });
});


describe("something the writer marked themselves", () => {
  // Weaving will miss things. A pin is how the writer says "this one matters"
  // about a word no rule raised -- and it MARKS rather than connects, so
  // there is no relation to get wrong and nothing to connect to yet is a
  // perfectly good reason to make one.

  const unknown = stop({
    kind: "pinned", key: "pinned|kithicor forest", entity_id: "",
    title: "'Kithicor Forest' has no entry yet",
    why: "You marked this yourself, so it is here until you say what to do with it. Nothing found it -- you pointed at it.",
    quote: "They rode into Kithicor Forest before dawn.",
    detail: { name: "Kithicor Forest", note: "", has_entry: false,
              type: "", filename: "" },
  });

  const known = stop({
    kind: "pinned", key: "pinned|lexa", entity_id: "e-lexa",
    title: "'Lexa' -- what should this connect to?",
    why: "You marked this yourself.",
    quote: "Lexa said nothing.",
    detail: { name: "Lexa", note: "", has_entry: true, type: "character",
              filename: "alexandra.md" },
  });

  it("says the writer asked, not that a rule fired", async () => {
    mockApi({ stops: [unknown] });
    await start();
    await userEvent.click(screen.getByText("Why am I seeing this?"));
    expect(screen.getByText(/you pointed at it/)).toBeTruthy();
  });

  it("shows the sentence it was marked in", async () => {
    mockApi({ stops: [unknown] });
    await start();
    expect(screen.getByText(/before dawn/)).toBeTruthy();
  });

  it("offers to create the entry when nothing answers to it", async () => {
    mockApi({ stops: [unknown] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.name).toBe("Kithicor Forest");
  });

  it("asks about the CONNECTION when the entry already exists", async () => {
    // "Make an entry" is the wrong question once there is one.
    mockApi({ stops: [known] });
    await start();
    expect(screen.getByRole("button", { name: /Open it and connect it/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create the entry/ })).toBeNull();
  });

  it("asks what to connect it to WITHOUT leaving the walk", async () => {
    // Reported: "Open it and connect it" opened the entry's own page and
    // abandoned the writer there. Connecting happens here now, so the walk
    // keeps its place and a wrong choice is a step back.
    mockApi({ stops: [known] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Open it and connect it/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
    expect(posted("/thread/new")).toEqual([]);
  });

  it("comes back to the same stop when the connector closes", async () => {
    // The whole point of doing it here. Closing must not lose the writer's
    // place in the list.
    mockApi({ stops: [known] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Open it and connect it/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/what should this connect to/)).toBeTruthy();
  });

  it("calls saying no REMOVING THE MARK, because that is what it is", async () => {
    // "Not a connection" is about a rule that was wrong. A pin was not a rule.
    mockApi({ stops: [unknown] });
    await start();
    expect(screen.getByRole("button", { name: /Remove the mark/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Not a connection/ })).toBeNull();
  });

  it("can still be put off", async () => {
    mockApi({ stops: [unknown] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.state).toBe("deferred");
  });

  it("names it Pinned, in the loom vocabulary", async () => {
    mockApi({ stops: [unknown] });
    await start();
    expect(screen.getByText("Pinned")).toBeTruthy();
  });

  it("explains that marking is not connecting", async () => {
    mockApi({ stops: [unknown] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/Marking does not make a connection/)).toBeTruthy();
  });
});

describe("one entry for a name and its variants", () => {
  // Reported after a live walkthrough: accepting "Lara Croft", "Lara" and
  // "Croft" left three entries where the writer meant one. The scan now groups
  // them into one question, so the panel has to create ONE entry that answers
  // to all three -- otherwise the writer is back to three by a longer route.

  const grouped = stop({
    kind: "unspun", key: "unspun|lara croft",
    title: "'Lara Croft' has no entry, and neither do its other names",
    why: "You write 'Lara Croft' like a name. Your prose also calls it 'Croft', 'Lara', which look like the same thing, so one entry covers all of them.",
    quote: "She waited for Lara Croft.",
    detail: { name: "Lara Croft", count: 16, also: ["Croft", "Lara"] },
  });

  it("shows every word the one entry will answer to", async () => {
    // Before the button, not only behind "why am I seeing this?" -- one entry
    // covering three words is the part a writer would otherwise be surprised
    // by.
    mockApi({ stops: [grouped] });
    await start();
    expect(screen.getByText("Lara Croft, Croft, Lara")).toBeTruthy();
  });

  it("creates ONE entry carrying the other names", async () => {
    mockApi({ stops: [grouped] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body).toMatchObject({
      name: "Lara Croft",
      aliases: ["Croft", "Lara"],
    });
  });

  it("does not make a second entry for a variant", async () => {
    mockApi({ stops: [grouped] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
  });

  it("says nothing about other names when there are none", async () => {
    // An ungrouped name should not gain a line saying it answers to itself.
    mockApi({ stops: [stop()] });
    await start();
    expect(screen.queryByText(/One entry, answering to/)).toBeNull();
  });

  it("still sends an empty list for an ungrouped name", async () => {
    mockApi({ stops: [stop()] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.aliases).toEqual([]);
  });

  it("retires the group by its full name, not by a nickname", async () => {
    // The writer was shown "Lara Croft", so that is what "not a connection"
    // is about.
    mockApi({ stops: [grouped] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: "Not a connection" }));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.retire_phrase).toBe("Lara Croft");
  });
});

describe("connecting without leaving the walk", () => {
  // Reported from live testing, on a Loose thread:
  //
  //     "Clicked Open it and connect it > Alexandra Langfords profile directly
  //      opened up... But the continuation of the process stopped there. I'm at
  //      the profile, now what? No way to go back, no way to accept the
  //      connection as the correct one. Nothing."
  //
  // Three paths were named: it worked and now what; it was wrong and I need to
  // go back; the thing does not exist yet. All three are one problem -- the
  // walk gave up its place -- so connecting happens here now.

  const lonely = stop({
    kind: "loose_thread", key: "loose|e-alex", entity_id: "e-alex",
    title: "How is Alexandra Langford connected to the story?", quote: "",
    detail: { name: "Alexandra Langford", type: "character",
              filename: "alexandra-langford.md" },
  });

  it("says what it will do, rather than promising to open something", async () => {
    mockApi({ stops: [lonely] });
    await start();
    expect(screen.getByRole("button", { name: /Choose the connection/ }))
      .toBeTruthy();
  });

  it("asks here instead of sending the writer to the entry's page", async () => {
    mockApi({ stops: [lonely] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(
      screen.getByRole("button", { name: /Choose the connection/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("names the entry being connected, so the writer knows where they are", async () => {
    mockApi({ stops: [lonely] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose the connection/ }));
    expect(await screen.findByRole("dialog",
      { name: /Connections for Alexandra Langford/ })).toBeTruthy();
  });

  it("returns to the SAME stop, not the next one", async () => {
    // Path 2: it was the wrong choice and the writer needs to try again. That
    // has to be a step back, not a navigation problem.
    mockApi({ stops: [lonely, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose the connection/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText(/How is Alexandra Langford connected/))
      .toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
  });

  it("moves on when the writer says so, not when a screen closes", async () => {
    // Path 1: it worked, and now what. The writer answers the stop.
    mockApi({ stops: [lonely, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose the connection/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    expect(await screen.findByText("Something else")).toBeTruthy();
  });

  it("offers to connect an entry whose kind has no editor", async () => {
    // Connecting needs something to connect FROM and nothing else. A writer's
    // own kind can be connected even though it cannot yet be written in.
    mockApi({ stops: [stop({
      kind: "loose_thread", key: "loose|e-drow", entity_id: "e-drow",
      title: "How is Drow connected to the story?", quote: "",
      detail: { name: "Drow", type: "race", filename: "drow.md" },
    })] });
    await start();
    expect(screen.getByRole("button", { name: /Choose the connection/ }))
      .toBeTruthy();
  });
});

describe("an empty stub is asked what it IS", () => {
  // Reported from live testing:
  //
  //     "FRAYED - Dean is missing Overview. Open it and fill it in clicked >
  //      Opens to Profile Builder. Full stop. Can't go back, If I create a new
  //      entry for Dean, there is no visual connection to Dean on the Character
  //      profile."
  //
  // That was the wrong question. An entry Weaving made from a name has no prose
  // by definition; telling the writer to go and type is describing a symptom.
  // What they need to say is what it IS -- something they already have, or its
  // own entry of some kind -- and they need to say it without leaving.

  const bare = stop({
    kind: "frayed", key: "frayed|e-dean", entity_id: "e-dean",
    title: "Dean is missing Overview", quote: "",
    detail: { name: "Dean", type: "character", filename: "dean.md",
              missing: ["Overview"], placeholder: true },
  });

  const thin = stop({
    kind: "frayed", key: "frayed|e-mira", entity_id: "e-mira",
    title: "Mira Kell is missing Goals", quote: "",
    detail: { name: "Mira Kell", type: "character", filename: "mira.md",
              missing: ["Goals"], placeholder: false },
  });

  it("asks what it is, rather than telling the writer to type", async () => {
    mockApi({ stops: [bare] });
    await start();
    expect(screen.getByRole("button", { name: /Say what this is/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /fill it in/ })).toBeNull();
  });

  it("answers it here, without opening another screen", async () => {
    mockApi({ stops: [bare] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Say what this is/ }));
    expect(await screen.findByTestId("bind-dot")).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("comes back to the same stop when that closes", async () => {
    mockApi({ stops: [bare, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Say what this is/ }));
    await screen.findByTestId("bind-dot");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/Dean is missing Overview/)).toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
  });

  it("still sends the writer to the editor for an entry that HAS writing", async () => {
    // A partly-filled entry genuinely needs prose typed into it, and there is
    // nowhere to type in the walk. Pretending otherwise would be a worse lie.
    mockApi({ stops: [thin] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /fill it in/ }));
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith(
      "e-mira", { type: "character", filename: "mira.md" }));
  });

  it("offers the question for a kind that has no editor at all", async () => {
    // Saying what something is needs no editor. A writer's own Race can be
    // named before it can be written in.
    mockApi({ stops: [stop({
      kind: "frayed", key: "frayed|e-drow", entity_id: "e-drow",
      title: "Drow is missing Overview", quote: "",
      detail: { name: "Drow", type: "race", filename: "drow.md",
                missing: ["Overview"], placeholder: true },
    })] });
    await start();
    expect(screen.getByRole("button", { name: /Say what this is/ })).toBeTruthy();
  });
});

describe("the question starts from something the writer recognises", () => {
  // Reported from live testing, on the first item of 57:
  //
  //     "LOOSE THREAD - Nothing connections to Alexandra Langford. That's not
  //      true. Alexandra Langford connects to the Character profile Alexandra
  //      Langford... So from my perspective there is either a glitch or
  //      something isn't right."
  //
  // They were right, about a different sense of the word. Two things get called
  // connected: her name finding her entry, which is automatic and needs nothing,
  // and her entry relating to OTHER entries, which is what was missing. Stating
  // an absence invited them to go and check the part that was already fine.
  //
  // The fix asked for: show the entry itself -- its own kind's icon and name --
  // then ask the question.

  const lonely = stop({
    kind: "loose_thread", key: "loose|e-alex", entity_id: "e-alex",
    title: "How is Alexandra Langford connected to the story?", quote: "",
    why: "Mentions of this name in your writing already find this entry -- 43 of them so far -- and that needs nothing from you. What is missing is how it relates to the REST of your world.",
    detail: { name: "Alexandra Langford", type: "character",
              filename: "alexandra-langford.md", mentioned: 43 },
  });

  it("shows the entry it is asking about, by name", async () => {
    mockApi({ stops: [lonely] });
    await start();
    const on = screen.getByTestId("standing-on");
    expect(on.textContent).toContain("Alexandra Langford");
  });

  it("says what KIND of thing it is, so the profile is recognisable", async () => {
    mockApi({ stops: [lonely] });
    await start();
    expect(screen.getByTestId("standing-on").textContent).toContain("Character");
  });

  it("shows it BEFORE the question, not after", async () => {
    mockApi({ stops: [lonely] });
    await start();
    const text = screen.getByTestId("weaving-panel").textContent ?? "";
    expect(text.indexOf("Alexandra Langford"))
      .toBeLessThan(text.indexOf("How is Alexandra Langford connected"));
  });

  it("asks a question rather than reporting an absence", async () => {
    mockApi({ stops: [lonely] });
    await start();
    expect(screen.getByText(/How is Alexandra Langford connected/)).toBeTruthy();
  });

  it("says the mentions are already fine, with the count as proof", async () => {
    // The sentence that answers "isn't this already connected?" with "yes,
    // that part is -- here is what is not".
    mockApi({ stops: [lonely] });
    await start();
    await userEvent.click(screen.getByText("Why am I seeing this?"));
    expect(screen.getByText(/already find this entry -- 43 of them/)).toBeTruthy();
  });

  it("labels the action as choosing, not as opening", async () => {
    mockApi({ stops: [lonely] });
    await start();
    expect(screen.getByRole("button", { name: /Choose the connection/ }))
      .toBeTruthy();
  });

  it("shows no starting point for a stop that is not about an entry", async () => {
    // An Unspun name has no entry yet, so there is nothing to stand on.
    mockApi({ stops: [stop()] });
    await start();
    expect(screen.queryByTestId("standing-on")).toBeNull();
  });
});


describe("a pair the prose keeps putting together", () => {
  // The other half of the connection problem. Loose thread asks how ONE entry
  // relates to the world. Untied points at TWO that keep sharing a scene and
  // notices that nothing records why -- which is the connection the writer
  // most likely meant to make and never got round to.

  const pair = stop({
    kind: "untied", key: "untied|e-1|e-2", entity_id: "e-1",
    title: "How are Alexandra Langford and Dean connected?",
    quote: "Alexandra found Dean at the gate.",
    why: "Your writing puts them in the same scene 7 times, and nothing in the Weave records any connection between them. What that connection IS is yours to say -- sharing a scene could mean anything from family to a feud.",
    detail: {
      a: { entity_id: "e-1", name: "Alexandra Langford", type: "character",
           filename: "alexandra.md" },
      b: { entity_id: "e-2", name: "Dean", type: "character",
           filename: "dean.md" },
      scenes: 7,
    },
  });

  it("names both ends in the question", async () => {
    mockApi({ stops: [pair] });
    await start();
    expect(screen.getByText(/How are Alexandra Langford and Dean connected/))
      .toBeTruthy();
  });

  it("shows both ends with their own kind icons", async () => {
    mockApi({ stops: [pair] });
    await start();
    const on = screen.getByTestId("standing-on");
    expect(on.textContent).toContain("Alexandra Langford");
    expect(on.textContent).toContain("Dean");
  });

  it("asks how they connect, not whether they do", async () => {
    // The prose already settled whether. Only the kind of connection is open,
    // and that is the writer's to name.
    mockApi({ stops: [pair] });
    await start();
    expect(screen.getByRole("button", { name: /Say how they connect/ }))
      .toBeTruthy();
  });

  it("shows the count and the sentence it came from", async () => {
    mockApi({ stops: [pair] });
    await start();
    await userEvent.click(screen.getByText("Why am I seeing this?"));
    expect(screen.getByText(/same scene 7 times/)).toBeTruthy();
    expect(screen.getByText(/Alexandra found Dean at the gate/)).toBeTruthy();
  });

  it("answers it in the walk, without opening anything else", async () => {
    mockApi({ stops: [pair] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Say how they connect/ }));
    expect(await screen.findByRole("dialog",
      { name: /Connections for Alexandra Langford/ })).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("opens from the FIRST end, so the second is the one to choose", async () => {
    mockApi({ stops: [pair] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Say how they connect/ }));
    expect(await screen.findByRole("heading",
      { name: /How is Alexandra Langford connected/ })).toBeTruthy();
  });
});
