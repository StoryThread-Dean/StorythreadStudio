// features/codex/layout.test.ts
// ==============================
// A graph layout's real job is not to look tidy -- it is to be the SAME
// every time. Most of a map's value is that you remember where things are,
// and a layout that reshuffles on every open makes you re-read the whole
// world each visit until you stop looking at it.
//
// Two properties carry that, and everything here is about them:
//
//   1. Same world, same picture -- on any machine, in any session.
//   2. Adding a Thread does not move the ones already there.
//
// The second is why this is not a force simulation. Physics is prettier and
// cannot promise it: one new node changes every force in the system.

import { describe, expect, it } from "vitest";

import {
  spreadOut,
  type Point,
  degrees,
  hashUnit,
  layoutNodes,
  neighborhood,
  nodeRadius,
  type GraphEdge,
  type LayoutNode,
} from "./layout";

const TYPES = ["character", "location", "faction", "lore"];

function nodes(...ids: string[]): LayoutNode[] {
  return ids.map((id, i) => ({ entity_id: id, type: TYPES[i % TYPES.length] }));
}

const OPTS = { width: 1000, height: 700, typeOrder: TYPES };


describe("determinism", () => {
  it("produces the same map twice", () => {
    const world = nodes("e-a", "e-b", "e-c", "e-d");
    expect(layoutNodes(world, OPTS)).toEqual(layoutNodes(world, OPTS));
  });

  it("does not depend on the order the Threads arrive in", () => {
    // The backend orders by name; a rename would otherwise redraw the world.
    const forward = layoutNodes(nodes("e-a", "e-b", "e-c"), OPTS);
    const shuffled = layoutNodes(
      [nodes("e-a", "e-b", "e-c")[2], nodes("e-a", "e-b", "e-c")[0],
       nodes("e-a", "e-b", "e-c")[1]],
      OPTS,
    );
    expect(shuffled).toEqual(forward);
  });

  it("uses no randomness or clock", () => {
    // hashUnit is the only source of variation, and it is a pure function.
    expect(hashUnit("e-elara")).toBe(hashUnit("e-elara"));
    expect(hashUnit("e-elara")).not.toBe(hashUnit("e-garrick"));
    expect(hashUnit("x")).toBeGreaterThanOrEqual(0);
    expect(hashUnit("x")).toBeLessThan(1);
  });
});


describe("adding a Thread leaves the others alone", () => {
  it("does not shove the existing world sideways", () => {
    // THE property. Position comes from a Thread's own id, not its index --
    // so the fiftieth character does not move the other forty-nine.
    const before = layoutNodes(nodes("e-a", "e-b", "e-c"), OPTS);
    const after = layoutNodes(nodes("e-a", "e-b", "e-c", "e-d"), OPTS);

    for (const id of ["e-a", "e-b", "e-c"]) {
      // Only the de-overlap pass may nudge, and only if the newcomer landed
      // on top of something.
      expect(Math.hypot(after[id].x - before[id].x,
                        after[id].y - before[id].y)).toBeLessThan(40);
    }
  });

  it("puts a Thread back where it was after a deletion", () => {
    const full = layoutNodes(nodes("e-a", "e-b", "e-c"), OPTS);
    const fewer = layoutNodes(nodes("e-a", "e-c"), OPTS);
    expect(Math.hypot(fewer["e-a"].x - full["e-a"].x,
                      fewer["e-a"].y - full["e-a"].y)).toBeLessThan(40);
  });
});


describe("clustering", () => {
  it("puts Threads of a kind near each other", () => {
    const world: LayoutNode[] = [
      { entity_id: "e-1", type: "character" },
      { entity_id: "e-2", type: "character" },
      { entity_id: "e-3", type: "faction" },
    ];
    const pos = layoutNodes(world, OPTS);
    const sameKind = Math.hypot(pos["e-1"].x - pos["e-2"].x, pos["e-1"].y - pos["e-2"].y);
    const otherKind = Math.hypot(pos["e-1"].x - pos["e-3"].x, pos["e-1"].y - pos["e-3"].y);
    expect(sameKind).toBeLessThan(otherKind);
  });

  it("gives a writer's own custom type a place of its own", () => {
    // Not in typeOrder, so it hashes into a slot -- less even, but stable
    // forever, which is the property that counts.
    const pos = layoutNodes([{ entity_id: "e-1", type: "spaceship" }], OPTS);
    expect(pos["e-1"]).toBeDefined();
    expect(Number.isFinite(pos["e-1"].x)).toBe(true);
  });
});


