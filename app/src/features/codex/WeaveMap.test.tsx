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

import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeaveMap } from "./WeaveMap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHAPTERS = {
  chapters: [
    { chapter_id: "c-1", filename: "01.md", title: "The Raid", anchor: "c-1",
      act_id: "a-1", act_title: "Act I" },
    { chapter_id: "c-2", filename: "02.md", title: "The Letter", anchor: "c-2",
      act_id: "a-1", act_title: "Act I" },
    { chapter_id: "c-3", filename: "03.md", title: "The Return", anchor: "c-3",
      act_id: "a-2", act_title: "Act II" },
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
    // Scoped to the heading, because the title now also appears on the
    // scrubber itself -- which is the point of the scrubber.
    await renderMap();
    scrubTo(0);
    await waitFor(() => expect(
      screen.getByText(/Showing your world as of/).textContent,
    ).toMatch(/The Raid/));
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


describe("what a line between two dots says", () => {
  it("uses the writer's reason where they wrote one", async () => {
    // The backend sends `reason` precisely "so the map can label the line
    // with something worth reading instead of a relation id" -- and the map
    // dropped it on arrival for two releases.
    mockApi(graph({ edges: [
      { src_id: "e-elara", dst_id: "e-garrick", rel: "mentored_by",
        reason: "taught her everything, then vanished",
        active: true, expired: false },
    ] }));
    await renderMap();
    expect(screen.getByText("taught her everything, then vanished")).toBeTruthy();
    expect(screen.queryByText("mentored by")).toBeNull();
  });

  it("falls back to the relation when no reason was written", async () => {
    mockApi(graph());
    await renderMap();
    expect(screen.getByText("mentored by")).toBeTruthy();
  });
});


// ── WHO IS IN THIS CHAPTER ──────────────────────────────────────────────────
//
// Reported after the writer tagged their whole cast and saw the map do nothing:
// "Chapter 1 just has the characters Serena, Rosie and Newton present ...
// Wouldn't/Shouldn't that mean that ALL dot shows every connection but Chapter
// 1 greys out everyone but those three?"
//
// Yes. Three states now, where the map had two:
//   not yet introduced -> hidden. The spoiler rule, unchanged, running first.
//   exists, elsewhere  -> grey.
//   here               -> full colour.

describe("an entry that exists but is not in this chapter", () => {
  const CAST = [
    { entity_id: "e-serena", type: "character", name: "Serena",
      display_name: "", aliases: [], placeholder: false, present: true },
    { entity_id: "e-lou", type: "character", name: "Lou",
      display_name: "", aliases: [], placeholder: false, present: false },
  ];

  it("IS GREYED RATHER THAN REMOVED", async () => {
    // The writer's own word. Hiding would lose the shape of the world around
    // the scene, and a connection to them would have nowhere to land.
    mockApi(graph({ nodes: CAST, edges: [] }));
    await renderMap();
    const nodes = screen.getAllByTestId("map-node");
    expect(nodes).toHaveLength(2);
    const lou = nodes.find(n => n.getAttribute("data-present") === "false")!;
    expect(lou).toBeTruthy();
    expect(Number(lou.getAttribute("opacity"))).toBeLessThan(1);
  });

  it("leaves the ones who are here at full strength", async () => {
    mockApi(graph({ nodes: CAST, edges: [] }));
    await renderMap();
    const here = screen.getAllByTestId("map-node")
      .find(n => n.getAttribute("data-present") === "true")!;
    expect(Number(here.getAttribute("opacity"))).toBe(1);
  });

  it("says why it is dim, on hover", async () => {
    // A dimmed dot with no explanation is a rendering bug to the reader.
    mockApi(graph({ nodes: CAST, edges: [] }));
    await renderMap();
    expect(document.body.textContent).toMatch(/not in this chapter/i);
  });

  it("treats an unplaced world exactly as before", async () => {
    // Silence means "not said", not "nowhere". Turning this on must not grey
    // out every project that has never used it.
    await renderMap();
    for (const node of screen.getAllByTestId("map-node")) {
      expect(Number(node.getAttribute("opacity"))).toBe(1);
    }
  });
});


// ── THE MAP AS A PLACE TO WORK ──────────────────────────────────────────────
//
// Reported: "The Weave is a great graphical means to show the connections to
// each character. But currently, it functions as a visual means with minor
// basic functionality ... It should be more."
//
// And the principle behind it, which decides HOW rather than what: "important
// features like Connections, Creating a profile, Building a profile,
// Extracting a Profile shouldn't be limited to a single location or area within
// the application."
//
// So the workbench owns nothing. Every section is a second MOUNT of a component
// already tested elsewhere -- a second implementation would be two vocabularies
// for one idea, which is the failure this recovery kept finding.

describe("standing on an entry", () => {
  async function focusFirst() {
    await renderMap();
    const node = screen.getAllByTestId("map-node")[0];
    fireEvent.click(node);
  }

  it("offers to edit it, beside the tools that were already there", async () => {
    // Added to the toolbar that already holds Connections and Fix or remove,
    // rather than as a rival panel. One more way to reach what exists.
    await focusFirst();
    expect(screen.getByTestId("map-open-workbench")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connections/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fix or remove/ })).toBeTruthy();
  });

  it("opens a panel BESIDE the map rather than over it", async () => {
    // The map is the context. A modal would hide the neighbourhood the writer
    // clicked from, and that neighbourhood is usually why they are editing.
    await focusFirst();
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    const panel = await screen.findByTestId("node-workbench");
    expect(panel.tagName.toLowerCase()).toBe("aside");
  });

  it("carries WHERE IT APPEARS and HOW IT CHANGES, the same two components", async () => {
    await focusFirst();
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    await screen.findByTestId("node-workbench");
    expect(await screen.findByTestId("appears-in")).toBeTruthy();
    expect(screen.getByTestId("workbench-run")).toBeTruthy();
  });

  it("offers the way through to the full entry", async () => {
    // The map is a second route to these capabilities, never a replacement for
    // the page that owns them.
    await renderMap({ onOpenThread: vi.fn() });
    fireEvent.click(screen.getAllByTestId("map-node")[0]);
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    expect(await screen.findByTestId("workbench-open")).toBeTruthy();
  });

  it("says nothing about opening it when the host cannot navigate", async () => {
    // The map is embedded in places with nowhere to go. A button that leads
    // nowhere is worse than no button.
    await focusFirst();
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    await screen.findByTestId("node-workbench");
    expect(screen.queryByTestId("workbench-open")).toBeNull();
  });
});


