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
import { QuickFill } from "./QuickFill";

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

const OLD_SESSION = { run_id: "run-old", depth: "warp", answered: 3,
                      deferred: 1, created_at: "", updated_at: "" };

let calls: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(options: {
  nodes?: Record<string, unknown>[];
  stops?: Record<string, unknown>[];
  total?: number;
  unreadable?: string[];
  runs?: Record<string, unknown>[];
  failWrites?: boolean;
  /** Only the run ledger fails -- the writer's own saves land. This is the
   *  shape of the real bug it exists for: work saved, answer unrecorded. */
  failAnswers?: boolean;
  /** What GET /entity returns -- the entry QuickFill or the fixer reads. */
  entity?: Record<string, unknown>;
  /** The entry a stale stop points at is GONE -- absorbed or deleted since
   *  the scan. GET /entity refuses with entity_not_found. */
  entityMissing?: boolean;
  /** The fact a stale snag argues about is GONE: PATCH and DELETE /fact
   *  refuse with fact_not_found. */
  factsGone?: boolean;
  /** The type registry cannot be read -- Quick Entry has no section list. */
  typesDown?: boolean;
  /** What POST /run/resume finds. `undefined` means an ordinary resumable
   *  session; pass null for "the list said there was one and there is not". */
  resumeFinds?: Record<string, unknown> | null;
  /** What the scan says changed under a resumed sitting (R8.1). */
  resumed?: Record<string, unknown>;
  /** The Unwoven domain board's rows. Empty means the board renders nothing,
   *  which is right -- and is why a test that needs the board must say so. */
  domains?: Record<string, unknown>[];
} = {}) {
  const stops = options.stops ?? [stop()];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    // Every write is recorded, not only POST -- the fixer PATCHes facts and
    // DELETEs the losing side of a snag, and a test that cannot see those is
    // a test of half the flow.
    if (init?.method && init.method !== "GET") calls.push({ url, body });

    if (url.includes("/types")) {
      if (options.typesDown) {
        return {
          ok: false,
          json: async () => ({ detail: { code: "unknown",
                                         message: "The registry could not be read." } }),
        } as Response;
      }
      // Enough registry for Quick Entry to know each kind's sections.
      return { ok: true, json: async () => ({ types: [
        { id: "character", sections: [{ id: "overview", heading: "Overview" }] },
        { id: "lore", sections: [{ id: "overview", heading: "Overview" },
                                 { id: "details", heading: "Details" }] },
        { id: "government", sections: [{ id: "overview", heading: "Overview" },
                                       { id: "succession", heading: "Succession" }] },
        { id: "faction", sections: [{ id: "overview", heading: "Overview" }] },
      ] }) } as Response;
    }
    if (url.includes("/anchors")) {
      return { ok: true, json: async () => ({ chapters: [
        { chapter_id: "c-1", filename: "01.md", title: "Chapter One",
          anchor: "c-1", act_id: null, act_title: "" },
        { chapter_id: "c-2", filename: "02.md", title: "Chapter Two",
          anchor: "c-2", act_id: null, act_title: "" },
      ] }) } as Response;
    }
    if (url.includes("/entity") && (!init?.method || init.method === "GET")) {
      if (options.entityMissing) {
        return {
          ok: false,
          json: async () => ({ detail: { code: "entity_not_found",
                                         message: "That entry is not in this world." } }),
        } as Response;
      }
      return { ok: true, json: async () => (options.entity ?? {
        entity_id: "e-1", type: "character", name: "Mira Kell",
        filename: "mira-kell.md", revision: "r1",
        run: [], ties: [],
        sections: {
          overview: { heading: "Overview", content: "" },
          goals: { heading: "Goals", content: "Wants the shop." },
        },
      }) } as Response;
    }

    if (url.includes("/graph")) {
      // The world the Tie editor offers as ends. Empty by default was fine while
      // no test reached the picker; the one that walks a whole connection needs
      // something to connect TO.
      return { ok: true, json: async () => ({
        nodes: options.nodes ?? [], edges: [],
        as_of: null, hidden_nodes: 0, hidden_edges: 0,
      }) } as Response;
    }
    if (url.includes("/relations")) {
      return { ok: true, json: async () => ({
        forward: [{ id: "connected_to", label: "connected to", symmetric: true,
                    cardinality: "many", inverse_label: "", flipped: false,
                    universal: true, group: "Other" }],
        reverse: [], available: [], reason_limit: 140, groups: ["Other"],
      }) } as Response;
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
          unreadable: options.unreadable ?? [],
          resumed: options.resumed ?? {},
          domains: options.domains ?? [],
        }),
      } as Response;
    }
    if (url.includes("/run/resume")) {
      const found = options.resumeFinds === undefined
        ? { run_id: "run-old", depth: "warp", answers: {}, retired: [],
            muted_kinds: [], disambiguations: {} }
        : options.resumeFinds;
      return { ok: true, json: async () => ({ run: found }) } as Response;
    }
    if (url.endsWith("/run")) {
      return { ok: true, json: async () => ({ run_id: "run-abc123abc123" }) } as Response;
    }
    if (url.includes("/fact") && options.factsGone
        && (init?.method === "PATCH" || init?.method === "DELETE")) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "fact_not_found",
                                       message: "That fact is no longer there." } }),
      } as Response;
    }
    if (url.includes("/run/answer") && options.failAnswers) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "unknown",
                                       message: "The ledger could not be written." } }),
      } as Response;
    }
    if (url.includes("/absorb")) {
      // What a real absorb returns: the SURVIVING entry, now answering to the
      // moved word as well.
      return { ok: true, json: async () => ({
        entity_id: "e-mira", type: "character", name: "Mira Kell",
        display_name: "", aliases: ["Dean"],
      }) } as Response;
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
    // "340" is information. "many sessions" is what a writer decides with --
    // and the measure is what the walk will actually ASK, not the total.
    mockApi({
      stops: Array.from({ length: 70 }, (_, i) => stop({ key: `k${i}` })),
      total: 70,
    });
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

  it("offers four passes, which are four different questions", async () => {
    // WHAT REPLACED FULL / TARGETED / QUICK. Those were three sizes of one
    // thing, so the only real choice was how long to be there. These ask
    // different things, and the writer named them out of the loom vocabulary the
    // rest of the Weave already uses.
    await open();
    for (const label of ["Dress the Loom", "Weave the Chapters",
                         "Read the Cloth", "Unwoven"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) }), label)
        .toBeTruthy();
    }
  });

  it("puts them in the order they are worth doing in", async () => {
    // The metaphor carries the dependency: you cannot weave a weft without a
    // warp. A chapter pass has nothing to ask about until entries exist.
    await open();
    const text = screen.getByTestId("weaving-panel").textContent ?? "";
    expect(text.indexOf("Dress the Loom"))
      .toBeLessThan(text.indexOf("Weave the Chapters"));
    expect(text.indexOf("Weave the Chapters"))
      .toBeLessThan(text.indexOf("Read the Cloth"));
  });

  it("says WHEN each one is for, rather than only what it does", async () => {
    // "Start here" and "then, as you write" teach the order without locking it.
    await open();
    expect(screen.getByText("Start here")).toBeTruthy();
    expect(screen.getByText(/as you write/)).toBeTruthy();
    expect(screen.getByText(/When you step back/)).toBeTruthy();
  });

  it("starts on the first one", async () => {
    await open();
    await waitFor(() =>
      expect(posted("/scan").some(c => c.body.depth === "warp")).toBe(true));
  });

  it("rescans when the pass changes, so the count matches the choice", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Read the Cloth/ }));
    await waitFor(() =>
      expect(posted("/scan").some(c => c.body.depth === "cloth")).toBe(true));
  });

  it("does not offer world invention as part of tidying up", async () => {
    // Unwoven is its own pass on the writer's call: "it needs its own pass done
    // separately because its done outside the other two." Mixing it in buries
    // the connection work under questions about how succession functions.
    await open();
    const unwoven = screen.getByRole("button", { name: /Unwoven/ });
    expect(unwoven.textContent).toMatch(/its own job/);
    expect(unwoven.textContent).toMatch(/Nothing here is wrong yet/);
  });

  it("has nothing to start when the book and the world agree", async () => {
    mockApi({ stops: [], total: 0 });
    await open();
    expect(screen.getByTestId("weaving-count").textContent)
      .toMatch(/your world and your book agree/i);
    expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled"))
      .toBe(true);
  });

  it("says what survives either way, now that there is a choice", async () => {
    mockApi({ runs: [OLD_SESSION] });
    await open();
    expect(screen.getByText(/nothing you have already applied or permanently declined comes back/i))
      .toBeTruthy();
  });
});


