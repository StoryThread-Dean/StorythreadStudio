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

const ADDED_NARRATION = NARRATION + "\n# Chapter 3\n\nBrand new prose.\n";

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/chapters/available")) {
      return { ok: true, json: async () => ({
        available: [{ title: "Chapter 3", characters: 1200 }],
        source: "C:\\books\\b.txt", warnings: [],
      }) };
    }
    if (url.includes("/chapters/add")) {
      return { ok: true, json: async () => ({
        content: ADDED_NARRATION,
        chapters: SAVE_RESPONSE.chapters, warnings: [],
      }) };
    }
    if (url.includes("/metadata")) {
      return { ok: true, json: async () => ({ cover_file: null }) };
    }
    if (url.includes("/narration") && init?.method === "PUT") {
      return { ok: true, json: async () => SAVE_RESPONSE };
    }
    if (url.includes("/narration")) {
      return { ok: true, json: async () => ({ content: NARRATION }) };
    }
    if (url.includes("/pronunciations")) {
      return { ok: true, json: async () => ({ workspace_rules: [], global_rules: [] }) };
    }
    // The GenerationPanel rail loads voices + run status on mount.
    if (url.includes("/voices")) {
      return { ok: true, json: async () => ({ voices: [
        { id: "af_heart", label: "Heart (American female)", language: "en-US", gender_presentation: "female" },
      ] }) };
    }
    if (url.includes("/generation/status")) {
      return { ok: true, json: async () => ({ run: null, active: false }) };
    }
    if (url.includes("/narration-settings")) {
      return { ok: true, json: async () => ({
        narrator_pace: 1.0, dialogue_pace: 1.0,
        scene_break_ms: 2000, chapter_break_ms: 3000,
      }) };
    }
    if (url.includes("/ffmpeg/status")) {
      return { ok: true, json: async () => ({
        installed: true, version: "n8.1.2", download_size_mb: 138.6,
        install: { state: "idle", progress: 0, error: null },
      }) };
    }
    if (url.includes("/assemble/status")) {
      return { ok: true, json: async () => ({
        state: "idle", message: null, progress: 0, error: null,
        outputs: [], workspace_path: null,
      }) };
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

  it("pauses insert INLINE without shredding the paragraph", async () => {
    const textarea = await renderLoaded();
    // Caret mid-paragraph, right after a sentence's period.
    const caret = NARRATION.indexOf("First prose.") + "First prose.".length;
    textarea.setSelectionRange(caret, caret);

    fireEvent.click(screen.getByText("Pause 0.8s"));
    // A space is added where one is missing; NO blank lines are injected
    // (the paragraph-shredding was a live-testing complaint).
    expect(textarea.value).toContain("First prose. [pause:0.8]");
    expect(textarea.value).not.toContain("First prose.\n\n[pause:0.8]");
    // Inserting marks the buffer dirty -- Save lights up.
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });

  it("scene breaks still get their own line (structure, not punctuation)", async () => {
    const textarea = await renderLoaded();
    const caret = NARRATION.indexOf("First prose.") + "First prose.".length;
    textarea.setSelectionRange(caret, caret);

    fireEvent.click(screen.getByText("Scene Break"));
    expect(textarea.value).toContain("First prose.\n\n[scene-break]\n\n");
  });

  it("inserting a marker preserves the scroll position (no jump to bottom)", async () => {
    const textarea = await renderLoaded();
    const caret = NARRATION.indexOf("First prose.");
    textarea.setSelectionRange(caret, caret);
    // Simulate a scrolled editor -- the regression was the value swap
    // resetting scrollTop, reading as a jump to the bottom on every click.
    textarea.scrollTop = 500;

    fireEvent.click(screen.getByText("Scene Break"));
    expect(textarea.value).toContain("[scene-break]");
    expect(textarea.scrollTop).toBe(500);
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

  it("Slow and Fast wrap the selection in step-form pace spans", async () => {
    // Step form: +-2 steps of 0.05 off the book base, so every span lands
    // on an engine-clean speed (the old multiplier form produced off-grid
    // speeds like 1.08x, which audibly slurred).
    const textarea = await renderLoaded();
    const start = NARRATION.indexOf("First prose.");
    textarea.setSelectionRange(start, start + "First prose.".length);
    fireEvent.click(screen.getByText("Slow"));
    expect(textarea.value).toContain("[pace:-2]First prose.[/pace]");

    const start2 = textarea.value.indexOf("Second prose.");
    textarea.setSelectionRange(start2, start2 + "Second prose.".length);
    fireEvent.click(screen.getByText("Fast"));
    expect(textarea.value).toContain("[pace:+2]Second prose.[/pace]");
  });

  it("Remove strips markers from the selection, keeping the words", async () => {
    const textarea = await renderLoaded();
    const marked = "# Chapter 1\n\nKeep. [say:KAY-lith]Kaelith[/say] stays.\n\n[pause:1.5]\n\nEnd.";
    fireEvent.change(textarea, { target: { value: marked } });
    textarea.setSelectionRange(0, marked.length);

    fireEvent.click(screen.getByText("Remove"));
    expect(textarea.value).toBe("# Chapter 1\n\nKeep. Kaelith stays.\n\nEnd.");
  });

  it("Remove with no selection targets the paragraph under the caret", async () => {
    const textarea = await renderLoaded();
    const marked = "# Chapter 1\n\nFirst prose.\n\n[pause:1.5]\n\nSecond prose.";
    fireEvent.change(textarea, { target: { value: marked } });
    const caret = marked.indexOf("[pause") + 4;
    textarea.setSelectionRange(caret, caret);

    fireEvent.click(screen.getByText("Remove"));
    expect(textarea.value).not.toContain("[pause");
    expect(textarea.value).toContain("First prose.");
    expect(textarea.value).toContain("Second prose.");
  });

  it("What's this opens the marker help with Hear it buttons", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("What's this?"));
    expect(screen.getByText(/generated live by the free local narrator/)).toBeTruthy();
    expect(screen.getAllByText("Hear it")).toHaveLength(6);
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

  it("a chapter can be removed from the narration buffer (manual save owns it)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const textarea = await renderLoaded();

    fireEvent.click(screen.getByLabelText("Remove chapter Chapter 1"));
    expect(confirmSpy).toHaveBeenCalledOnce();
    // Heading + body gone from the BUFFER; nothing saved yet.
    expect(textarea.value).not.toContain("# Chapter 1");
    expect(textarea.value).not.toContain("First prose.");
    expect(textarea.value).toContain("# Chapter 2");
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });

  it("declining the remove confirm leaves the narration untouched", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const textarea = await renderLoaded();
    fireEvent.click(screen.getByLabelText("Remove chapter Chapter 1"));
    expect(textarea.value).toBe(NARRATION);
  });

  it("Add chapters pulls new source chapters in and refreshes everything", async () => {
    const textarea = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /Add chapters/ }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Chapter 3/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox", { name: /Chapter 3/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 selected/ }));

    // The backend saved and returned the grown narration -- editor and
    // chapter rail refresh together, no dirty state.
    await waitFor(() => expect(textarea.value).toBe(ADDED_NARRATION));
    expect(screen.getByText("3. Chapter 3")).toBeTruthy();
    expect(screen.queryByTitle("Unsaved changes")).toBeNull();
  });

  it("Add chapters is disabled while the narration has unsaved edits", async () => {
    const textarea = await renderLoaded();
    fireEvent.change(textarea, { target: { value: NARRATION + "edited" } });
    const button = screen.getByRole("button", { name: /Add chapters/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
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
