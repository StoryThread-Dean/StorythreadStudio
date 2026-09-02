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
import type { RecentAudiobook } from "./types";

const RECENTS: RecentAudiobook[] = [
  {
    workspace_path: "C:\\Audiobooks\\The Hollow Road",
    title: "The Hollow Road", author: "Dean", source_file: "source/original-book.txt",
    status: "needs_review", imported_at: "2026-07-28T12:00:00Z", last_opened: "2026-07-28T12:00:00Z",
  },
  {
    workspace_path: "C:\\Audiobooks\\Ashes",
    title: "Ashes of Morning", author: "", source_file: "s.docx",
    status: "completed", imported_at: "2026-07-26T12:00:00Z", last_opened: "2026-07-26T12:00:00Z",
    progress: 1,
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
    if (url.includes("/storage")) {
      return { ok: true, json: async () => ({
        categories: [{
          key: "previews", label: "Preview files", description: "Rebuilt free.",
          consequence: "", default_selected: true, protected: false,
          files: 2, bytes: 3 * 1024 * 1024,
        }],
        total_bytes: 3 * 1024 * 1024, export_only: false, export_only_note: "",
        has_exports: false, retention: "keep",
      }) };
    }
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
      expect(screen.getByText(/Your first audiobook starts here/)).toBeTruthy());
  });

  it("Let's Get Started fires the wizard callback", async () => {
    const onNew = vi.fn();
    render(<AudiobookDashboard onNewAudiobook={onNew} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());
    fireEvent.click(screen.getByText("Let's Get Started"));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("teaches the five-step workflow and demotes Open Existing to More", async () => {
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());

    // The pitch carries the wonder, not just the function.
    expect(screen.getByText(/Hear your own words read aloud/)).toBeTruthy();
    expect(screen.getByText(/Five steps from page to playback/)).toBeTruthy();
    // The educational strip: all five steps named, pricing honesty in 5.
    expect(screen.getByText("Load your book")).toBeTruthy();
    expect(screen.getByText("Set up your workspace")).toBeTruthy();
    expect(screen.getByText("Direct the narration")).toBeTruthy();
    expect(screen.getByText("Hear it read aloud, free")).toBeTruthy();
    expect(screen.getByText(/Print a studio-quality version/)).toBeTruthy();
    expect(screen.getByText(/fifty cents/)).toBeTruthy();

    // Open Existing is NOT a primary button -- it hides under More.
    expect(screen.queryByText("Open Existing Workspace")).toBeNull();
    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("Open Existing Workspace")).toBeTruthy();
  });

  it("draws generation progress as a waveform on the rows that have it", async () => {
    const partly = [
      { ...RECENTS[0], status: "paused", progress: 0.4 },
      RECENTS[1],                                   // progress 1 (completed)
    ];
    vi.stubGlobal("fetch", mockFetch(partly));
    const { container } = render(
      <AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("40% narrated")).toBeTruthy());
    expect(screen.getByText("100% narrated")).toBeTruthy();
    // The finished book's bars are all lit; the paused one's are not.
    const waves = container.querySelectorAll(".flex.h-4.items-end");
    expect(waves.length).toBe(2);
    const dimInPaused = waves[0].querySelectorAll(".bg-bg-raised").length;
    const dimInDone = waves[1].querySelectorAll(".bg-bg-raised").length;
    expect(dimInPaused).toBeGreaterThan(0);
    expect(dimInDone).toBe(0);
  });

  it("a row with no run yet shows no progress claim", async () => {
    vi.stubGlobal("fetch", mockFetch([{ ...RECENTS[0], progress: null }]));
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());
    // (The pitch paragraph contains the word "narrated" too, so match
    // the percentage form specifically.)
    expect(screen.queryByText(/\d+% narrated/)).toBeNull();
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
  it("keeps 'forget the row' and 'delete the files' visibly apart (spec 5.4)", async () => {
    // Two very different destructive-looking buttons sit side by side.
    // Remove from Recents touches no files; Delete Working Files opens
    // the cleanup dialog. Confusing them is unrecoverable, so they are
    // labelled apart rather than hidden behind one menu.
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<AudiobookDashboard onNewAudiobook={vi.fn()} onOpenWorkspace={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("The Hollow Road")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Delete working files for The Hollow Road"));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Audiobook storage" })).toBeTruthy());
    // Opening the dialog must not have removed anything from recents.
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/recents/remove"))).toEqual([]);
  });
});