describe("the workbench and the toolbar share a corner", () => {
  it("DOES NOT SIT UNDER THE BUTTONS THAT OPENED IT", async () => {
    // Reported: "the window pops up directly behind the other buttons ... the
    // [X] close button is currently hidden." Both were at top-2, so the
    // toolbar landed on the panel's own header -- and the one control a writer
    // needs when a panel is in the way is the one it covered.
    await renderMap();
    fireEvent.click(screen.getAllByTestId("map-node")[0]);
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    const panel = await screen.findByTestId("node-workbench");

    const toolbar = screen.getByTestId("map-open-workbench").parentElement!;
    const topOf = (el: HTMLElement) =>
      /top-(\d+)/.exec(el.className)?.[1] ?? "";
    expect(topOf(panel)).not.toBe(topOf(toolbar));
    expect(Number(topOf(panel))).toBeGreaterThan(Number(topOf(toolbar)));
  });

  it("keeps its close button reachable", async () => {
    await renderMap();
    fireEvent.click(screen.getAllByTestId("map-node")[0]);
    fireEvent.click(screen.getByTestId("map-open-workbench"));
    const panel = await screen.findByTestId("node-workbench");
    const close = within(panel).getByLabelText("Close");
    fireEvent.click(close);
    expect(screen.queryByTestId("node-workbench")).toBeNull();
  });
});


// ── FINDING A DOT WITHOUT HUNTING FOR IT ────────────────────────────────────
//
// "This will allow some additional functionality when the graph becomes a
// cluster of chaotic dots due to the size of the story."
//
// That is the honest limit of any node map: excellent at showing the shape of
// something you are already looking at, useless for finding one thing among two
// hundred. So the list lives on the same screen rather than behind a toggle.

