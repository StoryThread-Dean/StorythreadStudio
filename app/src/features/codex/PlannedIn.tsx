// features/codex/PlannedIn.tsx -- which chapters PLAN to use this entry
// ======================================================================
// The counterpart to AppearsIn, and the difference between them is the whole
// reason this is a separate component rather than another row in that one.
//
//     Appears in    ch 1, ch 4        the writer SAID so
//     Planned in    ch 7, ch 8        the app NOTICED the name in those plans
//
// One is a decision, the other an observation, and they must never look like
// the same kind of claim. AppearsIn is editable because it is authored; this
// has no controls at all, because there is nothing here to change -- edit the
// chapter outline and the answer changes with it.
//
// DERIVED ON READ, NEVER CACHED, and that is the load-bearing rule. R8.5
// deleted the codex_mention table because mentions derived from the manuscript
// while the freshness gate fingerprints codex/ -- so every chapter the writer
// edited left the rows silently wrong with the index reporting itself current.
// This derives from outlines/, which the index does not fingerprint either, so
// it is recomputed every time it is asked for. See the route's docstring.

import { useEffect, useState } from "react";
import { ListOrdered, Loader } from "lucide-react";

import { Explain } from "../../components/learn/Explain";

const API_BASE = "http://localhost:8000";

interface PlannedChapter {
  chapter_filename: string;
  chapter_title: string;
}

interface Props {
  projectPath: string;
  entityId: string;
  /** What the entry is called, for the sentence. */
  name: string;
  /** Bumped by the caller to force a re-read. Nothing here caches, but the
   *  component still has to be TOLD when to ask again. */
  refreshKey?: number;
}

export function PlannedIn({ projectPath, entityId, name, refreshKey = 0 }: Props) {
  const [chapters, setChapters] = useState<PlannedChapter[] | null>(null);

  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setChapters(null);
    const params = new URLSearchParams({
      project_path: projectPath, entity_id: entityId,
    });
    fetch(`${API_BASE}/api/codex/planned-in?${params}`)
      .then(r => (r.ok ? r.json() : { chapters: [] }))
      .then(body => {
        if (!cancelled) setChapters(body.chapters ?? []);
      })
      .catch(() => { if (!cancelled) setChapters([]); });
    return () => { cancelled = true; };
  }, [projectPath, entityId, refreshKey]);

  if (chapters === null) {
    return (
      <p className="flex items-center gap-1.5 text-mini text-faint">
        <Loader size={11} className="animate-spin" /> Reading your chapter outlines...
      </p>
    );
  }

  // NOTHING IS NOT WORTH A ROW. An entry named in no plan is the ordinary
  // state of most of a world, and a permanent "Planned in: none" would be a
  // reproach on every page for a document the writer may never use.
  if (chapters.length === 0) return null;

  return (
    <div data-testid="planned-in"
         className="rounded border border-dashed border-border bg-bg-surface/40 px-3 py-2">
      <p className="flex flex-wrap items-center gap-1.5 text-mini text-text-muted">
        <ListOrdered size={11} className="text-accent" />
        <span className="font-medium text-text-primary">Planned in</span>
        {chapters.map(c => (
          <span key={c.chapter_filename}
                className="rounded border border-border bg-bg-panel px-1.5 py-0.5 text-micro text-text-primary">
            {c.chapter_title}
          </span>
        ))}
        {/* Beside the chips rather than under the note: this row sits right
            below "Appears in", which IS editable, and the question a writer
            has is "why can't I change this one" -- asked while looking here. */}
        <Explain of="weave.planned-in" compact />
      </p>
      {/* SAID OUT LOUD, because the row above it says the opposite kind of
          thing. Without this line the two read as one list the writer half
          typed, and they would reasonably try to edit this one. */}
      <p className="mt-1 text-micro text-faint">
        Worked out from your chapter outlines, which name {name}. Not something
        you set here: change an outline and this changes with it.
      </p>
    </div>
  );
}
