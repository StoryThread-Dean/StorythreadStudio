// features/codex/WeaveList.test.tsx
// ==================================
// The list is a PEER of the map, not a fallback. That distinction is the
// point of these tests: everything the map can answer, this answers too --
// the same point in the story, the same spoiler control, the same narrowing
// to one Thread and what touches it.
//
// The controls differ where the input demands it (a range slider is a poor
// keyboard control, so the point in the story is a select here) but the
// ANSWERS are identical, because both read the same graph.
//
// Sorting, filtering and search are the list's own advantage, and the reason
// a writer with a big world may end up preferring it.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeaveList } from "./WeaveList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHAPTERS = {
  chapters: [
    { chapter_id: "c-1", filename: "01.md", title: "The Raid", anchor: "c-1" },
    { chapter_id: "c-2", filename: "02.md", title: "The Letter", anchor: "c-2" },
  ],
};

const TYPES = {
  schema_version: 1,
  types: [
    { id: "character", label: "Character", folder: "characters", icon: "User", sections: [] },
    { id: "location", label: "Location", folder: "locations", icon: "MapPin", sections: [] },
  ],
  relations: [
    { id: "mentored_by", label: "mentored by", inverse: "mentor_of", symmetric: false,
      source_types: ["character"], target_types: ["character"],
      cardinality: "many", exclusive_group: null },
    { id: "sibling_of", label: "sibling of", inverse: null, symmetric: true,
      source_types: ["character"], target_types: ["character"],
      cardinality: "many", exclusive_group: null },
  ],
};

function graph(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      { entity_id: "e-elara", type: "character", name: "Elara Voss" },
      { entity_id: "e-garrick", type: "character", name: "Garrick Vale" },
      { entity_id: "e-moor", type: "location", name: "Ravensmoor" },
    ],
    edges: [
      { src_id: "e-elara", dst_id: "e-garrick", rel: "mentored_by",
        active: true, expired: false },
    ],
    as_of: null,
    hidden_nodes: 0,
    hidden_edges: 0,
    ...overrides,
  };
}

let graphCalls: URL[] = [];

function mockApi(body: Record<string, unknown> = graph()) {
  graphCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const payload =
      url.pathname.endsWith("/anchors") ? CHAPTERS
      : url.pathname.endsWith("/types") ? TYPES
      : (graphCalls.push(url), body);
    return { ok: true, json: async () => payload } as Response;
  }));
}

const PROJECT = "C:/MyNovel";

beforeEach(() => mockApi());

async function renderList() {
  render(<WeaveList projectPath={PROJECT} />);
  await waitFor(() => expect(screen.getByText("Elara Voss")).toBeTruthy());
}


describe("it answers the same questions as the map", () => {
  it("asks about a point in the story", async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText(/point in the story/i), "1");
    await waitFor(() => {
      expect(graphCalls[graphCalls.length - 1].searchParams.get("at")).toBe("c-2");
    });
  });

  it("hides what the reader does not know yet, by default", async () => {
    await renderList();
    expect(graphCalls[0].searchParams.get("hide_spoilers")).toBe("true");
  });

  it("always states the spoiler setting explicitly", async () => {
    // Same rule as the map: a missing parameter must never be able to mean
    // "show me everything".
    await renderList();
    for (const call of graphCalls) {
      expect(call.searchParams.has("hide_spoilers")).toBe(true);
    }
  });

  it("can show everything when asked", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /Hiding what the reader/ }));
    await waitFor(() => {
      expect(graphCalls[graphCalls.length - 1].searchParams.get("hide_spoilers")).toBe("false");
    });
  });

  /** The connections listed under one opened row. */
  async function openTies(name: string) {
    await userEvent.click(screen.getByRole("button", { name }));
    const row = screen.getByRole("button", { name }).closest("tr")!;
    return within(row).getByRole("list");
  }

  it("narrows to one Thread and what touches it", async () => {
    // The list's equivalent of the map's Neighborhood.
    await renderList();
    const ties = await openTies("Elara Voss");
    expect(ties.textContent).toMatch(/mentored by/);
    expect(ties.textContent).toMatch(/Garrick Vale/);
  });

  it("reads a connection backwards as its inverse, not as broken grammar", async () => {
    // A Tie is stored once, in one direction. Read from the far end,
    // "mentored by" is not "is mentored by by Elara" -- it is "mentor of
    // Elara", and the registry declares that inverse precisely so this can
    // be a sentence.
    await renderList();
    const ties = await openTies("Garrick Vale");
    expect(ties.textContent).toMatch(/mentor of\s+Elara Voss/);
    expect(ties.textContent).not.toMatch(/by by/);
  });

  it("reads a symmetric connection the same way from both ends", async () => {
    mockApi(graph({
      edges: [{ src_id: "e-elara", dst_id: "e-garrick", rel: "sibling_of",
                active: true, expired: false }],
    }));
    render(<WeaveList projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText("Elara Voss")).toBeTruthy());

    const forward = await openTies("Elara Voss");
    expect(forward.textContent).toMatch(/sibling of\s+Garrick Vale/);
  });

  it("shows a direction rather than inventing grammar for an unknown relation", async () => {
    // A writer's own relation has no declared inverse. An arrow is honest
    // where a guessed sentence would be wrong.
    mockApi(graph({
      edges: [{ src_id: "e-elara", dst_id: "e-garrick", rel: "haunts",
                active: true, expired: false }],
    }));
    render(<WeaveList projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText("Garrick Vale")).toBeTruthy());

    const ties = await openTies("Garrick Vale");
    expect(ties.textContent).toContain("←");
    expect(ties.textContent).toMatch(/haunts/);
  });

  it("says plainly when nothing connects to a Thread", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: "Ravensmoor" }));
    expect(screen.getByText(/Nothing connects to this yet/)).toBeTruthy();
  });

  it("reports what it is not showing", async () => {
    mockApi(graph({ hidden_nodes: 2, hidden_edges: 1 }));
    await renderList();
    const notice = screen.getByTestId("weave-list-hidden");
    expect(notice.textContent).toMatch(/2 entries/);
    expect(notice.textContent).toMatch(/1 connection/);
  });
});


