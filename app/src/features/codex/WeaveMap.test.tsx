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
      { entity_id: "e-elara", type: "character", name: "Elara Voss",
        display_name: "", aliases: [], placeholder: false },
      { entity_id: "e-garrick", type: "character", name: "Garrick Vale",
        display_name: "", aliases: [], placeholder: false },
      { entity_id: "e-moor", type: "location", name: "Ravensmoor",
        display_name: "", aliases: [], placeholder: false },
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


describe("dragging a Thread", () => {
  // Reported from live testing: "clicking on a dot and dragging it, the icon
  // immediately jumps an inch to the LEFT of the mouse and then follows an
  // inch away from wherever the mouse is going. Directly left." And then:
  // "Single click = menu, Click + Drag = nothing but dragging it."
  //
  // Three separate things, all real. Nothing recorded WHERE in the dot the
  // writer took hold, so the centre snapped to the cursor. The cursor was
  // mapped across the whole element while the drawing is letterboxed inside
  // its own viewBox, which is a constant offset in one direction. And a drag
  // ended with a click, so repositioning a dot also opened something.

  /** An element with a shape unlike the viewBox's, so the drawing is centred
   *  with blank padding -- the reported case. */
  function letterbox(el: Element, width = 2000, height = 620) {
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, width, height, right: width, bottom: height,
      x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
  }

  function positionOf(node: Element): { x: number; y: number } {
    const [x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/
      .exec(node.getAttribute("transform")!)!.slice(1).map(Number);
    return { x, y };
  }

  function lastPinned(onPin: ReturnType<typeof vi.fn>) {
    const calls = onPin.mock.calls;
    return Object.values(calls[calls.length - 1][0])[0] as
      { x: number; y: number };
  }

  async function map(width = 2000, height = 620) {
    const onPin = vi.fn();
    await renderMap({ onPin });
    const svg = screen.getByRole("img", { name: /Map of your world/ });
    letterbox(svg, width, height);
    const node = svg.querySelector("g[transform]")!;
    return { onPin, svg, node, at: positionOf(node) };
  }

  it("moves nothing at all while the cursor holds still", async () => {
    // The first symptom, exactly: press and the dot leaps away before any
    // movement. Now a press that does not travel does nothing whatsoever.
    const { onPin, svg, node } = await map();
    fireEvent.mouseDown(node, { clientX: 1000, clientY: 310 });
    fireEvent.mouseMove(svg, { clientX: 1000, clientY: 310 });
    expect(onPin).not.toHaveBeenCalled();
  });

  it("ignores a hand tremor rather than treating it as a drag", async () => {
    // A few pixels of slop, because a hand holding a mouse still moves. Below
    // it, this is a click that has not finished yet.
    const { onPin, svg, node } = await map();
    fireEvent.mouseDown(node, { clientX: 1000, clientY: 310 });
    fireEvent.mouseMove(svg, { clientX: 1002, clientY: 311 });
    expect(onPin).not.toHaveBeenCalled();
  });

  it("keeps the grip, rather than snapping the centre to the cursor", async () => {
    // Grab anywhere in the dot, move it, and it moves by exactly that much.
    const { onPin, svg, node, at } = await map();
    fireEvent.mouseDown(node, { clientX: 1000, clientY: 310 });
    fireEvent.mouseMove(svg, { clientX: 1050, clientY: 310 });
    const moved = lastPinned(onPin);
    expect(moved.x - at.x).toBeCloseTo(50, 0);
    expect(moved.y - at.y).toBeCloseTo(0, 0);
  });

  it("tracks the cursor one for one when the drawing is scaled down", async () => {
    // The subtler half. Screen pixels and viewBox units are not the same size
    // -- here the element is half the viewBox, so 100px of hand movement is
    // 200 units of map. Getting this wrong makes the dot drift further away
    // the longer it is dragged, which is a different complaint from the
    // constant offset and needs its own arithmetic.
    const { onPin, svg, node, at } = await map(500, 310);
    fireEvent.mouseDown(node, { clientX: 100, clientY: 155 });
    fireEvent.mouseMove(svg, { clientX: 200, clientY: 155 });
    expect(lastPinned(onPin).x - at.x).toBeCloseTo(200, 0);
  });

  it("moves nothing until a Thread is taken hold of", async () => {
    const { onPin, svg } = await map();
    fireEvent.mouseMove(svg, { clientX: 900, clientY: 200 });
    expect(onPin).not.toHaveBeenCalled();
  });

  it("lets go on mouse up", async () => {
    const { onPin, svg, node } = await map();
    fireEvent.mouseDown(node, { clientX: 1000, clientY: 310 });
    fireEvent.mouseUp(svg);
    onPin.mockClear();
    fireEvent.mouseMove(svg, { clientX: 1200, clientY: 400 });
    expect(onPin).not.toHaveBeenCalled();
  });
});


describe("a bare dot, and what a click means", () => {
  // "The dots themselves are ok but by themselves they should represent the
  // default 'Unconnected' Dot... I see the icons below as a legend of what the
  // dots will turn into once the connection is made."
  //
  // And: "Single click = menu, Click + Drag = nothing but dragging it."

  const WITH_STUB = graph({
    nodes: [
      { entity_id: "e-alex", type: "character", name: "Alexandra Langford",
        display_name: "", aliases: [], placeholder: false },
      { entity_id: "e-lexa", type: "character", name: "Lexa",
        display_name: "", aliases: [], placeholder: true },
    ],
    edges: [],
  });

  async function mapWithStub() {
    mockApi(WITH_STUB);
    const onPin = vi.fn();
    render(<WeaveMap projectPath={PROJECT} onPin={onPin} />);
    await waitFor(() => expect(graphCalls.length).toBeGreaterThan(0));
    const svg = screen.getByRole("img", { name: /Map of your world/ });
    svg.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1000, height: 620, right: 1000, bottom: 620,
      x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    const stub = Array.from(svg.querySelectorAll("g[transform]")).find(
      g => g.querySelector("title")?.textContent?.includes("Lexa"))!;
    return { svg, stub, onPin };
  }

  it("draws a bare dot differently from an established one", async () => {
    // A map full of hollow dots reads as work to do. A map of filled icons
    // reads as a world. The difference has to be visible without a legend.
    const { svg } = await mapWithStub();
    const dashed = svg.querySelectorAll("circle[stroke-dasharray]");
    expect(dashed.length).toBe(1);
  });

  it("says what a bare dot is for, on hover", async () => {
    const { stub } = await mapWithStub();
    expect(stub.querySelector("title")?.textContent)
      .toMatch(/nothing in it yet/);
  });

  it("opens the menu on a single click", async () => {
    const { stub } = await mapWithStub();
    fireEvent.mouseDown(stub, { clientX: 500, clientY: 310 });
    fireEvent.mouseUp(stub);
    fireEvent.click(stub);
    expect(screen.getByTestId("bind-dot")).toBeTruthy();
  });

  it("opens NOTHING after a drag", async () => {
    // The reported bug: every attempt to reposition a dot also opened
    // something. A drag ends with a click event on its way and there is no way
    // to cancel it, so the only reliable answer is to remember it is not one.
    const { svg, stub } = await mapWithStub();
    fireEvent.mouseDown(stub, { clientX: 500, clientY: 310 });
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 360 });
    fireEvent.mouseUp(svg);
    fireEvent.click(stub);
    expect(screen.queryByTestId("bind-dot")).toBeNull();
  });

  it("opens the menu again on the click after a drag", async () => {
    // Suppression is for ONE click, not for the rest of the session.
    const { svg, stub } = await mapWithStub();
    fireEvent.mouseDown(stub, { clientX: 500, clientY: 310 });
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 360 });
    fireEvent.mouseUp(svg);
    fireEvent.click(stub);

    fireEvent.mouseDown(stub, { clientX: 600, clientY: 360 });
    fireEvent.mouseUp(stub);
    fireEvent.click(stub);
    expect(screen.getByTestId("bind-dot")).toBeTruthy();
  });

  it("an established dot still focuses rather than asking what it is", async () => {
    // It already has an answer. The useful click there is "show me what this
    // connects to".
    const { svg } = await mapWithStub();
    const real = Array.from(svg.querySelectorAll("g[transform]")).find(
      g => g.querySelector("title")?.textContent?.includes("Alexandra"))!;
    fireEvent.mouseDown(real, { clientX: 500, clientY: 310 });
    fireEvent.mouseUp(real);
    fireEvent.click(real);
    expect(screen.queryByTestId("bind-dot")).toBeNull();
    expect(screen.getByRole("button", { name: /Show the whole world/ })).toBeTruthy();
  });

  it("labels a dot with what the story calls it", async () => {
    mockApi(graph({
      nodes: [{ entity_id: "e-alex", type: "character",
                name: "Alexandra Langford", display_name: "Lexa",
                aliases: ["Lexa"], placeholder: false }],
      edges: [],
    }));
    await renderMap();
    const svg = screen.getByRole("img", { name: /Map of your world/ });
    expect(svg.textContent).toContain("Lexa");
    expect(svg.textContent).not.toContain("Alexandra Langford");
  });
});
