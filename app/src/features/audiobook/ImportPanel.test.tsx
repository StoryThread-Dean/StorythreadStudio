// ImportPanel.test.tsx
// =====================
// The Get Started flow's contract (spec 5.1.2): picking a book
// auto-chooses where the audiobook will live and explains why, the
// writer can always override (and then it stops moving under them),
// and Create posts the source + workspace + title.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// ImportPanel imports the dialog statically, so the mock must be
// hoisted with vi.hoisted -- a plain const would be read before init.
const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import { ImportPanel } from "./ImportPanel";

const BOOK = "C:\\Storythread\\the-hollow-road";
const SUGGESTED = `${BOOK}\\audiobook`;

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/suggest-workspace")) {
      return { ok: true, json: async () => ({
        workspace_path: SUGGESTED,
        source_kind: "storythread-project",
        reason: "Storythread books keep their audiobook beside the book itself.",
        collision: false,
      }) };
    }
    if (url.includes("/import")) {
      return { ok: true, json: async () => ({
        manifest: { workspace_path: SUGGESTED }, chapters: [], warnings: [],
      }) };
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ImportPanel (Get Started)", () => {
  it("picking a book auto-chooses the workspace and says why", async () => {
    vi.stubGlobal("fetch", mockFetch());
    openMock.mockResolvedValue(BOOK);
    render(<ImportPanel onBack={vi.fn()} onImported={vi.fn()} />);

    // Before a source there is nothing to suggest.
    expect(screen.getByText(/a home is picked automatically/)).toBeTruthy();

    fireEvent.click(screen.getByText("Import from a Storythread Project"));
    await waitFor(() => expect(screen.getByText(SUGGESTED)).toBeTruthy());
    expect(screen.getByText(/beside the book itself/)).toBeTruthy();
  });

  it("a folder the writer chooses wins and stops the re-suggesting", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    openMock.mockResolvedValue(BOOK);
    render(<ImportPanel onBack={vi.fn()} onImported={vi.fn()} />);
    fireEvent.click(screen.getByText("Import from a Storythread Project"));
    await waitFor(() => expect(screen.getByText(SUGGESTED)).toBeTruthy());

    openMock.mockResolvedValue("D:\\My Audio\\Custom");
    fireEvent.click(screen.getByText(/Choose a different folder/));
    await waitFor(() => expect(screen.getByText("D:\\My Audio\\Custom")).toBeTruthy());
    expect(screen.getByText("Your chosen folder.")).toBeTruthy();

    // Typing a title must NOT move the writer's folder.
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByPlaceholderText(/The Hollow Road/),
                     { target: { value: "A New Title" } });
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText("D:\\My Audio\\Custom")).toBeTruthy();
  });

  it("Create posts the source, the workspace, and the title", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    openMock.mockResolvedValue(BOOK);
    const onImported = vi.fn();
    render(<ImportPanel onBack={vi.fn()} onImported={onImported} />);
    fireEvent.click(screen.getByText("Import from a Storythread Project"));
    await waitFor(() => expect(screen.getByText(SUGGESTED)).toBeTruthy());

    fireEvent.click(screen.getByText("Create My Audiobook Workspace"));
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    const importCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/import"));
    const body = JSON.parse(String((importCall![1] as RequestInit).body));
    expect(body.source_path).toBe(BOOK);
    expect(body.workspace_path).toBe(SUGGESTED);
  });
});