describe("reachable without a mouse", () => {
  it("uses a select for the point in the story, not a slider", async () => {
    // The map's range input is a poor keyboard control. Same question, same
    // answer, an input you can actually reach.
    await renderList();
    const control = screen.getByLabelText(/point in the story/i);
    expect(control.tagName).toBe("SELECT");
  });

  it("puts every entry in a real table with a caption", async () => {
    // A screen reader announcing "table, 3 rows, Name Kind Connections" is
    // the whole reason this view exists.
    await renderList();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/Every entry in your world as of/)).toBeTruthy();
  });

  it("names each row so it can be jumped to", async () => {
    await renderList();
    const rows = screen.getAllByRole("rowheader");
    expect(rows.map(r => r.textContent)).toContain("Elara Voss");
  });

  it("tells assistive tech which way a column is sorted", async () => {
    await renderList();
    const nameHeader = screen.getByRole("button", { name: /^Name/ });
    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
    await userEvent.click(nameHeader);
    expect(screen.getByRole("button", { name: /^Name/ }).getAttribute("aria-sort"))
      .toBe("descending");
  });

  it("marks an opened row as expanded", async () => {
    await renderList();
    const button = screen.getByRole("button", { name: "Elara Voss" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Elara Voss" })
      .getAttribute("aria-expanded")).toBe("true");
  });
});


describe("finding one thing among many", () => {
  it("sorts by name, and reverses", async () => {
    await renderList();
    const names = () => screen.getAllByRole("rowheader").map(r => r.textContent);
    expect(names()[0]).toBe("Elara Voss");
    await userEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(names()[0]).toBe("Ravensmoor");
  });

  it("sorts by how connected something is", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /^Connections/ }));
    // Ascending: the unconnected one first.
    expect(screen.getAllByRole("rowheader")[0].textContent).toBe("Ravensmoor");
  });

  it("filters to one kind of entry", async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText(/^Kind/), "location");
    expect(screen.getByText("Ravensmoor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Elara Voss" })).toBeNull();
  });

  it("searches by name", async () => {
    await renderList();
    await userEvent.type(screen.getByLabelText(/^Find/), "garr");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Elara Voss" })).toBeNull());
    expect(screen.getByRole("button", { name: "Garrick Vale" })).toBeTruthy();
  });

  it("counts what it is showing", async () => {
    await renderList();
    expect(screen.getByText(/3 entries/)).toBeTruthy();
  });

  it("names an unconnected Thread rather than printing a bare zero", async () => {
    // This is exactly what the walkthrough will later call a Loose thread.
    await renderList();
    const row = screen.getByRole("button", { name: "Ravensmoor" }).closest("tr")!;
    expect(within(row).getByText("none yet")).toBeTruthy();
  });
});


describe("an empty list", () => {
  it("teaches when the world is empty", async () => {
    mockApi(graph({ nodes: [], edges: [] }));
    render(<WeaveList projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText(/Your world is empty so far/)).toBeTruthy());
  });

  it("suggests what to change when a filter emptied it", async () => {
    // A different problem from an empty world, and it needs a different
    // sentence -- otherwise the writer thinks they have lost their work.
    await renderList();
    await userEvent.type(screen.getByLabelText(/^Find/), "zzzznothing");
    await waitFor(() => expect(screen.getByText(/clear the search/)).toBeTruthy());
  });
});


describe("failure", () => {
  it("says what went wrong instead of showing an empty table", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: async () => ({ detail: { code: "source_corrupt", message: "The types file is broken." } }),
    } as Response)));
    render(<WeaveList projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText(/The types file is broken/)).toBeTruthy());
  });
});