describe("carrying on where you left off (R1.2)", () => {
  // The spec's acceptance line: "Apply 15 findings, close the app, reopen,
  // RESUME." Before this there was one Start button and it always meant start
  // fresh -- so a writer who closed the app mid-walk met every question they
  // had already said "not yet" to.
  //
  // Why it went unnoticed for so long: applied and dismissed answers live in
  // the BOOK and come back either way. What only a SESSION holds is what was
  // deferred and which kinds were muted, so the loss was invisible unless you
  // had put something off.

  it("offers the choice only when there is something to carry on", async () => {
    mockApi({ runs: [] });
    await open();
    expect(screen.queryByRole("button", { name: /Carry on where you left off/ }))
      .toBeNull();
    expect(screen.getByRole("button", { name: /^Start$/ })).toBeTruthy();
  });

  it("offers both, and says what the difference is", async () => {
    mockApi({ runs: [OLD_SESSION] });
    await open();
    expect(screen.getByRole("button", { name: /keeps what you put off last time/ }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: /asks again about anything you put off/ }))
      .toBeTruthy();
  });

  it("carrying on reuses the earlier run rather than minting one", async () => {
    mockApi({ runs: [OLD_SESSION] });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Carry on where you left off/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-progress")).toBeTruthy());
    expect(posted("/run/resume").length).toBe(1);
    expect(posted("/run").filter(c => !c.url.includes("resume")
                                      && !c.url.includes("answer"))).toEqual([]);
  });

  it("says out loud that it carried on", async () => {
    // A writer who chose it is entitled to see that it worked -- and a
    // resumed walk is shorter, which would otherwise look like loss.
    mockApi({ runs: [OLD_SESSION] });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Carry on where you left off/ }));
    expect(await screen.findByTestId("resumed-note")).toBeTruthy();
  });

  it("starting fresh mints a new run", async () => {
    mockApi({ runs: [OLD_SESSION] });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Start fresh/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-progress")).toBeTruthy());
    expect(posted("/run/resume")).toEqual([]);
    expect(screen.queryByTestId("resumed-note")).toBeNull();
  });

  it("falls back to a new run when there is nothing to resume after all", async () => {
    // The list said there were earlier sessions and the resume came back
    // empty -- a deleted run file, say. Not an error: start one.
    mockApi({ runs: [OLD_SESSION], resumeFinds: null });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Carry on where you left off/ }));
    await waitFor(() => expect(screen.getByTestId("weaving-progress")).toBeTruthy());
    expect(screen.queryByTestId("resumed-note")).toBeNull();
  });
});


// ── R8.1: what changed under the walk ────────────────────────────────────────
//
// The panel half of the fix. StaleNotice.test.tsx pins the wording; these pin
// that the panel actually MOUNTS it, marks the right card, and turns the
// re-check into a narrowed scan -- the three things a registry-and-component
// pair can each be perfect at while nothing joins them up. That exact shape of
// failure is what gap A8 was.

