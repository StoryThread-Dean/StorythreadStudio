// ExportPanel.test.tsx
// =====================
// The completion prompt (spec 25.2) and what the retention setting does
// on its own. This is the one place in the app where files can be deleted
// WITHOUT a click, so the tests pin both halves of that promise: it only
// happens when the writer chose it, and when it happens they are told.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { ExportPanel } from "./ExportPanel";

const WS = "C:/books/hollow-road-audio";

const DONE = {
  state: "done", message: "Export complete.", progress: 1, error: null,
  outputs: [`${WS}/output/The Hollow Road.m4b`], workspace_path: WS,
};

function storageReport(retention: string) {
  return {
    categories: [
      { key: "current_segments", label: "Current segment files", description: "",
        consequence: "", default_selected: false, protected: false,
        files: 400, bytes: 2 * 1024 * 1024 * 1024 },
      { key: "previews", label: "Preview files", description: "",
        consequence: "", default_selected: true, protected: false,
        files: 2, bytes: 4 * 1024 * 1024 },
      { key: "exports", label: "Final MP3 and M4B exports", description: "",
        consequence: "", default_selected: false, protected: true,
        files: 3, bytes: 500 * 1024 * 1024 },
    ],
    total_bytes: 0, export_only: false, export_only_note: "",
    has_exports: true, retention,
  };
}

function mockFetch(retention: string) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/ffmpeg/status")) {
      return { ok: true, json: async () => ({
        installed: true, version: "n8.1.2", download_size_mb: 138.6,
        install: { state: "idle", progress: 0, error: null },
      }) };
    }
    if (url.includes("/assemble/status")) return { ok: true, json: async () => DONE };
    if (url.includes("/assemble")) return { ok: true, json: async () => ({ ok: true }) };
    if (url.includes("/storage/cleanup")) {
      return { ok: true, json: async () => ({
        deleted: {}, freed_bytes: 2 * 1024 * 1024 * 1024, problems: [],
        storage: storageReport(retention),
      }) };
    }
    if (url.includes("/storage")) {
      return { ok: true, json: async () => storageReport(retention) };
    }
    throw new Error(`unexpected fetch ${url} ${method}`);
  });
}

function cleanupBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/storage/cleanup"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

async function exportOnce(retention: string) {
  const fetchMock = mockFetch(retention);
  vi.stubGlobal("fetch", fetchMock);
  render(<ExportPanel workspacePath={WS} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Export Audiobook/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Export Audiobook/ }));
  await waitFor(() => expect(screen.getByText("Export complete.")).toBeTruthy());
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExportPanel retention", () => {
  it("says nothing when the writer chose to keep the files", async () => {
    // The default. Silence is correct here -- there is no decision to make.
    const fetchMock = await exportOnce("keep");
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/storage"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Keep Files" })).toBeNull();
    expect(cleanupBodies(fetchMock)).toEqual([]);
  });

  it("asks with the size in front of the writer when they chose ask", async () => {
    await exportOnce("ask_after_export");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep Files" })).toBeTruthy());
    // The size leads: it is the whole reason anyone considers deleting.
    expect(screen.getByText(/Intermediate generation files use 2\.0 GB/)).toBeTruthy();
  });

  it("Keep Files dismisses without deleting anything", async () => {
    const fetchMock = await exportOnce("ask_after_export");
    fireEvent.click(await screen.findByRole("button", { name: "Keep Files" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Keep Files" })).toBeNull());
    expect(cleanupBodies(fetchMock)).toEqual([]);
  });

  it("deletes only the intermediate audio, never the exports or the source", async () => {
    // The finished audiobook and the imported original are not
    // "intermediate" under any reading, and this is the one path that
    // deletes without a confirm dialog.
    const fetchMock = await exportOnce("ask_after_export");
    fireEvent.click(await screen.findByRole("button", { name: "Delete Segment Files" }));

    await waitFor(() => expect(cleanupBodies(fetchMock).length).toBe(1));
    const sent = cleanupBodies(fetchMock)[0].categories;
    expect(sent).toContain("current_segments");
    expect(sent).not.toContain("exports");
    expect(sent).not.toContain("source_snapshots");
  });

  it("deletes automatically when that is the standing choice -- and says so", async () => {
    // Reclaiming gigabytes silently is indistinguishable from a bug.
    const fetchMock = await exportOnce("delete_after_export");
    await waitFor(() => expect(cleanupBodies(fetchMock).length).toBe(1));
    expect(await screen.findByText(/2\.0 GB reclaimed/)).toBeTruthy();
    expect(screen.getByText(/exported audiobook is untouched/)).toBeTruthy();
  });
});
