// features/codex/RelationshipsSection.test.tsx
// ============================================
// The writer's own account of what this is for:
//
//     "A) provide the writer a foundation of how this character interacts with
//      this character from their point of view. B) AI can read and understand
//      that the relationship maybe mutual or very different depending on how
//      each character sees the other."
//
// And the example that decides the design: a teenage daughter "at odds with
// her mother for being restrictive, angsty, moody", while the mother's own
// page says "loving, maternal, caring, trying to control her out-of-control
// daughter". Both true, neither a belief, and each written where it belongs.
//
// THE FIRST VERSION OF THIS SECTION GOT IT WRONG by reusing the trait-block
// editor, which handed a relationship an IMPORTANCE dropdown. The objection
// was unanswerable -- "why would there be a need for Importance: Background
// for a relationship with her Mother Victoria" -- and the first test here is
// the fence around it.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as React from "react";

import { RelationshipsSection } from "./RelationshipsSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";
const KIPLING = "e-kip";

const RELATIONS = [
  { id: "parent_of", label: "parent of", group: "Family" },
  { id: "child_of", label: "child of", group: "Family" },
  { id: "sibling_of", label: "sibling of", group: "Family" },
  { id: "mentored_by", label: "mentored by", group: "Knows" },
  { id: "rivals", label: "rivals", group: "Against" },
];

const NODES = [
  { entity_id: KIPLING, name: "Kipling", type: "character",
    display_name: "", aliases: [], placeholder: false },
  { entity_id: "e-vic", name: "Victoria Chance", type: "character",
    display_name: "", aliases: [], placeholder: false },
  { entity_id: "e-mil", name: "Milton Buchanan", type: "character",
    display_name: "", aliases: [], placeholder: false },
  { entity_id: "e-aed", name: "Aedon", type: "character",
    display_name: "", aliases: [], placeholder: false },
  { entity_id: "e-manor", name: "Croft Manor", type: "location",
    display_name: "", aliases: [], placeholder: false },
];

const CHAPTERS = [
  { chapter_id: "f1", anchor: "c-1", title: "The Village" },
  { chapter_id: "f2", anchor: "c-2", title: "The Road" },
  { chapter_id: "f3", anchor: "c-3", title: "The Fall" },
];

