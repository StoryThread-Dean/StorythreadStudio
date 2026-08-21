// MarkdownEditor.tsx -- The Writing Editor Component
// =====================================================
// This component renders the CodeMirror editor where the writer works.
//
// Key design decisions:
//   - Uncontrolled mode: CodeMirror owns the text after initial load.
//     The parent reads content via editorViewRef.state.doc.toString() on save.
//   - Font Compartment: lets us hot-swap just the font extension without
//     rebuilding the entire editor (avoids flicker on font changes).
//   - Layout: centering is handled by a wrapper div, NOT by CSS on CodeMirror's
//     internal elements. Putting padding/margin on .cm-content breaks CodeMirror's
//     mouse-position-to-document-position calculations, causing selection to
//     appear in the wrong place or not at all.

import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, Decoration, ViewPlugin, keymap } from "@codemirror/view";
import type { ViewUpdate, DecorationSet } from "@codemirror/view";
import { Compartment, Prec, RangeSetBuilder } from "@codemirror/state";
import { search, openSearchPanel, searchKeymap } from "@codemirror/search";
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import type { FontValue } from "./EditorToolbar";
import { useTheme } from "../hooks/useTheme";
import { useLineSpacing } from "../hooks/useLineSpacing";
import { issueOverlayExtension } from "./editor/issueOverlay";
import { ThesaurusPopover } from "./editor/ThesaurusPopover";


// --- Font Compartment ---
// Module-level so it persists across re-renders (React recreates component
// variables on every render, but module-level constants stay alive).
const fontCompartment = new Compartment();

// Builds a CodeMirror theme extension for a given font.
// Only controls typography -- syntax highlighting colors are handled by
// the dark/light color themes below. Where this DOES set colors (caret,
// active-line highlight) it uses CSS variables so the colors flip with
// the app theme automatically. CodeMirror lets us write plain CSS values
// here, and var(--st-...) is a plain CSS value.
function buildFontTheme(fontFamily: string, lineHeight: number) {
  return EditorView.theme({
    // The root editor element. font-size inherits all the way down from here.
    "&": {
      fontSize: "16px",
    },
    // The typing area -- minimal styling here so CodeMirror's coordinate
    // system stays accurate. Centering is handled by the wrapper div in JSX.
    //
    // LINE HEIGHT MUST BE SET HERE, NOT ON "&", AND THAT IS NOT A STYLE
    // PREFERENCE. CodeMirror's own baseTheme contains:
    //
    //     ".cm-scroller": { lineHeight: 1.4, ... }
    //
    // .cm-scroller sits between .cm-editor and the text, and an explicit
    // line-height there BLOCKS inheritance from the root. So a line-height
    // declared on "&" is never seen by a single line of prose.
    //
    // This editor was written with `"&": { lineHeight: "1.8" }` and rendered
    // at 1.4 for its entire life. Nothing failed and nothing looked broken --
    // 1.4 is a perfectly plausible number -- so the dead declaration sat there
    // being read as the answer to "what is the line spacing?". It surfaced
    // only when the writer got a control that visibly did nothing: "the Line
    // spacing doesn't actually work ... currently 1.5 line spacing yet
    // nothing is showing."
    //
    // Setting it on .cm-content puts it INSIDE .cm-scroller, on the element
    // that actually holds the .cm-line children, so it wins and inherits.
    // useLineSpacing has already resolved Single / 1.5 lines / Double / a
    // custom multiple into one number, so the arithmetic lives in one place
    // and the editor cannot disagree with the figure Settings printed.
    ".cm-content": {
      fontFamily,
      lineHeight: String(lineHeight),
      caretColor: "var(--st-accent)",
      padding: "2rem 1rem",  // Small padding only -- wrapper handles centering
    },
    ".cm-line": {
      fontFamily,
    },
    // Hide the line-number gutter (not useful in a prose editor)
    ".cm-gutters": {
      display: "none",
    },
    // The active-line override is intentionally OMITTED here. App.css
    // already paints .cm-activeLine using --color-active-line at the
    // global level, and that variable swaps with the theme. Setting a
    // hardcoded color here would shadow the global rule in light mode.
    // Remove the default browser blue focus ring -- our border handles it
    "&.cm-focused": {
      outline: "none",
    },
  });
}


