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
                   flipped: false, universal: false, group: "Belief" };
const PART_OF = { id: "part_of", label: "part of", symmetric: false,
                  cardinality: "many", inverse_label: "contains",
                  flipped: false, universal: false, group: "Belonging" };
const PLAIN = { id: "connected_to", label: "connected to", symmetric: true,
                cardinality: "many", inverse_label: "", flipped: false,
                universal: true, group: "Other" };

let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(options: {
  ties?: Record<string, unknown>[];
  relations?: Record<string, unknown>;
  warnings?: string[];
  failTie?: string;
  failRelation?: string;
  /** Reading the connections refuses -- a stale walk stop can open this
   *  editor on an entity that was absorbed after the scan. */
  failTiesRead?: string;
} = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });

    if (url.includes("/ties")) {
      if (options.failTiesRead) {
        return {
          ok: false,
          json: async () => ({ detail: { code: "entity_not_found",
                                         message: options.failTiesRead } }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ties: options.ties ?? [] }) } as Response;
    }
    if (url.includes("/relations")) {
      return {
        ok: true,
        json: async () => ({
          groups: ["Family", "Knows / Known", "Intimate", "Against",
                   "Duty and standing", "Belonging", "Place", "Belief",
                   "Things and events", "Other"],
          ...(options.relations
            ?? { forward: [PLAIN, WORSHIPS], reverse: [], available: [] }),
        }),
      } as Response;
    }
    if (url.includes("/tie") && method === "POST" && options.failTie) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "tie_endpoint_invalid",
                                       message: options.failTie } }),
      } as Response;
    }
    if (url.includes("/relation") && method === "POST" && options.failRelation) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "type_invalid",
                                       message: options.failRelation } }),
      } as Response;
    }
    if (url.includes("/relation") && method === "POST") {
      return { ok: true,
               json: async () => {
                 // Derived the way relation_id() does, so a test can name its
                 // own connection and get that one back rather than a fixture.
                 const label = String(body.label ?? body.adopt ?? "");
                 return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
                                    .replace(/^_+|_+$/g, ""),
                          label };
               } } as Response;
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
  await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
  // A reason on every one, because a connection without one records nothing.
  // Tests about the reason ITSELF do this by hand -- see the reason describe.
  await userEvent.type(screen.getByLabelText("Why they are connected"),
                       "She was his last student");
}

const posted = (fragment: string) =>
  calls.filter(c => c.method === "POST" && c.url.includes(fragment));

/** The relation dropdown, which replaced a column of buttons. */
const relSelect = () => screen.getByLabelText("How they are connected");

/** Every option in it, flattened out of its optgroups. */
const relOptions = () =>
  Array.from(relSelect().querySelectorAll("option")).map(o => o.textContent ?? "");

/** The headings, in the order they are offered. */
const relGroups = () =>
  Array.from(relSelect().querySelectorAll("optgroup"))
    .map(g => g.getAttribute("label"));

async function pickRelation(id: string) {
  await userEvent.selectOptions(relSelect(), id);
}

/** The one save action. The dropdown refines what it records. */
async function recordIt() {
  await userEvent.click(screen.getByRole("button", { name: /^Record it$/ }));
}

/** Choose an end, write a reason, pick a relation, save. The common path. */
async function connectWith(name: string, relId?: string) {
  await chooseOther(name);
  if (relId) await pickRelation(relId);
  await recordIt();
  await waitFor(() => expect(posted("/tie").length).toBe(1));
}


