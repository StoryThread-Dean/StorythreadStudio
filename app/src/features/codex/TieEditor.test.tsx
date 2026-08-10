// features/codex/TieEditor.test.tsx
// =================================
// The case this whole screen exists for, from live testing:
//
//     "Daughter's of Pathicus and Cult are linked by Faction, Pathicus is a
//      Diety connection... The AI and app might not recognize any of these
//      connections directly, but the writer would. This is why its important
//      to establish the manual connection process."
//
// So the tests are about whether a writer can actually say those things --
// including when the app's own vocabulary is short, which it was: a faction
// could not worship a deity at all before this work.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TieEditor } from "./TieEditor";
import type { GraphNode } from "./api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function node(over: Partial<GraphNode> & { entity_id: string; name: string;
                                          type: string }): GraphNode {
  return { display_name: "", aliases: [], placeholder: false, ...over };
}

const DAUGHTERS = node({ entity_id: "e-daughters", type: "faction",
                         name: "Daughters of Pathicus", aliases: ["Cult"] });
const PATHICUS = node({ entity_id: "e-pathicus", type: "deity", name: "Pathicus" });
const FAITH = node({ entity_id: "e-faith", type: "religion",
                     name: "The Faith of Pathicus" });
const STUB = node({ entity_id: "e-stub", type: "character", name: "Someone",
                    placeholder: true });

const WORSHIPS = { id: "worships", label: "worships", symmetric: false,
                   cardinality: "many", inverse_label: "worshipped by",
                   flipped: false };
const PART_OF = { id: "part_of", label: "part of", symmetric: false,
                  cardinality: "many", inverse_label: "contains",
                  flipped: false };

let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(options: {
  ties?: Record<string, unknown>[];
  relations?: Record<string, unknown>;
  warnings?: string[];
  failTie?: string;
} = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });

    if (url.includes("/ties")) {
      return { ok: true, json: async () => ({ ties: options.ties ?? [] }) } as Response;
    }
    if (url.includes("/relations")) {
      return {
        ok: true,
        json: async () => options.relations
          ?? { forward: [WORSHIPS], reverse: [], available: [] },
      } as Response;
    }
    if (url.includes("/tie") && method === "POST" && options.failTie) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "tie_endpoint_invalid",
                                       message: options.failTie } }),
      } as Response;
    }
    if (url.includes("/relation") && method === "POST") {
      return { ok: true,
               json: async () => ({ id: "sworn_to_destroy",
                                    label: "Sworn to destroy" }) } as Response;
    }
    return { ok: true,
             json: async () => ({ created: true,
                                  warnings: options.warnings ?? [] }) } as Response;
  }));
}

beforeEach(() => mockApi());

async function open(props: Partial<Parameters<typeof TieEditor>[0]> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(<TieEditor projectPath={PROJECT} thread={DAUGHTERS}
                    candidates={[DAUGHTERS, PATHICUS, FAITH, STUB]}
                    onClose={onClose} onChanged={onChanged} {...props} />);
  await waitFor(() => expect(screen.getByTestId("tie-editor")).toBeTruthy());
  return { onChanged, onClose };
}

/** Anchored, because "Pathicus" the deity and "The Faith of Pathicus" are both
 *  on the list and a loose match finds both. */
async function chooseOther(name: string) {
  await userEvent.click(screen.getByRole("button", { name: /Connect this to something/ }));
  await userEvent.click(screen.getByRole("button", { name: new RegExp("^" + name) }));
  await waitFor(() => expect(screen.getByText(/How is/)).toBeTruthy());
}

const posted = (fragment: string) =>
  calls.filter(c => c.method === "POST" && c.url.includes(fragment));


