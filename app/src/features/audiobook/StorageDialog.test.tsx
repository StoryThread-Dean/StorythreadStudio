// StorageDialog.test.tsx
// =======================
// The delete screen. Everything here exists because deletion is instant
// and permanent while regeneration costs time and money, so the tests are
// written from the writer's worst day: they clicked once and the audio is
// gone. What must hold is that nothing irreversible was ever pre-checked
// for them, the confirm restated exactly what would go, and cancelling
// left the disk untouched.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { StorageDialog } from "./StorageDialog";

const WS = "C:/books/hollow-road-audio";

function category(over: Partial<Record<string, unknown>> = {}) {
  return {
    key: "previews", label: "Preview files", description: "Rebuilt free.",
    consequence: "", default_selected: true, protected: false,
    files: 3, bytes: 5 * 1024 * 1024,
    ...over,
  };
}

const REPORT = {
  categories: [
    category(),
    category({ key: "failed_attempts", label: "Failed generation attempts",
               files: 1, bytes: 1024 * 1024 }),
    category({ key: "current_segments", label: "Current segment files",
               description: "What your exports are built from.",
               consequence: "You could no longer fix one paragraph without "
                          + "narrating the book again.",
               default_selected: false, files: 400,
               bytes: 2 * 1024 * 1024 * 1024 }),
    category({ key: "exports", label: "Final MP3 and M4B exports",
               description: "The finished audiobook files.",
               consequence: "This is the audiobook itself.",
               default_selected: false, protected: true,
               files: 12, bytes: 700 * 1024 * 1024 }),
    category({ key: "superseded", label: "Superseded audio revisions",
               default_selected: false, files: 0, bytes: 0 }),
  ],
  total_bytes: 2 * 1024 * 1024 * 1024 + 706 * 1024 * 1024,
  export_only: false,
  export_only_note: "Individual sections can no longer be regenerated or "
                  + "reassembled without generating the narration again.",
  has_exports: true,
  retention: "keep",
};

function mockFetch(over: { report?: Record<string, unknown>; cleanup?: Record<string, unknown> } = {}) {
  const report = { ...REPORT, ...over.report };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/storage/cleanup")) {
      return { ok: true, json: async () => ({
        deleted: {}, freed_bytes: 6 * 1024 * 1024, problems: [],
        storage: { ...report, categories: report.categories.map(c => ({ ...c, files: 0, bytes: 0 })) },
        ...over.cleanup,
      }) };
    }
    if (url.includes("/storage/retention") && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ ...report, retention: body.retention }) };
    }
    if (url.includes("/storage")) return { ok: true, json: async () => report };
    throw new Error(`unexpected fetch ${url} ${method}`);
  });
}

async function open(fetchMock: ReturnType<typeof mockFetch>, title = "The Hollow Road") {
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  render(<StorageDialog workspacePath={WS} title={title}
                        onClose={vi.fn()} onChanged={onChanged} />);
  await waitFor(() => expect(screen.getByText("Preview files")).toBeTruthy());
  return { onChanged };
}

function box(label: string): HTMLInputElement {
  const row = screen.getByText(label).closest("label");
  return row!.querySelector("input[type=checkbox]") as HTMLInputElement;
}

function cleanupBodies(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/storage/cleanup"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StorageDialog", () => {
  it("pre-checks only what can be rebuilt for free", async () => {
    // The single most important line in this file. Previews and failed
    // takes cost nothing to remake; the segment audio costs a full
    // re-narration and the exports cannot be remade at all.
    await open(mockFetch());
    expect(box("Preview files").checked).toBe(true);
    expect(box("Failed generation attempts").checked).toBe(true);
    expect(box("Current segment files").checked).toBe(false);
    expect(box("Final MP3 and M4B exports").checked).toBe(false);
  });

  it("never pre-checks a category that has nothing in it", async () => {
    await open(mockFetch());
    const empty = box("Superseded audio revisions");
    expect(empty.checked).toBe(false);
    expect(empty.disabled).toBe(true);
    expect(screen.getByText("nothing here")).toBeTruthy();
  });

  it("states what is lost on the row, before the click", async () => {
    // A consequence discovered afterwards is not a consequence, it is a
    // surprise.
    await open(mockFetch());
    expect(screen.getByText(/no longer fix one paragraph/)).toBeTruthy();
    expect(screen.getByText("This is the audiobook itself.")).toBeTruthy();
  });

  it("repeats the categories, the size, and the losses in the confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = mockFetch();
    await open(fetchMock);

    fireEvent.click(box("Current segment files"));
    fireEvent.click(screen.getByRole("button", { name: /Delete selected/ }));

    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain("current segment files");
    expect(message).toContain("The Hollow Road");
    expect(message).toContain("2.0 GB");
    expect(message).toContain("narrating the book again");
    // Declining deletes nothing at all.
    expect(cleanupBodies(fetchMock)).toEqual([]);
  });

  it("sends only the checked categories", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch();
    const { onChanged } = await open(fetchMock);

    // Drop one default, add nothing else.
    fireEvent.click(box("Failed generation attempts"));
    fireEvent.click(screen.getByRole("button", { name: /Delete selected/ }));

    await waitFor(() => expect(cleanupBodies(fetchMock).length).toBe(1));
    expect(cleanupBodies(fetchMock)[0].categories).toEqual(["previews"]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("cannot delete with nothing selected", async () => {
    await open(mockFetch());
    fireEvent.click(box("Preview files"));
    fireEvent.click(box("Failed generation attempts"));
    expect((screen.getByRole("button", { name: /Delete selected/ }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText("Nothing selected.")).toBeTruthy();
  });

  it("surfaces files that would not delete instead of claiming success", async () => {
    // Locked by a media player is the common case, and the writer can
    // fix it -- but only if they are told.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch({
      cleanup: { problems: ["seg-4f2a.wav: being used by another process"] },
    });
    await open(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: /Delete selected/ }));
    await waitFor(() =>
      expect(screen.getByText(/1 file\(s\) would not delete/)).toBeTruthy());
  });

  it("shows the export-only warning when the audio is gone", async () => {
    await open(mockFetch({ report: { export_only: true } }));
    expect(screen.getByText("Export only")).toBeTruthy();
    expect(screen.getByText(/can no longer be regenerated/)).toBeTruthy();
  });

  it("saves the retention choice as soon as it changes", async () => {
    // One radio, no Save button: this is a preference, not a form, and
    // an unsaved preference is how a writer loses the setting they came
    // here to change.
    const fetchMock = mockFetch();
    await open(fetchMock);

    fireEvent.click(screen.getByRole("radio", { name: /Delete after a successful export/ }));
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes("/storage/retention")
          && (init as RequestInit | undefined)?.method === "PUT");
      expect(puts.length).toBe(1);
      expect(JSON.parse(String((puts[0][1] as RequestInit).body)).retention)
        .toBe("delete_after_export");
    });
  });
});