describe("the reported world", () => {
  it("lets a faction worship a deity", async () => {
    // It could not before this work: no relation ran between those kinds, so
    // the writer's most obvious statement was unsayable.
    await open();
    await connectWith("Pathicus", "worships");
    expect(posted("/tie")[0].body).toMatchObject({
      src_id: "e-daughters", rel: "worships", dst_id: "e-pathicus",
    });
  });

  it("reads as the sentence it will record", async () => {
    // The relation sits INSIDE the sentence rather than beside it, so what the
    // writer is agreeing to is one line they can read left to right:
    //
    //     Daughters of Pathicus [ worships v ] Pathicus
    //
    // Asked for that way, and it is why the dropdown is not simply a labelled
    // field somewhere above the button.
    await open();
    await chooseOther("Pathicus");
    const row = relSelect().parentElement!;
    expect(row.textContent).toMatch(
      /Daughters of Pathicus.*choose from.*Pathicus/);
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

  it("rules out the OTHER sense of connected before saying what is missing", async () => {
    // Reported: "Nothing connects to Alexandra Langford. That's not true."
    // Two things are called connected -- the name finding the entry, which is
    // automatic, and the entry relating to other entries, which is this. The
    // empty state has to say the first part is fine or it reads as a fault.
    await open();
    expect(screen.getByText(/already find\s+this entry/)).toBeTruthy();
    expect(screen.getByText(/No scan can guess that/)).toBeTruthy();
  });
});


describe("only what means something between these two kinds", () => {
  it("offers the connections that run this way", async () => {
    mockApi({ relations: { forward: [WORSHIPS, PART_OF], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions()).toContain("worships");
    expect(relOptions()).toContain("part of");
  });

  it("files them under headings rather than in one flat list", async () => {
    // ONE DROPDOWN, GROUPED, asked for because it "serves both a UI landscape
    // issue and makes the writer choose from a list rather than select from a
    // lot of choices." With seventy-odd relations shipped, a flat list is a
    // worse question than no list -- the writer reads all of it to find one
    // item. Under a heading they read one heading and four items.
    mockApi({ relations: { forward: [WORSHIPS, PART_OF], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(relGroups()).toEqual(["Belonging", "Belief"]);
  });

  it("keeps the headings in the order the backend gives", async () => {
    // Alphabetical would put "Against" above "Family", which reads as a
    // statement about relationships rather than a list of them.
    mockApi({ relations: { forward: [WORSHIPS, PART_OF], reverse: [],
                           available: [] },
    });
    await open();
    await chooseOther("Pathicus");
    // Belonging precedes Belief in the shipped order, not in the alphabet.
    expect(relGroups()).toEqual(["Belonging", "Belief"]);
  });

  it("defaults to choosing nothing, and says so", async () => {
    await open();
    await chooseOther("Pathicus");
    expect((relSelect() as HTMLSelectElement).value).toBe("");
    expect(relOptions()[0]).toBe("choose from ...");
  });

  it("asks only once the other end is known", async () => {
    // The answer depends on it, so asking earlier would offer a vocabulary
    // before there is anything to say it about.
    await open();
    expect(calls.filter(c => c.url.includes("/relations"))).toEqual([]);
    await chooseOther("Pathicus");
    expect(calls.filter(c => c.url.includes("/relations")).length).toBe(1);
  });

  it("DOES offer a bare entry as an end, and says it is bare", async () => {
    // REVERSED, and the earlier reasoning is worth recording because it was
    // defensible: a placeholder has not been said to BE anything, so connecting
    // to one records a relationship with a word rather than with a thing.
    //
    // Two things changed. The walk CREATES these on purpose, from names already
    // in the prose, so the writing can carry on -- so hiding them meant the
    // entry made thirty seconds ago could not be connected to, which is a dead
    // end of the app's own making. And the reason line now carries the meaning:
    // "she is hiding her theft from him" says what he is to her whether or not
    // his entry has any prose in it.
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect this to something/ }));
    const row = screen.getByRole("button", { name: /^Someone/ });
    expect(row).toBeTruthy();
    // Offered, but not passed off as more than it is.
    expect(row.textContent).toMatch(/nothing in it yet/);
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
  const CONTAINS = { ...PART_OF, id: "contains", label: "contains",
                     inverse_label: "part of", flipped: true };

  it("offers a connection that runs the other way, in the same list", async () => {
    // Making the writer work out that "governed by" is "governs" backwards is
    // work the app can do -- and it used to be done with a separate "the other
    // way round" section, which asked the writer to understand the app's
    // storage direction before they could say what they meant. One list now.
    mockApi({ relations: { forward: [], available: [], reverse: [CONTAINS] } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions().some(o => o.includes("part of"))).toBe(true);
  });

  it("says which way such a one will be stored", async () => {
    // Not hidden: the writer will see the connection listed from the other
    // entry afterwards, and an unexplained flip looks like a bug.
    mockApi({ relations: { forward: [], available: [], reverse: [CONTAINS] } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions().some(o => o.includes("stored the other way"))).toBe(true);
  });

  it("stores a turned-around connection from the OTHER end", async () => {
    // A Tie is recorded once and read from both sides. Storing it backwards
    // would make the whole world read backwards.
    mockApi({ relations: { forward: [], available: [], reverse: [CONTAINS] } });
    await open();
    await connectWith("Pathicus", "contains");
    expect(posted("/tie")[0].body).toMatchObject({
      src_id: "e-pathicus", dst_id: "e-daughters",
    });
  });

  it("offers a shipped connection this world does not have yet", async () => {
    // types.json is the writer's file and is never modified behind their back,
    // so an older project is OFFERED the newer vocabulary. It sits in the same
    // list as everything else, because "which relations does my types.json
    // happen to contain" is the app's bookkeeping, not the writer's question.
    mockApi({ relations: { forward: [], reverse: [], available: [WORSHIPS] } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions()).toContain("worships");
  });

  it("adopts it quietly when chosen, then records the connection", async () => {
    // Choosing it IS the request, so adopting it is not behind their back.
    mockApi({ relations: { forward: [], reverse: [], available: [WORSHIPS] } });
    await open();
    await connectWith("Pathicus", "worships");
    expect(posted("/relation")[0].body.adopt).toBe("worships");
    expect(posted("/tie")[0].body.rel).toBe("worships");
  });

  it("does not record a connection whose relation could not be added", async () => {
    // Without the relation the tie is refused anyway, and the writer would see
    // "that is not a connection that can run between..." with no idea why.
    mockApi({ relations: { forward: [], reverse: [], available: [WORSHIPS] },
              failRelation: "Could not be added." });
    await open();
    await chooseOther("Pathicus");
    await pickRelation("worships");
    await recordIt();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(posted("/tie").length).toBe(0);
  });

  it("says the world has no NAMED way, and that a plain one still works", async () => {
    // The wording matters: a plain connection is always available, so
    // "no way to connect these" would be untrue and discouraging.
    mockApi({ relations: { forward: [], reverse: [], available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText(/no NAMED way to connect/)).toBeTruthy();
    expect(screen.getByText(/Recording it\s+plain still works/)).toBeTruthy();
  });

  it("always lets the writer name it themselves, from inside the list", async () => {
    // The shipped vocabulary will always be short of somebody's invented
    // world, and a screen that shrugs is a screen that stops being opened.
    // In the list rather than beside it, so it is found while choosing rather
    // than after giving up.
    await open();
    await chooseOther("Pathicus");
    expect(relOptions()).toContain("Write my own...");
  });

  it("opens the naming form when that is chosen", async () => {
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    expect(screen.getByLabelText("Connection name")).toBeTruthy();
  });

  it("adds the named connection and uses it at once", async () => {
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    await userEvent.type(screen.getByLabelText("Connection name"),
                         "Bound by the thread-oath");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/relation")[0].body).toMatchObject({
      label: "Bound by the thread-oath",
      source_types: ["faction"], target_types: ["deity"],
    });
    expect(posted("/tie")[0].body.rel).toBe("bound_by_the_thread_oath");
  });

  it("says a named connection becomes part of the world", async () => {
    // So the writer knows they are extending their vocabulary, not making a
    // one-off note.
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    expect(screen.getByText(/becomes part of your world/)).toBeTruthy();
  });

  it("warns that the words go to AI, and why that costs", async () => {
    // Requested: "giving a warning to writer to use words/terms AI would be
    // familar with as this is part of a backend connection string to keep token
    // cost low and efficent." Guidance rather than a rule -- an invented
    // culture may genuinely need a word no model knows, and then the reason
    // line carries the meaning instead.
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    expect(screen.getByText(/words AI already knows/)).toBeTruthy();
    expect(screen.getByText(/goes into the connection sent with your writing/))
      .toBeTruthy();
  });
});


describe("refusals and warnings", () => {
  it("shows a refusal and keeps the writer where they are", async () => {
    mockApi({ failTie: "That connection is already recorded." });
    await open();
    await chooseOther("Pathicus");
    await pickRelation("worships");
    await recordIt();
    await waitFor(() =>
      expect(screen.getByText(/already recorded/)).toBeTruthy());
  });

  it("records a one-at-a-time clash and says so, rather than refusing", async () => {
    // Usually a mistake, sometimes a story: a disputed throne, a marriage
    // nobody annulled. The app is not entitled to decide which.
    mockApi({ warnings: ["'seat of' allows one at a time, and there are 2."] });
    await open();
    await connectWith("Pathicus", "worships");
    await waitFor(() =>
      expect(screen.getByText(/allows one at a time/)).toBeTruthy());
    expect(screen.getByText(/recorded either way/)).toBeTruthy();
  });

  it("marks a one-at-a-time connection before it is chosen", async () => {
    // Worth knowing BEFORE choosing, and an option cannot carry a second line
    // the way the old buttons could -- so it goes in the label.
    mockApi({ relations: {
      forward: [{ ...WORSHIPS, cardinality: "one" }], reverse: [], available: [],
    } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions()).toContain("worships (one at a time)");
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

  it("asks the question at the top, from the entry it is asking about", async () => {
    // The same frame of reference as the walk: the writer can see where they
    // are standing before being asked what it connects to.
    await open();
    expect(screen.getByRole("heading",
      { name: /How is Daughters of Pathicus connected/ })).toBeTruthy();
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
    await pickRelation("__own__");
    expect(screen.getByLabelText("The other way round")).toBeTruthy();
    expect(screen.getByText("optional")).toBeTruthy();
  });

  it("says what happens without it", async () => {
    // So skipping it is an informed choice rather than a thing to regret.
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    expect(screen.getByText(/reads awkwardly when you/)).toBeTruthy();
  });

  it("sends it when given", async () => {
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
    await userEvent.type(screen.getByLabelText("Connection name"), "Race");
    await userEvent.type(screen.getByLabelText("The other way round"), "Race of");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posted("/relation").length).toBe(1));
    expect(posted("/relation")[0].body.inverse_label).toBe("Race of");
  });

  it("still works when it is left empty", async () => {
    await open();
    await chooseOther("Pathicus");
    await pickRelation("__own__");
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
  //
  // Under one dropdown this stopped needing its own button: leaving the picker
  // at "choose from ..." IS the untyped answer, and the single save button
  // records it either way. That is a better shape than the plain-button-plus-
  // list it replaced, because the writer never has to notice that the plain one
  // was a different KIND of control from the named ones.

  it("is what the picker starts on", async () => {
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect((relSelect() as HTMLSelectElement).value).toBe("");
  });

  it("says the LABEL can come later, so skipping it is not a loss", async () => {
    // What is optional MOVED. The relation label is the queryable half; the
    // reason is the useful half, and only one of them can be deferred.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.getByText(/worth more than the label below/)).toBeTruthy();
  });

  it("does not offer the plain one as a thing to choose", async () => {
    // It is the default, so listing it would be a second way to say the same
    // thing -- and "connected to" in a list beside "friend of" reads as a
    // relationship rather than as the absence of one.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(relOptions()).not.toContain("connected to");
  });

  it("records it with no relation chosen", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.rel).toBe("connected_to");
  });

  it("needs no separate section for the plain one any more", async () => {
    // It used to sit above a headed list of named relations, which meant the
    // writer had to notice that the plain one was a different KIND of control.
    // One dropdown with a default removed the distinction entirely.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [],
                           available: [] } });
    await open();
    await chooseOther("Pathicus");
    expect(screen.queryByText(/or give it a label too/)).toBeNull();
    // One save action on screen, not one per relation.
    expect(screen.getAllByRole("button", { name: /^Record it$/ })).toHaveLength(1);
  });

  it("adopts it quietly when an older project lacks it", async () => {
    // types.json is the writer's own file, so an older project simply does not
    // have it. Recording a connection must not turn into a lecture.
    mockApi({ relations: { forward: [], reverse: [], available: [PLAIN] } });
    await open();
    await chooseOther("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
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
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
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

    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());

    // Made on the spot, and still needs a reason -- the point of making it here
    // was to keep the thought, not to skip the part that reaches AI.
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "The clan they answer to");
    await pickRelation("worships");
    await recordIt();
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


describe("the likely answers come first", () => {
  // Reported after the first version offered the whole world alphabetically:
  //
  //     "3 profiles and 1 location appear in a list."
  //
  // Asking the question is half the job. The prose already knows who the
  // likely answers are -- it keeps putting them in the same scene -- and that
  // costs nothing to count. Each row says how many, because a suggestion that
  // cannot show its reasoning is a guess with better manners.

  it("puts whoever shares most scenes at the top", async () => {
    await open({ likely: [{ entity_id: "e-pathicus", scenes: 9 },
                          { entity_id: "e-faith", scenes: 2 }] });
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    const rows = screen.getAllByRole("button")
      .map(b => b.textContent ?? "")
      .filter(t => t.includes("scenes together"));
    expect(rows[0]).toMatch(/Pathicus/);
    expect(rows[0]).toMatch(/9 scenes together/);
  });

  it("says how many scenes on the row itself", async () => {
    await open({ likely: [{ entity_id: "e-faith", scenes: 4 }] });
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    expect(screen.getByRole("button", { name: /4 scenes together/ })).toBeTruthy();
  });

  it("counts one scene in the singular", async () => {
    await open({ likely: [{ entity_id: "e-faith", scenes: 1 }] });
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    expect(screen.getByRole("button", { name: /1 scene together/ })).toBeTruthy();
  });

  it("says nothing about entries the prose never shares a scene with", async () => {
    // Silence is the honest answer. A "0 scenes together" badge on every other
    // row would read as a verdict rather than an absence of evidence.
    await open({ likely: [{ entity_id: "e-faith", scenes: 3 }] });
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    expect(screen.queryByText(/0 scenes together/)).toBeNull();
  });

  it("still lists everything, so the short list is a shortcut not a filter", async () => {
    await open({ likely: [{ entity_id: "e-faith", scenes: 3 }] });
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    expect(screen.getByRole("button", { name: /^Pathicus/ })).toBeTruthy();
  });

  it("works with no short list at all", async () => {
    // A brand new book has no manuscript to count. The picker is the same
    // picker, just alphabetical.
    await open();
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    expect(screen.queryByText(/scenes together/)).toBeNull();
  });
});

describe("why they are connected", () => {
  // THE FIELD THAT REDIRECTED THE FEATURE.
  //
  // The app could already record that two entries are connected. What it could
  // not record was the only part worth sending to a model:
  //
  //     Alexandra -- connected to -- Dean               a name, and nothing else
  //     Alexandra -- is hiding her theft from -- Dean   the scene
  //
  // The Weave exists so a writer can ask AI for help without pasting profiles
  // and explaining context. Measured against that, a bare edge is a cost with
  // no benefit -- it spends brief budget to say two people exist near each
  // other, which the prose already shows. So the reason is required, and it is
  // asked BEFORE the relation label, which is the half a model could have
  // guessed.

  const PLAIN = { id: "connected_to", label: "connected to", symmetric: true,
                  cardinality: "many", inverse_label: "", flipped: false,
                  universal: true };

  /** Pick an end WITHOUT typing a reason, which the shared helper does. */
  async function pickOnly(name: string) {
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp("^" + name) }));
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
  }

  it("asks for it before offering any label", async () => {
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    const text = screen.getByTestId("tie-editor").textContent ?? "";
    expect(text.indexOf("In one line, why?"))
      .toBeLessThan(text.indexOf("Record it as"));
  });

  it("records nothing until it is written", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
    expect(posted("/tie").length).toBe(0);
  });

  it("says WHY it is required, not merely that it is", async () => {
    // "Required" reads as bureaucracy. The writer needs to know this sentence
    // is the thing that reaches AI.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    expect(screen.getByText(/tells AI less than the prose already does/))
      .toBeTruthy();
    expect(screen.getByText(/what gets sent to AI when you ask for help/))
      .toBeTruthy();
  });

  it("sends it with the connection", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "The order they founded to worship him");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.reason)
      .toBe("The order they founded to worship him");
  });

  it("is a single-line input, not a textarea", async () => {
    // A textarea invites paragraphs. The shape of the box teaches the rule
    // before any counter has to scold anyone -- and a wordy reason does not
    // just read badly, it gets pruned out of the brief the writer wanted it in.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    expect(screen.getByLabelText("Why they are connected").tagName).toBe("INPUT");
  });

  it("takes its limit from the BACKEND, never a copy of its own", async () => {
    // A number duplicated in the frontend is how silent truncation ships: the
    // box lets them type 200 and the server keeps 140.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [],
                           reason_limit: 90 } });
    await open();
    await pickOnly("Pathicus");
    expect(screen.getByLabelText("Why they are connected")
      .getAttribute("maxLength")).toBe("90");
  });

  it("warns as the room runs out, and not before", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [],
                           reason_limit: 40 } });
    await open();
    await pickOnly("Pathicus");
    const box = screen.getByLabelText("Why they are connected");
    await userEvent.type(box, "short");
    expect(screen.queryByText(/left$/)).toBeNull();
    await userEvent.type(box, "aaaaaaaaaaaaaaaaaaaa");
    expect(screen.getByText(/left$/)).toBeTruthy();
  });

  it("offers the other side without demanding it", async () => {
    // "Alexandra is hiding her theft from Dean" does not reverse cleanly. But a
    // writer mid-thought should not be made to answer twice, so it is a link
    // rather than a second required box.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    expect(screen.queryByLabelText("Why, from the other side")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /reads differently/ }));
    expect(screen.getByLabelText("Why, from the other side")).toBeTruthy();
  });

  it("sends the other side when it is given", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "They founded the order that worships him");
    await userEvent.click(screen.getByRole("button", { name: /reads differently/ }));
    await userEvent.type(screen.getByLabelText("Why, from the other side"),
                         "The god they were founded to serve");
    await userEvent.click(screen.getByRole("button", { name: /Record it/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    expect(posted("/tie")[0].body.reason_inverse)
      .toBe("The god they were founded to serve");
  });

  it("swaps the two reasons when the relation is stored the other way round", async () => {
    // A flipped relation is stored from the OTHER end. If the reasons did not
    // travel with it, the connection would read backwards for the rest of the
    // book.
    const FLIPPED = { id: "worshipped_by", label: "worshipped by",
                      symmetric: false, cardinality: "many",
                      inverse_label: "worships", flipped: true, group: "Belief" };
    mockApi({ relations: { forward: [], reverse: [FLIPPED], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "They worship him");
    await userEvent.click(screen.getByRole("button", { name: /reads differently/ }));
    await userEvent.type(screen.getByLabelText("Why, from the other side"),
                         "He is worshipped by them");
    await pickRelation("worshipped_by");
    await recordIt();
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    const body = posted("/tie")[0].body;
    expect(body.src_id).toBe("e-pathicus");
    expect(body.reason).toBe("He is worshipped by them");
    expect(body.reason_inverse).toBe("They worship him");
  });

  it("starts empty for the next connection", async () => {
    // A reason left in the box would be recorded against the wrong pair.
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "The order that worships him");
    await userEvent.click(screen.getByRole("button", { name: /^Record it$/ }));
    await waitFor(() => expect(posted("/tie").length).toBe(1));
    // Through the flow the writer actually walks now: the picker is behind the
    // "anyone else?" question rather than sitting open.
    await userEvent.click(screen.getByRole("button", { name: /make another/ }));
    await userEvent.click(screen.getByRole("button", { name: /^The Faith/ }));
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
    expect((screen.getByLabelText("Why they are connected") as HTMLInputElement)
      .value).toBe("");
  });
});

