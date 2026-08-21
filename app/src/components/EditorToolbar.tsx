// EditorToolbar.tsx -- Markdown Formatting Toolbar
// ===================================================
// This component renders the row of formatting buttons above the editor.
// Each button manipulates the selected text in CodeMirror by inserting or
// removing Markdown syntax.
//
// The key architectural challenge: toolbar buttons are OUTSIDE the editor.
// Clicking them can clear the editor's selection before our code runs.
//
// Solution: each button saves the current selection at the very first moment
// of mousedown (before ANYTHING else can happen), then uses that saved
// selection when executing the formatting command.
//
// This is more reliable than trying to prevent focus transfer with
// e.preventDefault(), which isn't consistent across all WebView environments.

import {
  Bold, Italic, Underline, Strikethrough,
  Eraser, Heading1, Heading2, Heading3,
  List, ListOrdered, Minus, ChevronDown, FilePlus2,
} from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";


// --- Font Options ---
export const FONT_OPTIONS = [
  { label: "Georgia",         value: "'Georgia', serif"          },
  { label: "Times New Roman", value: "'Times New Roman', serif"  },
  { label: "Segoe UI",        value: "'Segoe UI', sans-serif"    },
  { label: "Arial",           value: "'Arial', sans-serif"       },
  { label: "Courier New",     value: "'Courier New', monospace"  },
] as const;

export type FontValue = (typeof FONT_OPTIONS)[number]["value"];

// Saved selection snapshot -- from/to character positions in the document
type SavedSelection = { from: number; to: number };


// --- Toolbar Props ---
interface EditorToolbarProps {
  editorView: EditorView | null;
  currentFont: FontValue;
  onFontChange: (font: FontValue) => void;
  // When present, a [+ New Template] button appears on the right side of the
  // toolbar. The parent should only pass this when notes/outline.md is the
  // active file -- the toolbar itself doesn't know about filenames.
  onNewTemplate?: () => void;
  // NOTE: the one-off feature buttons (Generate Scene Summaries, Suggest
  // Breaks, Reader Mode) moved to the Tools menu in the editor title bar
  // (components/EditorMenu.tsx) during the sidebar overhaul. This toolbar
  // is now formatting-only, plus the contextual [+ New Template] button.
}


// ── Word Finder ───────────────────────────────────────────────────────────────
// Finds the start and end positions of the word at a given cursor position.
// Returns null if the cursor is on whitespace or punctuation (no word there).
// Treats apostrophes and hyphens as part of a word so "I'm" and "self-aware"
// stay together.
function wordAt(
  state: EditorState,
  pos: number
): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;
  const isWordChar = (ch: string) => /[\w'\-]/.test(ch);

  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;

  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;

  if (start === end) return null;
  return { from: line.from + start, to: line.from + end };
}


