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
  /** When the writer declared it OVER, with nothing replacing it. */
  until_label?: string;
  /**
   * Whether this is the state that holds, and if not, why not.
   *
   * THE BUG THIS FIELD EXISTS FOR. This list used to show every stored state
   * as a peer, because the route it reads applied no resolution at all. A
   * character whose relationship had changed -- friends in the first half,
   * rivals in the second, which is the case the whole axis model was built
   * for -- read as though both were true at once.
   */
  state?: "in_force" | "superseded" | "unplaced" | "ambiguous";
  in_force?: boolean;
  /** The paragraph, where the writer wrote one. */
  description?: string;
  /** Whose reading this is, by name. Empty when it is simply the truth. */
  frame_name?: string;
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
        <Link2 size={12} className="shrink-0 text-weave" />
        <h3 className="text-xs font-semibold text-text-primary">Connections</h3>
        <Explain of="profile.connections" />
        <button
          onClick={() => void openConnect()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-weave-fill bg-weave-soft/40 px-2 py-0.5 text-mini text-weave-strong hover:bg-weave-soft/50"
        >
          <Plus size={10} /> Connect {name} to something
        </button>
      </header>

      {ties === null ? (
        <p className="flex items-center gap-1.5 text-mini text-text-muted">
          <Loader size={11} className="animate-spin" /> Reading connections...
        </p>
      ) : ties.length === 0 ? (
        <p className="text-mini text-faint">
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
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-mini text-text-muted"
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
              {/* WHAT HOLDS, FIRST. Reading order is the answer to "what is
                  true now?", so a current state cannot sit in the middle of a
                  list of old ones. Superseded states are kept rather than
                  hidden -- "friends, and before that acquaintances" is worth
                  seeing, and a state that vanished would look like lost work --
                  but they are marked and they come after. */}
              {[...ties].sort((a, b) => {
                const rank = (t: Tie) => (t.in_force === false ? 1 : 0);
                return rank(a) - rank(b);
              }).map(tie => {
                const kind = threadTypeEntry(tie.other_type);
                const KindIcon = kind.Icon;
                // The label and the name are different facts. Only shown
                // together when they differ, or every row would read
                // "Dean (Dean)".
                const full = tie.other_full_name && tie.other_full_name !== tie.other_name
                  ? ` (${tie.other_full_name})` : "";
                const elsewhere = tie.recorded_on && tie.recorded_on !== entityId;
                const past = tie.in_force === false;
                return (
                  <li key={`${tie.src_id}|${tie.rel}|${tie.dst_id}|${tie.frame_name ?? ""}|${tie.at_label}`}
                      className={`flex items-start gap-2 text-mini${past ? " opacity-60" : ""}`}>
                    <KindIcon size={11}
                              className={`mt-0.5 shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
                    <span className="min-w-0 flex-1">
                      {/* SAID BEFORE THE ROW IS READ, not after. A superseded
                          state read as current for its whole first sentence
                          would be worse than not showing it. */}
                      {past && (
                        <span className="mr-1 rounded bg-bg-raised px-1 text-micro uppercase tracking-label text-text-muted">
                          Earlier
                        </span>
                      )}
                      <span className="text-text-primary">
                        {tie.other_name}{full}
                      </span>
                      <span className="text-success"> -- {tie.reads_as} -- </span>
                      {tie.why ? (
                        <span className="text-text-muted">{tie.why}</span>
                      ) : (
                        <span className="text-faint">no reason written</span>
                      )}
                      {tie.at_label && (
                        <span className="text-faint"> (from {tie.at_label})</span>
                      )}
                      {/* Fetched by this component since it was written and
                          rendered by nothing, so a relationship the writer had
                          explicitly ENDED read as ongoing. */}
                      {tie.until_label && (
                        <span className="text-faint"> until {tie.until_label}</span>
                      )}
                      {/* WHOSE READING. Two records of one pair can both be
                          true -- the truth of it, and what one of them
                          believes -- and shown flatly they read as a
                          contradiction in the writer's own notes. */}
                      {tie.frame_name && (
                        <span className="text-weave"> -- as {tie.frame_name} sees it</span>
                      )}
                      {tie.description && (
                        <p className="mt-0.5 text-micro leading-relaxed text-text-muted">
                          {tie.description}
                        </p>
                      )}
                      {elsewhere && (
                        <span className="block text-micro text-faint">
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
            className="mt-2 inline-flex items-center gap-1 text-mini text-weave hover:text-weave-strong"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded
              ? "Show them as chips"
              : `What ${name} is to each of them`}
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-mini text-danger">{error}</p>
      )}
    </section>
  );
}
