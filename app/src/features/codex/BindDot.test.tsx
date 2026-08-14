// features/codex/BindDot.test.tsx
// ===============================
// The screen where a writer says "Lexa means Alexandra Langford".
//
// THE OBJECTION THESE TESTS EXIST FOR
// -----------------------------------
// Raised in review, about calling this a merge: "if the Alexandra Langford dot
// gets scrubbed/removed/deleted without a direct tie in, they might
// immediately associate that the Dot being deleted means the profile itself is
// removed."
//
// So the wording is load-bearing, not decoration. Nothing here says merge,
// delete, or remove-the-entry. What it says is that a WORD moved, that every
// mention of it now finds her, and that her own entry was not touched. These
// tests assert that, because it is the difference between a writer trusting
// the operation and being frightened by it.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BindDot } from "./BindDot";
import type { GraphNode } from "./api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function node(over: Partial<GraphNode> & { entity_id: string; name: string }): GraphNode {
  return {
    type: "character", display_name: "", aliases: [], placeholder: false,
    ...over,
  };
}

const STUB = node({ entity_id: "e-lexa", name: "Lexa", placeholder: true });
const ALEX = node({ entity_id: "e-alex", name: "Alexandra Langford" });
const MOOR = node({ entity_id: "e-moor", name: "Ravensmoor", type: "location" });
const OTHER_STUB = node({ entity_id: "e-drea", name: "Drea", placeholder: true });

let posted: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(result: Record<string, unknown> | null = null, fail = false) {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(input),
                  body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (fail) {
      return {
        ok: false,
        json: async () => ({ detail: {
          code: "entity_not_empty",
          message: "'Lexa' has writing in it, so its word cannot simply be moved.",
        } }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => result ?? {
        entity_id: "e-alex", name: "Alexandra Langford", display_name: "",
        aliases: ["Lexa"], absorbed: ["Lexa"], removed_placeholder: "Lexa",
      },
    } as Response;
  }));
}

beforeEach(() => mockApi());

function open(props: Partial<Parameters<typeof BindDot>[0]> = {}) {
  const onClose = vi.fn();
  const onBound = vi.fn();
  render(<BindDot projectPath={PROJECT} dot={STUB}
                  candidates={[ALEX, MOOR, OTHER_STUB, STUB]}
                  onClose={onClose} onBound={onBound} {...props} />);
  return { onClose, onBound };
}

async function pick(name: string) {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
}


