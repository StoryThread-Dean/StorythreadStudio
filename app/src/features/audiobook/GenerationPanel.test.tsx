// GenerationPanel.test.tsx
// =========================
// The narration rail's contract: voices load (spawning the engine behind
// the scenes), Generate posts the right body and shows live progress,
// a paused run offers Resume instead, and engine unavailability surfaces
// the backend's honest message.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { GenerationPanel } from "./GenerationPanel";
import type { GenerationRun } from "./types";

const VOICES = [
  { id: "af_heart", label: "Heart (American female)", language: "en-US", gender_presentation: "female" },
  { id: "am_adam", label: "Adam (American male)", language: "en-US", gender_presentation: "male" },
];

const WS = "C:\\Audiobooks\\Book";

function makeRun(overrides: Partial<GenerationRun> = {}): GenerationRun {
  return {
    run_id: "r1", status: "generating", provider: "local-kokoro",
    model: "kokoro-82m-v1.0", engine_version: "kokoro-worker 0.1.0",
    voice_id: "af_heart", started_at: "2026-07-29T00:00:00Z",
    paused_at: null, completed_at: null,
    total_segments: 10, completed_segments: 4, failed_segments: 0, note: null,
    ...overrides,
  };
}

const DEFAULT_SETTINGS = {
  narrator_pace: 1.0, dialogue_pace: 1.0,
  scene_break_ms: 2000, chapter_break_ms: 3000,
};

const FFMPEG_OK = {
  installed: true, version: "n8.1.2", download_size_mb: 138.6,
  install: { state: "idle", progress: 0, error: null },
};

const EXPORT_IDLE = {
  state: "idle", message: null, progress: 0, error: null,
  outputs: [], workspace_path: null,
};

const METADATA_DEFAULTS = {
  title: "The Hollow Road", subtitle: "", author: "Dean", narrator: "",
  series: "", series_number: "", description: "", genre: "",
  publication_year: "", publisher: "", copyright: "", language: "en-US",
  use_chapter_names: true, embed_cover: true, apply_to_chapter_mp3s: true,
  cover_file: null,
};

/** Handle the ExportPanel + BookDetailsPanel mount fetches in any custom mock. */
function exportPanelRoutes(url: string) {
  if (url.includes("/ffmpeg/status")) return { ok: true, json: async () => FFMPEG_OK };
  if (url.includes("/assemble/status")) return { ok: true, json: async () => EXPORT_IDLE };
  if (url.includes("/metadata")) return { ok: true, json: async () => METADATA_DEFAULTS };
  return null;
}

function mockFetch(statusBody: { run: GenerationRun | null; active: boolean }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/voices")) return { ok: true, json: async () => ({ voices: VOICES }) }; const ep = exportPanelRoutes(url); if (ep) return ep;
    if (url.includes("/generation/status")) return { ok: true, json: async () => statusBody };
    if (url.includes("/narration-settings")) return { ok: true, json: async () => DEFAULT_SETTINGS };
    if (url.includes("/generate")) return { ok: true, json: async () => makeRun() };
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GenerationPanel", () => {
  it("loads voices and defaults to the first one", async () => {
    vi.stubGlobal("fetch", mockFetch({ run: null, active: false }));
    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() => expect(screen.getByText("Heart (American female)")).toBeTruthy());
    const select = screen.getByLabelText(/Narrator voice/) as HTMLSelectElement;
    expect(select.value).toBe("af_heart");
    expect(screen.getByText("Generate Audiobook")).toBeTruthy();
  });

  it("Generate posts workspace + voice and shows live progress", async () => {
    // Stateful mock: no run until Generate is clicked, active afterwards --
    // matching the real endpoint's behavior across the mount poll.
    let started = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/voices")) return { ok: true, json: async () => ({ voices: VOICES }) }; const ep = exportPanelRoutes(url); if (ep) return ep;
      if (url.includes("/generation/status")) {
        return { ok: true, json: async () => (
          started ? { run: makeRun(), active: true } : { run: null, active: false }
        ) };
      }
      if (url.includes("/narration-settings")) {
        return { ok: true, json: async () => DEFAULT_SETTINGS };
      }
      if (url.includes("/generate")) {
        started = true;
        return { ok: true, json: async () => makeRun() };
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() => expect(screen.getByText("Generate Audiobook")).toBeTruthy());

    fireEvent.click(screen.getByText("Generate Audiobook"));
    await waitFor(() => expect(screen.getByText("4 / 10 segments")).toBeTruthy());

    const generateCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/generate"));
    expect(JSON.parse(String(generateCall?.[1]?.body))).toEqual({
      workspace_path: WS, provider: "local-kokoro", voice_id: "af_heart", force: false,
    });
    // Active run shows the between-segments controls.
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("a paused run offers Resume and shows the recovery note", async () => {
    vi.stubGlobal("fetch", mockFetch({
      run: makeRun({ status: "paused", note: "Generation was interrupted." }),
      active: false,
    }));
    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() => expect(screen.getByText("Resume Generation")).toBeTruthy());
    expect(screen.getByText("Generation was interrupted.")).toBeTruthy();
  });

  it("failed segments surface in ruby with the resume hint", async () => {
    vi.stubGlobal("fetch", mockFetch({
      run: makeRun({ status: "partially_completed", completed_segments: 8, failed_segments: 2 }),
      active: false,
    }));
    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() => expect(screen.getByText(/2 segments failed/)).toBeTruthy());
  });

  it("offers Regenerate Everything when the backend says up to date", async () => {
    const calls: { force?: boolean }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/voices")) return { ok: true, json: async () => ({ voices: VOICES }) }; const ep = exportPanelRoutes(url); if (ep) return ep;
      if (url.includes("/generation/status")) {
        return { ok: true, json: async () => ({ run: null, active: false }) };
      }
      if (url.includes("/narration-settings")) {
        return { ok: true, json: async () => DEFAULT_SETTINGS };
      }
      if (url.includes("/generate")) {
        const body = JSON.parse(String(init?.body));
        calls.push(body);
        if (!body.force) {
          return { ok: false, status: 400, json: async () => ({
            detail: "Nothing to generate -- every segment in the selected chapters is already up to date with the current text, pronunciations, and voice.",
          }) };
        }
        return { ok: true, json: async () => makeRun() };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() => expect(screen.getByText("Generate Audiobook")).toBeTruthy());

    fireEvent.click(screen.getByText("Generate Audiobook"));
    // The refusal surfaces WITH the escape hatch, not as a dead end.
    await waitFor(() => expect(screen.getByText("Regenerate Everything Anyway")).toBeTruthy());

    fireEvent.click(screen.getByText("Regenerate Everything Anyway"));
    await waitFor(() => expect(calls.some(c => c.force === true)).toBe(true));
  });

  it("engine unavailability shows the backend's honest message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/voices")) {
        return { ok: false, status: 503, json: async () => ({
          detail: "The free local narrator is not installed.",
        }) };
      }
      if (url.includes("/generation/status")) {
        return { ok: true, json: async () => ({ run: null, active: false }) };
      }
      if (url.includes("/narration-settings")) {
        return { ok: true, json: async () => DEFAULT_SETTINGS };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    render(<GenerationPanel workspacePath={WS} />);
    await waitFor(() =>
      expect(screen.getByText(/not installed/)).toBeTruthy());
  });
});

