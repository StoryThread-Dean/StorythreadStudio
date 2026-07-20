// components/sidebar/ActGroup.tsx -- One Act in the Manuscript Tree
// ==================================================================
// A collapsible act header ("Act I", chapter count, hover menu) whose
// children are the ChapterNavRows the parent renders. The parent owns
// everything: collapse state (persisted per book via useProjectUiState),
// the act mutations (rename / move / delete via callbacks that end in a
// PUT /api/structure), and the chapter rows themselves.
//
// Inline rename mirrors ChapterNavRow: double-click the title, Enter
// saves, Escape cancels, blur saves.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RowMenu } from "./RowMenu";
import type { RowMenuItem } from "./RowMenu";

export function ActGroup({
  title,
  chapterCount,
  collapsed,
  onToggleCollapsed,
  onRename,
  menuItems,
  children,
}: {
  title:             string;
  chapterCount:      number;
  collapsed:         boolean;
  onToggleCollapsed: () => void;
  onRename:          (newTitle: string) => void;
  // Move up / Move down / Delete act -- built by the parent so this
  // component stays ignorant of act ordering rules.
  menuItems:         RowMenuItem[];
  children:          ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(title);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === title) {
      setDraft(title);
      return;
    }
    onRename(next);
  };

  return (
    <div className="mb-1.5">
      {/* Act header row: caret + title + count + hover menu */}
      <div className="group flex items-stretch rounded transition-colors hover:bg-bg-surface">
        <button
          onClick={onToggleCollapsed}
          className="flex w-5 shrink-0 items-center justify-center text-xs text-text-muted hover:text-indigo-300"
          title={collapsed ? "Expand act" : "Collapse act"}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {collapsed ? ">" : "v"}
        </button>
        {editing ? (
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
                setDraft(title);
                setEditing(false);
              }
            }}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded border border-indigo-500/50 bg-bg-surface px-1 py-0.5 text-xs font-semibold text-text-primary outline-none focus:border-indigo-400"
            title="Rename act -- Enter to save, Escape to cancel"
          />
        ) : (
          <button
            onClick={onToggleCollapsed}
            onDoubleClick={() => { setDraft(title); setEditing(true); }}
            className="flex-1 min-w-0 truncate px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-text-muted"
            title={`${title} -- double-click to rename`}
          >
            {title}
            <span className="ml-1.5 font-normal normal-case tracking-normal text-faint">
              {chapterCount === 1 ? "1 chapter" : `${chapterCount} chapters`}
            </span>
          </button>
        )}
        {!editing && <RowMenu items={menuItems} ariaLabel={`Act actions for ${title}`} />}
      </div>

      {/* The act's chapters, indented under a guide line */}
      {!collapsed && (
        <div className="ml-2 border-l border-border/60 pl-1.5">
          {chapterCount === 0 ? (
            <p className="px-2 py-1 text-xs text-faint">
              No chapters yet -- use a chapter's menu to move one here.
            </p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}
