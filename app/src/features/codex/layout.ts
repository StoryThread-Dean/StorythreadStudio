// features/codex/layout.ts -- where things sit on the map
// ========================================================
// A graph layout's real job is not to look tidy. It is to be the SAME every
// time, because most of a map's value is that you remember where things are.
// A force-directed layout that reshuffles on every open forces you to
// re-read the whole world each time, and after a few visits you stop
// bothering to look.
//
// So position here is a PURE FUNCTION of what a Thread is:
//
//     cluster centre  <- its type
//     offset within   <- a hash of its id
//
// Two consequences, and the second is the one that matters:
//
//   1. Same world, same picture. Always, on any machine.
//   2. Adding a Thread does not move the ones already there. Its position
//      comes from its own id, not from its index in a list -- so the
//      fiftieth character does not shove the other forty-nine sideways.
//
// That second property is why this is not a force simulation. A physics
// layout is prettier and cannot promise it: one new node changes every
// force in the system. What is here is a deterministic placement plus a
// bounded, deterministic de-overlap pass that only ever nudges.
//
// Writers can drag a node, and their choice is stored per book and wins
// over everything below.

export interface LayoutNode {
  entity_id: string;
  type: string;
  /** How many Ties touch it. Drives size, not position. */
  degree?: number;
}

export interface Point { x: number; y: number }

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** Positions the writer dragged. Always win. */
  pinned?: Record<string, Point>;
  /** Canonical type order, so clusters are evenly spread and stable. */
  typeOrder?: string[];
}

// Rendering budgets. A novel's Weave can reach thousands of nodes and edges,
// and SVG gets painful well before that -- so the map is honest about what
// it is not drawing rather than quietly grinding.
export const MAX_RENDERED_EDGES = 1500;
export const MAX_RENDERED_NODES = 600;
/** Above this many edges, labels appear on hover instead of all at once. */
export const EDGE_LABEL_THRESHOLD = 150;

const TWO_PI = Math.PI * 2;

/**
 * FNV-1a, returning a float in [0, 1).
 *
 * Any stable string hash would do. What matters is that it is the same in
 * every session and on every machine -- so no Math.random(), no Date, and
 * nothing derived from insertion order.
 */
export function hashUnit(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // Multiply by the FNV prime using shifts, to stay inside 32 bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7)
                    + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash / 0x100000000;
}

/**
 * Where a type's cluster sits, as an angle.
 *
 * Built-in types get evenly spaced slots from a canonical order, so the nine
 * of them spread out neatly. A writer's own type hashes into a position of
 * its own -- less even, but stable forever, which is the property that
 * counts.
 */
function clusterAngle(type: string, typeOrder: string[]): number {
  const index = typeOrder.indexOf(type);
  if (index >= 0) return (index / Math.max(typeOrder.length, 1)) * TWO_PI;
  return hashUnit("type:" + type) * TWO_PI;
}

/**
 * Lay out a set of Threads.
 *
 * Returns a position for every node given. Deterministic: the same nodes in
 * any order produce the same map.
 */
export function layoutNodes(
  nodes: LayoutNode[],
  options: LayoutOptions = {},
): Record<string, Point> {
  const width = options.width ?? 1000;
  const height = options.height ?? 700;
  const pinned = options.pinned ?? {};
  const typeOrder = options.typeOrder ?? [];

  const cx = width / 2;
  const cy = height / 2;
  // Clusters sit on a ring; each cluster is a disc. Sized off the smaller
  // dimension so the map fits whichever way the window is shaped.
  const ringRadius = Math.min(width, height) * 0.30;
  const clusterRadius = Math.min(width, height) * 0.16;

  const positions: Record<string, Point> = {};

  for (const node of nodes) {
    const held = pinned[node.entity_id];
    if (held) {
      positions[node.entity_id] = { x: held.x, y: held.y };
      continue;
    }

    const angle = clusterAngle(node.type, typeOrder);
    const clusterX = cx + Math.cos(angle) * ringRadius;
    const clusterY = cy + Math.sin(angle) * ringRadius;

    // Two independent hashes of the id: one for direction, one for distance.
    // sqrt on the radius spreads nodes evenly over the disc instead of
    // bunching them in the middle.
    const a = hashUnit(node.entity_id) * TWO_PI;
    const r = Math.sqrt(hashUnit(node.entity_id + ":r")) * clusterRadius;

    positions[node.entity_id] = {
      x: clamp(clusterX + Math.cos(a) * r, 20, width - 20),
      y: clamp(clusterY + Math.sin(a) * r, 20, height - 20),
    };
  }

  return relaxOverlaps(nodes, positions, pinned, width, height);
}