describe("evidence that moved", () => {
  it("marks the stop the writer already put off, and only that one", async () => {
    mockApi({
      stops: [stop({ key: "moved" }), stop({ key: "fresh", title: "Second" })],
      resumed: { stale: 1, stale_keys: ["moved"], chapters: ["Chapter One"] },
    });
    await start();
    // The first card is the stale one.
    expect(screen.getByTestId("stale-mark")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByText("Second")).toBeTruthy());
    // The second is not, and nothing about the banner leaked onto it.
    expect(screen.queryByTestId("stale-mark")).toBeNull();
  });

  it("says nothing at all when nothing moved", async () => {
    await start();
    expect(screen.queryByTestId("stale-notice")).toBeNull();
    expect(screen.queryByTestId("stale-mark")).toBeNull();
  });

  it("re-checks just the chapters that changed", async () => {
    // The scan is free, so narrowing costs nothing. What it buys is a list
    // short enough to work through in one sitting.
    mockApi({
      stops: [stop({ key: "moved" })],
      resumed: { stale: 1, stale_keys: ["moved"], chapters: ["c-2"] },
    });
    await start();
    const before = posted("/scan").length;
    await userEvent.click(screen.getByTestId("stale-recheck"));
    await waitFor(() => expect(posted("/scan").length).toBeGreaterThan(before));
    const scans = posted("/scan");
    expect(scans[scans.length - 1].body).toMatchObject({ chapter_ids: ["c-2"] });
  });

  it("offers the way back out of a narrowed walk that runs dry", async () => {
    // A narrowing with no exit is a trap, and the trap springs precisely when
    // the writer has finished what they narrowed to.
    mockApi({
      stops: [stop({ key: "moved" })],
      resumed: { stale: 1, stale_keys: ["moved"], chapters: ["c-2"] },
    });
    await start();
    await userEvent.click(screen.getByTestId("stale-recheck"));
    await waitFor(() => expect(screen.getByTestId("stale-mark")).toBeTruthy());
    // Answer the one thing the narrowed walk holds.
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    expect(await screen.findByTestId("widen-again")).toBeTruthy();
    // And it does not claim the whole pass is finished.
    expect(screen.getByText(/chapters you narrowed to/)).toBeTruthy();
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
  it("creates the entry INSIDE the walk, with the name already filled", async () => {
    // Quick Entry: the closed-world rule's creation path. The one-click create
    // became a one-Accept form -- the name and the evidence sentence arrive
    // prefilled, so saying yes is still one decision.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value)
      .toBe("Garrick");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.name).toBe("Garrick");
  });

  it("asks how much of a character it is, and starts on Side", async () => {
    // The writer's report: every character Weaving created arrived as a Main,
    // "automatically grouped in the Main characters section with no way to move
    // them to side". Side is the default because a name the prose mentions once
    // is far more often a shopkeeper than a viewpoint character -- and the two
    // mistakes do not cost the same. A Side page promoted later loses nothing;
    // a Main page for a walk-on is six empty trait sections asking to be filled.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");

    const side = within(dialog).getByRole("radio", { name: "Side" }) as HTMLInputElement;
    const main = within(dialog).getByRole("radio", { name: "Main" }) as HTMLInputElement;
    expect(side.checked).toBe(true);
    expect(main.checked).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.character_kind).toBe("side");
  });

  it("sends Main when the writer says this one matters", async () => {
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Main" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.character_kind).toBe("main");
  });

  it("prefills the starter line from the writer's own sentence", async () => {
    // The stop's evidence is the writer's prose, so it is allowed to arrive in
    // the box -- as a starting point they can edit or clear, never more.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    const box = within(dialog).getByLabelText("Starter text") as HTMLTextAreaElement;
    expect(box.value.length).toBeGreaterThan(0);
    expect(screen.getByText(/Prefilled from your own writing/)).toBeTruthy();
  });

  it("asks what is next after creating, and advancing records it applied", async () => {
    // The continuous-flow rule, and "applied" has to mean SAVED -- this one
    // genuinely is, the file was written.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await userEvent.click(await screen.findByRole("button", { name: /No, I am good/ }));
    await waitFor(() =>
      expect(posted("/run/answer").some(c => c.body.state === "applied")).toBe(true));
  });

  it("can go straight into connecting the new entry, still inside", async () => {
    // "Government created ... with connection established" -- the worked
    // example. The connect step is the same inline connector, not a new place.
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /choose the connection/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
  });

  it("retires the PHRASE when a name should never become an entry", async () => {
    // The same word in another chapter must not be asked either. The button
    // says what it declines in the KIND's terms -- "Not a connection" on an
    // Unspun name was a sentence about something else entirely.
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: "Never make this an entry" }));
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
    // R8.3: it asks how widely before it writes anything.
    await userEvent.click(screen.getByTestId("mute-everywhere"));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body.mute).toBe("unspun");
    expect(posted("/run/answer")[0].body.mute_for).toBeUndefined();
  });

  it("says that turning a kind off is reversible", async () => {
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    expect(screen.getByTestId("mute-scope").textContent)
      .toMatch(/reversible/);
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

  it("offers to fill it in HERE, not to open it elsewhere", async () => {
    // The old label was "Open it and fill it in", and clicking it closed the
    // Weave behind the writer -- "good intentions, terrible execution".
    mockApi({ stops: [frayed] });
    await start();
    expect(screen.getByRole("button", { name: /Fill it in here/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open it/ })).toBeNull();
  });

  it("shows only the missing sections as boxes, right in the popup", async () => {
    mockApi({ stops: [frayed] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    // Overview is missing, so it gets a box; Goals has writing, so it does not.
    expect(within(dialog).getByLabelText("Overview")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Goals")).toBeNull();
  });

  it("saves what was typed and moves the walk on", async () => {
    mockApi({ stops: [frayed, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await userEvent.type(within(dialog).getByLabelText("Overview"),
                         "The clockmaker's daughter.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save it/ }));
    await waitFor(() => expect(posted("/entity").length).toBe(1));
    const saved = posted("/entity")[0].body as {
      thread: { sections: Record<string, { content: string }> };
      base_revision: string;
    };
    expect(saved.thread.sections.overview.content)
      .toBe("The clockmaker's daughter.");
    // With the revision it read, so a save cannot clobber an edit made
    // elsewhere -- same contract as the full editor.
    expect(saved.base_revision).toBe("r1");
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("does not create anything for a stop that already has an entry", async () => {
    mockApi({ stops: [frayed] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    await screen.findByTestId("quick-fill");
    expect(posted("/thread/new")).toEqual([]);
  });

  it("does not retire a phrase for a stop that is not a name", async () => {
    mockApi({ stops: [frayed] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: "Leave it as it is" }));
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

  it("answers it HERE: name it, write the answer, and it lands where the question says", async () => {
    // The worked example, end to end: "Create a government entry > within the
    // same popup, a new Government entry is created with basic information ...
    // > Writer gets brought BACK to the walkthrough."
    mockApi({ stops: [unwoven, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Answer it here/ }));
    const dialog = await screen.findByTestId("quick-entry");
    // The question is shown, so the writer answers IT rather than a blank form.
    expect(within(dialog).getByText(unwoven.title as string)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Name"), "The Old Law");
    await userEvent.type(within(dialog).getByLabelText("The answer"),
                         "Kinslaying is the one unforgivable crime.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    // The answer lands in the SECTION the question named -- lore > details --
    // which is exactly what makes the question stop being asked next scan.
    expect(posted("/thread/new")[0].body).toMatchObject({
      type: "lore",
      name: "The Old Law",
      sections: { details: "Kinslaying is the one unforgivable crime." },
    });
    await userEvent.click(await screen.findByRole("button", { name: /No, I am good/ }));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("does not let the kind wander from the one the question knows", async () => {
    // A succession answer filed under Creature is worse than no answer: the
    // question keeps being asked AND the world gains a wrong entry.
    mockApi({ stops: [unwoven] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Answer it here/ }));
    const dialog = await screen.findByTestId("quick-entry");
    expect(within(dialog).queryByLabelText("What kind of thing")).toBeNull();
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


describe("every kind resolves inside, including one the writer invented", () => {
  // TWO dead ends died together here. Shipped kinds without a Profile Builder
  // page used to route to the Thread editor -- which closed the Weave. And a
  // custom kind had NOWHERE to route, so the walk apologised: "no editor for
  // this kind of entry yet". The inline form is registry-driven, so it needs
  // no editor to exist -- a Race invented this morning fills in the same way a
  // Faction does.

  const faction = stop({
    kind: "frayed", key: "frayed|e-f", entity_id: "e-f",
    title: "House Vale is missing Overview", quote: "",
    detail: { name: "House Vale", type: "faction", filename: "house-vale.md",
              missing: ["Overview"] },
  });

  const race = stop({
    kind: "frayed", key: "frayed|e-r", entity_id: "e-r",
    title: "Drow is missing Overview", quote: "",
    detail: { name: "Drow", type: "race", filename: "drow.md",
              missing: ["Overview"] },
  });

  it("fills a faction in right here", async () => {
    mockApi({ stops: [faction],
              entity: { entity_id: "e-f", type: "faction", name: "House Vale",
                        filename: "house-vale.md", revision: "r9", run: [],
                        ties: [],
                        sections: { overview: { heading: "Overview",
                                                content: "" } } } });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await userEvent.type(within(dialog).getByLabelText("Overview"),
                         "The oldest house in the reach.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save it/ }));
    await waitFor(() => expect(posted("/entity").length).toBe(1));
  });

  it("fills a kind the writer invented the same way", async () => {
    // The apology is gone because the reason for it is gone: the form reads
    // the entry's own sections, so no editor has to exist for the kind.
    mockApi({ stops: [race],
              entity: { entity_id: "e-r", type: "race", name: "Drow",
                        filename: "drow.md", revision: "r2", run: [], ties: [],
                        sections: { overview: { heading: "Overview",
                                                content: "" } } } });
    await start();
    expect(screen.queryByText(/no editor for this kind of entry yet/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).getByLabelText("Overview")).toBeTruthy();
  });

  it("still lets the writer put anything off or stop being asked", async () => {
    mockApi({ stops: [race] });
    await start();
    expect(screen.getByRole("button", { name: /Not yet/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Never ask/ })).toBeTruthy();
  });

  it("answers a Government question in a Government entry", async () => {
    mockApi({ stops: [stop({
      kind: "unwoven", key: "unwoven|gov_power", title: "Who holds power?",
      why: "Because.", entity_id: "", quote: "",
      detail: { lands_as: ["government", "overview"], touches: [] },
    })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Answer it here/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.type(within(dialog).getByLabelText("Name"), "The Regency");
    await userEvent.type(within(dialog).getByLabelText("The answer"),
                         "A council rules between kings.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.type).toBe("government");
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
    // Through the same Quick Entry as everything else -- and a pinned phrase
    // gets a kind picker, because "Kithicor Forest" being a location is the
    // writer's call, not a rule's.
    mockApi({ stops: [unknown] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.name).toBe("Kithicor Forest");
  });

  it("asks about the CONNECTION when the entry already exists", async () => {
    // "Make an entry" is the wrong question once there is one. And the label
    // must not promise to OPEN anything -- the connector is inline, like
    // everything else in the closed world.
    mockApi({ stops: [known] });
    await start();
    expect(screen.getByRole("button", { name: /Choose the connection/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create the entry/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open it/ })).toBeNull();
  });

  it("asks what to connect it to WITHOUT leaving the walk", async () => {
    // Reported: "Open it and connect it" opened the entry's own page and
    // abandoned the writer there. Connecting happens here now, so the walk
    // keeps its place and a wrong choice is a step back.
    mockApi({ stops: [known] });
    const onOpenThread = vi.fn();
    await start({ onOpenThread });
    await userEvent.click(screen.getByRole("button", { name: /Choose the connection/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
    expect(posted("/thread/new")).toEqual([]);
  });

  it("comes back to the same stop when the connector closes", async () => {
    // The whole point of doing it here. Closing must not lose the writer's
    // place in the list.
    mockApi({ stops: [known] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Choose the connection/ }));
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
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
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
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
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
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.aliases).toEqual([]);
  });

  it("retires the group by its full name, not by a nickname", async () => {
    // The writer was shown "Lara Croft", so that is what their no is about.
    mockApi({ stops: [grouped] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: "Never make this an entry" }));
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

describe("an empty stub is asked to be WRITTEN, never re-identified", () => {
  // TWO live-testing reports, in order, because the second corrected the fix
  // for the first.
  //
  // First: "Dean is missing Overview > Open it and fill it in > Opens to
  // Profile Builder. Full stop. Can't go back." The fix built then was an
  // identity question -- "Say what this is" -- because the walk had nowhere to
  // type and identity was the only question it COULD ask.
  //
  // Then the closed world landed, typing inline became possible, and the same
  // stop showed what the leftover identity question does to a writer whose
  // entry already says what it is:
  //
  //     "We have established what Dean is, Dean is a Character Profile. ...
  //      Why is it asking me this? ... Clicking any of those asks me to
  //      confirm that {profile_name} now refers to Dean. That is NOT what I
  //      want to do. ... I'm literally stuck with zero places to go."
  //
  // Every answer was wrong for Dean: binding absorbs him into someone else,
  // and "it is its own thing" would have created a SECOND Dean. So: identity
  // is asked ONCE, at creation, and never again. Frayed means fill it in --
  // empty or not -- and the one genuine leftover case (the word is another
  // name for an entry that already exists) is a side path inside the form.

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

  const deanEntity = {
    entity_id: "e-dean", type: "character", name: "Dean", filename: "dean.md",
    revision: "r1", run: [], ties: [],
    sections: { overview: { heading: "Overview", content: "" } },
  };

  it("offers to fill it in, exactly like any other thin entry", async () => {
    mockApi({ stops: [bare], entity: deanEntity });
    await start();
    expect(screen.getByRole("button", { name: /Fill it in here/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Say what this is/ })).toBeNull();
  });

  it("writes into Dean's own entry, without ever asking what Dean is", async () => {
    mockApi({ stops: [bare, stop({ key: "second", title: "Something else" })],
              entity: deanEntity });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).queryByText(/What is/)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Overview"),
                         "The tester who found every dead end.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save it/ }));
    await waitFor(() => expect(posted("/entity").length).toBe(1));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("keeps the mistaken-identity case as a side path, from the WORD's side", async () => {
    // "Croft" getting its own placeholder when Lara Croft has a page is real.
    // But it is phrased about the WORD, so it cannot read as a question about
    // an entry whose identity the writer already settled.
    mockApi({ stops: [bare], entity: deanEntity });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await userEvent.click(within(dialog).getByRole("button",
      { name: /is actually another name for an entry I already have/ }));
    expect(await screen.findByTestId("bind-dot")).toBeTruthy();
  });

  it("offers no such side path for an entry the writer wrote themselves", async () => {
    // Mira was never a minted word. Suggesting her name might "actually mean"
    // something else is the interrogation this whole describe exists to ban.
    mockApi({ stops: [thin] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).queryByRole("button",
      { name: /is actually another name/ })).toBeNull();
  });

  it("comes back to the same stop when the form is backed out of", async () => {
    mockApi({ stops: [bare, stop({ key: "second", title: "Something else" })],
              entity: deanEntity });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    await screen.findByTestId("quick-fill");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText(/Dean is missing Overview/)).toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
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

describe("the walk moves on when a connection is finished", () => {
  // The other half of the report. The editor now asks "anyone or anything
  // else?", and answering no has to actually advance -- "Clicking takes them
  // back and advances the Weave Walkthrough."

  const lonely = stop({
    kind: "loose_thread", key: "loose|e-alex", entity_id: "e-alex",
    title: "How is Alexandra Langford connected to the story?", quote: "",
    why: "Mentions of this name already find this entry.",
    detail: { name: "Alexandra Langford", type: "character",
              filename: "alexandra.md", mentioned: 12, likely: [] },
  });

  it("advances to the next stop, rather than sitting on the same one", async () => {
    // The whole reported gap, walked end to end: record a connection, say you
    // are finished, and be somewhere new.
    mockApi({
      stops: [lonely, stop({ key: "second", title: "Something else" })],
      nodes: [{ entity_id: "e-garrick", name: "Garrick Vale", type: "character",
                display_name: "", aliases: [], placeholder: false }],
    });
    await start();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);

    await userEvent.click(screen.getByRole("button", { name: /Choose the connection/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Garrick/ }));
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "Ran into him and became partners");
    await userEvent.click(screen.getByRole("button", { name: /^Record it$/ }));

    await waitFor(() => expect(screen.getByTestId("what-next")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /No, I am good/ }));

    expect(await screen.findByText(/Something else/)).toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/2 of 2/);
  });

  it("backing out is still backing out, and keeps the writer's place", async () => {
    // Two exits, and they must not collapse into one: closing means "back to
    // where I was", finishing means "move me on".
    mockApi({ stops: [lonely, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Choose the connection/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/How is Alexandra Langford connected/))
      .toBeTruthy();
  });
});


describe("a disagreement is sorted out inside", () => {
  // Snag, Unplaced and Early mention used to end with "Open it" and a closed
  // Weave. The closed-world rule: every one settles here.

  const snag = stop({
    kind: "snag", key: "snag|e-1|eyes", entity_id: "e-1",
    title: "Two facts disagree about eyes", quote: "",
    why: "Both set the same thing at the same point.",
    detail: { name: "Elara Voss", type: "character", filename: "elara.md",
              snag: "ambiguous_order", axis: "eyes",
              sides: [{ id: "f-1", at: "c-1", value: "Green." },
                      { id: "f-2", at: "c-1", value: "Blue." }] },
  });

  const unplacedStop = stop({
    kind: "unplaced", key: "unplaced|e-1|f-9", entity_id: "e-1",
    title: "A fact never takes effect", quote: "",
    why: "Nothing says when it became true.",
    detail: { name: "Elara Voss", type: "character", filename: "elara.md",
              snag: "unplaced", axis: "scar",
              sides: [{ id: "f-9", at: null, value: "Carries a scar." }] },
  });

  it("keeps one side, and the other is removed", async () => {
    mockApi({ stops: [snag, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).getByText("Green.")).toBeTruthy();
    expect(within(dialog).getByText("Blue.")).toBeTruthy();
    await userEvent.click(
      within(dialog).getAllByRole("button", { name: /Keep this one/ })[0]);
    // Keeping Green deletes Blue -- and only Blue.
    await waitFor(() => {
      const deletes = calls.filter(c => c.url.includes("/fact")
        && c.url.includes("fact_id=f-2"));
      expect(deletes.length).toBe(1);
    });
    expect(calls.some(c => c.url.includes("fact_id=f-1"))).toBe(false);
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("edits a side in place, keeping its id", async () => {
    // PATCH, not delete-and-recreate: the id is what other facts' supersedes
    // point at, and losing it can silently break an ordering already settled.
    mockApi({ stops: [snag] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(within(dialog).getByLabelText("Edit Green."));
    const box = within(dialog).getByLabelText("The corrected text");
    await userEvent.clear(box);
    await userEvent.type(box, "Grey.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save the fix/ }));
    await waitFor(() => {
      const patched = posted("/fact").filter(c => c.body.fact_id === "f-1");
      expect(patched.length).toBe(1);
      expect((patched[0].body.set as { value: string }).value).toBe("Grey.");
    });
  });

  it("lets both stand ON PURPOSE, marked on every side", async () => {
    // Much good fiction contradicts itself deliberately. Marked on EVERY side,
    // so neither is free to re-open the same argument against a third fact.
    mockApi({ stops: [snag] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Both are right on purpose/ }));
    await waitFor(() => {
      const marked = posted("/fact").filter(c =>
        (c.body.set as { intentional?: boolean } | undefined)?.intentional === true);
      expect(marked.map(c => c.body.fact_id).sort()).toEqual(["f-1", "f-2"]);
    });
  });

  it("places an unplaced fact with a chapter picker", async () => {
    mockApi({ stops: [unplacedStop] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /^Place it$/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.selectOptions(
      within(dialog).getByLabelText("The chapter it becomes true"), "c-2");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Place it there/ }));
    await waitFor(() => {
      const patched = posted("/fact").filter(c => c.body.fact_id === "f-9");
      expect((patched[0].body.set as { at: string }).at).toBe("c-2");
    });
  });

  it("moves an anchor for an early mention, from the entry's own Run", async () => {
    // The stop knows the mention; the entry knows which anchor makes it late.
    mockApi({
      stops: [stop({
        kind: "early_mention", key: "early|e-1|c-1", entity_id: "e-1",
        chapter_id: "c-1",
        title: "Garrick is named before the Weave says they appear",
        quote: "Elara thought of Garrick.",
        why: "Everything anchored happens later.",
        detail: { name: "Garrick", type: "character", filename: "garrick.md" },
      })],
      entity: { entity_id: "e-1", type: "character", name: "Garrick",
                filename: "garrick.md", revision: "r1", ties: [],
                run: [{ id: "f-5", at: "c-2", value: "Arrives in the capital." }],
                sections: {} },
    });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Decide here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).getByText("Arrives in the capital.")).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Move to Chapter One/ }));
    await waitFor(() => {
      const patched = posted("/fact").filter(c => c.body.fact_id === "f-5");
      expect((patched[0].body.set as { at: string }).at).toBe("c-1");
    });
  });

  it("backing out keeps the writer's place", async () => {
    mockApi({ stops: [snag, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    await screen.findByTestId("snag-fixer");
    await userEvent.click(screen.getByRole("button", { name: /Back to the stop/ }));
    expect(await screen.findByText(/Two facts disagree/)).toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
  });
});


// ── R8.2: several problems with one cause, as one stop ───────────────────────
//
// The grouping existed in the backend and nothing called it, so a moved date
// arrived as eleven questions about one mistake. What has to hold now: the group
// SHOWS its members before the writer agrees to open it, the members are worked
// through inside the one dialog (they are not stops -- the ledger must not
// remember them individually), and the group-level "all deliberate" is the thing
// that makes the grouping worth having at all.

describe("a tangle", () => {
  const tangle = stop({
    kind: "tangle", key: "tangle|e-1|eyes", entity_id: "e-1",
    title: "Elara Voss: 2 problems with 'eyes', probably one mistake",
    quote: "",
    why: "2 separate contradictions all concern 'eyes' on this entry.",
    detail: {
      name: "Elara Voss", type: "character", filename: "elara.md", axis: "eyes",
      members: [
        { key: "snag|a", snag: "ambiguous_order", axis: "eyes",
          summary: "2 facts set 'eyes' at Chapter One with nothing to order them.",
          sides: [{ id: "f-1", at: "c-1", value: "Green." },
                  { id: "f-2", at: "c-1", value: "Blue." }] },
        { key: "snag|b", snag: "axis_conflict", axis: "eyes",
          summary: "2 facts each say they replaced the same earlier one.",
          sides: [{ id: "f-3", at: "c-2", value: "Grey." },
                  { id: "f-4", at: "c-2", value: "Hazel." }] },
      ],
    },
  });

  it("lists what it gathered before asking the writer to open it", async () => {
    // A Tangle has no quote, so this list IS its evidence. "2 problems" without
    // the two is a number, and a decision made without seeing what prompted it
    // is not a decision.
    mockApi({ stops: [tangle] });
    await start();
    const shown = screen.getByTestId("tangle-members").textContent ?? "";
    expect(shown).toContain("nothing to order them");
    expect(shown).toContain("replaced the same earlier one");
  });

  it("works through the members inside one dialog", async () => {
    mockApi({ stops: [tangle, stop({ key: "next", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort them out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).getByTestId("tangle-progress").textContent)
      .toContain("1 of 2");
    // The first member's sides, and only those.
    expect(within(dialog).getByText("Green.")).toBeTruthy();
    expect(within(dialog).queryByText("Grey.")).toBeNull();

    await userEvent.click(
      within(dialog).getAllByRole("button", { name: /Keep this one/ })[0]);
    // Settling one member moves to the next INSIDE the dialog. The walk has not
    // advanced: the group is one stop, and leaving mid-group would mean the
    // remaining problems were silently accepted.
    await waitFor(() => expect(
      within(dialog).getByTestId("tangle-progress").textContent).toContain("2 of 2"));
    expect(within(dialog).getByText("Grey.")).toBeTruthy();
    expect(screen.queryByText(/Something else/)).toBeNull();
  });

  it("advances the walk once the last member is settled", async () => {
    mockApi({ stops: [tangle, stop({ key: "next", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort them out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(
      within(dialog).getAllByRole("button", { name: /Keep this one/ })[0]);
    await waitFor(() => expect(
      within(dialog).getByTestId("tangle-progress").textContent).toContain("2 of 2"));
    await userEvent.click(
      within(dialog).getAllByRole("button", { name: /Keep this one/ })[0]);
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("marks every member deliberate in one action", async () => {
    // THE REASON THE GROUPING PAYS. Marking these one at a time is the two
    // questions the stop exists to avoid, and with eleven it is the whole
    // problem back again.
    mockApi({ stops: [tangle] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort them out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(within(dialog).getByTestId("tangle-all-deliberate"));
    await waitFor(() => {
      const marked = posted("/fact").filter(c =>
        (c.body.set as { intentional?: boolean } | undefined)?.intentional === true);
      expect(marked.map(c => c.body.fact_id).sort())
        .toEqual(["f-1", "f-2", "f-3", "f-4"]);
    });
  });

  it("offers no group-deliberate when the clash is between connections", async () => {
    // A tie has no fact to carry the mark. The walk's permanent dismiss covers
    // that case, and a button that PATCHed a synthetic "rel:target" id would
    // fail on every one of them.
    mockApi({ stops: [stop({
      kind: "tangle", key: "tangle|e-1|leads", entity_id: "e-1",
      title: "Elara Voss: 2 problems with 'leads'", quote: "",
      why: "Two connection rules clash.",
      detail: { name: "Elara Voss", type: "character", axis: "leads",
                members: [
                  { key: "snag|a", snag: "cardinality", axis: "leads",
                    summary: "'leads' allows one at a time, and there are 2.",
                    sides: [{ id: "leads:e-2", target: "e-2", target_name: "The Guard" },
                            { id: "leads:e-3", target: "e-3", target_name: "The Watch" }] },
                  { key: "snag|b", snag: "exclusive_group", axis: "leads",
                    summary: "These connections cannot both be true at once.",
                    sides: [{ id: "leads:e-4", target: "e-4", target_name: "The Order" },
                            { id: "serves:e-5", target: "e-5", target_name: "The Crown" }] },
                ] },
    })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort them out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).queryByTestId("tangle-all-deliberate")).toBeNull();
    // And the connection names are still readable, not raw ids.
    expect(within(dialog).getByText(/The Guard/)).toBeTruthy();
  });

  it("says no to all of them at once, permanently", async () => {
    mockApi({ stops: [tangle, stop({ key: "next", title: "Something else" })] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: /None of these are problems/ }));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });
});


describe("the closed world, structurally", () => {
  it("has no way to navigate anywhere -- the props do not exist", async () => {
    // The rule is held by the TYPE, not by discipline: WeavingPanel takes a
    // project path and an onClose, and nothing else. A future branch cannot
    // send the writer away, because there is nothing to call. This test reads
    // the source so a reintroduced callback fails loudly with the reason.
    const source = (await import("./WeavingPanel.tsx?raw")).default as string;
    for (const leak of ["onOpenThread", "onOpenKind", "setCurrentView"]) {
      expect(source.includes(leak), `WeavingPanel references ${leak}`).toBe(false);
    }
  });

  it("is mounted with the global overlays, not inside one view", async () => {
    // Reported from live testing: "attempting to go into Weaving does
    // nothing... if I switch to a document, the Weaving interface pops up
    // like I had clicked it then." Nothing was hung. The panel was rendered
    // inside the editor arm of the view switch, so opening it from the Weave
    // screen set the state and mounted nothing; changing view mounted the arm
    // and the panel appeared, looking like a delayed click.
    //
    // The invariant: an overlay opened from a sidebar visible in EVERY view
    // has to be rendered outside every view. Pinned by position -- the render
    // must come after the view switch closes, which is where the other
    // overlays (Settings and the rest) already live.
    const app = (await import("../../App.tsx?raw")).default as string;
    const weaving = app.indexOf("<WeavingPanel");
    const firstGlobalOverlay = app.indexOf("{showSettings &&");
    expect(weaving, "App.tsx never renders WeavingPanel").toBeGreaterThan(0);
    expect(
      weaving,
      "WeavingPanel is rendered before the global overlays, which means it "
      + "sits inside a view branch and will not open from other views",
    ).toBeGreaterThan(app.indexOf("</aside>\n      </>"));
    expect(Math.abs(weaving - firstGlobalOverlay)).toBeLessThan(2000);
  });
});


describe("a stale stop tells the truth about NOW", () => {
  // The walk's list is made at Start and not refreshed mid-walk, so a stop can
  // be answered before it is shown -- two empty Deans made this real on the
  // first closed-world test. The writer filled one Dean's Overview, the other
  // Dean's identical-looking stop came up next, and the form showed a BLANK
  // box: "no he is not [missing Overview], Dean's overview was JUST finished,
  // I know I just did it." A blank box over a filled section is worse than
  // confusing -- retyping would have REPLACED the saved writing.

  const frayedDean = stop({
    kind: "frayed", key: "frayed|e-dean", entity_id: "e-dean",
    title: "Dean is missing Overview", quote: "",
    detail: { name: "Dean", type: "character", filename: "dean.md",
              missing: ["Overview"], placeholder: true },
  });

  it("shows a section filled since the scan as DONE, never as a blank box", async () => {
    mockApi({ stops: [frayedDean],
              entity: { entity_id: "e-dean", type: "character", name: "Dean",
                        filename: "dean.md", revision: "r2", run: [], ties: [],
                        sections: { overview: {
                          heading: "Overview",
                          content: "The tester who found every dead end.",
                        } } } });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).getByText(/Overview already has writing/)).toBeTruthy();
    expect(within(dialog).getByText(/The tester who found every dead end/))
      .toBeTruthy();
    // No box means no way to accidentally replace it.
    expect(within(dialog).queryByLabelText("Overview")).toBeNull();
  });

  it("says nothing is left and offers the way on", async () => {
    mockApi({ stops: [frayedDean,
                      stop({ key: "second", title: "Something else" })],
              entity: { entity_id: "e-dean", type: "character", name: "Dean",
                        filename: "dean.md", revision: "r2", run: [], ties: [],
                        sections: { overview: {
                          heading: "Overview", content: "Already written.",
                        } } } });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).getByText(/Nothing left to do here/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /Carry on/ }));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("still offers boxes for the sections that ARE empty", async () => {
    // Half stale: Overview was filled, Goals was not. One done note, one box.
    mockApi({ stops: [stop({
                kind: "frayed", key: "frayed|e-dean|2", entity_id: "e-dean",
                title: "Dean is missing Overview and Goals", quote: "",
                detail: { name: "Dean", type: "character", filename: "dean.md",
                          missing: ["Overview", "Goals"], placeholder: false },
              })],
              entity: { entity_id: "e-dean", type: "character", name: "Dean",
                        filename: "dean.md", revision: "r2", run: [], ties: [],
                        sections: {
                          overview: { heading: "Overview", content: "Written." },
                          goals: { heading: "Goals", content: "" },
                        } } });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    expect(within(dialog).getByText(/Overview already has writing/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Goals")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Overview")).toBeNull();
  });
});


describe("saying no speaks each kind's own language", () => {
  // One label used to serve every kind -- "Not a connection" -- and it is a
  // sentence about connections. On a Snag it permanently retired a
  // CONTRADICTION check; on an Unwoven question it dismissed a piece of the
  // world's ground rules; a writer cannot decide what to turn off from a
  // label about something else. Permanence is unchanged (it is the worked
  // example's own "Don't ask again?"); the words now say what is declined.

  const cases: [Record<string, unknown>, string][] = [
    [stop(), "Never make this an entry"],
    [stop({ kind: "frayed", key: "frayed|e-1", entity_id: "e-1",
            title: "Mira Kell is missing Overview",
            detail: { name: "Mira Kell", type: "character",
                      missing: ["Overview"] } }),
     "Leave it as it is"],
    [stop({ kind: "snag", key: "snag|e-1|loyal", entity_id: "e-1",
            title: "Two versions of who Mira serves",
            detail: { name: "Mira Kell", type: "character", sides: [] } }),
     "Not a problem"],
    [stop({ kind: "unplaced", key: "unplaced|e-1|f-2", entity_id: "e-1",
            title: "A fact with no place in the book",
            detail: { name: "Mira Kell", type: "character" } }),
     "Leave it unplaced"],
    [stop({ kind: "early_mention", key: "early|e-1|c-1", entity_id: "e-1",
            title: "Named before the reader should know",
            detail: { name: "Mira Kell", type: "character" } }),
     "It is fine where it is"],
    [stop({ kind: "unwoven", key: "unwoven|succession", entity_id: "",
            title: "How does succession work?",
            detail: { lands_as: ["government", "succession"] } }),
     "Never ask this"],
  ];

  for (const [which, label] of cases) {
    it(`offers "${label}" on a ${String(which.kind)} stop`, async () => {
      mockApi({ stops: [which] });
      await start();
      const no = screen.getByRole("button", { name: label });
      expect(no).toBeTruthy();
      // Still permanent, and still says so where the writer can see it.
      expect(no.getAttribute("title")).toMatch(/Permanently/);
    });
  }

  it("keeps 'Not a connection' where it really IS one", async () => {
    mockApi({ stops: [stop({
      kind: "loose_thread", key: "loose|e-1", entity_id: "e-1",
      title: "How is Mira Kell connected to the story?",
      detail: { name: "Mira Kell", type: "character" },
    })] });
    await start();
    expect(screen.getByRole("button", { name: "Not a connection" })).toBeTruthy();
  });
});


describe("closing after a create still counts the create", () => {
  // The entry lands on disk the moment Create it succeeds. The first version
  // treated X as "back to the stop, nothing happened" even THEN -- so the
  // stop sat there looking unanswered with its create button still live, and
  // pressing it again made a second copy. Two empty Deans came from this.

  it("records the stop and advances when the receipt is X'd out of", async () => {
    mockApi({ stops: [stop(), stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await screen.findByRole("button", { name: /No, I am good/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(posted("/run/answer")
      .some(c => c.body.state === "applied" && c.body.key === "unspun|garrick"))
      .toBe(true));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("records and advances from the backdrop too", async () => {
    mockApi({ stops: [stop(), stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await screen.findByRole("button", { name: /No, I am good/ });
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(posted("/run/answer")
      .some(c => c.body.state === "applied")).toBe(true));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("records nothing when closed before anything was made", async () => {
    // Before the create, X really does mean "back out". The stop must look
    // exactly as it did.
    mockApi({ stops: [stop(), stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/'Garrick' has no entry/)).toBeTruthy();
    expect(posted("/thread/new")).toEqual([]);
    expect(posted("/run/answer")).toEqual([]);
  });
});


describe("a pin answered by connecting stops being a pin", () => {
  // Loose and Untied stops die on their own: the next scan sees the new Tie
  // and the condition has ended. A pin does NOT -- nothing re-derives it away,
  // because nothing but the writer made it. The backend removes the mark when
  // the applied answer's key starts with "pinned|"; before this, the connect
  // path never recorded an apply at all, so the same pin returned on every
  // future walk, forever, no matter how many times it was answered.

  const known = stop({
    kind: "pinned", key: "pinned|lexa", entity_id: "e-lexa",
    title: "'Lexa' -- what should this connect to?",
    why: "You marked this yourself.",
    quote: "Lexa said nothing.",
    detail: { name: "Lexa", note: "", has_entry: true, type: "character",
              filename: "alexandra.md" },
  });
  const croft = { entity_id: "e-croft", type: "character", name: "Lara Croft",
                  display_name: "", aliases: [], placeholder: false };

  async function connectLexaToCroft() {
    await userEvent.click(screen.getByRole("button", { name: /Choose the connection/ }));
    await screen.findByTestId("tie-editor");
    await userEvent.click(screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Lara Croft/ }));
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "marked while drafting chapter four");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
    await userEvent.click(await screen.findByRole("button", { name: /No, I am good/ }));
  }

  it("records the apply, which is what removes the mark", async () => {
    mockApi({ stops: [known, stop({ key: "second", title: "Something else" })],
              nodes: [croft] });
    await start();
    await connectLexaToCroft();
    await waitFor(() => expect(posted("/run/answer")
      .some(c => c.body.state === "applied" && c.body.key === "pinned|lexa"))
      .toBe(true));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("still leaves a loose thread to re-derivation", async () => {
    // The contrast that keeps this from creeping: a loose thread needs no
    // ledger entry, because connecting IS the fix the next scan can see.
    mockApi({ stops: [stop({
                kind: "loose_thread", key: "loose|e-lexa", entity_id: "e-lexa",
                title: "How is Lexa connected to the story?", quote: "",
                detail: { name: "Lexa", type: "character",
                          filename: "alexandra.md" },
              }), stop({ key: "second", title: "Something else" })],
              nodes: [croft] });
    await start();
    await connectLexaToCroft();
    expect(await screen.findByText(/Something else/)).toBeTruthy();
    expect(posted("/run/answer")).toEqual([]);
  });
});


describe("the absorb side path finishes the stop", () => {
  // When the word moves, the placeholder this stop points at is DELETED.
  // Returning to the stop showed a question about an entry that no longer
  // exists, with buttons that could only 404 -- and nothing was recorded, so
  // next session asked again about an id with nothing behind it.

  const bare = stop({
    kind: "frayed", key: "frayed|e-dean", entity_id: "e-dean",
    title: "Dean is missing Overview", quote: "",
    detail: { name: "Dean", type: "character", filename: "dean.md",
              missing: ["Overview"], placeholder: true },
  });
  const deanEntity = {
    entity_id: "e-dean", type: "character", name: "Dean", filename: "dean.md",
    revision: "r1", run: [], ties: [],
    sections: { overview: { heading: "Overview", content: "" } },
  };
  const mira = { entity_id: "e-mira", type: "character", name: "Mira Kell",
                 display_name: "", aliases: [], placeholder: false };

  it("records the stop and advances once the word has moved", async () => {
    mockApi({ stops: [bare, stop({ key: "second", title: "Something else" })],
              nodes: [mira], entity: deanEntity });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const fill = await screen.findByTestId("quick-fill");
    await userEvent.click(within(fill).getByRole("button",
      { name: /is actually another name/ }));
    const bind = await screen.findByTestId("bind-dot");
    await userEvent.click(within(bind).getByRole("button", { name: /Mira Kell/ }));
    await userEvent.click(within(bind).getByRole("button",
      { name: /means Mira Kell/ }));
    await userEvent.click(await within(bind).findByRole("button", { name: "Done" }));
    await waitFor(() => expect(posted("/run/answer")
      .some(c => c.body.state === "applied" && c.body.key === "frayed|e-dean"))
      .toBe(true));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
  });

  it("returns to the same stop when the writer backs out unmoved", async () => {
    mockApi({ stops: [bare], nodes: [mira], entity: deanEntity });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const fill = await screen.findByTestId("quick-fill");
    await userEvent.click(within(fill).getByRole("button",
      { name: /is actually another name/ }));
    const bind = await screen.findByTestId("bind-dot");
    await userEvent.click(within(bind).getByRole("button", { name: "Close" }));
    expect(await screen.findByText(/Dean is missing Overview/)).toBeTruthy();
    expect(posted("/run/answer")).toEqual([]);
  });
});


describe("a failed answer record is said out loud", () => {
  // These paths used to end in `.catch(() => undefined)`. The writer's save
  // had landed, the ledger write silently had not, and the same stop came
  // back next session looking exactly like the save never happened --
  // indistinguishable, from the writer's chair, from the broken-loop bug.

  const frayed = stop({
    kind: "frayed", key: "frayed|e-1", entity_id: "e-1",
    title: "Mira Kell is missing Overview", quote: "",
    detail: { name: "Mira Kell", type: "character", filename: "mira-kell.md",
              missing: ["Overview"] },
  });

  it("advances (the work is real) and says the record did not land", async () => {
    mockApi({ stops: [frayed, stop({ key: "second", title: "Something else" })],
              failAnswers: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await userEvent.type(within(dialog).getByLabelText("Overview"),
                         "The clockmaker's daughter.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save it/ }));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
    expect(screen.getByText(/could not record the answer/)).toBeTruthy();
  });

  it("says nothing when the record lands", async () => {
    mockApi({ stops: [frayed, stop({ key: "second", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await userEvent.type(within(dialog).getByLabelText("Overview"), "Written.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save it/ }));
    expect(await screen.findByText(/Something else/)).toBeTruthy();
    expect(screen.queryByText(/could not record the answer/)).toBeNull();
  });
});


describe("QuickFill survives the parent re-rendering", () => {
  // The panel builds the `missing` array fresh on every render. When the
  // fetch effect depended on the ARRAY, any unrelated parent re-render
  // re-fetched the entry and reset the boxes -- wiping a half-typed
  // paragraph back to empty mid-thought. The effect keys on the content now.

  it("keeps half-typed text when missing arrives as a new array, same words", async () => {
    mockApi();
    const props = {
      projectPath: PROJECT, entityId: "e-1",
      onClose: vi.fn(), onDone: vi.fn(),
    };
    const view = render(<QuickFill {...props} missing={["Overview"]} />);
    const box = await screen.findByLabelText("Overview");
    await userEvent.type(box, "Half a thought");
    view.rerender(<QuickFill {...props} missing={["Overview"]} />);
    expect((screen.getByLabelText("Overview") as HTMLTextAreaElement).value)
      .toBe("Half a thought");
  });

  it("does re-fetch when the content genuinely changes", async () => {
    mockApi();
    const props = {
      projectPath: PROJECT, entityId: "e-1",
      onClose: vi.fn(), onDone: vi.fn(),
    };
    const view = render(<QuickFill {...props} missing={["Overview"]} />);
    await screen.findByLabelText("Overview");
    const before = (vi.mocked(fetch)).mock.calls.length;
    view.rerender(<QuickFill {...props} missing={["Overview", "Goals"]} />);
    await waitFor(() =>
      expect((vi.mocked(fetch)).mock.calls.length).toBeGreaterThan(before));
  });
});


describe("the walk remembers what was answered this sitting", () => {
  // The stop list is a SNAPSHOT from Start. Before this, the panel forgot
  // its own session: Back re-showed answered stops as live questions (and
  // answering again re-fired the write), and "Never ask" muted a kind on the
  // server while the snapshot kept asking for the rest of the walk.

  it("Back shows a receipt on an answered stop, not the live question", async () => {
    mockApi({ stops: [stop(), stop({ key: "b", title: "Second thing" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await screen.findByText("Second thing");
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    const receipt = await screen.findByTestId("already-answered");
    expect(receipt.textContent).toMatch(/Not yet/);
    // The live buttons are gone -- answering twice was the duplicate factory.
    expect(screen.queryByRole("button", { name: /^Not yet$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Never make this an entry" }))
      .toBeNull();
    expect(posted("/run/answer").length).toBe(1);
  });

  it("Carry on from a receipt returns to the frontier", async () => {
    mockApi({ stops: [stop(),
                      stop({ key: "b", title: "Second thing" }),
                      stop({ key: "c", title: "Third thing" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await screen.findByText("Second thing");
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await screen.findByText("Third thing");
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await screen.findByTestId("already-answered");
    await userEvent.click(screen.getByRole("button", { name: /Carry on/ }));
    expect(await screen.findByText("Third thing")).toBeTruthy();
  });

  it("'Never ask' skips the rest of that kind in this sitting too", async () => {
    // The server already knew; the SNAPSHOT kept asking. A mute the current
    // walk ignores reads as a button that does not work.
    mockApi({ stops: [
      stop(),
      stop({ key: "unspun|other", title: "'Vesper' has no entry",
             detail: { name: "Vesper", count: 2 } }),
      stop({ kind: "frayed", key: "frayed|e-1", entity_id: "e-1",
             title: "Mira Kell is missing Overview", quote: "",
             detail: { name: "Mira Kell", type: "character",
                       missing: ["Overview"] } }),
    ] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    await userEvent.click(screen.getByTestId("mute-everywhere"));
    // Straight past the second unspun stop to the frayed one.
    expect(await screen.findByText(/Mira Kell is missing Overview/)).toBeTruthy();
    expect(screen.queryByText(/'Vesper' has no entry/)).toBeNull();
  });

  it("a walk whose remainder is all muted ends", async () => {
    mockApi({ stops: [stop(),
                      stop({ key: "unspun|other", title: "'Vesper' has no entry",
                             detail: { name: "Vesper", count: 2 } })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    await userEvent.click(screen.getByTestId("mute-everywhere"));
    expect(await screen.findByText(/That is everything this pass found/))
      .toBeTruthy();
  });
});


// ── R8.3: "never ask" asks how widely ────────────────────────────────────────
//
// One button, one meaning, and the meaning was THE WHOLE BOOK -- unstated. The
// spec's word was "for this target". The two wants are genuinely different, and
// the narrow one was unreachable: a writer with a deliberately contradictory
// character had to turn contradiction checking off for their whole novel.

describe("how widely never-ask reaches", () => {
  const thin = stop({
    kind: "frayed", key: "frayed|e-1", entity_id: "e-1",
    title: "Mira Kell is missing Overview", quote: "",
    detail: { name: "Mira Kell", type: "character", missing: ["Overview"] },
  });

  it("writes nothing until the writer says how widely", async () => {
    // The old button silenced a whole book on one click. Opening the question
    // is not an answer to it.
    mockApi({ stops: [thin] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    expect(screen.getByTestId("mute-scope")).toBeTruthy();
    expect(posted("/run/answer")).toEqual([]);
  });

  it("narrows to one entry, named", async () => {
    // "About e-1 only" is not a choice anyone can make. The entry's own name is.
    mockApi({ stops: [thin] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    expect(screen.getByTestId("mute-this-one").textContent).toContain("Mira Kell");
    await userEvent.click(screen.getByTestId("mute-this-one"));
    await waitFor(() => expect(posted("/run/answer").length).toBe(1));
    expect(posted("/run/answer")[0].body).toMatchObject({
      mute: "frayed", mute_for: "e-1",
    });
  });

  it("offers no narrow choice when there is no entry to narrow to", async () => {
    // An Unspun name has no entry yet, so "about this one" would name nothing
    // and silence nothing.
    await start();          // the default stop is unspun, entity_id ""
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    expect(screen.queryByTestId("mute-this-one")).toBeNull();
    expect(screen.getByTestId("mute-everywhere")).toBeTruthy();
  });

  it("backing out of the choice writes nothing and keeps the place", async () => {
    mockApi({ stops: [thin, stop({ key: "next", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    await userEvent.click(within(screen.getByTestId("mute-scope"))
      .getByRole("button", { name: /^Back$/ }));
    expect(screen.queryByTestId("mute-scope")).toBeNull();
    expect(posted("/run/answer")).toEqual([]);
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 2/);
  });

  it("a half-made choice does not travel to the next stop", async () => {
    // Otherwise "About Mira Kell only" sits under a question about someone else,
    // and the button then does exactly what it says about the wrong entry.
    mockApi({ stops: [thin, stop({ key: "next", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Never ask/ }));
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByText("Something else")).toBeTruthy());
    expect(screen.queryByTestId("mute-scope")).toBeNull();
  });
});


describe("a stale stop cannot be silently 'done'", () => {
  it("a stop pointing at nothing stays put and says why", async () => {
    // The old fall-through ADVANCED: the button pressed, nothing opened, and
    // the walk moved on as if something had been done. Now it says what is
    // wrong and leaves the real answers (Not yet, the permanent no) live.
    mockApi({ stops: [stop({
      kind: "snag", key: "snag|ghost", entity_id: "",
      title: "Two versions of who Mira serves",
      detail: { name: "Mira Kell", type: "character", sides: [] },
    }), stop({ key: "b", title: "Second thing" })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    expect(await screen.findByText(/no longer in your world/)).toBeTruthy();
    // Still on the same stop -- nothing was recorded, nothing advanced.
    expect(screen.getByText(/Two versions of who Mira serves/)).toBeTruthy();
    expect(posted("/run/answer")).toEqual([]);
  });
});


describe("a dead entry is a way forward, not a dead end", () => {
  // Stale stops point at entries that stopped existing mid-walk (absorbed,
  // deleted, settled elsewhere). Each inline screen used to strand the
  // writer there: an eternal spinner, an error with no buttons, or a 404 on
  // every action.

  const frayed = stop({
    kind: "frayed", key: "frayed|e-old", entity_id: "e-old",
    title: "Someone is missing Overview", quote: "",
    detail: { name: "Someone", type: "character", missing: ["Overview"] },
  });

  it("QuickFill on a missing entry offers Carry on", async () => {
    mockApi({ stops: [frayed, stop({ key: "b", title: "Second thing" })],
              entityMissing: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Fill it in here/ }));
    const dialog = await screen.findByTestId("quick-fill");
    await within(dialog).findByRole("alert");
    await userEvent.click(within(dialog).getByRole("button",
      { name: /carry on/i }));
    expect(await screen.findByText("Second thing")).toBeTruthy();
  });

  it("the early-mention fixer says 'already sorted' instead of spinning", async () => {
    // The reading spinner used to never end when the entry refused to load.
    mockApi({ stops: [stop({
      kind: "early_mention", key: "early|e-old|c-1", entity_id: "e-old",
      chapter_id: "c-1", title: "Named before the reader should know",
      detail: { name: "Someone", type: "character" },
    }), stop({ key: "b", title: "Second thing" })], entityMissing: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Decide here/ }));
    await screen.findByTestId("snag-gone");
    await userEvent.click(screen.getByRole("button", { name: /Carry on/ }));
    expect(await screen.findByText("Second thing")).toBeTruthy();
  });

  it("fixing a fact that is already gone flips to 'already sorted'", async () => {
    mockApi({ stops: [stop({
      kind: "snag", key: "snag|e-1|serves", entity_id: "e-1",
      title: "Two versions of who Mira serves",
      detail: { name: "Mira Kell", type: "character", sides: [
        { id: "f-1", value: "Serves the Crown", at: "c-1" },
        { id: "f-2", value: "Serves the Guild", at: "c-2" },
      ] },
    }), stop({ key: "b", title: "Second thing" })], factsGone: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    await screen.findByTestId("snag-fixer");
    await userEvent.click(screen.getByRole("button",
      { name: /Both are right on purpose/ }));
    // fact_not_found is not an error to argue with -- the work is done.
    await screen.findByTestId("snag-gone");
    await userEvent.click(screen.getByRole("button", { name: /Carry on/ }));
    expect(await screen.findByText("Second thing")).toBeTruthy();
  });

  it("a one-sided snag never offers 'Keep this one'", async () => {
    // With no other side to remove, that button deleted nothing, recorded
    // the stop applied, and permanently silenced a live problem while
    // looking like a fix.
    mockApi({ stops: [stop({
      kind: "snag", key: "snag|e-1|order", entity_id: "e-1",
      title: "Mira Kell: two changes land on the same chapter",
      detail: { name: "Mira Kell", type: "character", sides: [
        { id: "f-1", value: "Serves the Crown", at: "c-1" },
      ] },
    })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).queryByRole("button", { name: /Keep this one/ }))
      .toBeNull();
    // The honest answers are still there: fix it in place, or deliberate. And
    // the wording drops the "both", which offers a choice that is not there --
    // R8.4's checks can fire on a single fact whose own two anchors disagree.
    expect(within(dialog).getByRole("button", { name: /Edit Serves the Crown/ }))
      .toBeTruthy();
    expect(within(dialog).getByRole("button",
      { name: /That is deliberate/ })).toBeTruthy();
    expect(dialog.textContent).not.toContain("These disagree");
  });
});


// ── R8.4: the two checks the spec named and nothing implemented ──────────────
//
// Found is only half of it. Both new checks are about a fact's REVEAL POINT, and
// the fixer's edit form had no control for that anchor -- so the walk could
// report a problem it gave the writer no way to fix without leaving, which is
// the one thing the closed-world rule forbids.

describe("a reveal point that cannot be ordered", () => {
  const told = stop({
    kind: "snag", key: "snag|e-1|father", entity_id: "e-1",
    title: "Elara Voss: the reader is told this before it becomes true",
    quote: "",
    why: "The reveal point comes before the point it becomes true.",
    detail: { name: "Elara Voss", type: "character", axis: "father.fate",
              snag: "impossible_order",
              sides: [{ id: "f-1", at: "c-2", value: "Alive, in hiding.",
                        revealed_at: "c-1" }] },
  });

  it("offers the reveal point as something the writer can change", async () => {
    mockApi({ stops: [told] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(within(dialog).getByLabelText("Edit Alive, in hiding."));
    await userEvent.selectOptions(
      within(dialog).getByLabelText("The chapter the reader learns it"), "c-2");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save the fix/ }));
    await waitFor(() => {
      const patched = posted("/fact").filter(c => c.body.fact_id === "f-1");
      expect((patched[0].body.set as { revealed_at: string }).revealed_at)
        .toBe("c-2");
    });
  });

  it("offers no reveal picker on a fact that has no reveal point", async () => {
    // Two chapter pickers on every fact turns a two-field edit into a form, and
    // the ordinary fact becomes known where it happens.
    mockApi({ stops: [stop({
      kind: "snag", key: "snag|e-1|eyes", entity_id: "e-1",
      title: "Two facts disagree about eyes", quote: "",
      detail: { name: "Elara Voss", type: "character", axis: "eyes",
                sides: [{ id: "f-1", at: "c-1", value: "Green." },
                        { id: "f-2", at: "c-1", value: "Blue." }] },
    })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    await userEvent.click(within(dialog).getByLabelText("Edit Green."));
    expect(within(dialog)
      .queryByLabelText("The chapter the reader learns it")).toBeNull();
  });
});


describe("the numbers and names shown are the truth", () => {
  it("counts what the walk will ASK, and says what was settled earlier", async () => {
    // `total` includes stops answered for good in earlier sessions. Quoting
    // it inflated the work: "found 40 things" over a walk that would ask one
    // question and end.
    mockApi({ stops: [stop()], total: 40 });
    await open();
    expect(screen.getByTestId("weaving-count").textContent)
      .toMatch(/found 1 thing to look at/);
    expect(screen.getByText(/39 more were answered for good/)).toBeTruthy();
  });

  it("says so when everything found is already answered, and does not start", async () => {
    mockApi({ stops: [], total: 5 });
    await open();
    expect(screen.getByTestId("weaving-count").textContent)
      .toMatch(/already been answered/);
    expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled"))
      .toBe(true);
  });

  it("a tie snag names the other end, never its raw id", async () => {
    // "leads e-4f2a91" is not a sentence a writer can decide anything from.
    mockApi({ stops: [stop({
      kind: "snag", key: "snag|e-1|leads", entity_id: "e-1",
      title: "Mira Kell: leads more than one at once",
      detail: { name: "Mira Kell", type: "character", sides: [
        { id: "leads:e-4f2a91", rel: "leads", target: "e-4f2a91",
          target_name: "Garrick" },
        { id: "leads:e-9c02aa", rel: "leads", target: "e-9c02aa",
          target_name: "The Guild" },
      ] },
    })] });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Sort it out here/ }));
    const dialog = await screen.findByTestId("snag-fixer");
    expect(within(dialog).getByText(/leads Garrick/)).toBeTruthy();
    expect(within(dialog).getByText(/leads The Guild/)).toBeTruthy();
    expect(within(dialog).queryByText(/e-4f2a91/)).toBeNull();
  });
});


describe("adding to an existing entry is called what it is", () => {
  // The receipt used to say "Created: Government" over an entry that had
  // existed for ten chapters -- which reads as the app having just made a
  // duplicate, the exact thing the add-to-existing offer exists to avoid.

  const question = stop({
    kind: "unwoven", key: "unwoven|succession", entity_id: "",
    title: "How does succession work?", quote: "",
    detail: { lands_as: ["government", "succession"] },
  });
  const crown = { entity_id: "e-crown", type: "government", name: "The Crown",
                  display_name: "", aliases: [], placeholder: false };

  it("says 'Added to', and that nothing already written was lost", async () => {
    mockApi({ stops: [question], nodes: [crown],
              entity: { entity_id: "e-crown", type: "government",
                        name: "The Crown", filename: "the-crown.md",
                        revision: "r1", run: [], ties: [],
                        sections: { succession: { heading: "Succession",
                                                  content: "" } } } });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Answer it here/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.click(within(dialog).getByRole("button", { name: /The Crown/ }));
    await userEvent.type(within(dialog).getByLabelText("The answer"),
                         "Decided by single combat.");
    await userEvent.click(within(dialog).getByRole("button", { name: /Add it/ }));
    expect(await screen.findByRole("dialog", { name: /Added to: The Crown/ }))
      .toBeTruthy();
    expect(screen.getByText(/Everything already written there was kept/))
      .toBeTruthy();
    expect(screen.queryByText(/Created:/)).toBeNull();
  });
});


describe("starter text is never silently dropped", () => {
  // When the registry cannot be read the text has no section to land in. The
  // first version quietly created the entry WITHOUT the text: the writer's
  // words vanished and the receipt said success.

  it("refuses out loud, with the words still in the box", async () => {
    mockApi({ stops: [stop()], typesDown: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    // The evidence sentence is prefilled, so the box is not empty.
    const box = within(dialog).getByLabelText("Starter text") as HTMLTextAreaElement;
    expect(box.value.length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    expect(await within(dialog).findByText(/nowhere to land/)).toBeTruthy();
    expect(box.value.length).toBeGreaterThan(0);      // the words survived
    expect(posted("/thread/new")).toEqual([]);
  });

  it("clearing the box is the stated way through", async () => {
    mockApi({ stops: [stop()], typesDown: true });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Create the entry/ }));
    const dialog = await screen.findByTestId("quick-entry");
    await userEvent.clear(within(dialog).getByLabelText("Starter text"));
    await userEvent.click(within(dialog).getByRole("button", { name: /Create it/ }));
    await waitFor(() => expect(posted("/thread/new").length).toBe(1));
    expect(posted("/thread/new")[0].body.sections).toBeUndefined();
  });
});


// ── Ruling 8: the tick-list, offered from the walk ───────────────────────────
//
// "Forty unplaced facts should be a tick-list, not forty screens." Sweep.test.tsx
// pins the list itself; these pin that the WALK offers it, only when it is worth
// offering, and that the walk moves past everything the list settled -- which is
// the part a component test cannot see and the part that would re-ask the writer
// forty questions they just answered.

describe("working through a whole kind at once", () => {
  const unplacedStops = [1, 2, 3].map(n => stop({
    kind: "unplaced", key: `unplaced|e-${n}`, entity_id: `e-${n}`,
    title: "A fact never takes effect", quote: "",
    why: "Nothing says when it became true.",
    detail: { name: `Person ${n}`, type: "character", snag: "unplaced",
              sides: [{ id: `f-${n}`, value: `Fact ${n}.` }] },
  }));

  it("offers the list when there is more than one of the kind", async () => {
    mockApi({ stops: unplacedStops });
    await start();
    expect(screen.getByTestId("sweep-offer").textContent)
      .toContain("all 3 at once");
  });

  it("stays quiet for a single one", async () => {
    // "Work through all 1 at once" is a button that costs a click and does
    // nothing.
    mockApi({ stops: [unplacedStops[0]] });
    await start();
    expect(screen.queryByTestId("sweep-offer")).toBeNull();
  });

  it("stays quiet for a kind whose answers are each different", async () => {
    mockApi({ stops: [
      stop({ kind: "snag", key: "snag|a", entity_id: "e-1", quote: "",
             detail: { name: "A", type: "character",
                       sides: [{ id: "f-1", value: "x" }] } }),
      stop({ kind: "snag", key: "snag|b", entity_id: "e-2", quote: "",
             detail: { name: "B", type: "character",
                       sides: [{ id: "f-2", value: "y" }] } }),
    ] });
    await start();
    expect(screen.queryByTestId("sweep-offer")).toBeNull();
  });

  it("places from the list and walks past every one it settled", async () => {
    // THE POINT OF THE PANEL HALF. The walk's index has to jump over all three,
    // or the writer is asked again about facts they just placed.
    mockApi({ stops: [...unplacedStops,
                      stop({ key: "after", title: "Something else" })] });
    await start();
    await userEvent.click(screen.getByTestId("sweep-offer"));
    const sweep = await screen.findByTestId("sweep");

    for (const value of ["Fact 1.", "Fact 2.", "Fact 3."]) {
      await userEvent.selectOptions(
        within(sweep).getByLabelText(`Chapter for ${value}`), "c-2");
    }
    await userEvent.click(within(sweep).getByTestId("sweep-place"));

    // Straight to the stop after the swept ones.
    expect(await screen.findByText("Something else")).toBeTruthy();
    // Each fact was PATCHed at the chapter chosen for it.
    const patched = posted("/fact").filter(c => c.body.fact_id);
    expect(patched.map(c => c.body.fact_id).sort()).toEqual(["f-1", "f-2", "f-3"]);
    expect((patched[0].body.set as { at: string }).at).toBe("c-2");
  });

  it("leaves the walk exactly where it was when the writer backs out", async () => {
    mockApi({ stops: unplacedStops });
    await start();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 3/);
    await userEvent.click(screen.getByTestId("sweep-offer"));
    await screen.findByTestId("sweep");
    await userEvent.click(screen.getByTestId("sweep-one-at-a-time"));
    expect(await screen.findByTestId("weaving-progress")).toBeTruthy();
    expect(screen.getByTestId("weaving-progress").textContent).toMatch(/1 of 3/);
    expect(posted("/fact")).toEqual([]);
  });

  it("only lists what is still open in this sitting", async () => {
    // Answer one on the walk, then open the list: the answered one is gone.
    // A list assembled from anything but the walk's own snapshot would show a
    // fact the writer settled five minutes ago.
    mockApi({ stops: unplacedStops });
    await start();
    await userEvent.click(screen.getByRole("button", { name: /Not yet/ }));
    await waitFor(() => expect(screen.getByTestId("sweep-offer")).toBeTruthy());
    await userEvent.click(screen.getByTestId("sweep-offer"));
    const sweep = await screen.findByTestId("sweep");
    expect(within(sweep).queryByText(/Fact 1\./)).toBeNull();
    expect(within(sweep).getByText(/Fact 2\./)).toBeTruthy();
  });
});


// ── The guide the walk offered and did not draw ───────────────────────────────
//
// The Unwoven stop card has offered "Show me how this works" since R6.4, and
// UnwovenGuide was mounted only in the setup branch -- so on a stop the button
// set a flag and rendered nothing. A dead control in the middle of the walk.
//
// Same failure as R2.12f with the halves reversed: that was a guide nothing
// offered, this was an offer with no guide. Both are only findable by reading the
// mount points against the callers, which is why one test per mount point.

describe("the ground-rules guide is reachable from both places", () => {
  const unwovenStop = stop({
    kind: "unwoven", key: "unwoven|gov_power", entity_id: "", quote: "",
    title: "Who holds power, and how do they keep it?",
    why: "Nothing in your world says yet.",
    detail: { question_id: "gov_power", domain: "governance",
              domain_label: "Power and who holds it", domain_open: 4,
              lands_as: ["government", "structure"] },
  });

  it("opens from the setup screen", async () => {
    // The board is where the setup screen's copy of the button lives, and the
    // board renders nothing without domains -- correctly, so the test has to
    // supply them rather than the component pretending.
    mockApi({ stops: [unwovenStop], domains: [
      { id: "governance", label: "Power and who holds it", open: 4, asked_now: 1 },
    ] });
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Unwoven/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Show me how this works/ }));
    expect(await screen.findByTestId("unwoven-guide")).toBeTruthy();
  });

  it("opens from a stop in the middle of the walk", async () => {
    mockApi({ stops: [unwovenStop] });
    await start();
    await userEvent.click(
      screen.getByRole("button", { name: /Show me how this works/ }));
    expect(await screen.findByTestId("unwoven-guide")).toBeTruthy();
  });
});
