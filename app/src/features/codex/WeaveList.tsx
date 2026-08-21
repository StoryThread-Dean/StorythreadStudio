// features/codex/WeaveList.tsx -- the Weave, read rather than looked at
// ======================================================================
// A PEER OF THE MAP, NOT A FALLBACK.
//
// The map is a good way to understand a world. It must not be the only way,
// for four separate reasons, any one of which would be enough:
//
//   - keyboard-only use. A dot you have to click is a dot you cannot reach.
//   - screen readers. An SVG of circles says nothing useful out loud.
//   - low vision. Colour-coded dots twelve pixels across are not readable.
//   - scale. A long series can hold thousands of Threads; the map caps what
//     it draws, and a list does not have to.
//
// So everything the map can do is here too: the same point in the story, the
// same spoiler control, the same narrowing to one Thread and its
// connections. The controls differ where the input demands it -- a range
// slider is a poor keyboard control, so the point in the story is a select
// here -- but the ANSWERS are identical, because both read the same graph.
//
// Sorting and filtering are the list's own advantage, and the reason a
// writer with a big world may end up preferring it.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Eye, EyeOff, Loader, Search,
} from "lucide-react";

import { WhatsThis } from "../../components/learn/WhatsThis";
import { CONCEPTS, TONE_CLASSES, threadTypeEntry, type Tone } from "./lexicon";
import { degrees, neighborhood } from "./layout";
import {
  fetchAnchors, fetchGraph, fetchTypes,
  type ChapterAnchor, type TypeRegistry, type WeaveGraph,
} from "./api";

type SortKey = "name" | "type" | "ties";

interface WeaveListProps {
  projectPath: string;
  onOpenThread?: (entityId: string) => void;
}

