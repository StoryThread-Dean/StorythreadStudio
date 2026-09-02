// WorkspaceView.test.tsx
// =======================
// The narration editor's contract: markers insert as plain text at the
// caret, [say] wraps the selection with the caret ready for the spoken
// form, save is MANUAL (PUT on demand, dirty dot until then), and the
// chapter rail re-derives from the save response.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { WorkspaceView } from "./WorkspaceView";
import type { AudiobookProjectPayload } from "./types";
import {
  resolveEditorFontPx, EDITOR_PT_DEFAULT, setEditorFontSize,
} from "../../hooks/useEditorFontSize";
import {
  resolveLineHeight, setLineSpacing, currentLineHeight,
} from "../../hooks/useEditorSpacing";

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
    if (url.includes("/audio-status")) {
      return { ok: true, json: async () => ({
        chapters: [
          { chapter_id: "chapter-001", title: "Chapter 1", status: "current",
            current: 4, outdated: 0, missing: 0 },
          { chapter_id: "chapter-002", title: "Chapter 2", status: "partial",
            current: 2, outdated: 1, missing: 1 },
        ],
        book: "partial", outdated_segments: 1, draft_segments: 0,
        outdated_reason: "text",
      }) };
    }
    if (url.includes("/storage")) {
      return { ok: true, json: async () => ({
        categories: [], total_bytes: 0, export_only: false,
        export_only_note: "", has_exports: false, retention: "keep",
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

describe("the narration editor is sized by the writer, not by a utility class", () => {
  // THE REPORT: "I have the font side one way but it appears visibly
  // different in the Audiobook generator ... It should be the same font size
  // editor, a mirror of the other one."
  //
  // This textarea carried `text-sm leading-relaxed`, so it rendered at a
  // fixed 14px equivalent no matter what Editor text size said. It is the
  // writer's own manuscript prose -- the same words they edit in the main
  // editor -- so it follows the same two stores.
  //
  // It is NOT a MarkdownEditor (the marker grammar needs raw text and stable
  // character offsets), which is exactly why it was missed: wiring the six
  // MarkdownEditor surfaces to the setting did not reach this one.

  it("renders at the default editor size, not at a hardcoded one", async () => {
    const ta = await renderLoaded();
    expect(ta.style.fontSize).toBe(`${resolveEditorFontPx(EDITOR_PT_DEFAULT)}px`);
  });

  it("does not fix its size with a Tailwind text-* class", async () => {
    // A leftover class would win or lose depending on rule order, which is
    // the kind of ambiguity that hid the line-height bug in MarkdownEditor.
    const ta = await renderLoaded();
    expect(ta.className).not.toMatch(/text-(2xs|micro|mini|xs|sm|base|lg)/);
  });

  it("follows the setting when the writer changes it", async () => {
    const ta = await renderLoaded();
    await act(async () => { await setEditorFontSize(18); });
    await waitFor(() =>
      expect(ta.style.fontSize).toBe(`${resolveEditorFontPx(18)}px`));
    // Put it back: this store is module-level and outlives the test.
    await act(async () => { await setEditorFontSize(EDITOR_PT_DEFAULT); });
  });

  it("takes its line spacing from the same setting as the manuscript", async () => {
    // "at the very least the linespacing effect should extend over to the
    // Audiobook Generator's text editor side." It does: the line-height is
    // the resolved number from useEditorSpacing, not `leading-relaxed`, which
    // is what this textarea carried before.
    const ta = await renderLoaded();
    expect(ta.style.lineHeight).toBe(String(currentLineHeight()));
    expect(ta.className).not.toMatch(/leading-/);
  });

  it("follows a line spacing change", async () => {
    const ta = await renderLoaded();
    await act(async () => { await setLineSpacing("double"); });
    await waitFor(() =>
      expect(ta.style.lineHeight).toBe(String(resolveLineHeight("double", 1.15))));
    // Module-level store: put it back or the next test inherits Double.
    await act(async () => { await setLineSpacing("one_half"); });
  });

  it("keeps the monospace face, which the marker grammar depends on", async () => {
    // Only the SIZE was the complaint. [pause], [say:...] and [voice:NAME]
    // are bracket-dense and a fixed pitch keeps them scannable.
    const ta = await renderLoaded();
    expect(ta.className).toContain("font-mono");
  });
});

describe("WorkspaceView", () => {
  it("loads the narration copy and lists chapters", async () => {
    await renderLoaded();
    expect(screen.getByText("1. Chapter 1")).toBeTruthy();
    expect(screen.getByText("2. Chapter 2")).toBeTruthy();
  });

  it("remembers the last highlight so a second Sample click is not a demo sentence", async () => {
    // Live report: previewing a selection worked, then clicking preview
    // AGAIN played the canned demo sentence. A textarea's selection does
    // not reliably survive a round trip through a button in the rail, and
    // on the paid path that silently bills for words nobody asked to
    // hear. The last real highlight is remembered as text.
    const textarea = await renderLoaded();
    const start = NARRATION.indexOf("First prose.");
    textarea.setSelectionRange(start, start + "First prose.".length);
    fireEvent.select(textarea);

    // The selection collapses -- exactly what clicking away does.
    textarea.setSelectionRange(start, start);

    fireEvent.click(screen.getByRole("button", { name: /Sample selection/i }));
    await waitFor(() => {
      const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .find(([url]: unknown[]) => String(url).includes("/preview-selection"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body)).text)
        .toBe("First prose.");
    });
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

  it("[say] opens the structured popout; Accept wraps the word", async () => {
    const textarea = await renderLoaded();
    const start = NARRATION.indexOf("First");
    textarea.setSelectionRange(start, start + "First".length);

    fireEvent.click(screen.getByText("[say]"));
    // The popout: brackets are chrome, only the spoken form is typeable.
    const input = await screen.findByLabelText("Spoken form");
    fireEvent.change(input, { target: { value: "FURST" } });
    fireEvent.click(screen.getByText("Accept"));

    expect(textarea.value).toContain("[say:FURST]First[/say] prose.");
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });

  it("[say] with no selection targets the word under the caret", async () => {
    const textarea = await renderLoaded();
    const caret = NARRATION.indexOf("Second") + 3;   // mid-word
    textarea.setSelectionRange(caret, caret);

    fireEvent.click(screen.getByText("[say]"));
    const input = await screen.findByLabelText("Spoken form");
    fireEvent.change(input, { target: { value: "SEK-und" } });
    fireEvent.click(screen.getByText("Accept"));
    expect(textarea.value).toContain("[say:SEK-und]Second[/say] prose.");
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

  it("marks each chapter's audio freshness in the rail", async () => {
    // Spec 24.2. A dot rather than a word: the rail is narrow, and the
    // sentence lives in the tooltip where it does not crowd the titles.
    await renderLoaded();
    await waitFor(() =>
      expect(screen.getByLabelText(/Audio matches this chapter's narration/)).toBeTruthy());
    expect(screen.getByLabelText(/Partly outdated/)).toBeTruthy();
  });

  it("shows no freshness dots at all until the status has loaded", async () => {
    // The failure this prevents: a slow backend painting every chapter
    // as "not generated" on a book that is fully narrated.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/audio-status")) throw new Error("offline");
      return mockFetch()(url);
    }));
    render(<WorkspaceView payload={PAYLOAD} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("1. Chapter 1")).toBeTruthy());
    expect(screen.queryByLabelText(/No audio generated yet/)).toBeNull();
    expect(screen.queryByLabelText(/Audio matches/)).toBeNull();
  });

  it("opens Storage from the rail", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("Storage"));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Audiobook storage" })).toBeTruthy());
  });
});
