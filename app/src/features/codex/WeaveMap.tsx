// features/codex/WeaveMap.tsx -- your world, and when things became true
// =======================================================================
// The map is where the Weave stops being a data model and becomes something
// you can look at. Threads are dots, Ties are lines, and the control that
// earns the whole feature is the SCRUBBER along the bottom.
//
// Drag it and the map redraws as of that point in the story: Threads appear
// when they are introduced, connections light up when they become true, and
// with spoilers hidden nothing the reader has not learned yet is on screen.
// A writer who drags that handle from chapter one to chapter twenty
// understands what the Weave is for in about three seconds, which no amount
// of explanatory text achieves.
//
// WHY HAND-ROLLED SVG. There is no graph library in this project, and adding
// one would put a rendering engine between the writer and about two hundred
// lines of drawing. Nodes and lines with a deterministic layout (layout.ts)
// are enough for a novel, and the bundle stays small enough to ship in a
// desktop app.
//
// WHAT THIS IS NOT. It is not the only way to read the Weave. Everything
// here is also in WeaveList, which is keyboard-navigable and works at any
// size -- see the note there. A picture is a good way to understand a world;
// it must not be the ONLY way.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Loader, RotateCcw } from "lucide-react";

import { WhatsThis } from "../../components/learn/WhatsThis";
import {
  CONCEPTS, TONE_CLASSES, threadTypeEntry, type Tone,
} from "./lexicon";
import {
  EDGE_LABEL_THRESHOLD, MAX_RENDERED_EDGES, MAX_RENDERED_NODES,
  degrees, layoutNodes, neighborhood, nodeRadius, type Point,
} from "./layout";
import {
  fetchAnchors, fetchGraph, fetchTypes,
  type ChapterAnchor, type TypeRegistry, type WeaveGraph,
} from "./api";

const WIDTH = 1000;
const HEIGHT = 620;

interface WeaveMapProps {
  projectPath: string;
  /** Positions the writer has dragged, from per-book UI state. */
  pinned?: Record<string, Point>;
  onPin?: (positions: Record<string, Point>) => void;
  onOpenThread?: (entityId: string) => void;
}