describe("the reported world", () => {
  it("lets a faction worship a deity", async () => {
    // It could not before this work: no relation ran between those kinds, so
    // the writer's most obvious statement was unsayable.
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(
      screen.getByRole("button", { name: /Daughters of Pathicus worships Pathicus/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body).toMatchObject({
      src_id: "e-daughters", rel: "worships", dst_id: "e-pathicus",
    });
  });

  it("writes the connection as the sentence it will record", async () => {
    // "worships" on its own is a vocabulary item. The sentence is the thing
    // the writer is agreeing to.
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByRole("button",
      { name: /Daughters of Pathicus worships Pathicus/ })).toBeTruthy();
  });

  it("shows what is already recorded, read from this end", async () => {
    // An incoming "part of" is "contains" from here. Showing the stored
    // direction would make the writer translate every line in their head.
    mockApi({ ties: [
      { src_id: "e-faith", dst_id: "e-daughters", rel: "part_of",
        incoming: true, other_id: "e-faith", other_name: "The Faith of Pathicus",
        other_type: "religion", reads_as: "contains", at: null, until: null,
        at_label: "", until_label: "" },
    ] });
    await open();
    expect(screen.getByText("contains")).toBeTruthy();
    expect(screen.getByText("The Faith of Pathicus")).toBeTruthy();
  });

  it("says why connections matter when there are none", async () => {
    await open();
    expect(screen.getByText(/no scan can guess them/)).toBeTruthy();
  });
});


describe("only what means something between these two kinds", () => {
  it("offers the connections that run this way", async () => {
    mockApi({ relations: { forward: [WORSHIPS, PART_OF], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByRole("button", { name: /worships/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /part of/ })).toBeTruthy();
  });

  it("asks only once the other end is known", async () => {
    // The answer depends on it, so asking earlier would offer a vocabulary
    // before there is anything to say it about.
    await open();
    expect(calls.filter(c => c.url.includes("/relations"))).toEqual([]);
    await chooseOther("Pathicus");
    expect(calls.filter(c => c.url.includes("/relations")).length).toBe(1);
  });

  it("does not offer placeholders as an end", async () => {
    // A placeholder has not been said to BE anything, so connecting to one
    // records a relationship with a word rather than with a thing.
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    expect(screen.queryByRole("button", { name: /^Someone/ })).toBeNull();
  });

  it("does not offer the entry itself", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryAllByRole("button",
      { name: /^Daughters of Pathicus/ })).toEqual([]);
  });

  it("can be searched by a word an entry answers to", async () => {
    await open({ candidates: [DAUGHTERS, PATHICUS,
                              node({ entity_id: "e-x", type: "faction",
                                     name: "The Order", aliases: ["Cult"] })] });
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.type(screen.getByLabelText("Find an entry"), "cult");
    expect(screen.getByRole("button", { name: /The Order/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pathicus/ })).toBeNull();
  });
});


describe("nothing fits is never a dead end", () => {
  it("offers to turn the pair around", async () => {
    // Making the writer work out that "governed by" is "governs" backwards is
    // work the app can do.
    mockApi({ relations: {
      forward: [], available: [],
      reverse: [{ ...PART_OF, id: "contains", label: "contains", flipped: true }],
    } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText(/the other way round/)).toBeTruthy();
    expect(screen.getByRole("button",
      { name: /Pathicus contains Daughters of Pathicus/ })).toBeTruthy();
  });

  it("stores a turned-around connection from the OTHER end", async () => {
    // A Tie is recorded once and read from both sides. Storing it backwards
    // would make the whole world read backwards.
    mockApi({ relations: {
      forward: [], available: [],
      reverse: [{ ...PART_OF, id: "contains", label: "contains", flipped: true }],
    } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Pathicus contains/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body).toMatchObject({
      src_id: "e-pathicus", dst_id: "e-daughters",
    });
  });

  it("offers a shipped connection this world does not have yet", async () => {
    // types.json is the writer's file and is never modified behind their back,
    // so an older project is OFFERED the newer vocabulary.
    mockApi({ relations: { forward: [], reverse: [], available: [WORSHIPS] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText(/not in your world yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /add and use/ }));
    await waitFor(() => expect(posted("/relation").length).toBe(1));
    expect(posted("/relation")[0].body.adopt).toBe("worships");
  });

  it("adopting one then records the connection with it", async () => {
    mockApi({ relations: { forward: [], reverse: [], available: [WORSHIPS] } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /add and use/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.rel).toBe("worships");
  });

  it("says the world has no NAMED way, and that a plain one still works", async () => {
    // The wording matters: a plain connection is always available, so
    // "no way to connect these" would be untrue and discouraging.
    mockApi({ relations: { forward: [], reverse: [], available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText(/no NAMED way to connect/)).toBeTruthy();
    expect(screen.getByText(/plain connection still works/)).toBeTruthy();
  });

  it("always lets the writer name it themselves", async () => {
    // The shipped vocabulary will always be short of somebody's invented
    // world, and a screen that shrugs is a screen that stops being opened.
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByRole("button", { name: /Name it yourself/ })).toBeTruthy();
  });

  it("adds the named connection and uses it at once", async () => {
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    await userEvent.type(screen.getByLabelText("Connection name"),
                         "Sworn to destroy");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/relation")[0].body).toMatchObject({
      label: "Sworn to destroy",
      source_types: ["faction"], target_types: ["deity"],
    });
    expect(posted("/tie")[0].body.rel).toBe("sworn_to_destroy");
  });

  it("says a named connection becomes part of the world", async () => {
    // So the writer knows they are extending their vocabulary, not making a
    // one-off note.
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    expect(screen.getByText(/becomes part of your world/)).toBeTruthy();
  });
});


describe("refusals and warnings", () => {
  it("shows a refusal and keeps the writer where they are", async () => {
    mockApi({ failTie: "That connection is already recorded." });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /worships/ }));
    await waitFor(() =>
      expect(screen.getByText(/already recorded/)).toBeTruthy());
  });

  it("records a one-at-a-time clash and says so, rather than refusing", async () => {
    // Usually a mistake, sometimes a story: a disputed throne, a marriage
    // nobody annulled. The app is not entitled to decide which.
    mockApi({ warnings: ["'seat of' allows one at a time, and there are 2."] });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /worships/ }));
    await waitFor(() =>
      expect(screen.getByText(/one at a time/)).toBeTruthy());
    expect(screen.getByText(/recorded either way/)).toBeTruthy();
  });

  it("marks a one-at-a-time connection before it is chosen", async () => {
    mockApi({ relations: {
      forward: [{ ...WORSHIPS, cardinality: "one" }], reverse: [], available: [],
    } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText("one at a time")).toBeTruthy();
  });
});


