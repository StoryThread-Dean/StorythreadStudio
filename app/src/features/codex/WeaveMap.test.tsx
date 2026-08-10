// features/codex/WeaveMap.test.tsx
// =================================
// The map is where the Weave stops being a data model and becomes something
// a writer can look at. The control that earns the whole feature is the
// scrubber: drag it, and the world redraws as of that point in the story.
//
// What these tests protect, in order:
//
//   1. The scrubber asks for the right point, and says which one in words.
//      A slider whose position you cannot read is a slider you cannot trust.
//   2. Spoiler hiding is ON by default and is never quietly dropped from a
//      request. A leak cannot be taken back.
//   3. Nothing is omitted silently. A map that quietly drops entries looks
//      like a world with less in it than the writer built.
//   4. An empty map teaches instead of looking broken.

import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeaveMap } from "./WeaveMap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHAPTERS = {
  chapters: [
    { chapter_id: "c-1", filename: "01.md", title: "The Raid", anchor: "c-1" },
    { chapter_id: "c-2", filename: "02.md", title: "The Letter", anchor: "c-2" },
    { chapter_id: "c-3", filename: "03.md", title: "The Return", anchor: "c-3" },
  ],
};

const TYPES = {
  schema_version: 1,
  types: [
    { id: "character", label: "Character", folder: "characters", icon: "User", sections: [] },
    { id: "location", label: "Location", folder: "locations", icon: "MapPin", sections: [] },
  ],
  relations: [],
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

/** Records every /graph request so the tests can assert what was asked for. */
let graphCalls: URL[] = [];

function mockApi(graphBody: Record<string, unknown> = graph()) {
  graphCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body =
      url.pathname.endsWith("/anchors") ? CHAPTERS
      : url.pathname.endsWith("/types") ? TYPES
      : (graphCalls.push(url), graphBody);
    return { ok: true, json: async () => body } as Response;
  }));
}

const PROJECT = "C:/MyNovel";

beforeEach(() => mockApi());

async function renderMap(props = {}) {
  render(<WeaveMap projectPath={PROJECT} {...props} />);
  await waitFor(() => expect(graphCalls.length).toBeGreaterThan(0));
}

/** Move the scrubber. A range input does not respond to typing in jsdom, so
 *  drive it the way a drag does -- with a change event. */
function scrubTo(chapterIndex: number) {
  fireEvent.change(screen.getByLabelText("Point in the story"),
                   { target: { value: String(chapterIndex) } });
}


describe("the scrubber", () => {
  it("opens on the whole finished story", async () => {
    await renderMap();
    expect(screen.getByText(/the end of the book/)).toBeTruthy();
    // No anchor sent means "everything" -- how a writer sees their finished world.
    expect(graphCalls[0].searchParams.get("at")).toBeNull();
  });

  it("names the chapter it is showing, in words", async () => {
    // A slider whose position you cannot read is a slider you cannot trust.
    await renderMap();
    scrubTo(0);
    await waitFor(() => expect(screen.getByText(/The Raid/)).toBeTruthy());
  });

  it("asks the backend for that point in the story", async () => {
    await renderMap();
    scrubTo(1);
    await waitFor(() => {
      const last = graphCalls[graphCalls.length - 1];
      expect(last.searchParams.get("at")).toBe("c-2");
    });
  });

  it("says so when there is no story to move through", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith("/anchors") ? { chapters: [] }
        : url.pathname.endsWith("/types") ? TYPES : graph();
      return { ok: true, json: async () => body } as Response;
    }));
    render(<WeaveMap projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText(/no chapters yet/)).toBeTruthy());
  });

  it("explains what it does, for a writer who has never seen one", async () => {
    await renderMap();
    await userEvent.click(screen.getByRole("button", { name: /what does this slider do/i }));
    expect(screen.getByText(/redraws as of that point/)).toBeTruthy();
  });
});