let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(ties: Record<string, unknown>[] = [], opts: {
  failTie?: string;
} = {}) {
  calls = [];
  blocks = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method, body });

    if (url.includes("/api/codex/ties")) {
      return { ok: true, json: async () => ({ ties }) } as Response;
    }
    if (url.includes("/api/codex/relations")) {
      return { ok: true, json: async () => ({
        forward: RELATIONS, reverse: [], available: [], groups: [],
      }) } as Response;
    }
    if (url.includes("/api/codex/graph")) {
      return { ok: true, json: async () => ({ nodes: NODES, edges: [] }) } as Response;
    }
    if (url.includes("/api/codex/types")) {
      return { ok: true, json: async () => ({ types: [
        { id: "character", label: "Characters" },
        { id: "location", label: "Locations" },
        { id: "government", label: "Ruling Authorities" },
      ] }) } as Response;
    }
    if (url.includes("/api/codex/anchors")) {
      return { ok: true, json: async () => ({ chapters: CHAPTERS }) } as Response;
    }
    if (url.includes("/api/codex/tie")) {
      if (opts.failTie) {
        return { ok: false, json: async () => ({
          detail: { code: "tie_endpoint_invalid", message: opts.failTie },
        }) } as Response;
      }
      return { ok: true, json: async () => ({ created: true, warnings: [] }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

function tie(over: Record<string, unknown> = {}) {
  return {
    src_id: KIPLING, dst_id: "e-vic", rel: "parent_of", incoming: false,
    other_id: "e-vic", other_name: "Victoria Chance", other_type: "character",
    reads_as: "parent of", why: "her mother",
    description: "She resents her mother's self-preservation.",
    at: "", at_label: "", state: "in_force", in_force: true,
    ...over,
  };
}

let blocks: { trait: string; description: string; rel?: string }[] = [];

async function open(startBlocks = blocks) {
  blocks = startBlocks;
  const Harness = () => {
    const [held, setHeld] = React.useState(startBlocks);
    blocks = held;
    return (
      <RelationshipsSection projectPath={PROJECT} entityId={KIPLING}
                            entityType="character" entityName="Kipling"
                            blocks={held} onBlocksChange={setHeld} />
    );
  };
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByTestId("relationships-section")).toBeTruthy());
}


/** The boxes, addressed by what is in them rather than by position -- a test
 *  that indexes into the list re-points itself silently the moment the layout
 *  changes, which is how five of these broke when the Add button moved. */
const nameBoxes = () =>
  screen.queryAllByLabelText(
    /^Who .* has this relationship with/) as HTMLInputElement[];
const blankNameBox = () => nameBoxes().find(b => b.value === "")!;
const rowOf = (box: HTMLElement) => box.closest("li")!;
const reasonIn = (li: HTMLElement) =>
  li.querySelector("input[aria-label^='In one line']") as HTMLInputElement;


/** Open every recorded card. Recorded cards arrive CLOSED now -- a character
 *  with fourteen relationships should open as fourteen readable lines, not
 *  fourteen forms -- so a test about the editing controls has to ask for them
 *  first. Tests about the closed state deliberately do not call this. */
async function openAll() {
  const handles = screen.queryAllByLabelText(/^Open the relationship with/);
  for (const handle of handles) await userEvent.click(handle);
}

const posted = (method: string) =>
  calls.filter(c => c.method === method && c.url.includes("/api/codex/tie"));


// ── The control that was wrong ───────────────────────────────────────────────

describe("what the dropdown asks", () => {
  beforeEach(() => mockApi([tie()]));

  it("asks for the KIND of relationship, not its importance", async () => {
    await open();
    await openAll();
    const select = await screen.findByLabelText(
      /Kind of relationship with Victoria Chance/);
    expect(within(select).getByRole("option", { name: "parent of" })).toBeTruthy();
    expect(within(select).getByRole("option", { name: "mentored by" })).toBeTruthy();
  });

  it("offers no importance control anywhere", async () => {
    // The fence around the reported bug. "Importance: Background" for a
    // relationship with your mother is not a question worth asking.
    await open();
    expect(screen.queryByText(/Importance/i)).toBeNull();
    expect(screen.queryByRole("option", { name: /Background/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Contextual/i })).toBeNull();
  });

  it("takes its vocabulary from the world rather than a list in the code", async () => {
    await open();
    expect(calls.some(c => c.url.includes("/api/codex/relations"))).toBe(true);
  });

  it("lets the writer type a relationship the list does not have", async () => {
    await open();
    await openAll();
    const box = screen.getByLabelText(/Relationship wording with Victoria Chance/);
    await userEvent.clear(box);
    await userEvent.type(box, "sworn enemy of");
    expect((box as HTMLInputElement).value).toBe("sworn enemy of");
  });
});


// ── One row per relationship, from this character's side ─────────────────────

describe("a relationship on this character's page", () => {
  beforeEach(() => mockApi([tie()]));

  it("shows the other person, the kind, and the description", async () => {
    await open();
    await openAll();
    expect((screen.getByLabelText(
      /Who Kipling has this relationship with/) as HTMLInputElement).value)
      .toBe("Victoria Chance");
    expect((screen.getByLabelText(
      /What Victoria Chance is to Kipling/) as HTMLTextAreaElement).value)
      .toContain("resents her mother");
  });

  it("asks for the description from THIS character's side", async () => {
    // The whole point of B): the same pair reads differently from each end,
    // and a box that asked for a neutral summary would flatten that.
    await open();
    await openAll();
    // Carried by the field's own label and by the section's opening line. The
    // PLACEHOLDER is a worked example from a book everyone has read -- one
    // built from the writer's own names reads as a statement about them.
    expect(screen.getByLabelText(
      /What Victoria Chance is to Kipling/)).toBeTruthy();
    const intro = screen.getByTestId("relationships-section").textContent ?? "";
    expect(intro).toMatch(/Kipling['’]s own terms/);
  });

  it("does not show relationships recorded on the other person's page", async () => {
    // Those are THEIR reading of it. Showing them here as Kipling's would be
    // the app putting words in her mouth.
    mockApi([tie({ incoming: true, other_name: "Milton Buchanan",
                   other_id: "e-mil", why: "his student" })]);
    await open();
    expect(screen.queryByDisplayValue("Milton Buchanan")).toBeNull();
  });

  it("says that the other person can hold their own version", async () => {
    await open();
    await openAll();
    expect(screen.getByText(/can hold their own version/)).toBeTruthy();
  });
});


// ── The other end ────────────────────────────────────────────────────────────

describe("who the relationship is with", () => {
  beforeEach(() => mockApi());

  it("offers the writer's own entries in the picker", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    const picker = screen.getByLabelText(/Pick someone from this world/);
    expect(within(picker).getByRole("option",
                                    { name: "Victoria Chance" })).toBeTruthy();
    expect(within(picker).getByRole("option",
                                    { name: "Milton Buchanan" })).toBeTruthy();
  });

  it("does not offer the character themselves", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    const picker = screen.getByLabelText(/Pick someone from this world/);
    expect(within(picker).queryByRole("option",
                                      { name: "Kipling" })).toBeNull();
  });

  it("leaves the name box a plain box, not a second dropdown", async () => {
    // Reported as confusing: "I can manually type in the field, but its still
    // a dropdown AND it won't allow me to Record/save." Two dropdowns beside
    // each other, one of which was also a text box. The picker is the
    // dropdown; this is where the name ends up.
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(blankNameBox().getAttribute("list")).toBeNull();
    expect(document.querySelector("datalist")).toBeNull();
  });

  it("accepts a name that is not one of them, and says what that means", async () => {
    // "Former Partner", "Mother and Stepfather" -- real relationships with
    // nobody on the other end.
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getByLabelText(/Who Kipling has this relationship with/),
      "Former Partner");
    expect(screen.getByText(/kept on this page only/)).toBeTruthy();
  });

  it("says what a linked one gives you instead", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getByLabelText(/Who Kipling has this relationship with/),
      "Victoria Chance");
    expect(screen.getByText(/on the map/)).toBeTruthy();
  });
});


