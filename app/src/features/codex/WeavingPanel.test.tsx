// features/codex/WeavingPanel.test.tsx
// =====================================
// A walkthrough people click through is worse than no walkthrough: it costs
// time and finds nothing. Everything here protects against that.
//
//   - the count it quotes is REAL, because the scan is free and runs first
//   - every stop shows the text that triggered it and the rule that fired
//   - "not a connection" and "not yet" are different answers, and stay so
//   - the one-click action creates an EMPTY entry; it never writes for you

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
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
    detail: { name: "Mira Kell", missing: ["Overview"] },
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
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith("e-1"));
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
      lands_as: ["government", "succession"],
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
    expect(screen.getByText(/government > succession/)).toBeTruthy();
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
    await waitFor(() => expect(onOpenKind).toHaveBeenCalledWith("government"));
  });

  it("creates nothing, because the answer does not exist yet", async () => {
    mockApi({ stops: [unwoven] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Go and answer it/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-panel")).toBeTruthy());
    expect(posted("/thread/new")).toEqual([]);
  });
});