// ── wrapSelection ─────────────────────────────────────────────────────────────
// Wraps text with Markdown inline markers (bold, italic, etc.).
//
// Accepts a `saved` selection snapshot taken at mousedown time -- this is
// the reliable selection, captured before any potential focus changes.
//
// Behavior:
//   - saved.from === saved.to (cursor only) → auto-select the word at cursor,
//     then wrap or unwrap it
//   - saved has a range → use that range; unwrap if markers already surround it,
//     otherwise wrap it
function wrapSelection(
  view: EditorView,
  before: string,
  after: string = before,
  saved: SavedSelection
) {
  const state = view.state;
  const { from, to } = saved;
  const docLength = state.doc.length;

  // ── No selection: find and wrap the word at the cursor ────────────────────
  if (from === to) {
    const word = wordAt(state, from);

    if (!word) {
      // Cursor is on whitespace -- insert empty markers, place cursor between them
      view.dispatch({
        changes: { from, insert: before + after },
        selection: { anchor: from + before.length },
      });
      view.focus();
      return;
    }

    const { from: wFrom, to: wTo } = word;
    const wordText = state.sliceDoc(wFrom, wTo);

    // Check if the word is ALREADY wrapped by looking at surrounding characters
    const charsBefore = state.sliceDoc(Math.max(0, wFrom - before.length), wFrom);
    const charsAfter  = state.sliceDoc(wTo, Math.min(docLength, wTo + after.length));

    if (charsBefore === before && charsAfter === after) {
      // Already wrapped -- remove the surrounding markers
      view.dispatch({
        changes: [
          { from: wFrom - before.length, to: wFrom, insert: "" },
          { from: wTo, to: wTo + after.length, insert: "" },
        ],
        selection: { anchor: wFrom - before.length, head: wTo - before.length },
      });
    } else {
      // Not wrapped -- wrap the whole word
      view.dispatch({
        changes: { from: wFrom, to: wTo, insert: `${before}${wordText}${after}` },
        selection: { anchor: wFrom + before.length, head: wTo + before.length },
      });
    }

    view.focus();
    return;
  }

  // ── Text is selected: wrap or unwrap based on context ────────────────────
  const selected = state.sliceDoc(from, to);

  // Check if markers sit just OUTSIDE the selection in the document
  const charsBefore = state.sliceDoc(Math.max(0, from - before.length), from);
  const charsAfter  = state.sliceDoc(to, Math.min(docLength, to + after.length));

  if (charsBefore === before && charsAfter === after) {
    // Markers surround the selection -- remove them
    view.dispatch({
      changes: [
        { from: from - before.length, to: from, insert: "" },
        { from: to, to: to + after.length, insert: "" },
      ],
      selection: { anchor: from - before.length, head: to - before.length },
    });
  } else if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length > before.length + after.length
  ) {
    // Markers are INSIDE the selection -- strip them
    const inner = selected.slice(before.length, selected.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
  } else {
    // No markers found -- wrap the selection
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: { anchor: from + before.length, head: to + before.length },
    });
  }

  view.focus();
}