// ── Recording ────────────────────────────────────────────────────────────────

describe("recording one", () => {
  beforeEach(() => mockApi());

  async function fillARow(name = "Victoria Chance") {
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.selectOptions(
      screen.getByLabelText(/Kind of relationship/), "parent_of");
    await userEvent.type(
      screen.getByLabelText(/Who Kipling has this relationship with/), name);
    await userEvent.type(
      screen.getByLabelText(/In one line, why Kipling is connected/),
      "her mother");
    await userEvent.type(
      screen.getByLabelText(/is to Kipling/),
      "She resents her self-preservation.");
  }

  it("sends the relation, the other end and both descriptions", async () => {
    await open();
    await fillARow();
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));

    await waitFor(() => expect(posted("POST")).toHaveLength(1));
    const body = posted("POST")[0].body;
    expect(body.rel).toBe("parent_of");
    expect(body.dst_id).toBe("e-vic");
    expect(body.src_id).toBe(KIPLING);
    expect(body.reason).toBe("her mother");
    expect(body.description).toContain("resents her self-preservation");
  });

  it("refuses a row with no one-line reason, and says why it matters", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getByLabelText(/Who Kipling has this relationship with/),
      "Victoria Chance");
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/goes to AI every time/);
    expect(posted("POST")).toHaveLength(0);
  });

  it("keeps a typed-in name on the page instead of refusing it", async () => {
    // THE REPORTED BUG. "I'm trying to add the following relationship with
    // her parents, but they do not have a charcter profile and won't... it
    // won't allow me to Record/save."
    //
    // The offer was that a typed name is kept on this page. The storage for
    // that was never built, so the button just said no.
    await open();
    await fillARow("The Barksdale Family");
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));

    // Not sent as a connection -- there is no other end to connect to.
    await waitFor(() => expect(posted("POST")).toHaveLength(0));
    expect(screen.queryByRole("alert")).toBeNull();
    // Kept on the character, with the kind of relationship the writer chose.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].trait).toBe("The Barksdale Family");
    expect(blocks[0].rel).toBe("parent of");
    expect(blocks[0].description).toContain("resents her self-preservation");
  });

  it("still asks who it is with", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(blocks).toHaveLength(0);
  });

  it("surfaces a refusal from the backend rather than swallowing it", async () => {
    mockApi([], { failTie: "That connection is already recorded at c-1." });
    await open();
    await fillARow();
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
    expect(await screen.findByText(/already recorded/)).toBeTruthy();
  });

  it("says that a relationship saves on its own, not with the page", async () => {
    // Every other field on the profile page waits for Save. This does not,
    // because a relationship is a shared record -- and hiding that difference
    // would be worse than naming it.
    await open();
    expect(screen.getByText(/not with the rest of the page/)).toBeTruthy();
  });
});


// ── Stages across the book ───────────────────────────────────────────────────