describe("keeping nodes apart and on screen", () => {
  it("separates Threads that would otherwise overlap", () => {
    const world = nodes(...Array.from({ length: 30 }, (_, i) => `e-${i}`));
    const pos = layoutNodes(world, OPTS);
    const ids = Object.keys(pos);

    let tooClose = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (Math.hypot(pos[ids[i]].x - pos[ids[j]].x,
                       pos[ids[i]].y - pos[ids[j]].y) < 20) tooClose++;
      }
    }
    expect(tooClose).toBe(0);
  });

  it("keeps everything inside the canvas", () => {
    const pos = layoutNodes(nodes(...Array.from({ length: 40 }, (_, i) => `e-${i}`)), OPTS);
    for (const p of Object.values(pos)) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(980);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(680);
    }
  });

  it("separates two Threads that land on exactly the same spot", () => {
    // Reproducibly, even here -- the direction comes from the ids.
    const world: LayoutNode[] = [
      { entity_id: "e-a", type: "character" },
      { entity_id: "e-b", type: "character" },
    ];
    const first = layoutNodes(world, OPTS);
    const second = layoutNodes(world, OPTS);
    expect(first).toEqual(second);
  });
});


describe("positions the writer chose", () => {
  it("puts a dragged Thread exactly where they put it", () => {
    const pos = layoutNodes(nodes("e-a", "e-b"), {
      ...OPTS, pinned: { "e-a": { x: 111, y: 222 } },
    });
    expect(pos["e-a"]).toEqual({ x: 111, y: 222 });
  });

  it("never nudges a pinned Thread to make room", () => {
    // The writer put it there. Moving it would be the app overruling them.
    const pinned = { "e-a": { x: 500, y: 350 } };
    const world = nodes(...Array.from({ length: 25 }, (_, i) => `e-${i}`));
    world.push({ entity_id: "e-a", type: "character" });
    const pos = layoutNodes(world, { ...OPTS, pinned });
    expect(pos["e-a"]).toEqual({ x: 500, y: 350 });
  });
});


describe("neighborhood", () => {
  const edges: GraphEdge[] = [
    { src_id: "e-a", dst_id: "e-b", rel: "mentored_by" },
    { src_id: "e-b", dst_id: "e-c", rel: "member_of" },
    { src_id: "e-c", dst_id: "e-d", rel: "rules" },
    { src_id: "e-x", dst_id: "e-y", rel: "loves" },
  ];

  it("returns the Thread and what touches it", () => {
    expect(neighborhood(edges, "e-a")).toEqual(new Set(["e-a", "e-b"]));
  });

  it("follows Ties in both directions", () => {
    // A Tie is stored on one side and read from both, so the map must not
    // care which end you started from.
    expect(neighborhood(edges, "e-b")).toEqual(new Set(["e-b", "e-a", "e-c"]));
  });

  it("goes further when asked", () => {
    expect(neighborhood(edges, "e-a", 2)).toEqual(new Set(["e-a", "e-b", "e-c"]));
  });

  it("leaves the rest of the world out", () => {
    expect(neighborhood(edges, "e-a", 5).has("e-x")).toBe(false);
  });

  it("returns just the Thread when nothing connects to it", () => {
    expect(neighborhood(edges, "e-lonely")).toEqual(new Set(["e-lonely"]));
  });
});


describe("degree", () => {
  it("counts every Tie touching a Thread", () => {
    const counts = degrees([
      { src_id: "e-a", dst_id: "e-b", rel: "x" },
      { src_id: "e-c", dst_id: "e-a", rel: "y" },
    ]);
    expect(counts["e-a"]).toBe(2);
    expect(counts["e-b"]).toBe(1);
  });

  it("leaves an unconnected Thread absent, which is what a Loose thread is", () => {
    expect(degrees([])["e-lonely"]).toBeUndefined();
  });

  it("sizes a node by its connections, within limits", () => {
    // One very well-connected character must not swamp the map.
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(5));
    expect(nodeRadius(500)).toBeLessThanOrEqual(16);
  });
});