// --- Horizontal Rule visual decoration ---
// Markdown's `---` (or `***`) on its own line is the scene-break convention
// the writer uses + the scene parser recognizes. By default CodeMirror just
// shows the literal characters, which reads as text noise in long documents.
// This extension paints a thin horizontal stripe across any line that's only
// dashes/asterisks, while leaving the source characters intact and editable.
//
// Why a line decoration instead of a replacing widget?
//   - The `---` text stays visible. The writer can still see and edit/delete
//     the marker without invisible-character mysteries.
//   - The cursor still lands where it expects to. Replacing widgets disrupt
//     CodeMirror's coordinate math and click-to-cursor behavior.
//   - The rule renders across the FULL editor width because `.cm-line` is a
//     full-width block element, regardless of how short `---` is.

// Detects a line that's nothing but horizontal-rule markers. Three or more
// dashes or asterisks, with optional surrounding whitespace. Matches what
// CommonMark treats as a thematic break and what backend/app/utils/scene_parser.py
// treats as a scene boundary, so the visual cue mirrors the structural one.
const HR_LINE_REGEX = /^\s*(?:-{3,}|\*{3,})\s*$/;

const hrLineDecoration = Decoration.line({ class: "cm-hr-line" });

// ViewPlugin scans visible lines on every relevant update and emits a line
// decoration for each HR. Only the visible viewport is scanned, not the whole
// document, so this stays cheap on long chapters.
const hrLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildHRDecorations(view);
    }

    update(update: ViewUpdate) {
      // Recompute when the doc text changes (HR added/removed) or when the
      // viewport scrolls to fresh lines we haven't decorated yet.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHRDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations },
);

function buildHRDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Walk each visible line, test against the HR pattern, attach the decoration
  // class. Line decorations attach to a line's start position; CodeMirror does
  // the rest of the work mapping that onto the line's DOM element.
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (HR_LINE_REGEX.test(line.text)) {
        builder.add(line.from, line.from, hrLineDecoration);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

// CSS for the decorated lines. The horizontal stripe is a 1px background
// gradient centered vertically, drawn behind the muted `---` text. Using a
// background gradient (rather than a pseudo-element) avoids interfering with
// CodeMirror's caret and selection rendering.
const hrLineTheme = EditorView.theme({
  ".cm-hr-line": {
    color: "rgba(99, 102, 241, 0.45)",  // muted indigo for the literal `---`
    backgroundImage:
      "linear-gradient(rgba(99, 102, 241, 0.45), rgba(99, 102, 241, 0.45))",
    backgroundSize: "100% 1px",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  },
});


// --- Find & Replace panel ---
//
// CodeMirror 6's search panel already renders BOTH a Find input and a
// Replace input (the Replace row appears below the Find row, separated by a
// <br> the panel injects). Ctrl+F opens it; we add Ctrl+H as an explicit
// second entry so the VS Code / Notepad muscle memory works too.
//
// Prec.high ensures this beats any default keymap that might swallow Ctrl+H
// (browsers sometimes map Ctrl+H to "history," so we preventDefault as well
// to keep the OS webview from intercepting the keystroke).
const findReplaceKeymap = Prec.high(keymap.of([
  {
    key:            "Mod-h",
    preventDefault: true,
    run:            openSearchPanel,
  },
  // Re-bind Mod-f at high precedence so it definitely lands on the search
  // command even if another extension tries to claim the same shortcut.
  {
    key:            "Mod-f",
    preventDefault: true,
    run:            openSearchPanel,
  },
  // Also include every default search binding (findNext, findPrev, close,
  // etc.) so we don't lose them when basicSetup.searchKeymap is disabled.
  ...searchKeymap,
]));


// Theme-aware polish for the search panel so the Find/Replace controls read
// clearly against the rest of the editor. CodeMirror ships an unstyled panel
// by default, which inherits the browser's light-gray form controls and
// becomes hard to see on either the dark navy or paper background.
//
// All colors are CSS variables (defined in App.css) so the panel flips between
// dark/light along with the rest of the app -- no separate panel theme needed.
//
// CRITICAL: the panel uses a raw <br> to split the Find row from the Replace
// row. We deliberately do NOT use `display: flex` on `.cm-search` -- flex
// treats <br> as a regular flex item (no line break), which would hide the
// Replace row off the right edge of the panel. Sticking with the default
// inline/block layout lets the <br> break the line the way the panel expects.
const searchPanelTheme = EditorView.theme({
  ".cm-panels": {
    backgroundColor: "var(--st-bg-panel)",
    color:           "var(--st-text-primary)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--st-border)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--st-border)",
  },
  ".cm-search": {
    padding: "6px 10px",
    fontSize: "12px",
  },
  ".cm-search input.cm-textfield": {
    backgroundColor: "var(--st-bg-surface)",
    color:           "var(--st-text-primary)",
    border:          "1px solid var(--st-border)",
    borderRadius:    "3px",
    padding:         "3px 6px",
    margin:          "2px 4px 2px 0",
    outline:         "none",
    fontSize:        "12px",
  },
  ".cm-search input.cm-textfield:focus": {
    borderColor: "var(--st-accent)",
  },
  ".cm-search button.cm-button": {
    backgroundColor: "var(--st-bg-surface)",
    backgroundImage: "none",          // override default gradient
    color:           "var(--st-text-primary)",
    border:          "1px solid var(--st-border)",
    borderRadius:    "3px",
    padding:         "2px 8px",
    margin:          "0 2px",
    fontSize:        "12px",
    cursor:          "pointer",
  },
  ".cm-search button.cm-button:hover": {
    borderColor: "var(--st-accent)",
  },
  ".cm-search label": {
    color:       "var(--st-text-muted)",
    margin:      "0 6px 0 0",
    fontSize:    "12px",
  },
  ".cm-search br": {
    // Give the line-break a little vertical breathing room so the Replace
    // row is visually separated from the Find row rather than jammed
    // against it.
    content:      "''",
    display:      "block",
    marginBottom: "4px",
  },
  ".cm-search [name='close']": {
    position: "absolute",
    top: "4px",
    right: "4px",
    background: "transparent",
    border: "none",
    color: "var(--st-text-muted)",
    fontSize: "14px",
    cursor: "pointer",
  },
});


// --- Storythread Studio Color Themes (dark + light) ---
// Controls syntax highlighting (headings, bold, italic, links, etc.) and
// editor chrome colors (background, selection, cursor).
//
// Why two themes instead of CSS variables?
//   createTheme() from @uiw/codemirror-themes bakes its colors into a
//   pre-generated stylesheet and inline class definitions. CSS variables
//   would render as the literal string "var(--...)" in those baked styles,
//   which CodeMirror's syntax highlighter can't resolve. So we build a
//   complete dark theme and a complete light theme, then the component
//   picks the matching one based on the current app theme.
//
// Dark is the charcoal ground, light is the warm paper. Each keeps its own
// theme's accent, so a link reads as a link in both.
//
// KEEP THESE IN STEP WITH App.css BY HAND. They are the one place in the app
// that cannot read a token, so they are also the one place that can silently
// fall behind one: change a role there and the manuscript editor goes on
// wearing the old palette inside the new app. Every value below is the
// corresponding --st-* token flattened against this theme's background,
// because the ink tokens carry alpha and CodeMirror needs an opaque colour.

const storythreadDarkTheme = createTheme({
  theme: "dark",
  settings: {
    background:      "#1E1E1E",   // bg-primary
    foreground:      "#E2E2E2",   // text-primary
    caret:           "#90CAF9",   // accent
    selection:       "#2E5C8A",   // Visible indigo-blue selection
    selectionMatch:  "#24405C",   // Dimmer for secondary matches
    lineHighlight:   "#232323",   // bg-panel
    gutterBackground: "#1E1E1E",
    gutterForeground: "#A5A5A5",
  },
  styles: [
    { tag: t.heading1,              color: "#E2E2E2", fontWeight: "bold", fontSize: "1.5em" },
    { tag: t.heading2,              color: "#E2E2E2", fontWeight: "bold", fontSize: "1.3em" },
    { tag: t.heading3,              color: "#CFCFCF", fontWeight: "bold", fontSize: "1.1em" },
    { tag: t.emphasis,              fontStyle: "italic"  },
    { tag: t.strong,                fontWeight: "bold"   },
    { tag: t.link,                  color: "#90CAF9"     },
    { tag: t.url,                   color: "#90CAF9"     },
    { tag: t.quote,                 color: "#A5A5A5", fontStyle: "italic" },
    { tag: t.monospace,             color: "#BBDEFB"     },
    { tag: t.meta,                  color: "#737373"     }, // **, ##, etc.
    { tag: t.processingInstruction, color: "#737373"     },
    { tag: t.strikethrough,         textDecoration: "line-through", color: "#A5A5A5" },
  ],
});

const storythreadLightTheme = createTheme({
  theme: "light",
  settings: {
    background:      "#F5F2EC",   // bg-primary (warm paper)
    foreground:      "#30302F",   // text-primary (near-black)
    caret:           "#1565C0",   // accent (kept indigo)
    selection:       "#BBDEFB",   // soft indigo for selection on paper
    selectionMatch:  "#DCEBF9",   // even softer for secondary matches
    lineHighlight:   "#EDE9E0",   // bg-panel (slightly darker paper)
    gutterBackground: "#F5F2EC",
    gutterForeground: "#676664",
  },
  styles: [
    // Headings stay near-black on paper -- bold weight already gives the
    // hierarchy, no need to lighten the color.
    { tag: t.heading1,              color: "#30302F", fontWeight: "bold", fontSize: "1.5em" },
    { tag: t.heading2,              color: "#30302F", fontWeight: "bold", fontSize: "1.3em" },
    { tag: t.heading3,              color: "#3D3C3B", fontWeight: "bold", fontSize: "1.1em" },
    { tag: t.emphasis,              fontStyle: "italic"  },
    { tag: t.strong,                fontWeight: "bold"   },
    // Links use a slightly darker indigo so they pass AA contrast on paper.
    { tag: t.link,                  color: "#1565C0"     },
    { tag: t.url,                   color: "#1565C0"     },
    { tag: t.quote,                 color: "#676664", fontStyle: "italic" },
    { tag: t.monospace,             color: "#0D47A1"     },
    { tag: t.meta,                  color: "#92918E"     }, // **, ##, etc. -- soft tan
    { tag: t.processingInstruction, color: "#92918E"     },
    { tag: t.strikethrough,         textDecoration: "line-through", color: "#676664" },
  ],
});


// --- MarkdownEditor Props ---
interface MarkdownEditorProps {
  defaultValue: string;   // Initial content -- CodeMirror owns it after mount
  onChange: () => void;   // Fires on any change -- used to flip isDirty in App
  font: FontValue;        // Current writing font (CSS font-family string)
  onEditorReady: (view: EditorView) => void;  // Called once on mount with the EditorView
  onSelectionChange?: (selectedText: string) => void;  // Fires when selection changes
  /** Which project this text belongs to. Only used by the right-click
   *  Weaving action, which records a mark against the project. */
  projectPath?: string;
}


// ── Thesaurus state shape ─────────────────────────────────────────────────────
/**
 * The sentence a selection sits in, for showing a mark in context.
 *
 * Deliberately crude: split on sentence-enders and take the piece the
 * selection falls in. A mark is shown to the writer as a reminder of where
 * they were, not parsed by anything, so approximately-a-sentence is the
 * right amount of effort.
 */
function sentenceAround(text: string, from: number, to: number): string {
  const left = Math.max(0, text.lastIndexOf(".", from - 1) + 1);
  const dot = text.indexOf(".", to);
  const right = dot === -1 ? Math.min(text.length, to + 120) : dot + 1;
  return text.slice(left, right).trim().replace(/\s+/g, " ").slice(0, 240);
}

interface ThesaurusState {
  word: string;
  from: number;   // document position of word start
  to:   number;   // document position of word end
  x:    number;   // viewport px for popover
  y:    number;
  /**
   * A multi-word selection, when there is one.
   *
   * The thesaurus only ever wants one word, so `word` stays a word. But
   * "Kithicor Forest" and "Cambridge Campus Library" are single things in
   * a writer's world, and Weaving has to be able to mark them -- so the
   * phrase rides along beside the word rather than replacing it.
   */
  phrase?: string;
  /** The sentence it came from, so a mark can show where it was made. */
  sentence?: string;
}


// ── MarkdownEditor Component ──────────────────────────────────────────────────
export function MarkdownEditor({ defaultValue, onChange, font, onEditorReady, onSelectionChange, projectPath }: MarkdownEditorProps) {
  const editorViewRef = useRef<EditorView | null>(null);

  // Thesaurus popover state -- null when closed
  const [thesaurus, setThesaurus] = useState<ThesaurusState | null>(null);

  // ── Context-menu handler: open Thesaurus for any word ─────────────────────
  // Priority order:
  //   1. If a single word is selected, use the selection.
  //   2. Otherwise, look up the word at the click position.
  // Multi-word selections and clicks on punctuation/whitespace fall through
  // to the browser's native context menu (which keeps spell-check working).
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const view = editorViewRef.current;
    if (!view) return;

    let word = "";
    let from = 0;
    let to   = 0;

    // Check for an existing single-word selection first
    const sel  = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to).trim();
      if (text && !/\s/.test(text) && text.length <= 60) {
        word = text;
        from = sel.from;
        to   = sel.to;
      }
    }

    // No usable selection -- find the word at the click position
    if (!word) {
      const clickPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (clickPos !== null) {
        const range = view.state.wordAt(clickPos);
        if (range) {
          const text = view.state.sliceDoc(range.from, range.to);
          // Only show for real words (letters, hyphens, apostrophes)
          if (/^[A-Za-z][A-Za-z'-]*$/.test(text)) {
            word = text;
            from = range.from;
            to   = range.to;
          }
        }
      }
    }

    // A MULTI-WORD SELECTION is not a thesaurus lookup, but it is exactly
    // what Weaving needs to mark: "Kithicor Forest" is one thing in the
    // writer's world. So a phrase opens the menu even when no single word
    // does, and the thesaurus half simply finds nothing for it.
    let phrase = "";
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to).trim();
      // Up to six words: enough for the longest real name, short enough
      // that selecting a paragraph does not offer to mark a paragraph.
      if (text && text.length <= 80 && text.split(/\s+/).length <= 6
          && !text.includes("\n")) {
        phrase = text;
        if (!word) { from = sel.from; to = sel.to; }
      }
    }

    if (!word && !phrase) return;   // let the native menu show

    e.preventDefault();
    setThesaurus({
      word, from, to, phrase: phrase || undefined,
      sentence: sentenceAround(view.state.doc.toString(), from, to),
      x: e.clientX, y: e.clientY,
    });
  }, []);

  // Replace the original word with the chosen synonym, then close the popover
  const handleThesaurusReplace = useCallback((replacement: string, from: number, to: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from, to, insert: replacement } });
  }, []);

  // Subscribe to the global theme so we can switch CodeMirror's syntax
  // highlighting + chrome colors when the user toggles dark/light. The
  // CodeMirror prop `theme` accepts either an extension or a baked theme,
  // and changing it triggers @uiw/react-codemirror to rebuild the view --
  // exactly what we want when the palette changes.
  const [appTheme]    = useTheme();
  const { lineHeight } = useLineSpacing();
  const editorTheme   = appTheme === "light" ? storythreadLightTheme : storythreadDarkTheme;

  // When the font OR the line spacing changes, hot-swap only that compartment.
  // This avoids rebuilding the entire editor (which would reset the cursor) --
  // which matters more for spacing than for font, because a writer comparing
  // Double against 1.5 lines will flip between them repeatedly and would
  // otherwise lose their place in the manuscript every time.
  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        effects: fontCompartment.reconfigure(buildFontTheme(font, lineHeight)),
      });
    }
  }, [font, lineHeight]);

  // Static extensions -- built once, never change.
  //
  // contentAttributes sets HTML attributes on CodeMirror's .cm-content div.
  // CodeMirror 6 defaults spellcheck to "false" for performance, but fiction
  // writing is exactly the case where we want the browser's built-in spell
  // checker (red squiggles, right-click for suggestions). autocorrect and
  // autocapitalize are "off" so the writer stays in control of their prose.
  const extensions = [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    fontCompartment.of(buildFontTheme(font, lineHeight)),
    // HR scene-break decoration: paints a horizontal stripe across any line
    // that is just `---` (or `***`). The text remains editable; only the
    // visual presentation changes.
    hrLinePlugin,
    hrLineTheme,
    // Smart Advisor inline-issue overlay. Registers the StateField that holds
    // active issue decorations, the click handler that emits issue-click
    // events for the popover, and the theme for highlight colors. Issues are
    // dispatched into this field by EditorAdvisorBar after each pass.
    issueOverlayExtension(),
    // Search extension: registers the state field and panel factory. Calling
    // openSearchPanel without this relies on CodeMirror lazily appending the
    // config, which works but leaves us without a way to tune options like
    // panel position. Explicit registration is more predictable.
    //
    // top: true puts the Find/Replace bar above the editor (like VS Code)
    // rather than pinned to the bottom.
    search({ top: true }),
    // Ctrl+F and Ctrl+H both open the Find & Replace panel. The panel itself
    // renders Find + Replace rows whenever the editor isn't read-only.
    findReplaceKeymap,
    searchPanelTheme,
  ];

  return (
    // Outer wrapper: fills the panel and scrolls vertically.
    // onContextMenu intercepts right-clicks so we can show the Thesaurus popover
    // for any word. When no word is found the handler returns early, allowing the
    // browser's native context menu (with spellcheck suggestions) to appear.
    <div className="h-full overflow-y-auto bg-bg-primary" onContextMenu={handleContextMenu}>

      {/* Thesaurus popover -- fixed-position, appears at the right-click coordinates */}
      {thesaurus && (
        <ThesaurusPopover
          word={thesaurus.word}
          from={thesaurus.from}
          to={thesaurus.to}
          x={thesaurus.x}
          y={thesaurus.y}
          phrase={thesaurus.phrase}
          sentence={thesaurus.sentence}
          projectPath={projectPath}
          onReplace={handleThesaurusReplace}
          onClose={() => setThesaurus(null)}
        />
      )}

      {/* Centering wrapper: constrains the editor to a comfortable reading width.
          We center HERE with a div, not inside CodeMirror's internal styles.
          This keeps CodeMirror's coordinate system accurate so selection,
          click-to-cursor, and drag-select all work correctly. */}
      <div className="mx-auto w-full max-w-3xl">
        <CodeMirror
          value={defaultValue}
          onChange={onChange}
          theme={editorTheme}
          extensions={extensions}
          onCreateEditor={(view: EditorView) => {
            editorViewRef.current = view;
            onEditorReady(view);
          }}
          onUpdate={(viewUpdate) => {
            // Fire onSelectionChange whenever the selection moves.
            // This lets the AI panel know what text is highlighted.
            if (onSelectionChange && viewUpdate.selectionSet) {
              const sel  = viewUpdate.state.selection.main;
              const text = viewUpdate.state.sliceDoc(sel.from, sel.to);
              onSelectionChange(text);
            }
          }}
          basicSetup={{
            lineNumbers:               false,
            foldGutter:                false,
            highlightActiveLine:       true,
            highlightSelectionMatches: true,
            // We register our own high-precedence searchKeymap in `extensions`
            // above (which includes the full default searchKeymap plus our
            // Ctrl+H binding), so disable basicSetup's copy to avoid a
            // lower-precedence duplicate racing for the same shortcuts.
            searchKeymap:              false,
            history:                   true,
            // drawSelection: true -- CodeMirror draws its own selection using
            // .cm-selectionBackground divs. Previously false because highlights
            // weren't rendering, but that was caused by the unlayered CSS reset
            // overriding Tailwind. Now that the reset is in @layer base, it works.
            // Key benefit: selection STAYS VISIBLE when editor loses focus
            // (e.g., when clicking into the Writing Companion chat panel).
            drawSelection:             true,
            dropCursor:                true,
            autocompletion:            false,
            indentOnInput:             false,
            bracketMatching:           false,
            closeBrackets:             false,
            crosshairCursor:           false,
          }}
          height="100%"
          aria-label="Markdown writing editor"
        />
      </div>
    </div>
  );
}