export function WeaveMap({ projectPath, pinned, onPin, onOpenThread }: WeaveMapProps) {
  const [graph, setGraph] = useState<WeaveGraph | null>(null);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  const [registry, setRegistry] = useState<TypeRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -1 means "the end of the book" -- the whole finished story, which is how
  // a writer looking at their world as a whole sees it.
  const [chapterIndex, setChapterIndex] = useState(-1);
  const [hideSpoilers, setHideSpoilers] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);

  const at = chapterIndex >= 0 ? chapters[chapterIndex]?.anchor : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [anchors, types] = await Promise.all([
          fetchAnchors(projectPath), fetchTypes(projectPath),
        ]);
        if (cancelled) return;
        setChapters(anchors.chapters);
        setRegistry(types);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open the Weave.");
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchGraph(projectPath, { at, hideSpoilers });
        if (!cancelled) { setGraph(data); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not draw the map.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath, at, hideSpoilers]);

  const typeOrder = useMemo(
    () => (registry?.types ?? []).map(t => t.id),
    [registry],
  );
  const typeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of registry?.types ?? []) map[t.id] = t.label;
    return map;
  }, [registry]);
  // Icons from the registry, so a kind the writer added shows its own
  // symbol rather than the generic fallback.
  const iconNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of registry?.types ?? []) map[t.id] = t.icon;
    return map;
  }, [registry]);

  // What is actually drawn. Budgets are applied here rather than in the
  // renderer so the counts can be REPORTED -- a map that quietly omits
  // things looks like a world with less in it than the writer built.
  const view = useMemo(() => {
    if (!graph) return null;
    let nodes = graph.nodes;
    let edges = graph.edges;

    if (focus) {
      const near = neighborhood(edges, focus, 1);
      nodes = nodes.filter(n => near.has(n.entity_id));
      edges = edges.filter(e => near.has(e.src_id) && near.has(e.dst_id));
    }

    const overNodes = Math.max(0, nodes.length - MAX_RENDERED_NODES);
    const overEdges = Math.max(0, edges.length - MAX_RENDERED_EDGES);
    if (overNodes > 0) {
      // Keep the best-connected: on a crowded map the hubs are what make it
      // legible, and the isolated dots are the least informative thing to
      // draw.
      const degree = degrees(edges);
      nodes = [...nodes]
        .sort((a, b) => (degree[b.entity_id] ?? 0) - (degree[a.entity_id] ?? 0))
        .slice(0, MAX_RENDERED_NODES);
      const kept = new Set(nodes.map(n => n.entity_id));
      edges = edges.filter(e => kept.has(e.src_id) && kept.has(e.dst_id));
    }
    if (edges.length > MAX_RENDERED_EDGES) edges = edges.slice(0, MAX_RENDERED_EDGES);

    const degree = degrees(edges);
    const positions = layoutNodes(
      nodes.map(n => ({ entity_id: n.entity_id, type: n.type })),
      { width: WIDTH, height: HEIGHT, pinned, typeOrder },
    );
    return { nodes, edges, positions, degree, overNodes, overEdges };
  }, [graph, focus, pinned, typeOrder]);

  // ── Dragging ───────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<string | null>(null);

  function pointAt(event: React.MouseEvent): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * WIDTH,
      y: ((event.clientY - box.top) / box.height) * HEIGHT,
    };
  }

  function onMouseMove(event: React.MouseEvent) {
    if (!dragging.current || !onPin) return;
    const point = pointAt(event);
    if (point) onPin({ ...(pinned ?? {}), [dragging.current]: point });
  }

  if (error) {
    return (
      <div className="rounded border border-rose-800 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
        <AlertTriangle size={13} className="mr-1.5 inline" />
        {error}
      </div>
    );
  }

  const label = chapterIndex >= 0
    ? chapters[chapterIndex]?.title ?? "this chapter"
    : "the end of the book";

  return (
    <div className="flex flex-col gap-2" data-testid="weave-map">

      {/* ── The scrubber. The control that earns the feature. ───────────── */}
      <div className="rounded border border-border bg-bg-primary px-3 py-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-text-primary">
            Showing your world as of{" "}
            <span className="text-violet-300">{label}</span>
          </span>
          <button
            type="button"
            onClick={() => setHideSpoilers(v => !v)}
            aria-pressed={hideSpoilers}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-violet-600 hover:text-text-primary"
          >
            {hideSpoilers ? <EyeOff size={11} /> : <Eye size={11} />}
            {hideSpoilers ? "Hiding what the reader does not know yet" : "Showing everything"}
          </button>
          {loading && <Loader size={11} className="animate-spin text-faint" />}
        </div>

        {chapters.length > 0 ? (
          <input
            type="range"
            min={-1}
            max={chapters.length - 1}
            step={1}
            value={chapterIndex}
            onChange={e => setChapterIndex(parseInt(e.target.value, 10))}
            aria-label="Point in the story"
            className="w-full accent-violet-500"
          />
        ) : (
          <p className="text-[11px] text-faint">
            This project has no chapters yet, so there is no story to move through.
          </p>
        )}

        <div className="mt-1">
          <WhatsThis label="What does this slider do?">
            {CONCEPTS.run.whatsThis} Drag it and the map redraws as of that point:
            entries appear when they are introduced, connections light up when
            they become true. With spoilers hidden, nothing your reader has not
            learned yet is shown -- which is also exactly what your AI is told
            when you write at that point.
          </WhatsThis>
        </div>
      </div>

      {/* ── The map ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded border border-border bg-bg-primary">
        {view && view.nodes.length === 0 ? (
          <EmptyMap hasWorld={(graph?.hidden_nodes ?? 0) > 0} atLabel={label} />
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[60vh] w-full"
            role="img"
            aria-label="Map of your world"
            onMouseMove={onMouseMove}
            onMouseUp={() => { dragging.current = null; }}
            onMouseLeave={() => { dragging.current = null; }}
          >
            {view?.edges.map((edge, i) => {
              const a = view.positions[edge.src_id];
              const b = view.positions[edge.dst_id];
              if (!a || !b) return null;
              return (
                <g key={`${edge.src_id}-${edge.rel}-${edge.dst_id}-${i}`}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={edge.active ? "stroke-zinc-600" : "stroke-zinc-700"}
                    strokeWidth={1.2}
                    // Not yet true, or already over: drawn but distinguished.
                    // The writer is looking at their own future book, not a
                    // reader's view.
                    strokeDasharray={edge.active ? undefined : "4 3"}
                    opacity={edge.expired ? 0.35 : 1}
                  />
                  {view.edges.length <= EDGE_LABEL_THRESHOLD && (
                    <text
                      x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3}
                      textAnchor="middle"
                      className="fill-zinc-500 text-[9px]"
                    >
                      {edge.rel.replace(/_/g, " ")}
                    </text>
                  )}
                </g>
              );
            })}

            {view?.nodes.map(node => {
              const point = view.positions[node.entity_id];
              if (!point) return null;
              const entry = threadTypeEntry(node.type, typeLabels[node.type],
                                            iconNames[node.type]);
              const radius = nodeRadius(view.degree[node.entity_id] ?? 0);
              const tone = TONE_CLASSES[entry.tone as Tone];
              const isFocus = focus === node.entity_id;
              return (
                <g
                  key={node.entity_id}
                  transform={`translate(${point.x} ${point.y})`}
                  className="cursor-pointer"
                  onMouseDown={() => { dragging.current = node.entity_id; }}
                  onClick={() => setFocus(isFocus ? null : node.entity_id)}
                  onDoubleClick={() => onOpenThread?.(node.entity_id)}
                >
                  <title>{`${node.name} -- ${entry.term}`}</title>
                  <circle
                    r={radius}
                    className={`${tone.fill} ${isFocus ? "stroke-white" : "stroke-zinc-900"}`}
                    strokeWidth={isFocus ? 2 : 1}
                  />
                  <text
                    y={radius + 11} textAnchor="middle"
                    className="fill-zinc-300 text-[10px]"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {focus && (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border bg-bg-surface px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
          >
            <RotateCcw size={11} /> Show the whole world
          </button>
        )}
      </div>

      {/* ── What is not on screen. Never silent. ────────────────────────── */}
      <HiddenNotice graph={graph} view={view} hideSpoilers={hideSpoilers} />

      {/* ── Legend, rendered from the Lexicon ───────────────────────────── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-border bg-bg-primary px-3 py-2">
        {(registry?.types ?? []).map(type => {
          const entry = threadTypeEntry(type.id, type.label, type.icon);
          const Icon = entry.Icon;
          return (
            <span key={type.id} className="inline-flex items-center gap-1 text-[11px]"
                  title={entry.short}>
              <Icon size={11} className={TONE_CLASSES[entry.tone as Tone].text} />
              <span className="text-text-muted">{entry.term}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}


function HiddenNotice({ graph, view, hideSpoilers }: {
  graph: WeaveGraph | null;
  view: { overNodes: number; overEdges: number } | null;
  hideSpoilers: boolean;
}) {
  if (!graph) return null;
  const parts: string[] = [];
  if (graph.hidden_nodes > 0) {
    parts.push(`${graph.hidden_nodes} ${graph.hidden_nodes === 1 ? "entry" : "entries"} `
      + (hideSpoilers ? "not introduced yet, or kept from AI" : "kept from AI"));
  }
  if (graph.hidden_edges > 0) {
    parts.push(`${graph.hidden_edges} connection${graph.hidden_edges === 1 ? "" : "s"} hidden`);
  }
  if (view && view.overNodes > 0) {
    parts.push(`${view.overNodes} more not drawn (too many to show at once)`);
  }
  if (view && view.overEdges > 0) {
    parts.push(`${view.overEdges} more connections not drawn`);
  }
  if (parts.length === 0) return null;

  return (
    <p data-testid="weave-hidden-notice"
       className="rounded border border-border bg-bg-primary px-3 py-1.5 text-[11px] text-faint">
      Not shown: {parts.join(" · ")}.
    </p>
  );
}


function EmptyMap({ hasWorld, atLabel }: { hasWorld: boolean; atLabel: string }) {
  // An empty screen should teach rather than look broken. The two reasons
  // for emptiness need different sentences: nothing exists yet, versus
  // nothing exists YET at this point in the story.
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-sm text-text-primary">
        {hasWorld
          ? `Nothing in your world has appeared by ${atLabel}.`
          : "Your world is empty so far."}
      </p>
      <p className="max-w-md text-xs text-faint">
        {hasWorld
          ? "Drag the slider further along, or turn off spoiler hiding to see everything you have written."
          : CONCEPTS.thread.whatsThis}
      </p>
    </div>
  );
}
