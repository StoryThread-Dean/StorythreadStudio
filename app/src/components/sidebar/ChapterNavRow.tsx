// components/sidebar/ChapterNavRow.tsx -- One Chapter in the Manuscript Tree
// ===========================================================================
// One row in the Manuscript tree. Combines a chapter-opening button with an
// expand/collapse caret that reveals a single "Chapter Summary" child row
// plus a "Scene Summaries" subgroup.
//
// Clicking the caret toggles the subtree. Clicking the chapter name opens
// the chapter in the editor. These are separate click targets so the writer
// can navigate to the summary without inadvertently switching chapters.
//
// Extracted from App.tsx (originally Phase 6) as part of the sidebar
// overhaul. All state that matters lives in App.tsx and arrives via props;
// the only local state here is the inline-rename draft.

import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import type { ChapterInfo } from "../../types/project";
import type { SceneSummaryInfo } from "../../types/ai";
import { RowMenu } from "./RowMenu";
import type { RowMenuItem } from "./RowMenu";

export function ChapterNavRow({
  chapter,
  isExpanded,
  isActiveChapter,
  isSummaryAncestor,
  isChapterSummaryActive,
  sceneSummaries,
  isScenesExpanded,
  activeSceneIndex,
  onToggleExpand,
  onOpenChapter,
  onOpenChapterSummary,
  onRenameChapter,
  onDeleteChapter,
  onDeleteChapterSummary,
  onToggleScenesExpanded,
  onOpenScene,
  onDeleteScene,
  menuItems,
}: {
  chapter:                ChapterInfo;
  isExpanded:             boolean;
  isActiveChapter:        boolean;  // the chapter .md is open in the editor
  isSummaryAncestor:      boolean;  // this chapter's summary is the active view
  isChapterSummaryActive: boolean;  // the Chapter Summary child is currently active
  // Scene Summaries subtree (Phase 6):
  //   sceneSummaries      = filled scene slots fetched from the backend (or
  //                         undefined if the writer hasn't expanded yet).
  //   isScenesExpanded    = whether the Scene Summaries group is open.
  //   activeSceneIndex    = the scene currently shown in SceneSummaryView, or
  //                         null when a different view is active.
  sceneSummaries:         SceneSummaryInfo[] | undefined;
  isScenesExpanded:       boolean;
  activeSceneIndex:       number | null;
  onToggleExpand:         () => void;
  onOpenChapter:          () => void;
  onOpenChapterSummary:   () => void;
  onRenameChapter:        (newTitle: string) => void;
  onDeleteChapter:        () => void;
  onDeleteChapterSummary: () => void;
  onToggleScenesExpanded: () => void;
  onOpenScene:            (index: number) => void;
  onDeleteScene:          (index: number) => void;
  // When provided, the hover trash icon is replaced by a RowMenu holding
  // these items (Move up / Move to Act / Delete...). One hover control per
  // row keeps the tree calm; the acts view uses this, the flat fallback
  // view keeps the plain trash.
  menuItems?:             RowMenuItem[];
}) {
  // Softer highlight for the parent chapter row when the child summary is
  // active -- helps the eye trace back up the tree without dominating the row.
  const parentGhostBg = isSummaryAncestor && !isActiveChapter ? "bg-indigo-900/10" : "";

  // Inline-rename state: when `editing` is true the title <button> swaps to
  // an <input>. Start with a local draft so Escape can discard without ever
  // calling the rename API.
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(chapter.title);

  // Which scenes show their beat children. Session-only by design (like
  // chapter expansion) -- beats are glanceable planning info, not layout.
  const [expandedBeats, setExpandedBeats] = useState<Set<number>>(new Set());
  const toggleBeats = (index: number) => setExpandedBeats(prev => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  // Keep the draft in sync when the chapter title changes from outside
  // (e.g., another action renames the same chapter) and we're not editing.
  useEffect(() => {
    if (!editing) setDraft(chapter.title);
  }, [chapter.title, editing]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === chapter.title) {
      setDraft(chapter.title);
      return;
    }
    onRenameChapter(next);
  };

  return (
    <div className="mb-0.5">
      {/* Header row: caret + chapter name + trash. Separate click targets so
          expanding, opening, renaming, and deleting can't be confused with
          each other. `group` lets the trash icon stay hidden until hover. */}
      <div
        className={`group flex items-stretch rounded transition-colors ${
          isActiveChapter ? "bg-indigo-600/20" : `hover:bg-bg-surface ${parentGhostBg}`
        }`}
      >
        <button
          onClick={onToggleExpand}
          className="flex w-6 shrink-0 items-center justify-center text-xs text-text-muted hover:text-indigo-300"
          title={isExpanded ? "Collapse" : "Expand"}
          aria-label={isExpanded ? "Collapse chapter" : "Expand chapter"}
        >
          {isExpanded ? "v" : ">"}
        </button>
        {editing ? (
          // Inline rename input: shown when the writer double-clicked the
          // title. Enter saves, Escape cancels, blur saves (so clicking
          // anywhere else commits the change, matching the example flow the
          // writer described: "click into it, change it, click out").
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(chapter.title);
                setEditing(false);
              }
            }}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded border border-indigo-500/50 bg-bg-surface px-1 py-1 text-sm text-text-primary outline-none focus:border-indigo-400"
            title="Rename chapter -- Enter to save, Escape to cancel"
          />
        ) : (
          <button
            onClick={onOpenChapter}
            onDoubleClick={() => { setDraft(chapter.title); setEditing(true); }}
            className={`flex-1 min-w-0 truncate px-1 py-1.5 text-left text-sm ${
              isActiveChapter ? "text-indigo-300" : "text-text-primary"
            }`}
            title={`Open ${chapter.filename} -- double-click to rename`}
          >
            {chapter.title}
          </button>
        )}
        {!editing && (
          menuItems ? (
            <RowMenu items={menuItems} ariaLabel={`Chapter actions for ${chapter.title}`} />
          ) : (
            <button
              onClick={onDeleteChapter}
              className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
              title={`Delete ${chapter.title}`}
              aria-label={`Delete ${chapter.title}`}
            >
              <Trash2 size={12} />
            </button>
          )
        )}
      </div>

      {/* Expanded subtree: the Chapter Summary child row with its own trash
          button. Wrapped in a `group` container so the trash can reveal on
          hover independently of the parent chapter row. */}
      {isExpanded && (
        <div className="ml-6 mt-0.5 border-l border-border pl-2">
          <div
            className={`group flex items-stretch rounded transition-colors ${
              isChapterSummaryActive ? "bg-indigo-600/20" : "hover:bg-bg-surface"
            }`}
          >
            <button
              onClick={onOpenChapterSummary}
              className={`flex-1 min-w-0 truncate px-2 py-1.5 text-left text-sm ${
                isChapterSummaryActive ? "text-indigo-300" : "text-text-primary"
              }`}
              title="AI-generated continuity brief for this chapter"
            >
              Chapter Summary
            </button>
            <button
              onClick={onDeleteChapterSummary}
              className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
              title="Delete chapter summary (keeps the chapter)"
              aria-label="Delete chapter summary"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Scene Summaries subtree. Separate expandable group so collapsing
              the scenes doesn't hide the Chapter Summary row too. The group
              row always shows so the writer knows where to look; the list
              below only appears when expanded AND there are filled slots. */}
          <div className="mt-0.5">
            <button
              onClick={onToggleScenesExpanded}
              className="group flex w-full items-stretch rounded text-left text-sm text-text-primary transition-colors hover:bg-bg-surface"
              title="Per-scene AI summaries (click to expand)"
            >
              <span className="flex w-5 shrink-0 items-center justify-center text-xs text-text-muted group-hover:text-indigo-300">
                {isScenesExpanded ? "v" : ">"}
              </span>
              <span className="flex-1 min-w-0 truncate px-1 py-1.5 text-left">
                Scene Summaries
                {sceneSummaries && sceneSummaries.length > 0 && (
                  <span className="ml-1 text-xs text-text-muted">
                    ({sceneSummaries.length})
                  </span>
                )}
              </span>
            </button>

            {isScenesExpanded && (
              <div className="ml-5 mt-0.5 border-l border-border pl-2">
                {sceneSummaries === undefined ? (
                  <p className="px-2 py-1 text-xs text-faint">Loading...</p>
                ) : sceneSummaries.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-faint">
                    No scene summaries yet. Use Tools &gt; Generate Scene Summaries.
                  </p>
                ) : (
                  sceneSummaries.map(scene => {
                    const isActive  = activeSceneIndex === scene.index;
                    const hasBeats  = scene.beats && scene.beats.length > 0;
                    const beatsOpen = expandedBeats.has(scene.index);
                    const beatsDone = hasBeats ? scene.beats.filter(b => b.done).length : 0;
                    return (
                      <div key={scene.index}>
                        <div
                          className={`group flex items-stretch rounded transition-colors ${
                            isActive ? "bg-indigo-600/20" : "hover:bg-bg-surface"
                          }`}
                        >
                          {/* Beat caret -- only when the scene has beats, so
                              beat-less scenes keep their clean single row. */}
                          {hasBeats && (
                            <button
                              onClick={() => toggleBeats(scene.index)}
                              className="flex w-4 shrink-0 items-center justify-center text-[10px] text-text-muted hover:text-indigo-300"
                              title={beatsOpen ? "Hide beats" : `Show beats (${beatsDone}/${scene.beats.length} done)`}
                              aria-label={beatsOpen ? "Hide beats" : "Show beats"}
                            >
                              {beatsOpen ? "v" : ">"}
                            </button>
                          )}
                          <button
                            onClick={() => onOpenScene(scene.index)}
                            className={`flex-1 min-w-0 truncate px-2 py-1 text-left text-xs ${
                              isActive ? "text-indigo-300" : "text-text-primary"
                            }`}
                            title={`Scene ${scene.index}: ${scene.title}`}
                          >
                            <span className="text-text-muted">Scene {scene.index}</span>
                            <span className="mx-1 text-faint">&mdash;</span>
                            {scene.title}
                            {hasBeats && (
                              <span className="ml-1 text-[10px] text-faint">
                                ({beatsDone}/{scene.beats.length})
                              </span>
                            )}
                          </button>
                          <button
                            onClick={() => onDeleteScene(scene.index)}
                            className="shrink-0 px-1.5 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                            title={`Delete scene ${scene.index} summary`}
                            aria-label={`Delete scene ${scene.index} summary`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>

                        {/* Beat children: read-only in the sidebar (edit
                            them in the scene summary view). Done beats dim
                            and strike through; clicking any beat opens the
                            scene so the writer lands where editing lives. */}
                        {hasBeats && beatsOpen && (
                          <div className="ml-4 border-l border-border/60 pl-1.5">
                            {scene.beats.map((beat, bi) => (
                              <button
                                key={bi}
                                onClick={() => onOpenScene(scene.index)}
                                className="flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-bg-surface"
                                title="Open the scene summary to edit beats"
                              >
                                <span className={`shrink-0 ${beat.done ? "text-emerald-500" : "text-faint"}`}>
                                  {beat.done ? "✓" : "○"}
                                </span>
                                <span className={`min-w-0 truncate ${
                                  beat.done ? "text-faint line-through" : "text-text-muted"
                                }`}>
                                  {beat.text}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
