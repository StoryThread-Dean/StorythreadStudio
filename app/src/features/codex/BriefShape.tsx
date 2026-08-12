// features/codex/BriefShape.tsx -- the shape of what the AI is about to be told
// =============================================================================
// The spec is blunt about this, and it was overruled by accident:
//
//     "The inspect panel is a small map, not a list: the Threads going into the
//      brief, drawn with their Ties, at the anchor being written."
//
// It shipped as a list. The list is good -- it is the only thing that can carry
// per-Thread cost, a remove button, and the exact words -- but the spec was
// right about what a list cannot do. Eight names in a column do not show that
// Alexandra and Dean are connected while the Guild is sitting there attached to
// nothing. That is the judgement a writer makes at a glance and cannot make
// from a list at all.
//
// Ruling (recovery task R1.3): BOTH. This draws the shape; the list underneath
// stays the workbench.
//
// WHY IT IS NOT INTERACTIVE. It answers one question -- "does this look like
// the right corner of my world?" -- and every action already has a home in the
// list below. A second set of clickable dots would put two ways to remove a
// Thread on one screen, which is how a writer ends up unsure whether they
// removed it once or twice.
//
// It draws only what the brief CARRIES. A Tie to something the brief left out
// is not drawn, because a line to nowhere would read as "this is in the brief"
// about a Thread that was pruned -- the opposite of what the panel is for.

import { useMemo } from "react";

import { layoutNodes, nodeRadius, type LayoutNode } from "./layout";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import type { GraphEdge } from "./api";

const WIDTH = 420;
const HEIGHT = 150;

interface BriefShapeProps {
  /** The Threads the brief carries: entity_id, name and type. */
  threads: { entity_id: string; name: string; type: string }[];
  /** Every edge in the world; the ones between carried Threads get drawn. */
  edges: GraphEdge[];
  /** Where in the story this is as of, in the writer's words. */
  asOfLabel: string;
}

export function BriefShape({ threads, edges, asOfLabel }: BriefShapeProps) {
  const carried = useMemo(
    () => new Set((threads ?? []).map(t => t.entity_id)), [threads]);

  // Only edges with BOTH ends in the brief. See the header. Defaulted rather
  // than trusted: this is decoration, and decoration must never be able to
  // take down the controls it sits above.
  const inside = useMemo(
    () => (edges ?? []).filter(e => carried.has(e.src_id)
                                    && carried.has(e.dst_id)),
    [edges, carried]);

  const degrees = useMemo(() => {
    const count: Record<string, number> = {};
    for (const edge of inside) {
      count[edge.src_id] = (count[edge.src_id] ?? 0) + 1;
      count[edge.dst_id] = (count[edge.dst_id] ?? 0) + 1;
    }
    return count;
  }, [inside]);

  // The same deterministic layout the big map uses, so a Thread sits in the
  // same relative place in both and the writer is not re-reading their world.
  const positions = useMemo(() => {
    const asLayout: LayoutNode[] = threads.map(t => ({
      entity_id: t.entity_id, type: t.type, name: t.name,
      display_name: "", aliases: [], placeholder: false,
    }));
    return layoutNodes(asLayout, { width: WIDTH, height: HEIGHT });
  }, [threads]);

  if (threads.length === 0) return null;

  const unconnected = threads.filter(t => !degrees[t.entity_id]).length;

  return (
    <div className="mb-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${threads.length} Threads going to the AI, as of ${asOfLabel}`}
        data-testid="brief-shape"
        className="w-full rounded border border-border bg-bg-surface"
      >
        {inside.map((edge, i) => {
          const a = positions[edge.src_id];
          const b = positions[edge.dst_id];
          if (!a || !b) return null;
          return (
            <line
              key={`${edge.src_id}-${edge.rel}-${edge.dst_id}-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              className="stroke-zinc-600" strokeWidth={1}
            />
          );
        })}
        {threads.map(thread => {
          const at = positions[thread.entity_id];
          if (!at) return null;
          const kind = threadTypeEntry(thread.type);
          const alone = !degrees[thread.entity_id];
          return (
            <g key={thread.entity_id}>
              <circle
                cx={at.x} cy={at.y}
                r={nodeRadius(degrees[thread.entity_id] ?? 0)}
                className={TONE_CLASSES[kind.tone].fill}
                // A Thread attached to nothing else in the brief is drawn
                // hollow. It is not an error -- background context is real --
                // but it is the thing worth noticing, because a brief full of
                // unconnected entries is a brief that will read as a list of
                // facts rather than as a world.
                fillOpacity={alone ? 0.25 : 1}
                stroke="currentColor"
                strokeWidth={alone ? 1 : 0}
              />
              <text
                x={at.x} y={at.y - nodeRadius(degrees[thread.entity_id] ?? 0) - 3}
                textAnchor="middle"
                className="fill-zinc-300 text-[8px]"
              >
                {thread.name}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10px] text-faint">
        {inside.length === 0
          ? `${threads.length} ${threads.length === 1 ? "Thread" : "Threads"}, `
            + "none connected to each other here"
          : `${inside.length} ${inside.length === 1 ? "connection" : "connections"} `
            + `between them`}
        {unconnected > 0 && inside.length > 0
          ? `, and ${unconnected} attached to nothing else in this brief`
          : ""}
        . As of {asOfLabel}.
      </p>
    </div>
  );
}
