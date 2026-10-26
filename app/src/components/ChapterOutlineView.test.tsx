// components/ChapterOutlineView.test.tsx
// ======================================
// The chapter's plan, and the AI that helps write it.
//
// What these protect, in order of how badly they fail:
//
//   1. THE WRITE BOUNDARY. Build Chapter Outline proposes; Insert puts the
//      text in the editor buffer UNSAVED. Nothing reaches disk without the
//      writer pressing Save. An outline is a human-authored planning document,
//      not one of the four designated AI-generated fields, so a route that
//      wrote it would need a new exception to a locked product rule. It does
//      not write, and these tests are what keep that true.
//   2. Manual save only, with the unsaved state visible.
//   3. The empty state teaches instead of looking broken.

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChapterOutlineView } from "./ChapterOutlineView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = {
  project_id: "p", title: "N", description: "", root_path: "C:/MyNovel",
  content_mode_default: "general", default_model: null,
  series_id: null, series_path: null, story_type: "novel",
  created_at: "", updated_at: "",
} as never;

const OUTLINE = "1. The column is spotted at dusk.\n2. Vance argues.\n";
const PROPOSED = "1. She refuses the contract.\n2. Milton overrules her.";

let posted: { url: string; body: Record<string, unknown> }[] = [];

function mockApi(over: { outline?: string; exists?: boolean } = {}) {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes("/build-chapter-outline")) {
        return { ok: true, json: async () => ({ outline: PROPOSED }) } as Response;
      }
      return { ok: true, json: async () => ({ filename: "07.md", message: "Saved." }) } as Response;
    }
    if (url.includes("/chapter-outline?")) {
      return { ok: true, json: async () => ({
        filename: "07.md",
        content: over.outline ?? "",
        exists: over.exists ?? false,
      }) } as Response;
    }
    if (url.includes("/documents/chapter?")) {
      return { ok: true, json: async () => ({ title: "Seven to One" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

beforeEach(() => mockApi());

async function openView(over: { outline?: string; exists?: boolean } = {}) {
  mockApi(over);
  render(
    <ChapterOutlineView
      project={PROJECT}
      chapterFile="07-seven-to-one.md"
      font={"serif" as never}
      onFontChange={() => {}}
      onBack={() => {}}
      weaveBrief="Kipling (Character)"
    />,
  );
  await screen.findByText("Seven to One");
}

const saved = () => posted.filter(p => p.url.includes("/documents/chapter-outline"));
/** The Build composer, by its placeholder. The MarkdownEditor is a textbox
 *  too, so "the first textbox" would be a coin toss. */
const composer = () => screen.getByPlaceholderText(/In your own words/);
const builds = () => posted.filter(p => p.url.includes("/build-chapter-outline"));


describe("the empty state", () => {
  it("shows the shape rather than describing it", async () => {
    await openView();
    expect(screen.getByText(/Nothing planned for this chapter yet/)).toBeTruthy();
    // A four-line example teaches "a numbered list of key events" better than
    // those five words do.
    expect(screen.getByText(/The column is spotted at dusk/)).toBeTruthy();
  });

  it("says nothing is saved on its own", async () => {
    await openView();
    expect(screen.getByText(/Nothing is saved until you press Save/)).toBeTruthy();
  });
});


describe("build with AI", () => {
  it("is not open until asked for", async () => {
    await openView();
    expect(screen.queryByTestId("outline-build-panel")).toBeNull();
  });

  it("will not spend anything on an empty description", async () => {
    // The feature is "build the outline I am describing". With no description
    // there is nothing to build, and finding that out from the model would
    // cost the writer a request to be told so.
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    const build = screen.getByRole("button", { name: "Build" });
    expect((build as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(build);
    expect(builds()).toHaveLength(0);
  });

  it("sends the writer's words, and what is already there", async () => {
    await openView({ outline: OUTLINE, exists: true });
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    await userEvent.type(composer(), "she refuses");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    await waitFor(() => expect(builds()).toHaveLength(1));
    const body = builds()[0].body;
    expect(String(body.instruction)).toContain("she refuses");
    expect(body.weave_brief).toBe("Kipling (Character)");
    // An absolute path, which is what the backend validates against the
    // manuscript folder.
    expect(String(body.chapter_path)).toContain("manuscript");
  });

  it("shows the proposal and writes nothing yet", async () => {
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    await userEvent.type(composer(), "she refuses");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));

    await screen.findByTestId("outline-proposal");
    expect(screen.getByText(/She refuses the contract/)).toBeTruthy();
    // THE WRITE BOUNDARY, as an assertion: a proposal on screen has saved
    // nothing.
    expect(saved()).toHaveLength(0);
  });

  it("says what Insert will do before it is pressed", async () => {
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    await userEvent.type(composer(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));
    await screen.findByTestId("outline-proposal");
    // It REPLACES. A writer who expected an append and got a replacement has
    // lost work they cannot get back without an undo they may not think of.
    expect(screen.getByText(/Insert REPLACES what is in the editor/)).toBeTruthy();
  });

  it("Insert still saves nothing", async () => {
    // THE ONE THAT MATTERS MOST. Insert puts text in the buffer and marks it
    // unsaved. If this ever posts, an AI has written to a human-authored file
    // without the writer applying it -- which is the boundary, not a nicety.
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    await userEvent.type(composer(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));
    await screen.findByTestId("outline-proposal");

    await userEvent.click(screen.getByTestId("outline-insert"));
    expect(saved()).toHaveLength(0);
    // And it says so, rather than leaving the writer to assume it landed.
    expect(await screen.findByText(/Inserted. Not saved yet./)).toBeTruthy();
  });

  it("Discard changes nothing at all", async () => {
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    await userEvent.type(composer(), "x");
    await userEvent.click(screen.getByRole("button", { name: "Build" }));
    await screen.findByTestId("outline-proposal");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("outline-proposal")).toBeNull();
    expect(saved()).toHaveLength(0);
  });

  it("explains itself, including what it spends", async () => {
    await openView();
    await userEvent.click(screen.getByRole("button", { name: /Build with AI/ }));
    expect(screen.getAllByRole("button", { name: /What.s this/i }).length)
      .toBeGreaterThan(0);
  });
});


// ── It is an editor, so it has the editor's tools ────────────────────────────
//
// THE BUG, in the writer's words:
//
//     "Fix the Chapter Outline Editor to act and function like the Main
//      editor. There is no way to add numbered lists or bullet point lists
//      etc."
//
// An outline is a numbered list more often than it is anything else, and the
// only way to make one was to type the digits. The manuscript toolbar is
// formatting-only and takes an editor view, so there was nothing
// chapter-specific to strip out -- it just was not there.

describe("the formatting toolbar", () => {
  it("offers the two list kinds an outline is actually made of", async () => {
    await openView();
    expect(screen.getByTitle("Numbered List")).toBeTruthy();
    expect(screen.getByTitle("Bullet List")).toBeTruthy();
  });

  it("offers the rest of what the manuscript offers", async () => {
    await openView();
    for (const label of ["Bold", "Italic", "Heading 1", "Heading 2",
                         "Clear Formatting"]) {
      expect(screen.getByTitle(label)).toBeTruthy();
    }
  });

  it("is there before anything is typed", async () => {
    // The empty state is exactly when a writer reaches for "1." -- a toolbar
    // that only appeared once the document had content would be missing at
    // the one moment it is most wanted.
    await openView({ outline: "", exists: false });
    expect(screen.getByTitle("Numbered List")).toBeTruthy();
  });
});
