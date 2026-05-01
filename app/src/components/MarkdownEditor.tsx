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

import { useEffect, useRef } from "react";
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


// --- Font Compartment ---
// Module-level so it persists across re-renders (React recreates component
// variables on every render, but module-level constants stay alive).
const fontCompartment = new Compartment();

// Builds a CodeMirror theme extension for a given font.
// Only controls typography -- syntax highlighting colors are handled by
// the dark/light color themes below. Where this DOES set colors (caret,
// active-line highlight) it uses CSS variables so the colors flip with
// the app theme automatically. CodeMirror lets us write plain CSS values
// here, and var(--color-...) is a plain CSS value.
function buildFontTheme(fontFamily: string) {
  return EditorView.theme({
    // The root editor element
    "&": {
      fontSize: "16px",
      lineHeight: "1.8",
    },
    // The typing area -- minimal styling here so CodeMirror's coordinate
    // system stays accurate. Centering is handled by the wrapper div in JSX.
    ".cm-content": {
      fontFamily,
      caretColor: "var(--color-accent)",
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
    backgroundColor: "var(--color-bg-panel)",
    color:           "var(--color-text-primary)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--color-border)",
  },
  ".cm-search": {
    padding: "6px 10px",
    fontSize: "12px",
  },
  ".cm-search input.cm-textfield": {
    backgroundColor: "var(--color-bg-surface)",
    color:           "var(--color-text-primary)",
    border:          "1px solid var(--color-border)",
    borderRadius:    "3px",
    padding:         "3px 6px",
    margin:          "2px 4px 2px 0",
    outline:         "none",
    fontSize:        "12px",
  },
  ".cm-search input.cm-textfield:focus": {
    borderColor: "var(--color-accent)",
  },
  ".cm-search button.cm-button": {
    backgroundColor: "var(--color-bg-surface)",
    backgroundImage: "none",          // override default gradient
    color:           "var(--color-text-primary)",
    border:          "1px solid var(--color-border)",
    borderRadius:    "3px",
    padding:         "2px 8px",
    margin:          "0 2px",
    fontSize:        "12px",
    cursor:          "pointer",
  },
  ".cm-search button.cm-button:hover": {
    borderColor: "var(--color-accent)",
  },
  ".cm-search label": {
    color:       "var(--color-text-muted)",
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
    color: "var(--color-text-muted)",
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
// The dark theme uses the navy palette; the light theme uses the paper palette.
// Both keep the same indigo accent so syntax cues feel consistent across modes.

const storythreadDarkTheme = createTheme({
  theme: "dark",
  settings: {
    background:      "#070724",   // bg-primary
    foreground:      "#f0f0f5",   // text-primary
    caret:           "#6366f1",   // accent
    selection:       "#3a5bbf",   // Visible indigo-blue selection
    selectionMatch:  "#1e3464",   // Dimmer for secondary matches
    lineHighlight:   "#0d0d2b",   // bg-panel
    gutterBackground: "#070724",
    gutterForeground: "#8888aa",
  },
  styles: [
    { tag: t.heading1,              color: "#f0f0f5", fontWeight: "bold", fontSize: "1.5em" },
    { tag: t.heading2,              color: "#f0f0f5", fontWeight: "bold", fontSize: "1.3em" },
    { tag: t.heading3,              color: "#ddddf5", fontWeight: "bold", fontSize: "1.1em" },
    { tag: t.emphasis,              fontStyle: "italic"  },
    { tag: t.strong,                fontWeight: "bold"   },
    { tag: t.link,                  color: "#818cf8"     },
    { tag: t.url,                   color: "#818cf8"     },
    { tag: t.quote,                 color: "#8888aa", fontStyle: "italic" },
    { tag: t.monospace,             color: "#a5b4fc"     },
    { tag: t.meta,                  color: "#3f3f7a"     }, // **, ##, etc.
    { tag: t.processingInstruction, color: "#3f3f7a"     },
    { tag: t.strikethrough,         textDecoration: "line-through", color: "#8888aa" },
  ],
});

const storythreadLightTheme = createTheme({
  theme: "light",
  settings: {
    background:      "#F4F1EA",   // bg-primary (warm paper)
    foreground:      "#1A1A1A",   // text-primary (near-black)
    caret:           "#6366f1",   // accent (kept indigo)
    selection:       "#c7d2fe",   // soft indigo for selection on paper
    selectionMatch:  "#e0e7ff",   // even softer for secondary matches
    lineHighlight:   "#EAE6DC",   // bg-panel (slightly darker paper)
    gutterBackground: "#F4F1EA",
    gutterForeground: "#6B6B6B",
  },
  styles: [
    // Headings stay near-black on paper -- bold weight already gives the
    // hierarchy, no need to lighten the color.
    { tag: t.heading1,              color: "#1A1A1A", fontWeight: "bold", fontSize: "1.5em" },
    { tag: t.heading2,              color: "#1A1A1A", fontWeight: "bold", fontSize: "1.3em" },
    { tag: t.heading3,              color: "#2A2A2A", fontWeight: "bold", fontSize: "1.1em" },
    { tag: t.emphasis,              fontStyle: "italic"  },
    { tag: t.strong,                fontWeight: "bold"   },
    // Links use a slightly darker indigo so they pass AA contrast on paper.
    { tag: t.link,                  color: "#4F46E5"     },
    { tag: t.url,                   color: "#4F46E5"     },
    { tag: t.quote,                 color: "#6B6B6B", fontStyle: "italic" },
    { tag: t.monospace,             color: "#4F46E5"     },
    { tag: t.meta,                  color: "#9A9485"     }, // **, ##, etc. -- soft tan
    { tag: t.processingInstruction, color: "#9A9485"     },
    { tag: t.strikethrough,         textDecoration: "line-through", color: "#6B6B6B" },
  ],
});


// --- MarkdownEditor Props ---
interface MarkdownEditorProps {
  defaultValue: string;   // Initial content -- CodeMirror owns it after mount
  onChange: () => void;   // Fires on any change -- used to flip isDirty in App
  font: FontValue;        // Current writing font (CSS font-family string)
  onEditorReady: (view: EditorView) => void;  // Called once on mount with the EditorView
  onSelectionChange?: (selectedText: string) => void;  // Fires when selection changes
}


// ── MarkdownEditor Component ──────────────────────────────────────────────────
export function MarkdownEditor({ defaultValue, onChange, font, onEditorReady, onSelectionChange }: MarkdownEditorProps) {
  const editorViewRef = useRef<EditorView | null>(null);

  // Subscribe to the global theme so we can switch CodeMirror's syntax
  // highlighting + chrome colors when the user toggles dark/light. The
  // CodeMirror prop `theme` accepts either an extension or a baked theme,
  // and changing it triggers @uiw/react-codemirror to rebuild the view --
  // exactly what we want when the palette changes.
  const [appTheme]    = useTheme();
  const editorTheme   = appTheme === "light" ? storythreadLightTheme : storythreadDarkTheme;

  // When the font prop changes, hot-swap only the font compartment.
  // This avoids rebuilding the entire editor (which would reset the cursor).
  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        effects: fontCompartment.reconfigure(buildFontTheme(font)),
      });
    }
  }, [font]);

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
    fontCompartment.of(buildFontTheme(font)),
    // HR scene-break decoration: paints a horizontal stripe across any line
    // that is just `---` (or `***`). The text remains editable; only the
    // visual presentation changes.
    hrLinePlugin,
    hrLineTheme,
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
    <div className="h-full overflow-y-auto bg-bg-primary">

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
