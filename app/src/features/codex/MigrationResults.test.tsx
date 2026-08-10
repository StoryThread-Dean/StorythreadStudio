// features/codex/MigrationResults.test.tsx
// ========================================
// From live testing, after a conversion that worked: "apparently worked but I
// have zero context of what happened and where the information went to."
//
// The tests here are about that sentence. Not whether the conversion is
// correct -- test_codex_migration*.py owns that -- but whether a writer can
// SEE what it did to their own words, in their own words, without being asked
// to take it on faith.

import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MigrationResults } from "./MigrationResults";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "C:/MyNovel";

const REPORT = {
  status: "migrated",
  converted: 5,
  arcs_absorbed: 0,
  backup_path: "C:/MyNovel/profiles.backup-2026-08-10",
  entries: [
    { type: "character", name: "Elara Voss", entity_id: "e-1",
      filename: "elara.md", source: "profiles/characters/elara.md",
      converted_to: "codex/characters/elara.md" },
    { type: "character", name: "Alexandra", entity_id: "e-2",
      filename: "alexandra.md", source: "profiles/characters/alexandra.md",
      converted_to: "codex/characters/alexandra.md" },
    { type: "location", name: "Ravensmoor", entity_id: "e-3",
      filename: "ravensmoor.md", source: "profiles/locations/ravensmoor.md",
      converted_to: "codex/locations/ravensmoor.md" },
  ],
  warnings: ["characters/mira.md was given a new id."],
  unconvertible: [{ folder: "sketches", reason: "Not a profile type." }],
};

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    name: "Elara Voss",
    type: "character",
    filename: "elara.md",
    original_path: "C:/MyNovel/profiles.backup-2026-08-10/characters/elara.md",
    converted_path: "C:/MyNovel/codex/characters/elara.md",
    fields: [
      { field: "Name", original: "Elara Voss", converted: "Elara Voss",
        changed: false },
      { field: "Also known as", original: "Elara", converted: "Elara",
        changed: false },
    ],
    sections: [
      { id: "overview", heading: "Overview",
        original: "A tall woman with a borrowed sword.",
        converted: "A tall woman with a borrowed sword.", changed: false,
        missing: false },
      { id: "physical_traits", heading: "Physical Traits",
        original: "The mark: Under the collarbone.  [hidden]",
        converted: "The mark: Under the collarbone.  [hidden]  [AI: on-request]",
        changed: true, missing: false },
    ],
    original_raw: "---\nprofile_id: p-elara\n---\n\n# Overview\nA tall woman.",
    converted_raw: "---\ntype: character\n---\n\n# Overview\nA tall woman.",
    ...overrides,
  };
}

function mockApi(diff: Record<string, unknown> = comparison(), fail = false) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (fail) {
      return {
        ok: false,
        json: async () => ({ detail: { code: "source_corrupt",
                                       message: "One side could not be read." } }),
      } as Response;
    }
    return { ok: true, json: async () => diff } as Response;
  }));
}

beforeEach(() => mockApi());

function open(report = REPORT) {
  render(<MigrationResults projectPath={PROJECT} report={report as never} />);
}

async function openEntry(name: string, report = REPORT) {
  open(report);
  await userEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  await waitFor(() => expect(screen.getByTestId("migration-detail")).toBeTruthy());
}


describe("where did my things go", () => {
  it("lists every converted entry rather than counting them", async () => {
    open();
    expect(screen.getByRole("button", { name: /Elara Voss/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Alexandra/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ravensmoor/ })).toBeTruthy();
  });

  it("groups them by kind, the way a writer thinks about their world", async () => {
    open();
    expect(screen.getByText("Characters")).toBeTruthy();
    expect(screen.getByText("Locations")).toBeTruthy();
  });

  it("uses the same icons and words as the rest of the Weave", async () => {
    // A results screen with its own vocabulary teaches the writer a second
    // one for no reason.
    open();
    expect(screen.getByText("Characters")).toBeTruthy();
    expect(screen.queryByText("character")).toBeNull();
  });

  it("sorts within a kind so the list does not shuffle", async () => {
    open();
    const labels = screen.getAllByRole("button").map(b => b.textContent ?? "");
    expect(labels.findIndex(l => l.includes("Alexandra")))
      .toBeLessThan(labels.findIndex(l => l.includes("Elara")));
  });

  it("says where the originals were copied to", async () => {
    open();
    expect(screen.getByText(/profiles.backup-2026-08-10/)).toBeTruthy();
    expect(screen.getByText(/folder is/)).toBeTruthy();
  });

  it("still reports warnings and what it could not convert", async () => {
    open();
    expect(screen.getByText(/was given a new id/)).toBeTruthy();
    expect(screen.getByText(/Not a profile type/)).toBeTruthy();
  });

  it("says the entries can be opened", async () => {
    // A clickable list nobody realises is clickable is a list.
    open();
    expect(screen.getByText(/before and after, field by field/)).toBeTruthy();
  });
});


