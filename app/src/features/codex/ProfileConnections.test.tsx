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
