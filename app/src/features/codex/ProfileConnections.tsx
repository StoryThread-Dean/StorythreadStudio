// features/codex/ProfileConnections.tsx -- who this profile is to everyone else
// =============================================================================
// The Weave's connections, shown where a writer actually works on a character.
//
// Asked for in exactly this shape: a row of small chips while you are writing,
// and a fuller account when you want it.
//
//     [o Lexa] [o Dean] [o Liam] [I Croft Manor] [* Pathicus]
//
//     > Lara Croft is connected to:
//       Lexa (Alexandra Langford) -- partners with -- recently met and became
//         friends with     (recorded on Alexandra Langford's page)
//
// THREE THINGS THE DETAILED ROW HAS TO CARRY, and each was asked for:
//
//   The LABEL AND THE NAME. "Lexa (Alexandra Langford)" -- what the story
//   calls her, and who she is. They are different facts and a profile is
//   exactly where both matter.
//
//   THE REASON, in the writer's words. The relation is the filing; the reason
//   is the story ("takes care of her needs when the curse flares up"). It is
//   the required half of a connection, and a list that hides it shows the
//   least interesting part of what was written.
//
//   WHERE IT IS RECORDED. A Tie is stored once and read from both ends, so a
//   connection visible on Lara's page may live in Alexandra's file. Without
//   saying so, "why can I see this here but not find it in her file?" has no
//   answer.
//
// WHY THIS REUSES THE WEAVE'S OWN CONNECT DIALOG rather than a simpler one of
// its own: there is one way to record a connection in this app, and it asks
// for the reason first. A second, easier path that skipped the reason would
// quietly fill the world with connections that tell the AI nothing -- which
// is the exact failure the reason line was added to prevent.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Link2, Loader, Plus } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { fetchGraph, type GraphNode } from "./api";
import { TieEditor } from "./TieEditor";

const API_BASE = "http://localhost:8000";

interface Tie {
  src_id: string;
  dst_id: string;
  rel: string;
  incoming: boolean;
  other_id: string;
  /** What the story calls it -- the display name where there is one. */
  other_name: string;
  /** What it IS. Shown in brackets when it differs from the label. */
  other_full_name?: string;
  other_type: string;
  /** The relation, read from THIS end. */
  reads_as: string;
  /** The reason, read from this end. The part worth reading. */
  why?: string;
  /** Whose file holds it. */
  recorded_on?: string;
  at_label: string;
}

interface ProfileConnectionsProps {
  projectPath: string;
  /** The entry whose connections these are. */
  entityId: string;
  /** Its type, for the connect dialog. */
  type: string;
  /** What to call it on screen. */
  name: string;
  /** Open expanded. A profile page has room; a sidebar does not. */
  startExpanded?: boolean;
}

export function ProfileConnections({
  projectPath, entityId, type, name, startExpanded = false,
}: ProfileConnectionsProps) {
  const [ties, setTies] = useState<Tie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(startExpanded);
  const [connecting, setConnecting] = useState(false);
  const [world, setWorld] = useState<GraphNode[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/codex/ties?project_path=${encodeURIComponent(projectPath)}`
        + `&entity_id=${encodeURIComponent(entityId)}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "Connections could not be read.");
      }
      setTies((body.ties ?? []) as Tie[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connections could not be read.");
      setTies(prev => prev ?? []);        // the spinner must end
    }
  }, [projectPath, entityId]);

  useEffect(() => { void load(); }, [load]);

  /** Everything there is to connect to. Fetched when the writer asks, not on
   *  mount: most visits to a profile are to write, not to connect. */
  async function openConnect() {
    try {
      const graph = await fetchGraph(projectPath, { hideSpoilers: false });
      setWorld(graph.nodes);
    } catch {
      setWorld([]);                       // the picker says so rather than crashing
    }
    setConnecting(true);
  }

  const me = useMemo<GraphNode>(() => ({
    entity_id: entityId, type, name,
    display_name: "", aliases: [], placeholder: false,
  }), [entityId, type, name]);

  if (connecting) {
    return (
      <TieEditor
        projectPath={projectPath}
        thread={me}
        candidates={world}
        onClose={() => setConnecting(false)}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <section className="rounded border border-border bg-bg-surface p-2.5">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Link2 size={12} className="shrink-0 text-violet-300" />
        <h3 className="text-xs font-semibold text-text-primary">Connections</h3>
        <Explain of="profile.connections" />
        <button
          onClick={() => void openConnect()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-violet-700 bg-violet-950/40 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-900/50"
        >
          <Plus size={10} /> Connect {name} to something
        </button>
      </header>

      {ties === null ? (
        <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <Loader size={11} className="animate-spin" /> Reading connections...
        </p>
      ) : ties.length === 0 ? (
        <p className="text-[11px] text-faint">
          Nothing yet. A connection is how this relates to the rest of your
          world -- who it knows, where it belongs, what it serves. Nothing can
          work that out for you, and it is what the AI is told when you ask
          for help with a scene.
        </p>
      ) : (
        <>
          {/* ── Minimised: the chips ──────────────────────────────────── */}
          {!expanded && (
            <div className="flex flex-wrap gap-1" data-testid="connection-chips">
              {ties.map(tie => {
                const kind = threadTypeEntry(tie.other_type);
                const KindIcon = kind.Icon;
                return (
                  <span
                    key={`${tie.src_id}|${tie.rel}|${tie.dst_id}`}
                    title={`${tie.reads_as} ${tie.other_name}`}
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted"
                  >
                    <KindIcon size={10}
                              className={`shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
                    {tie.other_name}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── Expanded: what each one actually IS ───────────────────── */}
          {expanded && (
            <ul className="space-y-1.5" data-testid="connection-details">
              {ties.map(tie => {
                const kind = threadTypeEntry(tie.other_type);
                const KindIcon = kind.Icon;
                // The label and the name are different facts. Only shown
                // together when they differ, or every row would read
                // "Dean (Dean)".
                const full = tie.other_full_name && tie.other_full_name !== tie.other_name
                  ? ` (${tie.other_full_name})` : "";
                const elsewhere = tie.recorded_on && tie.recorded_on !== entityId;
                return (
                  <li key={`${tie.src_id}|${tie.rel}|${tie.dst_id}`}
                      className="flex items-start gap-2 text-[11px]">
                    <KindIcon size={11}
                              className={`mt-0.5 shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
                    <span className="min-w-0 flex-1">
                      <span className="text-text-primary">
                        {tie.other_name}{full}
                      </span>
                      <span className="text-emerald-300"> -- {tie.reads_as} -- </span>
                      {tie.why ? (
                        <span className="text-text-muted">{tie.why}</span>
                      ) : (
                        <span className="text-faint">no reason written</span>
                      )}
                      {tie.at_label && (
                        <span className="text-faint"> (from {tie.at_label})</span>
                      )}
                      {elsewhere && (
                        <span className="block text-[10px] text-faint">
                          recorded on {tie.other_name}&rsquo;s page
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded
              ? "Show them as chips"
              : `What ${name} is to each of them`}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-rose-300">{error}</p>
      )}
    </section>
  );
}