describe("a relationship that changes across the book", () => {
  it("offers the writer's own chapters as a starting point", async () => {
    mockApi([tie()]);
    await open();
    await openAll();
    const select = screen.getByLabelText(/From when this relationship/);
    expect(within(select).getByRole("option",
                                    { name: /All the way through/ })).toBeTruthy();
    expect(within(select).getByRole("option", { name: /The Fall/ })).toBeTruthy();
  });

  it("holds several stages for the same person at once", async () => {
    // "chapter 1-6 Character A distrusts ... Chapters 7-20 more trusting ...
    // Chapters 21-36 fully developed" -- three rows on one pair.
    mockApi([
      tie({ rel: "rivals", reads_as: "rivals", at: "c-1",
            why: "cold and distrustful", description: "She will not be led." }),
      tie({ rel: "mentored_by", reads_as: "mentored by", at: "c-3",
            why: "she trusts him now", description: "A father-like mentor." }),
    ]);
    await open();
    await openAll();
    expect(screen.getByDisplayValue("cold and distrustful")).toBeTruthy();
    expect(screen.getByDisplayValue("she trusts him now")).toBeTruthy();
  });

  it("shows each stage's range, worked out from the next one", async () => {
    // The end is never stored: where one stage ends is where the next begins,
    // and storing both would give one fact two homes that can disagree.
    mockApi([
      tie({ rel: "rivals", reads_as: "rivals", at: "c-1", why: "cold" }),
      tie({ rel: "mentored_by", reads_as: "mentored by", at: "c-3",
            why: "trusting" }),
    ]);
    await open();
    await openAll();
    expect(screen.getByText(/1\. The Village to 2\. The Road/)).toBeTruthy();
    expect(screen.getByText(/from 3\. The Fall on/)).toBeTruthy();
  });

  it("calls an undated one true all the way through", async () => {
    mockApi([tie({ at: "" })]);
    await open();
    await openAll();
    expect(screen.getByText(/all the way through/)).toBeTruthy();
  });

  it("edits one stage without touching the others", async () => {
    // Editing goes through PATCH addressed by the anchor. Delete-and-recreate
    // used to take the siblings with it.
    mockApi([
      tie({ rel: "rivals", reads_as: "rivals", at: "c-1", why: "cold" }),
      tie({ rel: "mentored_by", reads_as: "mentored by", at: "c-3",
            why: "trusting" }),
    ]);
    await open();
    await openAll();
    const box = screen.getByDisplayValue("cold");
    await userEvent.type(box, " and guarded");
    const rows = screen.getAllByRole("button", { name: /^Update$/ });
    await userEvent.click(rows[0]);

    await waitFor(() => expect(posted("PATCH")).toHaveLength(1));
    const body = posted("PATCH")[0].body;
    expect(body.at).toBe("c-1");
    expect(body.reason).toContain("and guarded");
  });
});


// ── Removing ─────────────────────────────────────────────────────────────────

describe("removing one", () => {
  it("removes only that stage", async () => {
    mockApi([
      tie({ rel: "rivals", reads_as: "rivals", at: "c-1", why: "cold" }),
      tie({ rel: "mentored_by", reads_as: "mentored by", at: "c-3",
            why: "trusting" }),
    ]);
    await open();
    await openAll();
    await userEvent.click(screen.getAllByLabelText(/Remove the relationship/)[0]);
    await waitFor(() => expect(posted("DELETE")).toHaveLength(1));
    expect(posted("DELETE")[0].url).toContain("at=c-1");
  });

  it("drops an unsaved row without asking the server", async () => {
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.click(screen.getByLabelText(/Remove the relationship/));
    expect(posted("DELETE")).toHaveLength(0);
  });
});


// ── The empty state teaches the idea ────────────────────────────────────────