describe("finishing the connection", () => {
  // REPORTED FROM LIVE TESTING, and it stopped the feature dead:
  //
  //     "I attempted to connect Alexandra to Lara Croft, I clicked Lara's
  //      profile, then wrote a brief 'ran into and quickly became friends and
  //      partners to' and wrote the reverse for Lara to Alexandra. None of the
  //      options below were clickable, there was no 'accept' or 'save' or any
  //      means to move foreward."
  //
  // Two causes, and every test in this file passed through both of them.
  //
  // The first: the editor finds its primary button with `find(r => r.universal)`
  // and the BACKEND NEVER SENT `universal`. So `plain` was always undefined, no
  // save button ever rendered, and the fixtures here hid it by setting the flag
  // themselves -- a mock more generous than the API it stood for. The guard for
  // that lives in the backend, where the field is: see
  // test_the_plain_connection_is_marked_as_such in test_codex_routes.py.
  //
  // The second is here: the relation rows WERE clickable, but a borderless line
  // of text reading "Alexandra mentored by Lara Croft" reads as a label, not a
  // button. And they fired with no reason typed, which the server then refused.

  const PLAIN = { id: "connected_to", label: "connected to", symmetric: true,
                  cardinality: "many", inverse_label: "", flipped: false,
                  universal: true };

  async function pickOnly(name: string) {
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp("^" + name) }));
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
  }

  it("gives a way to finish once the reason is written", async () => {
    // The whole report in one assertion: something to press, and it works.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "Ran into her and quickly became partners");
    const save = screen.getByRole("button", { name: /Record it/ });
    expect(save.hasAttribute("disabled")).toBe(false);
    await userEvent.click(save);
    await waitFor(() => expect(posted("/tie").length).toBe(1));
  });

  it("finds the plain option even when the world does not have it yet", async () => {
    // An older project's types.json predates connected_to, so it arrives under
    // "available" instead of "forward". Without this fallback the only writers
    // with a save button would be the ones who started a project this week.
    mockApi({ relations: { forward: [WORSHIPS], reverse: [],
                           available: [PLAIN] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"), "Partners");
    expect(screen.getByRole("button", { name: /Record it/ }).hasAttribute("disabled")).toBe(false);
  });

  it("does not fire a relation the server would refuse", async () => {
    // Clicking a relation with no reason used to reach the backend and come
    // back a 400. Refusing locally says the same thing without the round trip.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await pickRelation("worships");
    expect(screen.getByRole("button", { name: /^Record it$/ })
      .hasAttribute("disabled")).toBe(true);
    expect(posted("/tie").length).toBe(0);
  });

  it("says what would wake the buttons up", async () => {
    // A disabled button with no explanation is the dead end the writer hit.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    expect(screen.getByText(/buttons below wake up/)).toBeTruthy();
  });

  it("stops saying it once the line is written", async () => {
    mockApi({ relations: { forward: [PLAIN], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"), "Partners");
    expect(screen.queryByText(/buttons below wake up/)).toBeNull();
  });

  it("wakes the save button once there is a reason, whatever is chosen", async () => {
    const FLIPPED = { id: "worshipped_by", label: "worshipped by",
                      symmetric: false, cardinality: "many",
                      inverse_label: "worships", flipped: true, group: "Belief" };
    mockApi({ relations: { forward: [], reverse: [FLIPPED], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await pickRelation("worshipped_by");
    const save = () => screen.getByRole("button", { name: /^Record it$/ });
    expect(save().hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "They worship him");
    expect(save().hasAttribute("disabled")).toBe(false);
  });
});

describe("after recording one, what next", () => {
  // REPORTED, and the gap it exposes is a RULE rather than a bug:
  //
  //     "I made the connection of Alexandra to Lara, wrote in both A -> L, then
  //      L -> A and even did both from the drop down menus and successfully
  //      recorded it. It brought me back to the 'How is Alexandra Langford
  //      connected?' screen with the new entry for: friend of -> Lara Croft. My
  //      immediate ask and problem now is, Now what? there is nothing to take me
  //      to the next page. Bringing me back to this page doesn't ask me anything
  //      or direct me to do something."
  //
  // And the rule, given as standing direction: "at all times there needs to be a
  // process flow that leads the writer to the next step after they do something
  // or make a decision. Continuous process for this walkthrough."
  //
  // A walkthrough is a sequence. Completing an action and then simply returning
  // has silently ended it. So: say what happened, then ask what is next, with
  // two named answers -- never one ambiguous Close.

  const PLAIN = { id: "connected_to", label: "connected to", symmetric: true,
                  cardinality: "many", inverse_label: "", flipped: false,
                  universal: true, group: "Other" };

  async function recordOne(relId?: string) {
    await chooseOther("Pathicus");
    if (relId) await pickRelation(relId);
    await userEvent.click(screen.getByRole("button", { name: /^Record it$/ }));
    await waitFor(() => expect(screen.getByTestId("what-next")).toBeTruthy());
  }

  it("says what was recorded, in the writer's own terms", async () => {
    // "Recorded" with nothing named reads as a system message rather than as an
    // account of the writer's own work.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] } });
    await open();
    await recordOne("worships");
    expect(screen.getByTestId("what-next").textContent)
      .toMatch(/Daughters of Pathicus worships Pathicus/);
  });

  it("reads it the way the writer chose it, not the way it is stored", async () => {
    // A flipped relation is stored from the other end. Reporting the storage
    // direction would describe something they did not do.
    const CONTAINS = { ...PART_OF, id: "contains", label: "contains",
                       inverse_label: "part of", flipped: true };
    mockApi({ relations: { forward: [], available: [], reverse: [CONTAINS] } });
    await open();
    await recordOne("contains");
    expect(screen.getByTestId("what-next").textContent)
      .toMatch(/Pathicus contains Daughters of Pathicus/);
  });

  it("asks the question rather than leaving the writer to guess", async () => {
    await open();
    await recordOne();
    expect(screen.getByText(
      /Would you like Daughters of Pathicus to connect to anyone or anything else/))
      .toBeTruthy();
  });

  it("offers making another, and reopens the picker", async () => {
    await open();
    await recordOne();
    await userEvent.click(screen.getByRole("button", { name: /make another/ }));
    expect(screen.getByLabelText("Find an entry")).toBeTruthy();
    expect(screen.queryByTestId("what-next")).toBeNull();
  });

  it("offers being finished, and ADVANCES the walk", async () => {
    // The half that was missing. Dismissing a panel back onto the same stop is
    // not the same as moving on, and the writer had no way to move on at all.
    const onDone = vi.fn();
    const onClose = vi.fn();
    await open({ onDone, onClose });
    await recordOne();
    await userEvent.click(screen.getByRole("button", { name: /No, I am good/ }));
    expect(onDone).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says what being finished WILL DO, inside a walk", async () => {
    // So leaving is a decision rather than a guess.
    await open({ onDone: vi.fn() });
    await recordOne();
    expect(screen.getByText(/takes you to the next thing in the walk/))
      .toBeTruthy();
  });

  it("closes instead when there is no walk to advance", async () => {
    // Opened from the map there is no next stop, and claiming one would lie.
    const onClose = vi.fn();
    await open({ onClose });
    await recordOne();
    expect(screen.getByText(/closes this and goes back/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /No, I am good/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not offer a bare Connect button beside the question", async () => {
    // Two ways to do the same thing, one of them unlabelled, is how the writer
    // ended up unsure which control was the next step.
    await open();
    await recordOne();
    expect(screen.queryByRole("button", { name: /Connect this to something/ }))
      .toBeNull();
  });

  it("shows nothing of the sort before anything is recorded", async () => {
    await open();
    expect(screen.queryByTestId("what-next")).toBeNull();
    expect(screen.getByRole("button", { name: /Connect this to something/ }))
      .toBeTruthy();
  });

  it("lists the new connection alongside the question", async () => {
    // The receipt says what happened; the list is the standing record. Both,
    // because the writer asked "now what" while looking at the list.
    mockApi({ relations: { forward: [PLAIN, WORSHIPS], reverse: [], available: [] },
              ties: [{ src_id: "e-daughters", dst_id: "e-pathicus",
                       rel: "worships", incoming: false, other_id: "e-pathicus",
                       other_name: "Pathicus", other_type: "deity",
                       reads_as: "worships", at: null, until: null,
                       at_label: "", until_label: "" }] });
    await open();
    await recordOne("worships");
    expect(screen.getByTestId("what-next")).toBeTruthy();
    expect(screen.getAllByText("Pathicus").length).toBeGreaterThan(1);
  });
});


describe("no path through the dialog can lock it", () => {
  // Reported shape: "Write my own", type a label, press Add with the reason
  // line still empty -- and every button in the dialog died. No error, no
  // spinner that ended, nothing responded; only X escaped. nameIt() set busy
  // with no finally, and its success path ended inside connect()'s silent
  // early-return for the missing reason, so busy stayed true forever.
  //
  // Two locks on that door now: Add sleeps until the reason line is written
  // (same gate, same amber hint as Record it), and nameIt clears busy on
  // every exit. And Record it with nothing to record says WHY instead of
  // doing nothing.

  async function pickOnly(name: string) {
    await userEvent.click(screen.getByRole("button",
      { name: /Connect this to something/ }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp("^" + name) }));
    await waitFor(() => expect(screen.getByTestId("relation-prompt")).toBeTruthy());
  }

  it("keeps Add asleep until the reason line is written", async () => {
    await open();
    await pickOnly("Pathicus");
    await pickRelation("__own__");
    await userEvent.type(screen.getByLabelText("Connection name"), "worships");
    const add = screen.getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled")).toBe(true);
    // The hint that explains the sleep covers this button too.
    expect(screen.getByText(/buttons below wake up/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "the Daughters pray to him");
    expect(add.hasAttribute("disabled")).toBe(false);
  });

  it("leaves every button alive after adding the name fails", async () => {
    // The busy flag has to clear on the error path, or the failure message
    // arrives on a dead screen.
    mockApi({ failRelation: "That name cannot be used." });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "the Daughters pray to him");
    await pickRelation("__own__");
    await userEvent.type(screen.getByLabelText("Connection name"), "worships");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/That name cannot be used/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled"))
      .toBe(false);
  });

  it("says why when Record it has nothing to record", async () => {
    // A world whose types.json predates the plain connection: no pick, no
    // universal fallback. The button used to press and do NOTHING -- no
    // request, no error -- which reads as the app being broken.
    mockApi({ relations: { forward: [WORSHIPS], reverse: [], available: [] } });
    await open();
    await pickOnly("Pathicus");
    await userEvent.type(screen.getByLabelText("Why they are connected"),
                         "the Daughters pray to him");
    await userEvent.click(screen.getByRole("button", { name: /^Record it$/ }));
    expect(await screen.findByText(/no plain connection to fall back on/))
      .toBeTruthy();
    expect(posted("/tie")).toEqual([]);
    // And the dialog is still alive to act on the advice.
    expect(screen.getByRole("button", { name: /^Record it$/ })
      .hasAttribute("disabled")).toBe(false);
  });
});


describe("a failed read ends the spinner", () => {
  it("shows the refusal instead of 'Reading connections...' forever", async () => {
    // A stale walk stop can open this editor on an entity absorbed after the
    // scan. The read refuses -- and the first version left the loading
    // spinner up permanently underneath the error, which read as a hang.
    mockApi({ failTiesRead: "That entry is not in this world." });
    await open();
    expect(await screen.findByText(/That entry is not in this world/))
      .toBeTruthy();
    expect(screen.queryByText(/Reading connections/)).toBeNull();
  });
});


describe("the reason line is shown back", () => {
  it("appears under the connection it explains", async () => {
    // It is the one REQUIRED field -- the writer was made to write it, and
    // the list used to render reads_as only, as if the app had thrown the
    // line away the moment it was recorded.
    mockApi({ ties: [{
      src_id: "e-daughters", dst_id: "e-pathicus", rel: "worships",
      incoming: false, other_id: "e-pathicus", other_name: "Pathicus",
      other_type: "deity", reads_as: "worships",
      why: "they believe he walks among them",
      at: null, until: null, at_label: "", until_label: "",
    }] });
    await open();
    expect(await screen.findByText(/they believe he walks among them/))
      .toBeTruthy();
  });
});
