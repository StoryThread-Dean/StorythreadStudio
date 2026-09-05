// features/codex/ProfileConnections.test.tsx
// ===========================================
// The requested shape, pinned: chips while writing, the full account when
// asked for, and three facts on every detailed row that a shorter version
// would have dropped -- the label AND the name, the reason in the writer's
// own words, and which page the connection is actually recorded on.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileConnections } from "./ProfileConnections";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

function tie(over: Record<string, unknown> = {}) {
  return {
    src_id: "e-lara", dst_id: "e-alex", rel: "partners_with",
    incoming: false, other_id: "e-alex",
    other_name: "Lexa", other_full_name: "Alexandra Langford",
    other_type: "character", reads_as: "partners with",
    why: "recently met and became friends with",
    recorded_on: "e-lara", at_label: "",
    ...over,
  };
}

function mockApi(ties: Record<string, unknown>[] = [tie()]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ties")) {
      return { ok: true, json: async () => ({ ties }) } as Response;
    }
    if (url.includes("/graph")) {
      return { ok: true, json: async () => ({
        nodes: [], edges: [], as_of: null,
        hidden_nodes: 0, hidden_edges: 0,
      }) } as Response;
    }
    if (url.includes("/relations")) {
      return { ok: true, json: async () => ({
        forward: [], reverse: [], available: [], groups: [],
      }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

beforeEach(() => mockApi());

async function open(props: Record<string, unknown> = {}) {
  render(
    <ProfileConnections
      projectPath={PROJECT} entityId="e-lara" type="character"
      name="Lara Croft" {...props} />,
  );
  await waitFor(() =>
    expect(screen.queryByText(/Reading connections/)).toBeNull());
}

async function expand() {
  await userEvent.click(screen.getByRole("button", { name: /what Lara Croft is to each/i }));
  return screen.getByTestId("connection-details");
}


describe("the quick read", () => {
  it("shows each connection as a chip", async () => {
    await open();
    const chips = screen.getByTestId("connection-chips");
    expect(within(chips).getByText("Lexa")).toBeTruthy();
  });

  it("says what to do when there are none, in the writer's terms", async () => {
    // Not "no data" -- what a connection IS and why it is worth making.
    mockApi([]);
    await open();
    expect(screen.getByText(/how this relates to the rest of your world/))
      .toBeTruthy();
  });
});


describe("the full account", () => {
  it("gives the label AND the name", async () => {
    // "Lexa (Alexandra Langford)" -- what the story calls her, and who she
    // is. Two different facts, and a profile is where both matter.
    await open();
    const details = await expand();
    expect(within(details).getByText(/Lexa \(Alexandra Langford\)/)).toBeTruthy();
  });

  it("does not repeat a name that has no separate label", async () => {
    mockApi([tie({ other_name: "Dean", other_full_name: "Dean" })]);
    await open();
    const details = await expand();
    expect(within(details).queryByText(/Dean \(Dean\)/)).toBeNull();
  });

  it("shows the relation and the REASON, which is the part worth reading", async () => {
    await open();
    const details = await expand();
    expect(within(details).getByText(/partners with/)).toBeTruthy();
    expect(within(details).getByText(/recently met and became friends with/))
      .toBeTruthy();
  });

  it("says so plainly when no reason was written", async () => {
    mockApi([tie({ why: "" })]);
    await open();
    const details = await expand();
    expect(within(details).getByText(/no reason written/)).toBeTruthy();
  });

  it("says which page a connection is recorded on when it is not this one", async () => {
    // A Tie is stored once and read from both ends. Without this, "why can I
    // see this here but not find it in her file?" has no answer.
    mockApi([tie({ recorded_on: "e-alex", incoming: true })]);
    await open();
    const details = await expand();
    // Matched without the apostrophe: the rendered one is typographic, and a
    // test that pins the glyph fails on a punctuation change rather than on
    // the fact it is supposed to be about.
    expect(within(details).getByText(/recorded on Lexa/)).toBeTruthy();
  });

  it("stays quiet about where it lives when it lives here", async () => {
    await open();
    const details = await expand();
    expect(within(details).queryByText(/recorded on/)).toBeNull();
  });

  it("folds back to chips", async () => {
    await open();
    await expand();
    await userEvent.click(screen.getByRole("button", { name: /Show them as chips/ }));
    expect(screen.getByTestId("connection-chips")).toBeTruthy();
  });
});


describe("making one from here", () => {
  it("opens the same connect screen the Weave uses", async () => {
    // One way to record a connection, and it asks for the reason first. An
    // easier second path that skipped it would fill the world with
    // connections that tell the AI nothing.
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: /Connect Lara Croft to something/ }));
    expect(await screen.findByTestId("tie-editor")).toBeTruthy();
  });

  it("explains itself, per the product rule", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/what they are TO people/)).toBeTruthy();
  });
});