describe("an entry with none yet", () => {
  beforeEach(() => mockApi());

  it("explains what is being asked for, including the two-sided part", async () => {
    await open();
    await openAll();
    const text = screen.getByTestId("relationships-section").textContent ?? "";
    // Apostrophe class rather than a literal: the page renders a typographic
    // one (&rsquo;) and a straight-quote regex silently misses it.
    expect(text).toMatch(/Kipling['’]s (own terms|side)/);
    expect(text).toMatch(/completely different and still be true/);
  });

  it("offers the explanation panel", async () => {
    await open();
    expect(screen.getByRole("button", { name: /What.s this/i })).toBeTruthy();
  });
});


// ── THE REPORTED BUG ────────────────────────────────────────────────────────
//
//     "I added the first relationship of Milton onto Gwendolyn's profile. The
//      first one appeared fine. I clicked add a new relationship to add
//      kipling. When I clicked update, it appeared to erase Milton's
//      relationship and replaced it with Kiplings."
//
// The cause is not the save at all -- it is that the list re-sorted itself
// alphabetically ON EVERY KEYSTROKE. Typing "Kipling" into the new row at the
// bottom made that row jump ABOVE the recorded Milton row mid-word, so the
// button the writer reached for belonged to a different relationship than the
// one they had been filling in. Two rows swapping places under a cursor is not
// a save bug; it is the list moving while being used.
//
// Rows keep the order they were made in now. These tests are the fence.

describe("the reported bug: rows must not move while being used", () => {
  beforeEach(() => mockApi([tie({ other_name: "Milton Buchanan",
                                  other_id: "e-mil", why: "her party leader" })]));

  it("keeps a recorded row in place while a new one is being typed", async () => {
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));

    const before = nameBoxes().map(box => box.value);
    expect(before).toContain("Milton Buchanan");
    expect(before).toContain("");

    // A name that sorts BEFORE the existing one. This is what moved the rows.
    await userEvent.type(blankNameBox(), "Aedon");

    // Same rows, same positions -- only the value in one of them changed.
    const after = nameBoxes().map(box => box.value);
    expect(after).toEqual(before.map(v => (v === "" ? "Aedon" : v)));
  });

  it("records the row the writer was actually working in", async () => {
    // The consequence of the reorder: the writer pressed the button beside the
    // row they had just filled in, and it belonged to the other one.
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Aedon");
    const draft = rowOf(nameBoxes().find(b => b.value === "Aedon")!);
    await userEvent.type(reasonIn(draft), "her closest friend");

    await userEvent.click(
      within(draft).getByRole("button", { name: /^Record$/ }));

    await waitFor(() => expect(posted("POST")).toHaveLength(1));
    expect(posted("POST")[0].body.dst_id).toBe("e-aed");
    expect(posted("POST")[0].body.reason).toBe("her closest friend");
  });

  it("keeps an unsaved row when another one is recorded", async () => {
    // Reloading from the server after a save replaced the whole list, which
    // threw away anything half-typed beside it.
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Aedon");
    const draft = rowOf(nameBoxes().find(b => b.value === "Aedon")!);
    await userEvent.type(reasonIn(draft), "her closest friend");

    // Recording it reloads; the recorded row must come back and nothing else
    // may vanish.
    await userEvent.click(
      within(draft).getByRole("button", { name: /^Record$/ }));
    await waitFor(() => expect(posted("POST")).toHaveLength(1));
    expect(screen.getByDisplayValue("Milton Buchanan")).toBeTruthy();
  });

  it("does not put the delete button where the record button just was", async () => {
    // The likeliest way the writer lost Milton: the rows swapped, and the
    // control under the cursor was the other row's Remove.
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    const removes = screen.getAllByLabelText(/Remove the relationship/);
    await userEvent.type(blankNameBox(), "Aedon");
    const after = screen.getAllByLabelText(/Remove the relationship/);
    // Same buttons, same order. Nothing has been re-associated.
    expect(after[0]).toBe(removes[0]);
    expect(after[1]).toBe(removes[1]);
  });
});


describe("order", () => {
  it("lists rows in the order they were made, not alphabetically", async () => {
    mockApi([
      tie({ other_name: "Milton Buchanan", other_id: "e-mil", why: "first" }),
      tie({ other_name: "Aedon", other_id: "e-aed", why: "second" }),
      tie({ other_name: "Kipling", other_id: "e-kip", why: "third" }),
    ]);
    await open();
    await openAll();
    const reasons = screen.getAllByLabelText(/In one line, why/)
      .map(box => (box as HTMLInputElement).value);
    expect(reasons).toEqual(["first", "second", "third"]);
  });

  it("leaves the recorded ones alone when a draft is opened", async () => {
    // A draft opens above the Add button; the recorded list below it does not
    // move. (Where the draft goes is pinned by the layout tests.)
    mockApi([tie({ other_name: "Milton Buchanan", other_id: "e-mil",
                   why: "first" })]);
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(screen.getByDisplayValue("Milton Buchanan")).toBeTruthy();
    expect(screen.getByDisplayValue("first")).toBeTruthy();
  });

  it("closes the gap when one is removed", async () => {
    mockApi([
      tie({ other_name: "Milton Buchanan", other_id: "e-mil", why: "first" }),
      tie({ other_name: "Aedon", other_id: "e-aed", why: "second" }),
    ]);
    await open();
    await openAll();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    // Remove the draft; the recorded two keep their order and their places.
    const draft = rowOf(blankNameBox());
    await userEvent.click(
      within(draft).getByLabelText(/Remove the relationship/));
    const reasons = screen.getAllByLabelText(/In one line, why/)
      .map(box => (box as HTMLInputElement).value);
    expect(reasons).toEqual(["first", "second"]);
  });
});