describe("removing one", () => {
  const TIE = {
    src_id: "e-daughters", dst_id: "e-pathicus", rel: "worships",
    incoming: false, other_id: "e-pathicus", other_name: "Pathicus",
    other_type: "deity", reads_as: "worships", at: null, until: null,
    at_label: "", until_label: "",
  };

  it("removes the connection the writer pointed at", async () => {
    mockApi({ ties: [TIE] });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Remove worships Pathicus/ }));
    await waitFor(() =>
      expect(calls.some(c => c.method === "DELETE")).toBe(true));
    const url = calls.filter(c => c.method === "DELETE")[0].url;
    expect(url).toContain("rel=worships");
    expect(url).toContain("dst_id=e-pathicus");
  });

  it("tells the map to redraw", async () => {
    mockApi({ ties: [TIE] });
    const { onChanged } = await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Remove worships Pathicus/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});


describe("the shell", () => {
  it("names the entry being connected", async () => {
    await open();
    expect(screen.getByRole("dialog",
      { name: /Connections for Daughters of Pathicus/ })).toBeTruthy();
  });

  it("uses the label the story gives an entry", async () => {
    await open({ thread: node({ entity_id: "e-alex", type: "character",
                                name: "Alexandra Langford",
                                display_name: "Lexa", aliases: ["Lexa"] }) });
    expect(screen.getByRole("dialog", { name: /Connections for Lexa/ })).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const { onClose } = await open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});


describe("naming the other half", () => {
  // From the worked example: clicking the Drow entry and seeing every drow.
  // A connection called "Race" with no second half reads as "Race (the other
  // way round)" from that end -- honest, and clumsy enough to be worth asking
  // one more question about.

  it("offers it, and says it is optional", async () => {
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    expect(screen.getByLabelText("The other way round")).toBeTruthy();
    expect(screen.getByText("optional")).toBeTruthy();
  });

  it("says what happens without it", async () => {
    // So skipping it is an informed choice rather than a thing to regret.
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    expect(screen.getByText(/reads awkwardly when you/)).toBeTruthy();
  });

  it("sends it when given", async () => {
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    await userEvent.type(screen.getByLabelText("Connection name"), "Race");
    await userEvent.type(screen.getByLabelText("The other way round"), "Race of");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posted("/relation").length).toBe(1));
    expect(posted("/relation")[0].body.inverse_label).toBe("Race of");
  });

  it("still works when it is left empty", async () => {
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Name it yourself/ }));
    await userEvent.type(screen.getByLabelText("Connection name"), "Race");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/relation")[0].body.inverse_label).toBe("");
  });
});


