// components/EditorMenu.tsx -- The "Tools" Dropdown Menu
// =======================================================
// One pulldown button in the editor title bar that collects the one-off
// features which used to be scattered across the toolbar and header:
//
//   AI      Generate Scene Summaries, Suggest Scene Breaks, Chapter Summary
//   View    Reader Mode
//   Export  Export Manuscript
//
// Why a menu: these are occasional actions, not per-keystroke tools. Moving
// them out of the always-visible chrome frees horizontal space and keeps the
// writer's typing area calm (see the sidebar-overhaul plan).
//
// Visibility rule (same convention as EditorToolbar's optional buttons):
// each item only renders when its callback prop is provided. The parent
// decides context -- e.g. scene-summary actions only make sense when a
// chapter is open -- and this component just reflects that by omission.
//
// This is a hand-rolled dropdown in the house style (no component library
// in this project): a relative wrapper, an absolutely-positioned panel,
// and close-on-outside-click / close-on-Escape handled with document
// listeners that only exist while the menu is open.

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, Wrench, Sparkles, Scissors, FileText, BookOpen, Download,
} from "lucide-react";

export interface EditorMenuProps {
  // AI group -- chapter-scoped, so only passed when a chapter is open.
  onGenerateSceneSummaries?: () => void;
  autoSplitRunning?: boolean;
  onSuggestSceneBreaks?: () => void;
  suggestBreaksRunning?: boolean;
  onOpenChapterSummary?: () => void;
  // View group
  onReaderMode?: () => void;
  // Export group
  onExport?: () => void;
}

// One row in the menu. Kept private -- nothing outside this file needs it.
function MenuItem({
  icon,
  label,
  hint,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-bg-surface disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="shrink-0 text-text-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// A tiny uppercase group label, matching the sidebar's NavSection styling.
function MenuGroupLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </p>
  );
}

export function EditorMenu({
  onGenerateSceneSummaries,
  autoSplitRunning = false,
  onSuggestSceneBreaks,
  suggestBreaksRunning = false,
  onOpenChapterSummary,
  onReaderMode,
  onExport,
}: EditorMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close when the writer clicks anywhere outside the menu, or presses
  // Escape. Listeners are only attached while the menu is open so an idle
  // menu costs nothing.
  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Wrap every item callback so choosing an item also closes the menu.
  // Running actions (disabled items) never fire, so no close needed there.
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const hasAiGroup     = !!(onGenerateSceneSummaries || onSuggestSceneBreaks || onOpenChapterSummary);
  const hasViewGroup   = !!onReaderMode;
  const hasExportGroup = !!onExport;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors ${
          open
            ? "border-indigo-500 text-text-primary"
            : "border-border text-text-muted hover:border-indigo-500 hover:text-text-primary"
        }`}
        title="Summaries, Reader Mode, and Export live here"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Wrench size={12} />
        <span>Tools</span>
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 rounded border border-border bg-bg-panel py-1 shadow-xl"
        >
          {hasAiGroup && (
            <>
              <MenuGroupLabel>AI</MenuGroupLabel>
              {onGenerateSceneSummaries && (
                <MenuItem
                  icon={<Sparkles size={13} />}
                  label={autoSplitRunning ? "Generating scene summaries..." : "Generate Scene Summaries"}
                  hint="Split this chapter by --- and generate a summary for each scene"
                  disabled={autoSplitRunning}
                  onClick={pick(onGenerateSceneSummaries)}
                />
              )}
              {onSuggestSceneBreaks && (
                <MenuItem
                  icon={<Scissors size={13} />}
                  label={suggestBreaksRunning ? "Analyzing scene breaks..." : "Suggest Scene Breaks"}
                  hint="Ask the AI where scene breaks (---) would strengthen this chapter"
                  disabled={suggestBreaksRunning}
                  onClick={pick(onSuggestSceneBreaks)}
                />
              )}
              {onOpenChapterSummary && (
                <MenuItem
                  icon={<FileText size={13} />}
                  label="Chapter Summary..."
                  hint="Open this chapter's summary (generate or edit it there)"
                  onClick={pick(onOpenChapterSummary)}
                />
              )}
            </>
          )}

          {hasViewGroup && (
            <>
              {hasAiGroup && <div className="my-1 border-t border-border" />}
              <MenuGroupLabel>View</MenuGroupLabel>
              {onReaderMode && (
                <MenuItem
                  icon={<BookOpen size={13} />}
                  label="Reader Mode"
                  hint="Read the full manuscript distraction-free"
                  onClick={pick(onReaderMode)}
                />
              )}
            </>
          )}

          {hasExportGroup && (
            <>
              {(hasAiGroup || hasViewGroup) && <div className="my-1 border-t border-border" />}
              <MenuGroupLabel>Export</MenuGroupLabel>
              {onExport && (
                <MenuItem
                  icon={<Download size={13} />}
                  label="Export Manuscript..."
                  hint="Export the manuscript to the exports/ folder"
                  onClick={pick(onExport)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
