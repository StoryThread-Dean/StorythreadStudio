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
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
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
}


// ── MarkdownEditor Component ──────────────────────────────────────────────────
export function MarkdownEditor({ defaultValue, onChange, font, onEditorReady }: MarkdownEditorProps) {
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
  const extensions = [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    fontCompartment.of(buildFontTheme(font)),
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
          basicSetup={{
            lineNumbers:               false,
            foldGutter:                false,
            highlightActiveLine:       true,
            highlightSelectionMatches: true,
            searchKeymap:              true,
            history:                   true,
            // drawSelection: false -- let the browser draw selection natively.
            // When true, CodeMirror hides the browser's selection and draws its
            // own using .cm-selectionBackground divs. In Tauri's WebView this
            // custom drawing doesn't appear correctly for within-line selections.
            // With false, the browser's built-in highlight is used instead,
            // which we style with ::selection CSS in App.css.
            drawSelection:             false,
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