describe("a connection is allowed to be untyped", () => {
  // From review: "What we should establish for now is, Connection is just
  // defaulted to connection only. The TYPE of connection can be further
  // defined and Expanded upon later."
  //
  // Requiring a relation first gets the order of work wrong. A writer knows
  // Drizzt and Guenhwyvar belong together long before they want to argue with
  // themselves about whether that is a bond, a friendship or ownership.

  const PLAIN = { id: "connected_to", label: "connected to", symmetric: true,
                  cardinality: "many", inverse_label: "", flipped: false,
                  universal: true };

  it("offers just connecting them, first", async () => {
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    const buttons = screen.getAllByRole("button").map(b => b.textContent ?? "");
    const plain = buttons.findIndex(t => t.includes("Just connect them"));
    const named = buttons.findIndex(t => t.includes("worships"));
    expect(plain).toBeGreaterThan(-1);
    expect(plain).toBeLessThan(named);
  });

  it("says the how can come later, so skipping it is not a loss", async () => {
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText("say how later")).toBeTruthy();
  });

  it("records it with no relation chosen", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Just connect them/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.rel).toBe("connected_to");
  });

  it("separates the plain one from the ways of saying how", async () => {
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText("or say how")).toBeTruthy();
  });

  it("adopts it quietly when an older project lacks it", async () => {
    // types.json is the writer's own file, so an older project simply does not
    // have it. "Just connect them" must not turn into a lecture.
    mockApi({ relations: { forward: [], reverse: [], available: [PLAIN] } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Just connect them/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/relation")[0].body.adopt).toBe("connected_to");
  });

  it("does not list the plain one among the ones to adopt", async () => {
    // It has its own button. Showing it twice would read as two different
    // things.
    mockApi({ relations: { forward: [], reverse: [], available: [PLAIN] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.queryByText(/not in your world yet/)).toBeNull();
  });

  it("works between kinds nothing named connects", async () => {
    // The Race case: a kind the app has never heard of, invented after every
    // relation in the file was written.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open({ thread: node({ entity_id: "e-drizzt", type: "character",
                                name: "Drizzt Do'Urden" }),
                 candidates: [node({ entity_id: "e-drow", type: "race",
                                     name: "Drow (Dark Elf)" })] });
    await chooseOther("Drow");
    await userEvent.click(screen.getByRole("button", { name: /Just connect them/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
  });
});

describe("the other end might not exist yet", () => {
  // Path 3 from live testing: "the path to the file doesn't exist because it
  // hasn't been created yet". Sending the writer off to make it somewhere else
  // loses their place and the half-made thought with it.

  function mockMake() {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method,
                   body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (url.includes("/ties")) {
        return { ok: true, json: async () => ({ ties: [] }) } as Response;
      }
      if (url.includes("/relations")) {
        return { ok: true,
                 json: async () => ({ forward: [WORSHIPS], reverse: [],
                                      available: [] }) } as Response;
      }
      if (url.includes("/thread/new")) {
        return { ok: true,
                 json: async () => ({ thread: { entity_id: "e-made" } }) } as Response;
      }
      return { ok: true,
               json: async () => ({ created: true, warnings: [] }) } as Response;
    }));
  }

  it("offers to make one rather than ending the job", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    expect(screen.getByRole("button", { name: /make it/ })).toBeTruthy();
  });

  it("prefills the name from whatever they searched for", async () => {
    // Which is usually its name -- they typed it looking for it.
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.type(screen.getByLabelText("Find an entry"), "The Foot Clan");
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    expect((screen.getByLabelText("What is it called") as HTMLInputElement).value)
      .toBe("The Foot Clan");
  });

  it("asks what kind it is, and will not act without one", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    await userEvent.type(screen.getByLabelText("What is it called"), "The Foot Clan");
    expect(screen.getByRole("button", { name: /Make it/ })
      .hasAttribute("disabled")).toBe(true);
  });

  it("says it is made empty, so the writer is not expecting a form", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    expect(screen.getByText(/made empty and you can fill it in whenever/))
      .toBeTruthy();
  });

  it("makes it and treats it as chosen, so the writer carries on", async () => {
    mockMake();
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    await userEvent.type(screen.getByLabelText("What is it called"), "The Foot Clan");
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing is it"), "Faction");
    await userEvent.click(screen.getByRole("button", { name: /Make it/ }));

    await waitFor(() => expect(screen.getByText(/How is/)).toBeTruthy());
    const made = posted("/thread/new")[0];
    expect(made.body).toMatchObject({ type: "faction", name: "The Foot Clan" });
  });

  it("then connects to the thing it just made", async () => {
    mockMake();
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    await userEvent.type(screen.getByLabelText("What is it called"), "The Foot Clan");
    await userEvent.selectOptions(
      screen.getByLabelText("What kind of thing is it"), "Faction");
    await userEvent.click(screen.getByRole("button", { name: /Make it/ }));
    await waitFor(() => expect(screen.getByText(/How is/)).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /worships/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.dst_id).toBe("e-made");
  });

  it("can be backed out of", async () => {
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: /make it/ }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Find an entry")).toBeTruthy();
  });
});
