// BookDetailsPanel.test.tsx
// ==========================
// The metadata form's contract: loads on mount, edits mark it dirty
// (manual save -- nothing persists until Save Details), the PUT carries
// every field, and the cover flow (pick -> validate -> preview,
// non-square hint, remove).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const openMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import { BookDetailsPanel } from "./BookDetailsPanel";

const WS = "C:\\Audiobooks\\The Hollow Road";

const META = {
  title: "The Hollow Road", subtitle: "", author: "Dean", narrator: "",
  series: "", series_number: "", description: "", genre: "",
  publication_year: "", publisher: "", copyright: "", language: "en-US",
  use_chapter_names: true, embed_cover: true, apply_to_chapter_mp3s: true,
  cover_file: null as string | null,
};

function mockFetch(overrides: Partial<typeof META> = {}) {
  const meta = { ...META, ...overrides };
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/metadata/cover-image")) {
      return { ok: true, blob: async () => new Blob() };
    }
    if (url.includes("/metadata/cover") && init?.method === "POST") {
      return { ok: true, json: async () => ({
        cover_file: "cover.png", width: 1600, height: 900, square: false,
      }) };
    }
    if (url.includes("/metadata/cover") && init?.method === "DELETE") {
      return { ok: true, json: async () => ({ cover_file: null }) };
    }
    if (url.includes("/metadata") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ ...meta, ...body }) };
    }
    if (url.includes("/metadata")) {
      return { ok: true, json: async () => meta };
    }
    throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderOpen(fetchMock: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchMock);
  render(<BookDetailsPanel workspacePath={WS} />);
  fireEvent.click(screen.getByText("Book Details"));
  await waitFor(() =>
    expect((screen.getByLabelText("Title") as HTMLInputElement).value)
      .toBe("The Hollow Road"));
}

describe("BookDetailsPanel", () => {
  it("loads metadata, saves edits with every field in the PUT", async () => {
    const fetchMock = mockFetch();
    await renderOpen(fetchMock);

    const publisher = screen.getByLabelText("Publisher") as HTMLInputElement;
    fireEvent.change(publisher, { target: { value: "Storythread" } });
    expect(screen.getByTitle("Edited but not saved")).toBeTruthy();

    fireEvent.click(screen.getByText("Save Details"));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) =>
        init && (init as RequestInit).method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put![1] as RequestInit).body));
      expect(body.workspace_path).toBe(WS);
      expect(body.publisher).toBe("Storythread");
      expect(body.title).toBe("The Hollow Road");
      expect(body.use_chapter_names).toBe(true);
      // cover_file is managed by the cover endpoints, never the PUT.
      expect("cover_file" in body).toBe(false);
    });
    await waitFor(() =>
      expect(screen.queryByTitle("Edited but not saved")).toBeNull());
  });

  it("cover pick uploads the chosen file and shows the square hint", async () => {
    const fetchMock = mockFetch();
    openMock.mockResolvedValue("C:\\art\\cover-wide.png");
    await renderOpen(fetchMock);

    fireEvent.click(screen.getByText("Choose Cover"));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/metadata/cover") &&
        init && (init as RequestInit).method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.source_path).toBe("C:\\art\\cover-wide.png");
    });
    // 1600x900 -> the non-square warning appears; preview renders.
    await waitFor(() => expect(screen.getByText(/SQUARE/)).toBeTruthy());
    expect(screen.getByAltText("Cover preview")).toBeTruthy();
    expect(screen.getByText("Replace Cover")).toBeTruthy();
  });

  it("Use current voice fills the narrator field from the picked voice", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<BookDetailsPanel workspacePath={WS} currentVoiceLabel="Michael (American male)" />);
    fireEvent.click(screen.getByText("Book Details"));
    await waitFor(() =>
      expect((screen.getByLabelText("Title") as HTMLInputElement).value)
        .toBe("The Hollow Road"));

    fireEvent.click(screen.getByText("Use current voice"));
    // The tag wants the name, not the parenthetical accent/gender note.
    expect((screen.getByLabelText(/Narrator/) as HTMLInputElement).value).toBe("Michael");
    expect(screen.getByTitle("Edited but not saved")).toBeTruthy();
  });

  it("remove clears the stored cover", async () => {
    const fetchMock = mockFetch({ cover_file: "cover.jpg" });
    await renderOpen(fetchMock);
    expect(screen.getByAltText("Cover preview")).toBeTruthy();

    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) =>
        init && (init as RequestInit).method === "DELETE");
      expect(del).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByAltText("Cover preview")).toBeNull());
    expect(screen.getByText("Choose Cover")).toBeTruthy();
  });
});