/**
 * Nudge apart anything sitting on top of something else.
 *
 * Bounded and deterministic: a fixed number of passes over ids in sorted
 * order. It cannot run away, and it cannot produce a different answer on a
 * second run. Pinned nodes never move -- the writer put them there.
 */
function relaxOverlaps(
  nodes: LayoutNode[],
  positions: Record<string, Point>,
  pinned: Record<string, Point>,
  width: number,
  height: number,
): Record<string, Point> {
  const MIN_GAP = 34;
  const PASSES = 12;
  const ids = nodes.map(n => n.entity_id).sort();

  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions[ids[i]];
        const b = positions[ids[j]];
        if (!a || !b) continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);

        if (distance >= MIN_GAP) continue;
        if (distance === 0) {
          // Exactly coincident: separate along a direction derived from the
          // ids, so even this case is reproducible.
          const angle = hashUnit(ids[i] + ids[j]) * TWO_PI;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const push = (MIN_GAP - distance) / 2;
        const ux = (dx / distance) * push;
        const uy = (dy / distance) * push;

        if (!pinned[ids[i]]) {
          a.x = clamp(a.x - ux, 20, width - 20);
          a.y = clamp(a.y - uy, 20, height - 20);
        }
        if (!pinned[ids[j]]) {
          b.x = clamp(b.x + ux, 20, width - 20);
          b.y = clamp(b.y + uy, 20, height - 20);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  return positions;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** How big to draw a node: more connections, bigger dot. Bounded so one
 *  very well-connected character does not swamp the map. */
export function nodeRadius(degree: number): number {
  return Math.min(6 + Math.sqrt(Math.max(degree, 0)) * 2.5, 16);
}

export interface GraphEdge {
  src_id: string;
  dst_id: string;
  rel: string;
  active?: boolean;
  expired?: boolean;
}

/**
 * One Thread and everything within `depth` Ties of it.
 *
 * The Neighborhood layer: the whole world at once is a constellation you can
 * recognise but not read, so clicking a Thread narrows to what actually
 * touches it. Depth defaults to 1 because two hops from a well-connected
 * character is most of the book again.
 */
export function neighborhood(
  edges: GraphEdge[],
  rootId: string,
  depth = 1,
): Set<string> {
  const reached = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let step = 0; step < depth; step++) {
    const next: string[] = [];
    for (const edge of edges) {
      if (frontier.includes(edge.src_id) && !reached.has(edge.dst_id)) {
        reached.add(edge.dst_id);
        next.push(edge.dst_id);
      }
      if (frontier.includes(edge.dst_id) && !reached.has(edge.src_id)) {
        reached.add(edge.src_id);
        next.push(edge.src_id);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return reached;
}

/** How many Ties touch each Thread. Drives node size and the Loose thread
 *  reading -- a degree of zero is a Thread nothing connects to. */
export function degrees(edges: GraphEdge[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const edge of edges) {
    counts[edge.src_id] = (counts[edge.src_id] ?? 0) + 1;
    counts[edge.dst_id] = (counts[edge.dst_id] ?? 0) + 1;
  }
  return counts;
}