// ── prefixLine ────────────────────────────────────────────────────────────────
// Adds or removes a prefix at the start of each line in the selection.
// Used for headings (# ## ###) and lists (- and 1.).
// Toggles off if the same prefix is already there.
// Replaces a different prefix if a line already has one.
//
// When multiple lines are selected, every line gets the same treatment.
// For numbered lists (1. prefix), each line gets an incrementing number.
// The toggle decision is based on whether ALL selected lines already have
// the prefix -- if they all do, remove it; otherwise add/replace on each line.
function prefixLine(view: EditorView, prefix: string, saved: SavedSelection) {
  const doc = view.state.doc;
  const firstLine = doc.lineAt(saved.from);
  const lastLine  = doc.lineAt(saved.to);

  // Collect all lines in the selection range
  const lines: { from: number; to: number; text: string; number: number }[] = [];
  for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
    const line = doc.line(ln);
    lines.push({ from: line.from, to: line.to, text: line.text, number: ln });
  }

  // Decide toggle direction: if EVERY line already has this prefix, remove all.
  // For numbered lists, check if each line starts with any "N. " pattern.
  const isNumbered = /^\d+\. $/.test(prefix);
  const allHavePrefix = lines.every((l) =>
    isNumbered ? /^\d+\. /.test(l.text) : l.text.startsWith(prefix)
  );

  // Build all changes in one transaction so undo is a single step.
  // Process lines bottom-to-top so earlier changes don't shift later positions.
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    if (allHavePrefix) {
      // Toggle off: remove the existing prefix from each line
      const match = isNumbered
        ? line.text.match(/^(\d+\. )/)
        : line.text.startsWith(prefix) ? [prefix] : null;
      if (match) {
        const removeLen = match[0].length;
        changes.push({ from: line.from, to: line.from + removeLen, insert: "" });
      }
    } else {
      // Add or replace: put the correct prefix on each line
      const linePrefix = isNumbered ? `${i + 1}. ` : prefix;
      const existing = line.text.match(/^(#{1,6} |- |\d+\. )/);
      if (existing) {
        // Replace whatever prefix is already there
        changes.push({ from: line.from, to: line.from + existing[0].length, insert: linePrefix });
      } else {
        // No prefix yet -- insert one
        changes.push({ from: line.from, to: line.from, insert: linePrefix });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }

  view.focus();
}


// ── insertHorizontalRule ──────────────────────────────────────────────────────
// Inserts a Markdown horizontal rule (---) on its own line. This is the scene-
// break convention the scene parser looks for (see backend/app/utils/scene_parser.py):
// three dashes, alone on a line, with blank lines above and below.
//
// Positioning logic:
//   - Selection present: replace selection with "\n\n---\n\n"
//   - Cursor on an empty line: put "---" directly on that line (don't create
//     extra blank lines the writer will have to clean up)
//   - Cursor on a line with text: append "\n\n---\n\n" after the current line
//     so the HR sits between paragraphs with the blank-line padding Markdown
//     requires for it to render as a rule (not as setext heading underline)
function insertHorizontalRule(view: EditorView, saved: SavedSelection) {
  const { from, to } = saved;
  const state = view.state;

  // With a real selection, replace the selected range with a padded HR.
  if (from !== to) {
    const insert = "\n\n---\n\n";
    view.dispatch({
      changes:   { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    view.focus();
    return;
  }

  const line = state.doc.lineAt(from);
  const lineIsEmpty = line.text.trim() === "";

  if (lineIsEmpty) {
    // Drop "---" straight onto the empty line. No extra newlines needed --
    // the line's surroundings already give it the padding Markdown wants.
    const insert = "---";
    view.dispatch({
      changes:   { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + insert.length },
    });
  } else {
    // Insert after the end of the current line so prose doesn't get split.
    const insert = "\n\n---\n\n";
    view.dispatch({
      changes:   { from: line.to, to: line.to, insert },
      selection: { anchor: line.to + insert.length },
    });
  }

  view.focus();
}


// ── clearFormatting ───────────────────────────────────────────────────────────
// Strips Markdown inline formatting from the selection, or removes the line
// prefix (heading/list marker) if nothing is selected.
function clearFormatting(view: EditorView, saved: SavedSelection) {
  const { from, to } = saved;

  if (from === to) {
    const line = view.state.doc.lineAt(from);
    const stripped = line.text.replace(/^(#{1,6} |- |\d+\. )/, "");
    if (stripped !== line.text) {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: stripped } });
    }
  } else {
    let text = view.state.sliceDoc(from, to);
    text = text.replace(/\*\*(.+?)\*\*/gs, "$1");
    text = text.replace(/\*(.+?)\*/gs, "$1");
    text = text.replace(/__(.+?)__/gs, "$1");
    text = text.replace(/_(.+?)_/gs, "$1");
    text = text.replace(/~~(.+?)~~/gs, "$1");
    text = text.replace(/<u>(.+?)<\/u>/gs, "$1");
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from, head: from + text.length },
    });
  }

  view.focus();
}


// ── EditorToolbar Component ───────────────────────────────────────────────────
export function EditorToolbar({
  editorView,
  currentFont,
  onFontChange,
  onNewTemplate,
}: EditorToolbarProps) {
  const view = editorView;

  // Snapshot the current selection from the editor.
  // This is called at the very start of each button's onMouseDown,
  // before e.preventDefault() or any other code runs.
  // We use this snapshot (not view.state.selection at onClick time) to
  // ensure we always have the selection the writer intended.
  function captureSelection(): SavedSelection {
    if (!view) return { from: 0, to: 0 };
    const sel = view.state.selection.main;
    return { from: sel.from, to: sel.to };
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-bg-panel px-3 py-1.5">

      {/* Inline Formatting */}
      <ToolbarButton icon={<Bold size={14} />}          label="Bold"
        onAction={(s) => view && wrapSelection(view, "**", "**", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Italic size={14} />}        label="Italic"
        onAction={(s) => view && wrapSelection(view, "*", "*", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Underline size={14} />}     label="Underline"
        onAction={(s) => view && wrapSelection(view, "<u>", "</u>", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Strikethrough size={14} />} label="Strikethrough"
        onAction={(s) => view && wrapSelection(view, "~~", "~~", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Eraser size={14} />}        label="Clear Formatting"
        onAction={(s) => view && clearFormatting(view, s)}
        captureSelection={captureSelection} />

      <Divider />

      {/* Headings */}
      <ToolbarButton icon={<Heading1 size={14} />} label="Heading 1"
        onAction={(s) => view && prefixLine(view, "# ", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Heading2 size={14} />} label="Heading 2"
        onAction={(s) => view && prefixLine(view, "## ", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<Heading3 size={14} />} label="Heading 3"
        onAction={(s) => view && prefixLine(view, "### ", s)}
        captureSelection={captureSelection} />

      <Divider />

      {/* Lists */}
      <ToolbarButton icon={<List size={14} />}        label="Bullet List"
        onAction={(s) => view && prefixLine(view, "- ", s)}
        captureSelection={captureSelection} />
      <ToolbarButton icon={<ListOrdered size={14} />} label="Numbered List"
        onAction={(s) => view && prefixLine(view, "1. ", s)}
        captureSelection={captureSelection} />

      <Divider />

      {/* Horizontal Rule -- scene break (---) that the scene parser recognizes. */}
      <ToolbarButton icon={<Minus size={14} />} label="Horizontal Rule (scene break)"
        onAction={(s) => view && insertHorizontalRule(view, s)}
        captureSelection={captureSelection} />

      <div className="flex-1" />

      {/* [+ New Template] -- only visible when notes/outline.md is the open file.
          The parent controls visibility by passing or omitting onNewTemplate. */}
      {onNewTemplate && (
        <button
          onClick={onNewTemplate}
          title="Apply a different outline template (overwrites current outline)"
          className="mr-2 flex items-center gap-1 rounded border border-border bg-bg-surface px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
        >
          <FilePlus2 size={12} />
          <span>+ New Template</span>
        </button>
      )}

      {/* Font Selector */}
      <div className="relative flex items-center">
        <select
          value={currentFont}
          onChange={(e) => onFontChange(e.target.value as FontValue)}
          className="appearance-none rounded border border-border bg-bg-surface py-0.5 pl-2 pr-6 text-xs text-text-primary transition-colors hover:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          title="Change the editor font (display only -- not saved in the document)"
          style={{ fontFamily: currentFont }}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
              {font.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-1.5 text-text-muted" />
      </div>

    </div>
  );
}


// ── ToolbarButton ─────────────────────────────────────────────────────────────
// A single icon button in the toolbar.
//
// The critical sequence in onMouseDown:
//   1. captureSelection() -- reads the editor's current selection IMMEDIATELY.
//      This is the very first line, before anything else can run.
//   2. e.preventDefault() -- prevents the browser from moving focus to this button.
//   3. e.stopPropagation() -- prevents document-level handlers from seeing this event.
//   4. onAction(savedSel) -- runs the formatting command with the saved selection.
//
// Why save the selection first?
//   Even with e.preventDefault(), some browser/WebView combinations still
//   briefly clear or blur the editor selection during the click sequence.
//   By saving it at the very first line of onMouseDown, we guarantee we
//   always have the selection the writer intended -- no matter what happens after.
function ToolbarButton({
  icon,
  label,
  onAction,
  captureSelection,
}: {
  icon: React.ReactNode;
  label: string;
  onAction: (saved: SavedSelection) => void;
  captureSelection: () => SavedSelection;
}) {
  return (
    <button
      onMouseDown={(e) => {
        const saved = captureSelection(); // 1. Save selection FIRST
        e.preventDefault();              // 2. Keep focus on editor
        e.stopPropagation();             // 3. Block document handlers
        onAction(saved);                 // 4. Format with saved selection
      }}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
    >
      {icon}
    </button>
  );
}

// A thin vertical line separating button groups in the toolbar.
function Divider() {
  return <div className="mx-1.5 h-4 w-px bg-border" />;
}
