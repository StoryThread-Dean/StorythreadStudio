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
import { EditorView, Decoration, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate, DecorationSet } from "@codemirror/view";
import { Compartment, RangeSetBuilder } from "@codemirror/state";
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import type { FontValue } from "./EditorToolbar";


// --- Font Compartment ---
// Module-level so it persists across re-renders (React recreates component
// variables on every render, but module-level constants stay alive).
const fontCompartment = new Compartment();

// Builds a CodeMirror theme extension for a given font.
// Only controls typography -- colors are handled by storyforgeColorTheme.
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
      caretColor: "#6366f1",
      padding: "2rem 1rem",  // Small padding only -- wrapper handles centering
    },
    ".cm-line": {
      fontFamily,
    },
    // Hide the line-number gutter (not useful in a prose editor)
    ".cm-gutters": {
      display: "none",
    },
    // Subtle highlight on the line the cursor is on
    ".cm-activeLine": {
      backgroundColor: "#0d0d2b",
    },
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


// --- StoryForge Color Theme ---
// Controls syntax highlighting (headings, bold, italic, links, etc.)
// and editor chrome colors (background, selection, cursor).
//
// The selection color (#3a5bbf) must contrast clearly against the
// background (#070724). We use a mid-range indigo-blue.
const storyforgeColorTheme = createTheme({
  theme: "dark",
  settings: {
    background:      "#070724",
    foreground:      "#f0f0f5",
    caret:           "#6366f1",
    selection:       "#3a5bbf",   // Visible indigo-blue selection
    selectionMatch:  "#1e3464",   // Dimmer for secondary matches
    lineHighlight:   "#0d0d2b",
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
  ];

  return (
    // Outer wrapper: fills the panel and scrolls vertically.
    <div className="h-full overflow-y-auto bg-[#070724]">

      {/* Centering wrapper: constrains the editor to a comfortable reading width.
          We center HERE with a div, not inside CodeMirror's internal styles.
          This keeps CodeMirror's coordinate system accurate so selection,
          click-to-cursor, and drag-select all work correctly. */}
      <div className="mx-auto w-full max-w-3xl">
        <CodeMirror
          value={defaultValue}
          onChange={onChange}
          theme={storyforgeColorTheme}
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
            searchKeymap:              true,
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