describe("the relationship-type dropdown", () => {
  beforeEach(() => mockApi([tie()]));

  it("groups the list so a writer can skip to the right kind", async () => {
    await open();
    await openAll();
    const select = screen.getByLabelText(/Kind of relationship/);
    const groups = Array.from(select.querySelectorAll("optgroup"))
      .map(g => g.getAttribute("label"));
    expect(groups).toContain("Family");
    expect(groups).toContain("Against");
  });

  it("puts each relation under its own heading", async () => {
    await open();
    await openAll();
    const select = screen.getByLabelText(/Kind of relationship/);
    const family = Array.from(select.querySelectorAll("optgroup"))
      .find(g => g.getAttribute("label") === "Family");
    expect(family!.textContent).toContain("parent of");
    expect(family!.textContent).not.toContain("rivals");
  });

  it("puts a chosen kind into the box beside it", async () => {
    await open();
    await openAll();
    await userEvent.selectOptions(
      screen.getByLabelText(/Kind of relationship/), "mentored_by");
    expect((screen.getByLabelText(/Relationship wording/) as HTMLInputElement)
      .value).toBe("mentored by");
  });

  it("records a kind the writer typed that the world does not have yet", async () => {
    // "or they can simply write in that relationship type themselves"
    await open();
    await openAll();
    const box = screen.getByLabelText(/Relationship wording/);
    await userEvent.clear(box);
    await userEvent.type(box, "shieldbrother of");
    await userEvent.click(screen.getByRole("button", { name: /^Update$/ }));

    await waitFor(() => expect(
      calls.filter(c => c.method === "POST"
                     && c.url.includes("/api/codex/relation?") === false
                     && c.url.endsWith("/relation")).length).toBe(1));
    const minted = calls.find(c => c.url.endsWith("/relation")
                                && c.method === "POST");
    expect(minted!.body.label).toBe("shieldbrother of");
  });
});


describe("the who dropdown", () => {
  beforeEach(() => mockApi());

  it("groups the world by kind, with a heading for each", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    const select = screen.getByLabelText(/Pick someone from this world/);
    const groups = Array.from(select.querySelectorAll("optgroup"))
      .map(g => g.getAttribute("label"));
    expect(groups).toContain("Characters");
    expect(groups).toContain("Locations");
  });

  it("sorts each group A to Z", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    const select = screen.getByLabelText(/Pick someone from this world/);
    const characters = Array.from(select.querySelectorAll("optgroup"))
      .find(g => g.getAttribute("label") === "Characters");
    const names = Array.from(characters!.querySelectorAll("option"))
      .map(o => o.textContent);
    expect(names).toEqual([...names].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("inserts the chosen one into the box beside it", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.selectOptions(
      screen.getByLabelText(/Pick someone from this world/), "e-vic");
    const box = screen.getAllByLabelText(
      /^Who .* has this relationship with/)[0] as HTMLInputElement;
    expect(box.value).toBe("Victoria Chance");
  });

  it("still takes a name that will never be a profile", async () => {
    // The writer's case: a deceased lover from before the story who is spoken
    // about and never appears. Real to the character, never an entry.
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getAllByLabelText(/^Who .* has this relationship with/)[0],
      "Ninel of the Reeds");
    expect(screen.getByText(/kept on this page only/)).toBeTruthy();
  });
});


// ── Where the control and the new card sit ───────────────────────────────────
//
// Asked for exactly:
//
//     [+ Add a relationship]
//     [1st card if present]
//     [2nd card if present]
//
//     After clicking add a relationship button.
//     [Blank new entry card writer fills in]
//     [+ Add a relationship]
//     [1st card if present]
//
// The reason it matters more than it looks: a writer adding their fifth
// relationship should not have to scroll past four to reach the button, and
// the card they just opened should be where they were already looking.

function order(): string[] {
  const section = screen.getByTestId("relationships-section");
  const marks: string[] = [];
  section.querySelectorAll("li, button").forEach(node => {
    if (node.tagName === "LI") {
      const box = node.querySelector("input[aria-label^='Who ']") as HTMLInputElement | null;
      if (box) {
        marks.push(`card:${box.value || "blank"}`);
      } else {
        // Closed: its name is the first line of the one-line summary.
        const line = node.querySelector("span.block");
        marks.push(`card:${line?.textContent?.split("(")[0].trim() || "?"}`);
      }
    } else if (/Add a relationship/.test(node.textContent ?? "")) {
      marks.push("add");
    }
  });
  return marks;
}

describe("the layout of the section", () => {
  it("puts the Add button above the cards", async () => {
    mockApi([
      tie({ other_name: "Milton Buchanan", other_id: "e-mil", why: "first" }),
      tie({ other_name: "Aedon", other_id: "e-aed", why: "second" }),
    ]);
    await open();
    expect(order()).toEqual([
      "add", "card:Milton Buchanan", "card:Aedon",
    ]);
  });

  it("opens a new blank card ABOVE the button", async () => {
    mockApi([tie({ other_name: "Milton Buchanan", other_id: "e-mil" })]);
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(order()).toEqual([
      "card:blank", "add", "card:Milton Buchanan",
    ]);
  });

  it("stacks a second blank card directly above the button", async () => {
    // Which is where the writer just clicked, so the newest draft is always
    // next to the control that made it.
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getAllByLabelText(/^Who .* has this relationship with/)[0], "Aedon");
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(order()).toEqual(["card:Aedon", "card:blank", "add"]);
  });

  it("shows the button with nothing recorded yet", async () => {
    mockApi();
    await open();
    expect(order()).toEqual(["add"]);
  });

  it("files a recorded card below the button with the rest", async () => {
    // The move is the confirmation: it has stopped being a draft and become a
    // shared record.
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(
      screen.getAllByLabelText(/^Who .* has this relationship with/)[0], "Aedon");
    await userEvent.type(
      screen.getAllByLabelText(/In one line, why/)[0], "her closest friend");
    expect(order()).toEqual(["card:Aedon", "add"]);
  });
});


