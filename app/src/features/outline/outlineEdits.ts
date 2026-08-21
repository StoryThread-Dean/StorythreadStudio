// outlineEdits.ts -- the three ways the toolbar touches the writer's outline
// ===========================================================================
// Every one of these is ONE CodeMirror transaction, which is not a detail:
// it means one Ctrl+Z undoes the whole thing. That is what lets the toolbar
// act without asking first. A preset that pasted in three separate edits
// would take three undos to remove and would feel like damage.
//
// None of them saves. Manual save is a locked product rule, so everything
// here lands in the buffer and the writer's Save button still means what it
// has always meant.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findHeadingOffset, normaliseHeading } from "./headings";

/**
 * Append a preset section to the end of the outline.
 *
 * AT THE END, NEVER AT THE CURSOR. Inserting where the caret happens to be
 * would split a sentence the writer is in the middle of, and the caret is
 * almost never where they want a new section -- they clicked a menu, not a
 * position. The end is boring and always correct.
 *
 * The cursor lands on the first blank line of what was pasted and scrolls
 * into view, so the writer is left where the typing happens.
 */
export function appendPreset(view: EditorView, markdown: string): void {
  const doc = view.state.doc.toString();
  const needsGap = doc.trim().length > 0;
  const prefix = needsGap ? (doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n") : "";
  const text = prefix + markdown.replace(/\s*$/, "") + "\n";

  const at = doc.length;
  // Land the caret after the heading, on the first line of body text.
  const headingEnd = text.indexOf("\n", text.indexOf("## "));
  const caret = at + (headingEnd >= 0 ? headingEnd + 2 : text.length);

  view.dispatch({
    changes: { from: at, insert: text },
    selection: EditorSelection.cursor(Math.min(caret, at + text.length)),
    scrollIntoView: true,
  });
  view.focus();
}

/** `Label:` at the start of a line, tolerant of the writer's formatting. */
function labelLine(label: string): RegExp {
  const words = label.split(" ").map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[ \\t]+");
  return new RegExp(
    `^[ \\t]*(?:[-*+][ \\t]+)?(?:\\*\\*|__)?[ \\t]*${words}`
    + `[ \\t]*(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?([^\\n]*)$`,
    "im",
  );
}

/**
 * Fill the worksheet header from Book Details.
 *
 * FILLS BLANK LINES ONLY, and that is the whole contract. The thing this
 * replaced overwrote the entire file with a fresh scaffold; a writer who had
 * typed a description lost it. Here, a line with anything on it is the
 * writer's answer and is left exactly as they wrote it -- including their
 * bullet, their bold, and their spacing.
 *
 * A worksheet that is missing altogether is inserted after the H1.
 *
 * Returns how many lines were actually filled, so the toolbar can say
 * something true rather than "done".
 */
export function fillWorksheet(view: EditorView, worksheet: string): number {
  const doc = view.state.doc.toString();

  // Pull `Label: value` out of the rendered worksheet the backend sent.
  const incoming: [string, string][] = [];
  for (const line of worksheet.split("\n")) {
    const match = /^([A-Za-z][A-Za-z ]*?):[ \t]*(.*)$/.exec(line.trim());
    if (match && match[2].trim()) incoming.push([match[1].trim(), match[2].trim()]);
  }

  let next = doc;
  let filled = 0;
  const missing: [string, string][] = [];

  for (const [label, value] of incoming) {
    const re = labelLine(label);
    const found = re.exec(next);
    if (!found) {
      missing.push([label, value]);
      continue;
    }
    if (found[1].trim()) continue;      // the writer already answered this
    const line = found[0];
    const head = line.slice(0, line.lastIndexOf(":") + 1);
    // Preserve any bold that closes after the colon.
    const tail = line.slice(line.lastIndexOf(":") + 1);
    const closer = /^(\*\*|__)/.exec(tail)?.[1] ?? "";
    next = next.slice(0, found.index)
      + `${head}${closer} ${value}`
      + next.slice(found.index + line.length);
    filled += 1;
  }

  // Labels the outline does not have at all go in as a block after the H1,
  // so the header stays a header rather than growing at the bottom.
  if (missing.length) {
    const block = missing.map(([l, v]) => `${l}: ${v}`).join("\n");
    const h1 = /^#[^\n]*$/m.exec(next);
    if (h1) {
      const at = h1.index + h1[0].length;
      next = next.slice(0, at) + "\n\n" + block + next.slice(at);
    } else {
      next = block + "\n\n" + next;
    }
    filled += missing.length;
  }

  if (next === doc) return 0;

  view.dispatch({
    changes: { from: 0, to: doc.length, insert: next },
    scrollIntoView: true,
  });
  return filled;
}

/**
 * Scroll to a section the outline already has.
 *
 * So a greyed-out menu entry is not a dead end. It says why it is disabled
 * and then still takes the writer where they were trying to go -- the
 * continuous-flow rule applied to a refusal.
 */
export function scrollToHeading(view: EditorView, heading: string): void {
  const at = findHeadingOffset(view.state.doc.toString(), heading);
  if (at < 0) return;
  view.dispatch({
    selection: EditorSelection.cursor(at),
    scrollIntoView: true,
  });
  view.focus();
}

export { normaliseHeading };