describe("spoilers", () => {
  it("hides what the reader does not know yet, by default", async () => {
    await renderMap();
    expect(graphCalls[0].searchParams.get("hide_spoilers")).toBe("true");
    expect(screen.getByText(/Hiding what the reader does not know yet/)).toBeTruthy();
  });

  it("always states the setting explicitly in the request", async () => {
    // A missing parameter must never be able to mean "show me everything".
    await renderMap();
    for (const call of graphCalls) {
      expect(call.searchParams.has("hide_spoilers")).toBe(true);
    }
  });

  it("can be turned off deliberately", async () => {
    await renderMap();
    await userEvent.click(screen.getByRole("button", { name: /Hiding what the reader/ }));
    await waitFor(() => {
      const last = graphCalls[graphCalls.length - 1];
      expect(last.searchParams.get("hide_spoilers")).toBe("false");
    });
    expect(screen.getByText(/Showing everything/)).toBeTruthy();
  });
});


describe("what is not on screen", () => {
  it("says how much of the world it is not showing", async () => {
    mockApi(graph({ hidden_nodes: 3, hidden_edges: 2 }));
    await renderMap();
    const notice = screen.getByTestId("weave-hidden-notice");
    expect(notice.textContent).toMatch(/3 entries/);
    expect(notice.textContent).toMatch(/2 connections hidden/);
  });

  it("stays quiet when nothing is hidden", async () => {
    await renderMap();
    expect(screen.queryByTestId("weave-hidden-notice")).toBeNull();
  });

  it("counts one entry as one, not '1 entries'", async () => {
    mockApi(graph({ hidden_nodes: 1 }));
    await renderMap();
    expect(screen.getByTestId("weave-hidden-notice").textContent).toMatch(/1 entry/);
  });
});


describe("the world itself", () => {
  it("draws every Thread it was given", async () => {
    await renderMap();
    expect(screen.getByText("Elara Voss")).toBeTruthy();
    expect(screen.getByText("Garrick Vale")).toBeTruthy();
    expect(screen.getByText("Ravensmoor")).toBeTruthy();
  });

  it("labels the connection between them", async () => {
    await renderMap();
    expect(screen.getByText("mentored by")).toBeTruthy();
  });

  it("narrows to one Thread and what touches it when clicked", async () => {
    // The Neighborhood layer: the whole world at once is a constellation you
    // can recognise but not read.
    await renderMap();
    await userEvent.click(screen.getByText("Elara Voss"));
    await waitFor(() => expect(screen.queryByText("Ravensmoor")).toBeNull());
    expect(screen.getByText("Garrick Vale")).toBeTruthy();
    expect(screen.getByRole("button", { name: /whole world/i })).toBeTruthy();
  });

  it("goes back to the whole world again", async () => {
    await renderMap();
    await userEvent.click(screen.getByText("Elara Voss"));
    await userEvent.click(screen.getByRole("button", { name: /whole world/i }));
    await waitFor(() => expect(screen.getByText("Ravensmoor")).toBeTruthy());
  });

  it("shows a legend naming each kind of entry", async () => {
    await renderMap();
    // Rendered from the Lexicon, so the map cannot show a symbol the app
    // has no words for.
    expect(screen.getAllByTitle(/The people in your story/).length).toBeGreaterThan(0);
  });
});


describe("an empty map", () => {
  it("teaches rather than looking broken", async () => {
    mockApi(graph({ nodes: [], edges: [] }));
    await renderMap();
    expect(screen.getByText(/Your world is empty so far/)).toBeTruthy();
    expect(screen.getByText(/A Thread is one entry/)).toBeTruthy();
  });

  it("distinguishes 'nothing yet' from 'nothing YET at this point'", async () => {
    // Different reasons need different sentences: one is a world not built,
    // the other is a slider dragged too far left.
    mockApi(graph({ nodes: [], edges: [], hidden_nodes: 4 }));
    await renderMap();
    expect(screen.getByText(/Nothing in your world has appeared by/)).toBeTruthy();
    expect(screen.getByText(/turn off spoiler hiding/)).toBeTruthy();
  });
});


describe("failure", () => {
  it("says what went wrong instead of drawing an empty box", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      json: async () => ({ detail: { code: "source_corrupt", message: "The types file is broken." } }),
    } as Response)));
    render(<WeaveMap projectPath={PROJECT} />);
    await waitFor(() => expect(screen.getByText(/The types file is broken/)).toBeTruthy());
  });
});
