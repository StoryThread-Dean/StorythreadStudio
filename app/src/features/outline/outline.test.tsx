// outline.test.tsx -- the section drawer, and the promises it makes
// ==================================================================
// The greying rule is the interesting part. It claims "already in your
// outline", and that claim is only honest if the menu actually looked -- so
// most of this file is about the menu keeping up with a document the writer
// is editing underneath it.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { headingsIn, normaliseHeading, findHeadingOffset } from "./headings";
import { appendPreset, fillWorksheet } from "./outlineEdits";
import { OutlineGuide } from "./OutlineGuide";

// Editors made by the helper below, torn down after each test. An EditorView
// that is never destroyed keeps its measure loop alive past the end of the
// test that made it, so its errors land on no test at all -- which is how
// they end up as unhandled ones that fail the run without failing a case.
const views: EditorView[] = [];

afterEach(() => {
  cleanup();
  while (views.length) views.pop()!.destroy();
});

function editor(doc: string): EditorView {
  // Mounted into the document rather than detached, because CodeMirror only
  // measures what it can find in a tree.
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc }), parent });
  views.push(view);
  return view;
}

// ── Which sections the outline already has ───────────────────────────────

describe("reading the headings out of the buffer", () => {
  it("finds H2 headings and normalises them", () => {
    const found = headingsIn("# Outline\n\n## Premise\n\ntext\n\n##   Story  Promise\n");
    expect(found.has("premise")).toBe(true);
    expect(found.has("story promise")).toBe(true);
  });

  it("ignores the H1 and any H3", () => {
    const found = headingsIn("# Premise\n\n### Premise\n");
    expect(found.size).toBe(0);
  });

  it("treats a repeatable section's suffix as the same section", () => {
    // `## Identity -- (name)` and `## Identity -- Vera` are both Identity, so
    // a writer can have one per character without them fighting.
    expect(normaliseHeading("Identity -- (name)")).toBe("identity");
    expect(normaliseHeading("Identity -- Vera")).toBe("identity");
  });

  it("matches exactly, never by substring", () => {
    // THE TRAP THIS AVOIDS: substring matching would grey out BOTH Climax and
    // Resolution for a writer who merged them into one heading, and there
    // would be no way to get either back short of renaming their own work.
    const found = headingsIn("## Climax and Resolution\n");
    expect(found.has("climax")).toBe(false);
    expect(found.has("resolution")).toBe(false);
    expect(found.has("climax and resolution")).toBe(true);
  });

  it("can locate a heading so a greyed entry still goes somewhere", () => {
    const doc = "# Outline\n\n## Premise\n\nbody\n\n## Crisis\n\nbody\n";
    expect(findHeadingOffset(doc, "Crisis")).toBeGreaterThan(0);
    expect(findHeadingOffset(doc, "Midpoint")).toBe(-1);
  });
});

// ── Inserting a section ──────────────────────────────────────────────────

describe("adding a section", () => {
  it("appends at the end, never at the cursor", () => {
    // The caret is almost never where the writer wants a new section -- they
    // clicked a menu, not a position -- and inserting there would split
    // whatever sentence they were in the middle of.
    const view = editor("# Outline\n\nSome prose I am in the middle of.\n");
    appendPreset(view, "## Premise\n\nWho wants what.\n");
    const doc = view.state.doc.toString();
    expect(doc.indexOf("Some prose")).toBeLessThan(doc.indexOf("## Premise"));
  });

  it("puts a horizontal rule above each section", () => {
    // Without one the outline is a single column of headings and prose with
    // nothing marking where a section starts. `---` rather than `___`,
    // because the editor paints a stripe across three or more dashes.
    const view = editor("# Outline\n\nTitle: A Book\n");
    appendPreset(view, "## Premise\n\nWho wants what.\n");
    const doc = view.state.doc.toString();
    expect(doc).toMatch(/---\n\n## Premise/);
  });

  it("does not open an empty outline with a rule", () => {
    // And so never puts one at position 0, where a pair could read as
    // frontmatter to the healer.
    const view = editor("");
    appendPreset(view, "## Premise\n\nWho wants what.\n");
    expect(view.state.doc.toString().startsWith("---")).toBe(false);
  });

  it("separates two sections from each other", () => {
    const view = editor("# Outline\n");
    appendPreset(view, "## Premise\n\nA.\n");
    appendPreset(view, "## Crisis\n\nB.\n");
    const doc = view.state.doc.toString();
    expect((doc.match(/^---$/gm) ?? []).length).toBe(2);
  });
});

// ── Fill from Book Details ───────────────────────────────────────────────

describe("filling the worksheet", () => {
  const WORKSHEET = "# Outline -- A Book\n\nTitle: A Book\nGenre: Fantasy\n"
    + "Tone: Wry\nTarget Word Count: 90000\n";

  it("fills only the lines that are empty", () => {
    const view = editor("# Outline\n\nTitle:\nGenre: Horror\nTone:\n");
    const filled = fillWorksheet(view, WORKSHEET);
    const doc = view.state.doc.toString();
    expect(doc).toContain("Title: A Book");
    expect(doc).toContain("Genre: Horror");   // the writer's answer survives
    expect(doc).toContain("Tone: Wry");
    expect(filled).toBeGreaterThan(0);
  });

  it("never replaces something the writer wrote", () => {
    // The thing this replaced overwrote the WHOLE FILE with a fresh scaffold.
    const view = editor("# Outline\n\nTitle: My Own Title\nGenre: Mine\n");
    fillWorksheet(view, WORKSHEET);
    const doc = view.state.doc.toString();
    expect(doc).toContain("Title: My Own Title");
    expect(doc).toContain("Genre: Mine");
    expect(doc).not.toContain("A Book");
  });

  it("reports nothing filled when the header is already complete", () => {
    // A no-op has to be distinguishable from a failure, which is how this
    // was first reported: "didn't seem to work".
    const view = editor("# Outline\n\nTitle: Mine\nGenre: Mine\nTone: Mine\n"
      + "Target Word Count: 1\n");
    expect(fillWorksheet(view, WORKSHEET)).toBe(0);
  });

  it("keeps the writer's own formatting on a line it fills", () => {
    const view = editor("# Outline\n\n- **Genre:**\n");
    fillWorksheet(view, WORKSHEET);
    expect(view.state.doc.toString()).toContain("- **Genre:** Fantasy");
  });
});

// ── The walkthrough ──────────────────────────────────────────────────────

describe("Show me how", () => {
  it("opens on page 1 and counts every page", async () => {
    render(<OutlineGuide onClose={() => {}} />);
    expect(screen.getByTestId("outline-guide-progress").textContent)
      .toMatch(/^Page 1 of \d+$/);
  });

  it("has a page for every section the drawer can add", () => {
    // Nineteen sections plus an opening and a closing page. If a preset is
    // added and this is not, the walkthrough quietly stops being complete.
    render(<OutlineGuide onClose={() => {}} />);
    const total = Number(
      /of (\d+)/.exec(screen.getByTestId("outline-guide-progress").textContent!)![1],
    );
    expect(total).toBe(21);
  });

  it("teaches with worked examples rather than definitions", async () => {
    const user = userEvent.setup();
    render(<OutlineGuide onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText(/How three books you know answer it/)).toBeTruthy();
    });
    expect(screen.getByText("The Lord of the Rings")).toBeTruthy();
  });

  it("closes from the last page", async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<OutlineGuide onClose={() => { closed = true; }} />);
    for (let i = 0; i < 20; i++) {
      const next = screen.queryByRole("button", { name: /Next/ });
      if (!next) break;
      await user.click(next);
    }
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(closed).toBe(true);
  });
});
