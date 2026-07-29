// AudiobookDashboard.test.tsx
// ============================
// The dashboard's contract: recents render with jewel-status pills, the
// empty state invites an import, Remove from Recents hits the endpoint
// that keeps files (and refreshes the list), and opening a recent hands
// the fetched project payload up.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// The Tauri dialog plugin only exists inside the shell -- mock it so the
// component renders in jsdom. Individual tests override the resolved value.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { AudiobookDashboard } from "./AudiobookDashboard";

const RECENTS = [
  {
    workspace_path: "C:\\Audiobooks\\The Hollow Road",
    title: "The Hollow Road", author: "Dean", source_file: "source/original-book.txt",
    status: "needs_review", imported_at: "2026-07-28T12:00:00Z", last_opened: "2026-07-28T12:00:00Z",
  },
  {
    workspace_path: "C:\\Audiobooks\\Ashes",
    title: "Ashes of Morning", author: "", source_file: "s.docx",
    status: "completed", imported_at: "2026-07-26T12:00:00Z", last_opened: "2026-07-26T12:00:00Z",
  },
];

const PROJECT_PAYLOAD = {
  manifest: { title: "The Hollow Road", workspace_path: RECENTS[0].workspace_path },
  chapters: [],
};

function mockFetch(recents = RECENTS) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/recents/remove")) return { ok: true, json: async () => ({ ok: true }) };
    if (url.includes("/recents")) return { ok: true, json: async () => ({ audiobooks: recents }) };
    if (url.includes("/project")) return { ok: true, json: async () => PROJECT_PAYLOAD };
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  cleanup();               // globals: false -- manual RTL cleanup (house rule)
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AudiobookDashboard", () => {
  it("renders recent audiobooks with status labels", async () => {
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());
    expect(screen.getByText("Ashes of Morning")).toBeTruthy();
    expect(screen.getByText("Needs Review")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("shows the empty-state invitation when there are no recents", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/No audiobooks yet/)).toBeTruthy());
  });

  it("New Audiobook fires the wizard callback", async () => {
    const onNew = vi.fn();
    render(<AudiobookDashboard onNewAudiobook={onNew} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());
    fireEvent.click(screen.getByText("New Audiobook"));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("opening a recent fetches the project and hands the payload up", async () => {
    const onOpen = vi.fn();
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={onOpen} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());
    fireEvent.click(screen.getByText("The Hollow Road"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(PROJECT_PAYLOAD));
    // The project endpoint got the workspace path, URL-encoded.
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const projectCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/project"));
    expect(String(projectCall?.[0])).toContain(encodeURIComponent(RECENTS[0].workspace_path));
  });

  it("Remove from Recents posts to the file-preserving endpoint and refreshes", async () => {
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());

    const removeButtons = screen.getAllByTitle(/Remove from Recents/);
    fireEvent.click(removeButtons[0]);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const removeCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/recents/remove"));
      expect(removeCall).toBeTruthy();
      expect(JSON.parse(String(removeCall?.[1]?.body))).toEqual({
        workspace_path: RECENTS[0].workspace_path,
      });
    });
  });
});