// ── The transaction ends when it is recorded ─────────────────────────────────
//
//     "once the writer clicks [Record] button, the add a relationship card
//      meant for that latest character needs to disapear and potentially
//      cleared as the entry was added below."
//
// Add, fill in, record, done. Without this the writer saw the same
// relationship twice -- the real one filed below the button, and the draft
// they had just filled in still sitting above it, which reads as "it did not
// save" and invites pressing Record again.

describe("finishing one", () => {
  it("clears the draft card once it is recorded", async () => {
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Aedon");
    const draft = rowOf(nameBoxes().find(b => b.value === "Aedon")!);
    await userEvent.type(reasonIn(draft), "her closest friend");
    await userEvent.click(within(draft).getByRole("button", { name: /^Record$/ }));

    await waitFor(() => expect(posted("POST")).toHaveLength(1));
    // No draft left above the button, and no second copy of the same person.
    await waitFor(() => expect(nameBoxes().length).toBe(0));
    expect(screen.queryByRole("button", { name: /^Record$/ })).toBeNull();
  });

  it("keeps a DIFFERENT half-typed card while one is recorded", async () => {
    // Only the card that was recorded goes. Anything else the writer had
    // started stays exactly where it was.
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Aedon");
    const draft = rowOf(nameBoxes().find(b => b.value === "Aedon")!);
    await userEvent.type(reasonIn(draft), "her closest friend");

    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Croft Manor");

    await userEvent.click(within(draft).getByRole("button", { name: /^Record$/ }));
    await waitFor(() => expect(posted("POST")).toHaveLength(1));
    expect(screen.getByDisplayValue("Croft Manor")).toBeTruthy();
    expect(screen.queryByDisplayValue("Aedon")).toBeNull();
  });

  it("opens a clean card the next time, not the last one again", async () => {
    mockApi();
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    await userEvent.type(blankNameBox(), "Aedon");
    const draft = rowOf(nameBoxes().find(b => b.value === "Aedon")!);
    await userEvent.type(reasonIn(draft), "her closest friend");
    await userEvent.click(within(draft).getByRole("button", { name: /^Record$/ }));
    await waitFor(() => expect(posted("POST")).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(nameBoxes().map(b => b.value)).toEqual([""]);
  });
});


// ── Reading a page full of them ──────────────────────────────────────────────

describe("cards a writer has already recorded", () => {
  const TWO = [
    tie({ other_id: "e-kip", other_name: "Kipling", rel: "close_friend_of",
          reads_as: "close friend of", at: "",
          why: "her closest friend in the party",
          description: "They quickly become friends when Kipling refuses to be talked down to." }),
    tie({ other_id: "e-mil", other_name: "Milton Buchanan", rel: "partners_with",
          reads_as: "dungeon diving partners with", at: "c-2",
          why: "years of expeditions together",
          description: "Has known and worked with Milton longer than anyone else in the party." }),
  ];

  it("opens with them closed, one readable line each", async () => {
    mockApi(TWO);
    await open();
    // Closed: no editing controls on screen at all.
    expect(nameBoxes().length).toBe(0);
    expect(screen.getByText("Kipling")).toBeTruthy();
    expect(screen.getByText("Milton Buchanan")).toBeTruthy();
  });

  it("shows who they are to this character on the closed card", async () => {
    mockApi(TWO);
    await open();
    expect(screen.getByText(/\(close friend of\)/)).toBeTruthy();
    expect(screen.getByText(/\(dungeon diving partners with\)/)).toBeTruthy();
  });

  it("shows the start of the description", async () => {
    mockApi(TWO);
    await open();
    expect(screen.getByText(/They quickly become friends/)).toBeTruthy();
  });

  it("marks one that holds all the way through", async () => {
    mockApi(TWO);
    await open();
    expect(screen.getByText("(full)")).toBeTruthy();
  });

  it("lists the chapters a later stage covers", async () => {
    mockApi(TWO);
    await open();
    // Starts at chapter 2, nothing supersedes it, three chapters in the book.
    expect(screen.getByText("2,3")).toBeTruthy();
  });

  it("ends a stage where the next one on the same pair begins", async () => {
    mockApi([
      tie({ other_id: "e-mil", other_name: "Milton Buchanan", at: "c-1",
            why: "wary of him" }),
      tie({ other_id: "e-mil", other_name: "Milton Buchanan", at: "c-3",
            why: "trusts him now" }),
    ]);
    await open();
    expect(screen.getByText("1,2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("opens one when its line is clicked, and closes it again", async () => {
    mockApi(TWO);
    await open();
    await userEvent.click(
      screen.getByLabelText(/Open the relationship with Kipling/));
    expect(screen.getByDisplayValue("her closest friend in the party")).toBeTruthy();

    await userEvent.click(
      screen.getByLabelText(/Close the relationship with Kipling/));
    expect(screen.queryByDisplayValue("her closest friend in the party")).toBeNull();
  });

  it("leaves the others closed when one is opened", async () => {
    mockApi(TWO);
    await open();
    await userEvent.click(
      screen.getByLabelText(/Open the relationship with Kipling/));
    expect(nameBoxes().map(b => b.value)).toEqual(["Kipling"]);
  });

  it("keeps a draft open while the recorded ones stay closed", async () => {
    mockApi(TWO);
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Add a relationship/ }));
    expect(nameBoxes().map(b => b.value)).toEqual([""]);
  });
});