export function WeaveList({ projectPath, onOpenThread }: WeaveListProps) {
  const [graph, setGraph] = useState<WeaveGraph | null>(null);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  const [registry, setRegistry] = useState<TypeRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chapterIndex, setChapterIndex] = useState(-1);
  const [hideSpoilers, setHideSpoilers] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [ascending, setAscending] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read the Weave.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath, at, hideSpoilers]);

  const typeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of registry?.types ?? []) map[t.id] = t.label;
    return map;
  }, [registry]);

  // Icons come from the registry too, so a kind the writer added shows its
  // own symbol rather than falling back to a generic one.
  const iconNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of registry?.types ?? []) map[t.id] = t.icon;
    return map;
  }, [registry]);

  const rows = useMemo(() => {
    if (!graph) return [];
    const degree = degrees(graph.edges);
    const needle = search.trim().toLowerCase();

    let list = graph.nodes.map(node => ({
      ...node,
      ties: degree[node.entity_id] ?? 0,
      label: typeLabels[node.type] ?? node.type,
    }));

    if (typeFilter) list = list.filter(r => r.type === typeFilter);
    if (needle) list = list.filter(r => r.name.toLowerCase().includes(needle));

    list.sort((a, b) => {
      const direction = ascending ? 1 : -1;
      if (sortKey === "ties") return (a.ties - b.ties) * direction;
      if (sortKey === "type") return a.label.localeCompare(b.label) * direction;
      return a.name.localeCompare(b.name) * direction;
    });
    return list;
  }, [graph, typeFilter, search, sortKey, ascending, typeLabels]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending(v => !v);
    else { setSortKey(key); setAscending(true); }
  }

  if (error) {
    return (
      <div className="rounded border border-rose-800 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
        <AlertTriangle size={13} className="mr-1.5 inline" />
        {error}
      </div>
    );
  }

  const atLabel = chapterIndex >= 0
    ? chapters[chapterIndex]?.title ?? "this chapter"
    : "the end of the book";

  return (
    <div className="flex flex-col gap-2" data-testid="weave-list">

      {/* ── The same controls as the map, in forms you can reach by keyboard ── */}
      <div className="flex flex-wrap items-end gap-3 rounded border border-border bg-bg-primary px-3 py-2">
        <label className="flex flex-col gap-1 text-mini text-text-muted">
          Point in the story
          {/* A select rather than the map's slider: a range input is a poor
              keyboard control, and this view exists to be reachable. Same
              question, same answer, better input. */}
          <select
            value={chapterIndex}
            onChange={e => setChapterIndex(parseInt(e.target.value, 10))}
            className="rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary"
          >
            <option value={-1}>The end of the book</option>
            {chapters.map((chapter, index) => (
              <option key={chapter.chapter_id} value={index}>{chapter.title}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-mini text-text-muted">
          Kind
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary"
          >
            <option value="">All kinds</option>
            {(registry?.types ?? []).map(type => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-mini text-text-muted">
          Find
          <span className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name..."
              className="w-full rounded border border-border bg-bg-surface py-1 pl-6 pr-2 text-xs text-text-primary placeholder-faint"
            />
          </span>
        </label>

        <button
          type="button"
          onClick={() => setHideSpoilers(v => !v)}
          aria-pressed={hideSpoilers}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-mini text-text-muted hover:border-violet-600 hover:text-text-primary"
        >
          {hideSpoilers ? <EyeOff size={11} /> : <Eye size={11} />}
          {hideSpoilers ? "Hiding what the reader does not know yet" : "Showing everything"}
        </button>

        {loading && <Loader size={12} className="animate-spin text-faint" />}
      </div>

      <p className="text-mini text-faint">
        Your world as of <span className="text-violet-300">{atLabel}</span>
        {" -- "}{rows.length} {rows.length === 1 ? "entry" : "entries"}.
      </p>

      {/* ── The table ────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <EmptyList hasWorld={(graph?.hidden_nodes ?? 0) > 0 || Boolean(search || typeFilter)}
                   atLabel={atLabel} />
      ) : (
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Every entry in your world as of {atLabel}, with how many connections each has.
          </caption>
          <thead>
            <tr className="border-b border-border text-mini text-text-muted">
              <SortHeader label="Name" active={sortKey === "name"} ascending={ascending}
                          onClick={() => toggleSort("name")} />
              <SortHeader label="Kind" active={sortKey === "type"} ascending={ascending}
                          onClick={() => toggleSort("type")} />
              <SortHeader label="Connections" active={sortKey === "ties"} ascending={ascending}
                          onClick={() => toggleSort("ties")} />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const entry = threadTypeEntry(row.type, row.label, iconNames[row.type]);
              const Icon = entry.Icon;
              const isOpen = expanded === row.entity_id;
              return (
                <tr key={row.entity_id}
                    className="border-b border-border/50 align-top">
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : row.entity_id)}
                      onDoubleClick={() => onOpenThread?.(row.entity_id)}
                      aria-expanded={isOpen}
                      className="text-left text-text-primary hover:text-violet-300"
                    >
                      {row.name}
                    </button>
                    {isOpen && (
                      <TieList graph={graph} entityId={row.entity_id}
                               registry={registry} />
                    )}
                  </th>
                  <td className="py-1.5 pr-3 text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Icon size={11} className={TONE_CLASSES[entry.tone as Tone].text} />
                      {row.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-text-muted">
                    {row.ties === 0
                      // Named, not left as a bare zero: this is exactly what
                      // the walkthrough will later call a Loose thread.
                      ? <span className="text-faint">none yet</span>
                      : row.ties}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {graph && (graph.hidden_nodes > 0 || graph.hidden_edges > 0) && (
        <p data-testid="weave-list-hidden" className="text-mini text-faint">
          Not shown: {graph.hidden_nodes} {graph.hidden_nodes === 1 ? "entry" : "entries"}
          {graph.hidden_edges > 0 && ` and ${graph.hidden_edges} connection${graph.hidden_edges === 1 ? "" : "s"}`}
          {" "}not introduced yet, or kept from AI.
        </p>
      )}

      <div>
        <WhatsThis label="What is this list?">
          The same world the map shows, read rather than looked at. Everything
          here answers the same questions -- what exists, how it connects, and
          when. {CONCEPTS.tie.does} Use whichever suits you: the map is better
          for seeing shape, this is better for finding one thing among many,
          and it works with a keyboard and a screen reader.
        </WhatsThis>
      </div>
    </div>
  );
}


function SortHeader({ label, active, ascending, onClick }: {
  label: string; active: boolean; ascending: boolean; onClick: () => void;
}) {
  return (
    <th scope="col" className="py-1.5 pr-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
        className="inline-flex items-center gap-1 hover:text-text-primary"
      >
        {label}
        {active && (ascending ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}


/**
 * How a connection reads from ONE end of it.
 *
 * A Tie is stored once, in one direction, and read from both -- so arriving
 * at it from the far end has to produce a sentence rather than the stored
 * relation with a preposition bolted on. "mentored_by" read backwards is
 * not "is mentored by by Elara", it is "mentor of Elara", and the registry
 * already knows that because every relation declares its inverse.
 *
 * Three cases, in order of how good the answer is:
 *   symmetric      reads the same from either end ("sibling of")
 *   has an inverse use it ("mentored by" -> "mentor of")
 *   neither        say the direction plainly rather than inventing grammar
 */
function tiePhrase(
  rel: string,
  outgoing: boolean,
  registry: TypeRegistry | null,
): { phrase: string; prefix: string } {
  const readable = (id: string) => id.replace(/_/g, " ");
  const relation = registry?.relations.find(r => r.id === rel);

  if (outgoing || relation?.symmetric) {
    return { phrase: readable(relation?.label ?? rel), prefix: "" };
  }
  if (relation?.inverse) {
    return { phrase: readable(relation.inverse), prefix: "" };
  }
  // No inverse declared -- a custom relation, most likely. An arrow is
  // honest where a guessed sentence would be wrong.
  return { phrase: readable(rel), prefix: "← " };
}


function TieList({ graph, entityId, registry }: {
  graph: WeaveGraph | null;
  entityId: string;
  registry: TypeRegistry | null;
}) {
  if (!graph) return null;
  // The list's equivalent of the map's Neighborhood: one Thread and what
  // touches it. Both directions, because a Tie is stored once and read from
  // either end.
  const near = neighborhood(graph.edges, entityId, 1);
  const names: Record<string, string> = {};
  for (const node of graph.nodes) names[node.entity_id] = node.name;

  const ties = graph.edges.filter(
    e => e.src_id === entityId || e.dst_id === entityId,
  );

  if (ties.length === 0) {
    return (
      <p className="mt-1 text-mini text-faint">
        Nothing connects to this yet.
      </p>
    );
  }

  return (
    <ul className="mt-1 space-y-0.5">
      {ties.map((tie, i) => {
        const outgoing = tie.src_id === entityId;
        const otherId = outgoing ? tie.dst_id : tie.src_id;
        const { phrase, prefix } = tiePhrase(tie.rel, outgoing, registry);
        return (
          <li key={`${tie.rel}-${otherId}-${i}`} className="text-mini text-text-muted">
            {prefix}
            <span className="text-violet-300">{phrase}</span>
            {" "}
            {names[otherId] ?? otherId}
            {!tie.active && (
              <span className="ml-1 text-faint">
                ({tie.expired ? "no longer" : "not yet"})
              </span>
            )}
          </li>
        );
      })}
      <li className="sr-only">{near.size - 1} connected entries.</li>
    </ul>
  );
}


function EmptyList({ hasWorld, atLabel }: { hasWorld: boolean; atLabel: string }) {
  return (
    <div className="rounded border border-border bg-bg-primary px-4 py-6 text-center">
      <p className="text-sm text-text-primary">
        {hasWorld
          ? `Nothing here as of ${atLabel}.`
          : "Your world is empty so far."}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-faint">
        {hasWorld
          ? "Try a later point in the story, a different kind, or clear the search."
          : CONCEPTS.thread.whatsThis}
      </p>
    </div>
  );
}
