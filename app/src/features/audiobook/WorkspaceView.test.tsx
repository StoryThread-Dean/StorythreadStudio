// WorkspaceView.test.tsx
// =======================
// The narration editor's contract: markers insert as plain text at the
// caret, [say] wraps the selection with the caret ready for the spoken
// form, save is MANUAL (PUT on demand, dirty dot until then), and the
// chapter rail re-derives from the save response.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { WorkspaceView } from "./WorkspaceView";
import type { AudiobookProjectPayload } from "./types";

const NARRATION = "# Chapter 1\n\nFirst prose.\n\n# Chapter 2\n\nSecond prose.\n";

const PAYLOAD: AudiobookProjectPayload = {
  manifest: {
    project_id: "p1", schema_version: 1, title: "The Hollow Road", author: "Dean",
    workspace_path: "C:\\Audiobooks\\The Hollow Road", source_file: "source/original-b.txt",
    language: "en-US", status: "needs_review",
    created_at: "2026-07-28T12:00:00Z", updated_at: "2026-07-28T12:00:00Z",
    selected_provider: null, selected_model: null, selected_voice: null,
    output_formats: ["chapter_mp3", "combined_mp3", "m4b"], retain_intermediate_audio: true,
  },
  chapters: [
    { chapter_id: "chapter-001", title: "Chapter 1", order: 1, selected_for_generation: true, status: "ready" },
    { chapter_id: "chapter-002", title: "Chapter 2", order: 2, selected_for_generation: true, status: "ready" },
  ],
};

const SAVE_RESPONSE = {
  chapters: [
    ...PAYLOAD.chapters,
    { chapter_id: "chapter-003", title: "Chapter 3", order: 3, selected_for_generation: true, status: "ready" },
  ],
  warnings: ["Chapter 'Chapter 3': an [exclude] has no closing [/exclude]; everything after it is excluded from narration."],
};

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/narration") && init?.method === "PUT") {
      return { ok: true, json: async () => SAVE_RESPONSE };
    }
    if (url.includes("/narration")) {
      return { ok: true, json: async () => ({ content: NARRATION }) };
    }
    if (url.includes("/pronunciations")) {
      return { ok: true, json: async () => ({ workspace_rules: [], global_rules: [] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderLoaded() {
  render(<WorkspaceView payload={PAYLOAD} onBack={vi.fn()} />);
  await waitFor(() =>
    expect((screen.getByLabelText("Narration text") as HTMLTextAreaElement).value).toBe(NARRATION));
  return screen.getByLabelText("Narration text") as HTMLTextAreaElement;
}

describe("WorkspaceView", () => {
  it("loads the narration copy and lists chapters", async () => {
    await renderLoaded();
    expect(screen.getByText("1. Chapter 1")).toBeTruthy();
    expect(screen.getByText("2. Chapter 2")).toBeTruthy();
  });

  it("marker buttons insert the marker text at the caret", async () => {
    const textarea = await renderLoaded();
    const caret = NARRATION.indexOf("First prose.") + "First prose.".length;
    textarea.setSelectionRange(caret, caret);

    fireEvent.click(screen.getByText("Pause 0.8s"));
    expect(textarea.value).toContain("First prose.\n\n[pause:0.8]\n\n");
    // Inserting marks the buffer dirty -- Save lights up.
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });

  it("[say] wraps the selection and parks the caret for the spoken form", async () => {
    const textarea = await renderLoaded();
    const start = NARRATION.indexOf("First");
    textarea.setSelectionRange(start, start + "First".length);

    fireEvent.click(screen.getByText("[say]"));
    expect(textarea.value).toContain("[say:]First[/say] prose.");
    // Caret sits right after 'say:' so the writer types the spoken form.
    expect(textarea.selectionStart).toBe(start + "[say:".length);
  });

  it("Exclude wraps the selection in exclude tags", async () => {
    const textarea = await renderLoaded();
    const start = NARRATION.indexOf("Second prose.");
    textarea.setSelectionRange(start, start + "Second prose.".length);

    fireEvent.click(screen.getByText("Exclude"));
    expect(textarea.value).toContain("[exclude]Second prose.[/exclude]");
  });

  it("save is manual: PUT sends the buffer, chapters and warnings update", async () => {
    const textarea = await renderLoaded();
    fireEvent.change(textarea, { target: { value: NARRATION + "\n# Chapter 3\n\nNew.\n" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("3. Chapter 3")).toBeTruthy());
    // The marker warning from the backend surfaces in the banner.
    expect(screen.getByText(/no closing \[\/exclude\]/)).toBeTruthy();

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const putCall = fetchMock.mock.calls.find(([, init]) => init && (init as RequestInit).method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String((putCall?.[1] as RequestInit).body));
    expect(body.workspace_path).toBe(PAYLOAD.manifest.workspace_path);
    expect(body.content).toContain("# Chapter 3");
  });

  it("clicking a chapter moves the caret to its heading", async () => {
    const textarea = await renderLoaded();
    fireEvent.click(screen.getByText("2. Chapter 2"));
    expect(textarea.selectionStart).toBe(NARRATION.indexOf("# Chapter 2"));
  });

  it("opens the pronunciation dictionary dialog", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("Pronunciations"));
    await waitFor(() => expect(screen.getByText("Pronunciation Dictionary")).toBeTruthy());
    // One-spot overrides are pointed at the [say] toolbar, per the spec.
    expect(screen.getByText(/\[say\] toolbar button/)).toBeTruthy();
  });
});
