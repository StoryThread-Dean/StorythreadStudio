// components/sidebar/RowMenu.tsx -- Hover "..." Menu for Tree Rows
// =================================================================
// A small vertical-ellipsis button that reveals on row hover and opens a
// dropdown of actions (Move up / Move down / Move to Act / Rename /
// Delete...). Used by chapter rows and act headers in the manuscript tree.
//
// Why a menu instead of drag-and-drop (v1): the app runs in a Windows
// WebView where native HTML5 drag is unreliable, and nested-tree DnD needs
// a new dependency plus substantial collision code. Menu moves ship
// reliably and are keyboard-accessible; DnD is noted on the roadmap as an
// enhancement once the tree is stable.
//
// House dropdown pattern: relative wrapper, absolute panel, close on
// outside-mousedown / Escape / item click. Items with `submenu` expand
// INLINE below the parent item ("Move to Act v" -> indented act list).
// A sideways flyout was tried first and failed: the sidebar is a fixed
// 256px column, so a right-opening panel overflowed into a horizontal
// scrollbar, and grabbing that scrollbar counted as an outside click
// that closed the whole menu. Expanding downward stays inside the panel.

import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export interface RowMenuItem {
  label:     string;
  hint?:     string;
  danger?:   boolean;               // render red (Delete)
  disabled?: boolean;
  onClick?:  () => void;            // leaf action
  submenu?:  RowMenuItem[];         // nested flyout instead of an action
}

export function RowMenu({ items, ariaLabel }: { items: RowMenuItem[]; ariaLabel: string }) {
  const [open, setOpen]           = useState(false);
  const [subOpenIdx, setSubOpen]  = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSubOpen(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setSubOpen(null); }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const runAndClose = (fn?: () => void) => () => {
    setOpen(false);
    setSubOpen(null);
    fn?.();
  };

  const itemClass = (it: RowMenuItem) =>
    `flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-xs transition-colors ${
      it.disabled
        ? "cursor-not-allowed text-faint"
        : it.danger
          ? "text-rose-300 hover:bg-rose-950/40"
          : "text-text-primary hover:bg-bg-surface"
    }`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); setSubOpen(null); }}
        className={`px-1 text-faint transition-all hover:text-text-primary focus:opacity-100 group-hover:opacity-100 ${
          open ? "opacity-100 text-text-primary" : "opacity-0"
        }`}
        title={ariaLabel}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={12} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-0.5 w-44 rounded border border-border bg-bg-panel py-1 shadow-xl"
        >
          {items.map((it, i) => (
            <div key={it.label}>
              <button
                disabled={it.disabled}
                title={it.hint}
                onClick={it.submenu
                  ? () => setSubOpen(subOpenIdx === i ? null : i)
                  : runAndClose(it.onClick)}
                className={itemClass(it)}
              >
                <span className="truncate">{it.label}</span>
                {it.submenu && (
                  <span aria-hidden="true" className="text-faint">
                    {subOpenIdx === i ? "v" : ">"}
                  </span>
                )}
              </button>

              {/* Inline submenu: indented list right below the parent item,
                  inside the same panel -- nothing can overflow the sidebar. */}
              {it.submenu && subOpenIdx === i && (
                <div
                  role="menu"
                  className="ml-2 max-h-56 overflow-y-auto border-l border-border/60 py-0.5"
                >
                  {it.submenu.length === 0 ? (
                    <p className="px-2.5 py-1 text-xs text-faint">No other acts yet</p>
                  ) : (
                    it.submenu.map(sub => (
                      <button
                        key={sub.label}
                        disabled={sub.disabled}
                        title={sub.hint}
                        onClick={runAndClose(sub.onClick)}
                        className={itemClass(sub)}
                      >
                        <span className="truncate">{sub.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