describe("choosing what it is", () => {
  it("asks the question in the writer's terms", async () => {
    open();
    expect(screen.getByRole("dialog", { name: /What is Lexa/ })).toBeTruthy();
  });

  it("explains why a placeholder exists at all", async () => {
    // Otherwise a map full of dots the writer did not make looks like a bug.
    open();
    expect(screen.getByText(/found this word in your writing/)).toBeTruthy();
  });

  it("promises up front that the entry does not change", async () => {
    open();
    expect(screen.getByText(/nothing in that entry changes/)).toBeTruthy();
  });

  it("offers established entries", async () => {
    open();
    expect(screen.getByRole("button", { name: /Alexandra Langford/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ravensmoor/ })).toBeTruthy();
  });

  it("does not offer other bare dots", async () => {
    // Pointing a placeholder at a placeholder leaves the writer no further
    // forward, and makes a chain nobody asked for.
    open();
    expect(screen.queryByRole("button", { name: /^Drea/ })).toBeNull();
  });

  it("does not offer itself", async () => {
    open();
    const list = screen.getByRole("dialog");
    expect(within(list).queryByRole("button", { name: /^Lexa$/ })).toBeNull();
  });

  it("offers any kind, not just the same kind", async () => {
    // "Cambridge", "Cambridge Library" and "Library" are one location; the app
    // has no idea which kind a bare word was meant to be, so it does not
    // pretend to.
    open();
    expect(screen.getByRole("button", { name: /Ravensmoor/ })).toBeTruthy();
  });

  it("can be searched, including by the words an entry already answers to", async () => {
    open({ candidates: [node({ entity_id: "e-alex", name: "Alexandra Langford",
                               aliases: ["Lexi"] }), MOOR] });
    await userEvent.type(screen.getByLabelText("Find an entry"), "lexi");
    expect(screen.getByRole("button", { name: /Alexandra Langford/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ravensmoor/ })).toBeNull();
  });

  it("says so when there is nothing to point it at yet", async () => {
    open({ candidates: [STUB, OTHER_STUB] });
    expect(screen.getByText(/no entries to point this at yet/)).toBeTruthy();
  });

  it("names the way forward instead of leaving a greyed button", async () => {
    // REPORTED AS A DEAD END:
    //
    //     "There is a character referenced that is noted in the manuscript. But
    //      no profile or entry to link/connect them too. It brings up a search
    //      feature but the Find Connection never ungreys or becomes clickable."
    //
    // The way out was already on screen -- "It is its own thing" -- but it read
    // as a rejection rather than as the answer, while the only thing that
    // looked like a next step sat greyed out. Nothing matching is usually the
    // ANSWER for a name the prose has and the world does not.
    open({ candidates: [STUB, OTHER_STUB] });
    expect(screen.getByText(/most likely its own thing/)).toBeTruthy();
  });

  it("offers that answer as something to click, right there", async () => {
    open({ candidates: [STUB, OTHER_STUB] });
    const inline = screen.getAllByRole("button", { name: /It is its own thing/ });
    expect(inline.length).toBeGreaterThan(1);   // in the message AND the footer
    await userEvent.click(inline[0]);
    expect(screen.getByLabelText("What kind")).toBeTruthy();
  });

  it("says what the greyed button is waiting for", async () => {
    open();
    expect(screen.getByRole("button", { name: /Pick an entry above/ })).toBeTruthy();
  });

  it("treats being its own thing as a real answer, not a failure", async () => {
    // Some things are genuinely their own entry -- and usually under a fuller
    // name than the prose happened to use.
    open();
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    expect(screen.getByLabelText("What kind")).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it("will not act until something is chosen", async () => {
    open();
    expect(screen.getByRole("button", { name: /Pick an entry/ })
      .hasAttribute("disabled")).toBe(true);
  });

  it("names the consequence on the button itself", async () => {
    open();
    await pick("Alexandra Langford");
    expect(screen.getByRole("button", { name: /"Lexa" means Alexandra Langford/ }))
      .toBeTruthy();
  });
});


describe("the label, which is not the name", () => {
  it("is only offered once there is a choice to make", async () => {
    open();
    expect(screen.queryByText(/Call them/)).toBeNull();
    await pick("Alexandra Langford");
    expect(screen.getByText(/Call them/)).toBeTruthy();
  });

  it("says the entry keeps its own name either way", async () => {
    // The whole point: Alexandra Langford stays Alexandra Langford, and the
    // map says Lexa because that is what the story says.
    open();
    await pick("Alexandra Langford");
    expect(screen.getByText(/Their entry stays Alexandra Langford/)).toBeTruthy();
  });

  it("is off unless asked for", async () => {
    open();
    await pick("Alexandra Langford");
    await userEvent.click(screen.getByRole("button", { name: /"Lexa" means/ }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].body.as_label).toBe(false);
  });

  it("is sent when asked for", async () => {
    open();
    await pick("Alexandra Langford");
    await userEvent.click(screen.getByText(/Call them/));
    await userEvent.click(screen.getByRole("button", { name: /"Lexa" means/ }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].body.as_label).toBe(true);
  });
});


describe("what it says afterwards", () => {
  async function bind(result?: Record<string, unknown>) {
    mockApi(result);
    const handles = open();
    await pick("Alexandra Langford");
    await userEvent.click(screen.getByRole("button", { name: /"Lexa" means/ }));
    await waitFor(() =>
      expect(screen.getByText(/now means/)).toBeTruthy());
    return handles;
  }

  it("says the word MOVED, never that anything was deleted", async () => {
    // The objection this whole screen was rewritten around. Read as
    // textContent because the sentence is deliberately built from several
    // elements -- the name is emphasised inside it.
    await bind();
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toMatch(/Lexa\D{0,4} now means/);
    expect(text).toContain("Alexandra Langford");
    expect(text).not.toMatch(/merge/i);
    expect(text).not.toMatch(/deleted/i);
    expect(text).not.toMatch(/removed the entry/i);
  });

  it("says the entry itself was not changed", async () => {
    await bind();
    expect(screen.getByText(/was changed/)).toBeTruthy();
  });

  it("explains why the dot has gone, in those terms", async () => {
    await bind();
    expect(screen.getByText(/only standing in for the word/)).toBeTruthy();
  });

  it("says the mention now resolves everywhere", async () => {
    // The reason the word matters at all: manuscript, other entries, notes.
    await bind();
    expect(screen.getByText(/your manuscript, your other entries, your/))
      .toBeTruthy();
  });

  it("lists every word the entry now answers to", async () => {
    // "they can directly see the names/words tied to a profile."
    await bind({
      entity_id: "e-alex", name: "Alexandra Langford", display_name: "Lexa",
      aliases: ["Alexandra", "Langford", "Lexi", "Lexa", "Drea"],
      absorbed: ["Lexa"], removed_placeholder: "Lexa",
    });
    expect(screen.getByText("Alexandra, Langford, Lexi, Lexa, Drea")).toBeTruthy();
  });

  it("calls them by the label once there is one", async () => {
    // With a label set, the report should read "Lexa now means Lexa" rather
    // than reverting to the official name -- the writer chose Lexa, and the
    // screen that just applied their choice should honour it.
    await bind({
      entity_id: "e-alex", name: "Alexandra Langford", display_name: "Lexa",
      aliases: ["Lexa"], absorbed: ["Lexa"], removed_placeholder: "Lexa",
    });
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toMatch(/Lexa\D{0,4} now means/);
    expect(text).not.toContain("Alexandra Langford");
  });

  it("tells the map to re-read", async () => {
    const { onBound } = await bind();
    expect(onBound).toHaveBeenCalled();
  });
});


describe("the refusal", () => {
  it("shows what the backend said and keeps the writer here", async () => {
    // An entry with writing in it is never absorbed. The app does not move
    // somebody's writing into another file on the strength of one click.
    mockApi(null, true);
    open();
    await pick("Alexandra Langford");
    await userEvent.click(screen.getByRole("button", { name: /"Lexa" means/ }));
    await waitFor(() =>
      expect(screen.getByText(/has writing in it/)).toBeTruthy());
    expect(screen.queryByText(/now means/)).toBeNull();
  });

  it("does not tell the map anything happened", async () => {
    mockApi(null, true);
    const { onBound } = open();
    await pick("Alexandra Langford");
    await userEvent.click(screen.getByRole("button", { name: /"Lexa" means/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onBound).not.toHaveBeenCalled();
  });
});

describe("it is its own thing, under a fuller name", () => {
  // The flow described in review, in the Ninja Turtles case:
  //
  //   "The Manuscript has The Foot being picked up under UNSPUN > Writer
  //    clicks Create the entry > ... Writer eventually gets to making a new
  //    Faction, ... types in the name The Foot Clan and then clicks The Foot
  //    dot from that screen that makes the connection."
  //
  // Reached from the dot rather than from a create screen, because the dot is
  // what the writer is looking at. Same operation, one step.

  const FOOT = node({ entity_id: "e-foot", name: "The Foot", placeholder: true });

  function mockPromote() {
    posted = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (url.includes("/thread/new")) {
        return { ok: true,
                 json: async () => ({ thread: { entity_id: "e-clan" } }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ entity_id: "e-clan", name: "The Foot Clan",
                             display_name: "", aliases: ["The Foot"],
                             absorbed: ["The Foot"],
                             removed_placeholder: "The Foot" }),
      } as Response;
    }));
  }

  async function promote(name = "The Foot Clan", kind = "Faction") {
    mockPromote();
    const handles = open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    await userEvent.selectOptions(screen.getByLabelText("What kind"), kind);
    const field = screen.getByLabelText("Called what");
    await userEvent.clear(field);
    await userEvent.type(field, name);
    await userEvent.click(screen.getByRole("button", { name: /Make the entry/ }));
    return handles;
  }

  it("asks the two questions the writer actually has", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    expect(screen.getByLabelText("What kind")).toBeTruthy();
    expect(screen.getByLabelText("Called what")).toBeTruthy();
  });

  it("starts from the word, so the common case is one click", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    expect((screen.getByLabelText("Called what") as HTMLInputElement).value)
      .toBe("The Foot");
  });

  it("explains that the prose word and the entry name can differ", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    expect(screen.getByText(/Both find it afterwards/)).toBeTruthy();
  });

  it("will not act without a kind", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    expect(screen.getByRole("button", { name: /Make the entry/ })
      .hasAttribute("disabled")).toBe(true);
  });

  it("makes the entry with the kind and the fuller name", async () => {
    await promote();
    await waitFor(() => expect(posted.some(c => c.url.includes("/thread/new"))).toBe(true));
    const made = posted.filter(c => c.url.includes("/thread/new"))[0];
    expect(made.body).toMatchObject({ type: "faction", name: "The Foot Clan" });
  });

  it("takes the prose word in, so The Foot still finds it", async () => {
    // The connection completed from both sides in one step, which is the whole
    // point of doing it from the dot.
    await promote();
    await waitFor(() => expect(posted.some(c => c.url.includes("/absorb"))).toBe(true));
    expect(posted.filter(c => c.url.includes("/absorb"))[0].body)
      .toMatchObject({ into: "e-clan", from_id: "e-foot" });
  });

  it("does not absorb when the name is unchanged", async () => {
    // Absorbing "The Foot" into an entry also called "The Foot" would be a
    // no-op dressed up as a step.
    await promote("The Foot");
    await waitFor(() => expect(posted.some(c => c.url.includes("/thread/new"))).toBe(true));
    expect(posted.filter(c => c.url.includes("/absorb"))).toEqual([]);
  });

  it("reports what it did, in the same terms as the other answer", async () => {
    await promote();
    await waitFor(() => expect(screen.getByText(/now means/)).toBeTruthy());
    expect(screen.getByRole("dialog").textContent).toContain("The Foot Clan");
  });

  it("tells the map to re-read", async () => {
    const { onBound } = await promote();
    await waitFor(() => expect(onBound).toHaveBeenCalled());
  });

  it("can be backed out of", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Find an entry")).toBeTruthy();
  });

  it("offers every kind, because a word could be anything", async () => {
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    const select = screen.getByLabelText("What kind");
    const terms = Array.from(select.querySelectorAll("option"))
      .map(o => o.textContent);
    expect(terms).toContain("Faction");
    expect(terms).toContain("Location");
    expect(terms).toContain("Deity");
  });

  it("groups them the way the sidebar groups them", async () => {
    // Requested as "Chooses from NOTES/PROFILE/OTHER, clicks PROFILE, then
    // Character". One flat list of fourteen words makes the writer do that
    // sorting in their head.
    open({ dot: FOOT });
    await userEvent.click(screen.getByRole("button", { name: /It is its own thing/ }));
    const groups = Array.from(
      screen.getByLabelText("What kind").querySelectorAll("optgroup"),
    ).map(g => g.getAttribute("label"));
    expect(groups).toEqual(["Profiles", "Other"]);
  });
});