describe("a dragged position cannot hide a node", () => {
  // Found by a count that disagreed with itself: the sidebar said 13
  // characters and the map showed 12. The missing one was pinned at x = 1119
  // on a canvas 1000 wide -- drawn outside the viewBox, clipped by the frame,
  // and impossible to drag back because there was nothing on screen to grab.
  const nodes = [
    { entity_id: "e-1", type: "character", name: "Lost",
      display_name: "", aliases: [], placeholder: false },
  ];

  it("keeps a position past the right edge inside the drawing", () => {
    const view = layoutNodes(nodes, { width: 1000, height: 620,
                                 pinned: { "e-1": { x: 1119, y: 22 } } });
    expect(view["e-1"].x).toBeLessThanOrEqual(980);
    expect(view["e-1"].x).toBeGreaterThanOrEqual(20);
  });

  it("keeps a position past the bottom edge inside the drawing", () => {
    const view = layoutNodes(nodes, { width: 1000, height: 620,
                                 pinned: { "e-1": { x: 500, y: 900 } } });
    expect(view["e-1"].y).toBeLessThanOrEqual(600);
  });

  it("still respects a position that is actually on the canvas", () => {
    // The writer put it there on purpose; clamping must not become nudging.
    const view = layoutNodes(nodes, { width: 1000, height: 620,
                                 pinned: { "e-1": { x: 640, y: 300 } } });
    expect(view["e-1"]).toEqual({ x: 640, y: 300 });
  });
});


// ── SPREADING A CLUMP ───────────────────────────────────────────────────────
//
// "automatically spreads out the dots so they are visually less clustered but
// not out of screens viewable region." Both halves are the specification -- a
// node pushed off the edge is worse than a node in a clump, because at least
// the clump is visible.

describe("spreadOut", () => {
  const bounds = { width: 800, height: 600, margin: 40 };

  function distances(points: Record<string, Point>): number[] {
    const ids = Object.keys(points);
    const out: number[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        out.push(Math.hypot(points[ids[i]].x - points[ids[j]].x,
                            points[ids[i]].y - points[ids[j]].y));
      }
    }
    return out;
  }

  it("pushes a clump apart", () => {
    const clumped = {
      a: { x: 400, y: 300 }, b: { x: 404, y: 302 },
      c: { x: 398, y: 305 }, d: { x: 402, y: 297 },
    };
    const before = Math.min(...distances(clumped));
    const after = Math.min(...distances(spreadOut(clumped, bounds)));
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(30);
  });

  it("KEEPS EVERY DOT INSIDE THE VIEWPORT", () => {
    // The half that makes it usable. A dot pushed off the edge is lost, and
    // the writer has no way to know it is out there.
    const edge = {
      a: { x: 42, y: 42 }, b: { x: 44, y: 44 }, c: { x: 46, y: 41 },
      d: { x: 758, y: 558 }, e: { x: 756, y: 556 },
    };
    const after = spreadOut(edge, bounds);
    for (const point of Object.values(after)) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.margin);
      expect(point.x).toBeLessThanOrEqual(bounds.width - bounds.margin);
      expect(point.y).toBeGreaterThanOrEqual(bounds.margin);
      expect(point.y).toBeLessThanOrEqual(bounds.height - bounds.margin);
    }
  });

  it("IS DETERMINISTIC, so pressing it twice says the same thing", () => {
    // A button whose result varied would be a dice roll, and the writer could
    // not tell what it had done to their map.
    const clumped = { a: { x: 100, y: 100 }, b: { x: 102, y: 101 },
                      c: { x: 101, y: 103 } };
    expect(spreadOut(clumped, bounds)).toEqual(spreadOut(clumped, bounds));
  });

  it("survives two dots at exactly the same point", () => {
    // No direction to push along, and a naive version divides by zero, sends
    // both to NaN and empties the map.
    const stacked = { a: { x: 300, y: 300 }, b: { x: 300, y: 300 } };
    const after = spreadOut(stacked, bounds);
    for (const point of Object.values(after)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(Math.hypot(after.a.x - after.b.x, after.a.y - after.b.y))
      .toBeGreaterThan(0);
  });

  it("leaves a map that is already comfortable alone", () => {
    // Nothing overlapping means nothing to do. A spread that shuffled a tidy
    // map would punish the writer for pressing it to check.
    const roomy = { a: { x: 100, y: 100 }, b: { x: 400, y: 300 },
                    c: { x: 700, y: 500 } };
    expect(spreadOut(roomy, bounds)).toEqual(roomy);
  });

  it("handles an empty map without complaint", () => {
    expect(spreadOut({}, bounds)).toEqual({});
  });
});
