// features/codex/MapEntryList.tsx -- finding a dot without hunting for it
// ========================================================================
// A list of every entry, inside the map, in its top-left corner. Click one and
// the map focuses it exactly as clicking its dot would.
//
// Asked for because of what a real world does to a graph: "This will allow some
// additional functionality when the graph becomes a cluster of chaotic dots due
// to the size of the story."
//
// That is the honest problem with any node map. It is excellent at showing you
// the shape of something you are already looking at, and useless for finding a
// particular thing among two hundred. A sorted list is the opposite, so the two
// belong on one screen rather than behind a toggle.
//
// ── IT REPLACES A TOGGLE, NOT THE LIST VIEW ─────────────────────────────────
//
// The writer asked to remove the [Map] [List] switch at the top, and that is
// done. What is NOT done is deleting WeaveList, and the reason is written at
// the top of that file: it is a peer for keyboard-only use, for screen readers,
// for low vision, and for worlds too large to draw. This dropdown is a
// convenience inside a graphical view -- it is still a set of buttons in an SVG
// screen, and it does not do those four jobs.
//
// So the full list stays reachable from in here. One fewer permanent control,
// nothing lost.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, List, Search } from "lucide-react";

import { nodeLabel, type GraphNode } from "./api";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";

interface Props {
  nodes: GraphNode[];
  /** The entry the map is standing on, so the list can show it. */
  focus: string | null;
  typeLabels?: Record<string, string>;
  iconNames?: Record<string, string>;
  /** Same effect as clicking the dot. */
  onPick: (node: GraphNode) => void;
  /** The full, accessible list view. Absent when the host cannot show it. */
  onOpenListView?: () => void;
}

export function MapEntryList({
  nodes, focus, typeLabels = {}, iconNames = {}, onPick, onOpenListView,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // BY KIND, THEN ALPHABETICALLY, as asked. The kinds themselves are in the
  // registry's own order rather than sorted, so the groups sit in the same
  // sequence as everywhere else in the app -- a list whose headings reorder
  // between screens is one the writer has to re-read every time.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? nodes.filter(n => nodeLabel(n).toLowerCase().includes(needle)
                       || n.aliases.some(a => a.toLowerCase().includes(needle)))
      : nodes;

    const byType = new Map<string, GraphNode[]>();
    for (const node of matching) {
      const list = byType.get(node.type) ?? [];
      list.push(node);
      byType.set(node.type, list);
    }
    for (const list of byType.values()) {
      list.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
    }
    return [...byType.entries()];
  }, [nodes, query]);

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="absolute left-2 top-2 w-56" data-testid="map-entry-list">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-testid="map-entry-list-toggle"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded border border-border bg-bg-surface px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <List size={11} />
        Find an entry
        <span className="ml-auto text-faint">{nodes.length}</span>
      </button>

      {open && (
        <div className="mt-1 rounded border border-border bg-bg-primary shadow-lg">
          <label className="flex items-center gap-1.5 border-b border-border px-2 py-1">
            <Search size={11} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search entries"
              className="w-full bg-transparent text-[11px] text-text-primary outline-none"
            />
          </label>

          {/* Scrolls rather than truncating. The whole point is a world too
              big to see at once, so a capped list would fail the case it was
              built for -- the same mistake WordFix made with its slice of 8. */}
          <ul className="max-h-72 overflow-y-auto py-0.5"
              data-testid="map-entry-list-items">
            {groups.map(([type, list]) => {
              const entry = threadTypeEntry(type, typeLabels[type],
                                            iconNames[type]);
              const Icon = entry.Icon;
              return (
                <li key={type}>
                  <p className="px-2 py-0.5 text-[9px] uppercase tracking-wide text-faint">
                    {entry.term}
                  </p>
                  <ul>
                    {list.map(node => (
                      <li key={node.entity_id}>
                        <button
                          type="button"
                          onClick={() => { onPick(node); setOpen(false); }}
                          className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] ${
                            node.entity_id === focus
                              ? "bg-violet-500/15 text-text-primary"
                              : "text-text-muted hover:bg-white/5"}`}
                        >
                          <Icon size={10}
                                className={`shrink-0 ${TONE_CLASSES[entry.tone].text}`} />
                          <span className="truncate">{nodeLabel(node)}</span>
                          {/* Greyed on the map means "not in this chapter", and
                              a list that did not say so would look like the
                              map was wrong. */}
                          {node.present === false && (
                            <span className="ml-auto shrink-0 text-[9px] text-faint">
                              elsewhere
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {total === 0 && (
              <li className="px-2 py-2 text-[11px] text-faint">
                Nothing matches that.
              </li>
            )}
          </ul>

          {onOpenListView && (
            <button
              type="button"
              onClick={onOpenListView}
              data-testid="map-open-list-view"
              className="w-full border-t border-border px-2 py-1 text-left text-[10px] text-faint hover:text-text-muted"
            >
              Open the full list instead -- readable, keyboard-friendly, and it
              does not cap what it shows
            </button>
          )}
        </div>
      )}
    </div>
  );
}
