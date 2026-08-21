// features/codex/NodeWorkbench.tsx -- the map as a place to work, not just look
// ==============================================================================
// What opens when a writer stands on an entry in the map and wants to DO
// something to it.
//
// The ask, in the writer's words: "The Weave is a great graphical means to show
// the connections to each character. But currently, it functions as a visual
// means with minor basic functionality ... It should be more."
//
// And the principle they set, which decides how this is built rather than
// merely what it holds:
//
//   "important features like Connections, Creating a profile, Building a
//    profile, Extracting a Profile shouldn't be limited to a single location or
//    area within the application"
//
// So this panel OWNS NOTHING. Every section is a second mount of a component
// that already exists and is already tested somewhere else:
//
//   Where it appears            -> AppearsIn      (also on the profile page)
//   How this changes            -> RunEditor      (also on the profile page)
//   Connections                 -> TieEditor      (already on this map)
//   Open the full profile       -> the app's own navigation
//
// A second IMPLEMENTATION of any of them would be two vocabularies for one
// idea, which is the failure this whole recovery kept finding. A second MOUNT
// is the thing being asked for.
//
// WHY A PANEL RATHER THAN A DIALOG. The map is the context. A modal over it
// would hide the neighbourhood the writer clicked from, and the reason they
// are editing this entry is usually something they can see around it.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader, Save, X } from "lucide-react";

import { useAttemptClose } from "../../components/learn/useAttemptClose";
import { AppearsIn } from "./AppearsIn";
import { RunEditor } from "./RunEditor";
import {
  fetchThread, nodeLabel, saveThreadDetail,
  type ChapterAnchor, type GraphNode, type ThreadDetail,
} from "./api";

interface Props {
  projectPath: string;
  node: GraphNode;
  chapters: ChapterAnchor[];
  /** Everything else in the world, for the Run's "whose truth" picker. */
  people: { entity_id: string; name: string }[];
  onClose: () => void;
  /** Open this entry's full page. Absent when the host cannot navigate. */
  onOpenThread?: (entityId: string) => void;
  /** The world changed: redraw. */
  onChanged: () => void;
}

export function NodeWorkbench({
  projectPath, node, chapters, people, onClose, onOpenThread, onChanged,
}: Props) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // THE RUN IS A BUFFER, and this panel is manual-save like every other place
  // facts are edited. RunEditor's own contract says so -- "Both screens are
  // manual-save and neither writes from here" -- and writing on every
  // keystroke would also mean a save per character typed into a fact.
  const [run, setRun] = useState<unknown[]>([]);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await fetchThread(projectPath, node.entity_id);
      setThread(detail);
      setRun((detail.run ?? []) as unknown[]);
      setDirty(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That entry could not be read.");
    } finally {
      setLoading(false);
    }
  }, [projectPath, node.entity_id]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!thread) return;
    setSaving(true);
    setError("");
    try {
      const next = { ...thread, run } as ThreadDetail;
      const saved = await saveThreadDetail(projectPath, next, thread.revision);
      setThread(saved ?? next);
      setDirty(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
      // A refused save means somebody wrote first. The writer's text stays in
      // the buffer -- the same refusal the Thread editor makes -- so nothing
      // they typed is thrown away by the failure.
    } finally {
      setSaving(false);
    }
  }, [projectPath, thread, run, onChanged]);

  // THE MAP IS A SURFACE A WRITER CLICKS CONSTANTLY, so a panel over it that
  // discarded typing on an outside click would be R11.5's reported bug all
  // over again -- "very sensitive to accidental clicking outside the field
  // causing the entire window to Exit prematurely". One guard, and it asks
  // only when there is something to lose.
  const attemptClose = useAttemptClose(
    dirty, onClose,
    "You have changes to how this changes through the story that have not been "
    + "saved. Close anyway?");

  return (
    <aside
      data-testid="node-workbench"
      // BELOW THE TOOLBAR, not under it.
      //
      // This sat at top-2, which is exactly where the focus toolbar sits, so
      // the buttons landed on top of the panel's own header and swallowed its
      // X. Reported as: "the window pops up directly behind the other buttons
      // ... the [X] close button is currently hidden."
      //
      // top-12 clears a row of py-1 buttons at top-2 with room to spare, and
      // the height allowance drops by the same amount so a long entry still
      // scrolls inside the map rather than off the bottom of it.
      className="absolute right-2 top-12 flex max-h-[calc(100%-3.5rem)] w-80 flex-col rounded border border-border bg-bg-primary shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text-primary">
            {nodeLabel(node)}
          </p>
          <p className="text-micro capitalize text-faint">{node.type}</p>
        </div>
        <button type="button" onClick={attemptClose} aria-label="Close"
                className="ml-auto rounded p-0.5 text-faint hover:text-text-primary">
          <X size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(node.entity_id)}
            data-testid="workbench-open"
            className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-mini text-text-muted hover:text-text-primary"
          >
            <ExternalLink size={11} /> Open the full entry
          </button>
        )}

        {error && (
          <p role="alert" className="text-mini text-danger">{error}</p>
        )}

        {loading ? (
          <p className="flex items-center gap-1.5 text-mini text-text-muted">
            <Loader size={11} className="animate-spin" /> Reading it...
          </p>
        ) : thread ? (
          <>
            <AppearsIn
              projectPath={projectPath}
              entityId={node.entity_id}
              appearsIn={thread.appears_in ?? []}
              chapters={chapters}
              name={nodeLabel(node)}
              onChanged={next => {
                setThread(prev => (prev ? { ...prev, appears_in: next } : prev));
                // The map greys by presence, so it has to redraw.
                onChanged();
              }}
            />

            <div data-testid="workbench-run">
              <RunEditor
                run={run as never}
                chapters={chapters}
                people={people}
                self={{ entity_id: node.entity_id, name: nodeLabel(node) }}
                onChange={next => { setRun(next as unknown[]); setDirty(true); }}
              />
              {dirty && (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  data-testid="workbench-save"
                  className="mt-2 inline-flex items-center gap-1.5 rounded bg-weave-fill px-2.5 py-1 text-mini font-semibold text-white hover:bg-weave-fill disabled:opacity-40"
                >
                  {saving ? <Loader size={11} className="animate-spin" />
                          : <Save size={11} />}
                  Save these facts
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