describe("the map's own entry list", () => {
  it("is closed until asked for, and says how many there are", async () => {
    await renderMap();
    expect(screen.queryByTestId("map-entry-list-items")).toBeNull();
    expect(screen.getByTestId("map-entry-list-toggle").textContent)
      .toMatch(/3/);
  });

  it("groups by kind and sorts inside each", async () => {
    await renderMap();
    fireEvent.click(screen.getByTestId("map-entry-list-toggle"));
    const items = await screen.findByTestId("map-entry-list-items");
    const text = items.textContent ?? "";
    // Elara before Garrick within Characters.
    expect(text.indexOf("Elara")).toBeLessThan(text.indexOf("Garrick"));
    // And the location is under its own heading rather than mixed in.
    expect(text).toMatch(/Ravensmoor/);
  });

  it("PICKING ONE DOES WHAT CLICKING ITS DOT DOES", async () => {
    // The whole point: the same focus, reached a different way. Two ways to do
    // one thing, one implementation of it.
    await renderMap();
    fireEvent.click(screen.getByTestId("map-entry-list-toggle"));
    const items = await screen.findByTestId("map-entry-list-items");
    fireEvent.click(within(items).getByRole("button", { name: /Ravensmoor/ }));
    // Focusing is what a dot click does, and it reveals the entry toolbar.
    expect(await screen.findByTestId("map-open-workbench")).toBeTruthy();
  });

  it("searches by name", async () => {
    await renderMap();
    fireEvent.click(screen.getByTestId("map-entry-list-toggle"));
    fireEvent.change(screen.getByLabelText("Search entries"),
                     { target: { value: "raven" } });
    const items = screen.getByTestId("map-entry-list-items");
    expect(items.textContent).toMatch(/Ravensmoor/);
    expect(items.textContent).not.toMatch(/Elara/);
  });

  it("SCROLLS RATHER THAN CAPPING, because a big world is the point", async () => {
    // The mistake WordFix made with its slice of 8: a list built for a world
    // too large to see, that silently showed the first few.
    await renderMap();
    fireEvent.click(screen.getByTestId("map-entry-list-toggle"));
    const items = screen.getByTestId("map-entry-list-items");
    expect(items.className).toMatch(/overflow-y-auto/);
  });

  it("still offers the full list view, which does jobs this cannot", async () => {
    // WeaveList exists for keyboard-only use, screen readers, low vision and
    // scale. A dropdown of buttons over an SVG does none of those four things,
    // so removing the toggle must not remove the way in.
    await renderMap({ onOpenListView: vi.fn() });
    fireEvent.click(screen.getByTestId("map-entry-list-toggle"));
    expect(await screen.findByTestId("map-open-list-view")).toBeTruthy();
  });
});


describe("spreading the dots out", () => {
  it("ASKS FIRST, and says what it costs", async () => {
    // Every dragged position is replaced and there is no history of where they
    // were -- the positions ARE the record of the writer's arrangement.
    await renderMap({ onPin: vi.fn() });
    fireEvent.click(screen.getByTestId("map-spread"));
    const confirm = await screen.findByTestId("map-spread-confirm");
    expect(confirm.textContent).toMatch(/no way back/i);
    expect(confirm.textContent).toMatch(/wherever you have dragged/i);
  });

  it("does nothing if the writer backs out", async () => {
    const onPin = vi.fn();
    await renderMap({ onPin });
    fireEvent.click(screen.getByTestId("map-spread"));
    fireEvent.click(await screen.findByRole("button",
                                            { name: /Leave them as they are/ }));
    expect(onPin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("map-spread-confirm")).toBeNull();
  });

  it("hands back new positions for every dot", async () => {
    const onPin = vi.fn();
    await renderMap({ onPin });
    fireEvent.click(screen.getByTestId("map-spread"));
    fireEvent.click(await screen.findByTestId("map-spread-go"));
    expect(onPin).toHaveBeenCalledTimes(1);
    const positions = onPin.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(positions)).toHaveLength(3);
  });

  it("is not offered where positions cannot be saved", async () => {
    // Without onPin there is nowhere to put the result, and a button that
    // silently does nothing is worse than no button.
    await renderMap();
    expect(screen.queryByTestId("map-spread")).toBeNull();
  });
});