// ── Being on the page at all ─────────────────────────────────────────────────
//
// This panel was built, tested and mounted NOWHERE. Every test in this file
// passed the whole time, because they render the component directly -- and the
// writer, who had asked for exactly this, could not find it on any screen.
//
// A component with no consumer is a component that does not exist. It is the
// second time in this recovery: the Weaving panel was rendered inside a branch
// of the view switch that never ran, and its tests passed too.
//
// So the mount is pinned, the same way that one is: by reading the source.

describe("where it is used", () => {
  const SOURCES = import.meta.glob("../../screens/ProfileBuilder.tsx",
    { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const builder = Object.values(SOURCES)[0];

  it("is on the profile page", () => {
    expect(builder).toMatch(/<ProfileConnections/);
  });

  it("is only offered where a connection can exist", () => {
    // A tie is the Weave's own idea. A profiles/ file has nowhere to record one,
    // so offering the panel there would be a control that cannot work.
    expect(builder).toMatch(/home === "codex" && profile\.entity_id/);
  });
});


// ── A relationship that changed, on the page the writer works on ─────────────
//
// THE BUG THESE CLOSE. This list showed every stored state as a peer, because
// the route it reads applied no resolution at all. A character whose
// relationship had changed -- friends in the first half, rivals in the second,
// which is the case the whole axis model exists for -- read as though both
// were true at once and the app had lost track of its own answer.
//
// The states are not hidden, and that is deliberate: "friends, and before that
// acquaintances" is worth being able to see. What was missing was any mark
// saying which one HOLDS.

const ARC = [
  tie({ rel: "rivals", reads_as: "rival of", why: "she cannot forgive him",
        at_label: "3. The Fall", state: "in_force", in_force: true }),
  tie({ rel: "connected_to", reads_as: "connected to",
        why: "father-like mentor", at_label: "1. The Village",
        state: "superseded", in_force: false }),
];

describe("a relationship that changed", () => {
  beforeEach(() => mockApi(ARC));

  it("shows which state is true now", async () => {
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/she cannot forgive him/)).toBeTruthy());
    const current = screen.getByText(/she cannot forgive him/).closest("li");
    expect(current).toBeTruthy();
    expect(current!.textContent).not.toMatch(/Earlier/i);
  });

  it("keeps the earlier state, marked as earlier", async () => {
    // Not dropped. A writer scanning a profile wants the arc, not only the
    // endpoint -- and a state that vanished would look like lost work.
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/father-like mentor/)).toBeTruthy());
    const earlier = screen.getByText(/father-like mentor/).closest("li");
    expect(earlier!.textContent).toMatch(/Earlier/i);
  });

  it("puts the state in force first", async () => {
    // Reading order is the answer to "what is true now?", so the current
    // state cannot be somewhere in the middle of a list of old ones.
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/she cannot forgive him/)).toBeTruthy());
    const rows = screen.getAllByRole("listitem").map(li => li.textContent ?? "");
    expect(rows[0]).toMatch(/she cannot forgive him/);
  });

  it("says when a relationship has ended rather than changed", async () => {
    // `until` was fetched by this component and rendered by nothing, so a
    // relationship the writer had explicitly ended read as ongoing.
    mockApi([tie({ why: "they stopped speaking", at_label: "1. The Village",
                   until_label: "4. The Parting", state: "in_force",
                   in_force: true })]);
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/they stopped speaking/)).toBeTruthy());
    expect(screen.getByText(/4\. The Parting/)).toBeTruthy();
  });
});


describe("one side's view of a relationship", () => {
  it("says whose view it is", async () => {
    // Two records of one pair can both be true -- the truth of it, and what
    // one of them believes. Shown flatly they would read as a contradiction
    // in the writer's own notes.
    mockApi([
      tie({ why: "he will always choose the party", state: "in_force",
            in_force: true }),
      tie({ why: "she believes he is a father to her", frame_name: "Lara Croft",
            state: "in_force", in_force: true }),
    ]);
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() =>
      expect(screen.getByText(/she believes he is a father/)).toBeTruthy());
    const belief = screen.getByText(/she believes he is a father/).closest("li");
    expect(belief!.textContent).toMatch(/as Lara Croft sees it/i);
  });
});


describe("the longer version, on the profile", () => {
  it("is shown when there is one", async () => {
    const paragraph = "Kipling initially sees Milton as an experienced "
      + "expedition leader whose rules often frustrate her.";
    mockApi([tie({ why: "father-like mentor", description: paragraph,
                   state: "in_force", in_force: true })]);
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/father-like mentor/)).toBeTruthy());
    expect(screen.getByText(new RegExp("expedition leader"))).toBeTruthy();
  });

  it("does not leave an empty gap when there is none", async () => {
    mockApi([tie({ why: "father-like mentor", state: "in_force",
                   in_force: true })]);
    render(<ProfileConnections projectPath={PROJECT} entityId="e-lara"
                               type="character" name="Lara Croft"
                               startExpanded />);
    await waitFor(() => expect(screen.getByText(/father-like mentor/)).toBeTruthy());
    const row = screen.getByText(/father-like mentor/).closest("li");
    expect(row!.querySelectorAll("p").length).toBe(0);
  });
});