// ── A relationship with nobody on the other end ──────────────────────────────
//
//     "I'm trying to add the following relationship with her parents, but they
//      do not have a charcter profile and won't."
//
// Real, and unrecordable as a connection: a Tie needs two ends that exist. It
// is kept on the character's own page instead -- their parents, a guild, the
// Barksdale Family, someone dead before page one. No map, no other side, and
// no reason it should be lost.

const FAMILY = [{ trait: "The Barksdale Family", rel: "child of",
                  description: "Gwen left them and does not talk about why." }];

describe("relationships kept on the page", () => {
  beforeEach(() => mockApi());

  it("shows one that is already there", async () => {
    await open([...FAMILY]);
    await openAll();
    expect(screen.getByDisplayValue("The Barksdale Family")).toBeTruthy();
    expect(screen.getByDisplayValue("child of")).toBeTruthy();
    expect(screen.getByDisplayValue(/does not talk about why/)).toBeTruthy();
  });

  it("says it lives on this page and why that is different", async () => {
    await open([...FAMILY]);
    await openAll();
    expect(screen.getByText(/kept on Kipling.s page/)).toBeTruthy();
    expect(screen.getByText(/not on the\s+map/)).toBeTruthy();
  });

  it("offers no Record button, because it saves with the page", async () => {
    // A button claiming to record it would be the second thing on this screen
    // to promise something it does not do.
    await open([...FAMILY]);
    await openAll();
    expect(screen.queryByRole("button", { name: /^Record$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Update$/ })).toBeNull();
  });

  it("edits in place", async () => {
    await open([...FAMILY]);
    await openAll();
    await userEvent.type(
      screen.getByDisplayValue("The Barksdale Family"), " of Bree");
    expect(blocks[0].trait).toBe("The Barksdale Family of Bree");
  });

  it("removes without asking the server", async () => {
    await open([...FAMILY]);
    await openAll();
    await userEvent.click(screen.getByLabelText(/Remove the relationship/));
    expect(blocks).toHaveLength(0);
    expect(posted("DELETE")).toHaveLength(0);
  });

  it("collapses like the rest", async () => {
    await open([...FAMILY]);
    expect(nameBoxes().length).toBe(0);
    expect(screen.getByText("The Barksdale Family")).toBeTruthy();
    expect(screen.getByText(/\(child of\)/)).toBeTruthy();
  });

  it("sits in the same list as the recorded connections", async () => {
    mockApi([tie({ other_name: "Milton Buchanan", other_id: "e-mil" })]);
    await open([...FAMILY]);
    expect(screen.getByText("Milton Buchanan")).toBeTruthy();
    expect(screen.getByText("The Barksdale Family")).toBeTruthy();
  });

  it("keeps the two kinds apart where it matters", async () => {
    // One can be opened from the other end and drawn; the other cannot. The
    // writer sees one list; the app knows the difference.
    mockApi([tie({ other_name: "Milton Buchanan", other_id: "e-mil" })]);
    await open([...FAMILY]);
    await openAll();
    expect(screen.getByText(/linked -- on the map/)).toBeTruthy();
    expect(screen.getByText(/kept on Kipling.s page/)).toBeTruthy();
  });
});