describe("is it still mine", () => {
  it("shows the original and the converted side by side", async () => {
    await openEntry("Elara Voss");
    const table = screen.getByRole("table");
    expect(within(table).getByText("What you wrote")).toBeTruthy();
    expect(within(table).getByText("In the Weave")).toBeTruthy();
  });

  it("says plainly when nothing was changed", async () => {
    // The expected answer, and the reassuring one. Leaving it to be inferred
    // from a wall of identical rows is not the same as saying it.
    mockApi(comparison({
      sections: [{ id: "overview", heading: "Overview", original: "Same.",
                   converted: "Same.", changed: false, missing: false }],
    }));
    await openEntry("Elara Voss");
    expect(screen.getByText(/came across word for word/)).toBeTruthy();
  });

  it("counts what differs when something does", async () => {
    await openEntry("Elara Voss");
    expect(screen.getByText(/1 field differs/)).toBeTruthy();
  });

  it("marks the row that changed rather than making the writer hunt", async () => {
    await openEntry("Elara Voss");
    expect(screen.getByText("changed")).toBeTruthy();
    expect(screen.getByText(/AI: on-request/)).toBeTruthy();
  });

  it("calls a field that did not come across MISSING, not merely changed", async () => {
    // The two mean different things to a writer: one is "this was edited",
    // the other is "this did not survive".
    mockApi(comparison({
      sections: [{ id: "overview", heading: "Overview", original: "Words.",
                   converted: "", changed: true, missing: true }],
    }));
    await openEntry("Elara Voss");
    expect(screen.getByText("missing")).toBeTruthy();
    expect(screen.getByText(/did not come across/)).toBeTruthy();
    expect(screen.getByText(/still in the backup, untouched/)).toBeTruthy();
  });

  it("names both files, so the writer can go and look", async () => {
    await openEntry("Elara Voss");
    expect(screen.getByText(/profiles.backup-2026-08-10\/characters\/elara.md/))
      .toBeTruthy();
    expect(screen.getByText(/codex\/characters\/elara.md/)).toBeTruthy();
  });

  it("offers the files themselves, because a table is an interpretation", async () => {
    await openEntry("Elara Voss");
    await userEvent.click(
      screen.getByRole("button", { name: /Show me the files themselves/ }));
    expect(screen.getByText(/profile_id: p-elara/)).toBeTruthy();
  });

  it("hides the raw files again", async () => {
    await openEntry("Elara Voss");
    await userEvent.click(
      screen.getByRole("button", { name: /Show me the files themselves/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Hide the files themselves/ }));
    expect(screen.queryByText(/profile_id: p-elara/)).toBeNull();
  });

  it("goes back to the list", async () => {
    await openEntry("Elara Voss");
    await userEvent.click(screen.getByRole("button", { name: /Back to everything/ }));
    expect(screen.getByTestId("migration-results")).toBeTruthy();
  });

  it("says a comparison failed rather than showing half of one", async () => {
    mockApi(comparison(), true);
    open();
    await userEvent.click(screen.getByRole("button", { name: /Elara Voss/ }));
    await waitFor(() =>
      expect(screen.getByText(/One side could not be read/)).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("asks the backend for the entry it was told about", async () => {
    await openEntry("Ravensmoor");
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("type=location");
    expect(url).toContain("filename=ravensmoor.md");
  });
});
