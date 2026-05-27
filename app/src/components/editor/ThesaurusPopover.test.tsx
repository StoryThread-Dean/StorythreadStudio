// ThesaurusPopover.test.tsx -- Unified spellcheck + thesaurus popover
// ====================================================================
// Verifies the popover leads with a "Spellcheck" section for a misspelled
// word (corrections on top), then shows the Thesaurus section, and that
// clicking a correction replaces the word with case preserved.
//
// The spellcheck module is mocked so the test doesn't load the 540 KB
// dictionary and stays deterministic. Datamuse calls are mocked via fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ThesaurusPopover } from "./ThesaurusPopover";

// Mock the dictionary-backed spell checker. Each test sets the return values.
vi.mock("../../utils/spellcheck", () => ({
  isMisspelled:       vi.fn(),
  suggestCorrections: vi.fn(),
}));
import { isMisspelled, suggestCorrections } from "../../utils/spellcheck";

// Helper: make fetch return Datamuse-shaped arrays. Datamuse is called twice
// (rel_syn, then ml); we resolve both with the provided payloads.
function mockDatamuse(synonyms: string[], related: string[]) {
  const toData = (words: string[]) => words.map((word, i) => ({ word, score: 100 - i }));
  // globalThis (not Node's `global`) so this also type-checks under the
  // production build's tsc, which compiles test files too.
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce({ json: async () => toData(synonyms) })
    .mockResolvedValueOnce({ json: async () => toData(related) }) as unknown as typeof fetch;
}

const baseProps = {
  word: "permanantly",
  from: 0,
  to:   11,
  x:    100,
  y:    100,
  onReplace: vi.fn(),
  onClose:   vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // With globals:false, RTL's automatic between-test cleanup isn't registered,
  // so we unmount explicitly to avoid renders piling up across tests.
  cleanup();
  vi.restoreAllMocks();
});

describe("ThesaurusPopover spellcheck section", () => {
  it("shows a Spellcheck section with corrections for a misspelled word", async () => {
    vi.mocked(isMisspelled).mockReturnValue(true);
    vi.mocked(suggestCorrections).mockReturnValue(["permanently", "permanent"]);
    mockDatamuse([], []);

    render(<ThesaurusPopover {...baseProps} />);

    // Spellcheck label and a correction button are present
    expect(screen.getByText("Spellcheck")).toBeTruthy();
    expect(screen.getByRole("button", { name: "permanently" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "permanent" })).toBeTruthy();
  });

  it("orders Spellcheck above Thesaurus in the DOM", async () => {
    vi.mocked(isMisspelled).mockReturnValue(true);
    vi.mocked(suggestCorrections).mockReturnValue(["permanently"]);
    mockDatamuse([], []);

    const { container } = render(<ThesaurusPopover {...baseProps} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Spellcheck")).toBeLessThan(text.indexOf("Thesaurus"));
  });

  it("clicking a correction replaces the word with case preserved", async () => {
    vi.mocked(isMisspelled).mockReturnValue(true);
    vi.mocked(suggestCorrections).mockReturnValue(["permanently"]);
    mockDatamuse([], []);

    render(<ThesaurusPopover {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "permanently" }));

    expect(baseProps.onReplace).toHaveBeenCalledWith("permanently", 0, 11);
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("preserves Title Case when correcting a capitalized word", async () => {
    vi.mocked(isMisspelled).mockReturnValue(true);
    vi.mocked(suggestCorrections).mockReturnValue(["permanently"]);
    mockDatamuse([], []);

    const onReplace = vi.fn();
    render(<ThesaurusPopover {...baseProps} word="Permanantly" onReplace={onReplace} />);
    fireEvent.click(screen.getByRole("button", { name: "permanently" }));

    // matchCase should up-case the first letter to mirror the original
    expect(onReplace).toHaveBeenCalledWith("Permanently", 0, 11);
  });

  it("hides the Spellcheck section for a correctly spelled word", async () => {
    vi.mocked(isMisspelled).mockReturnValue(false);
    vi.mocked(suggestCorrections).mockReturnValue([]);
    mockDatamuse(["lasting", "enduring"], []);

    render(<ThesaurusPopover {...baseProps} word="permanent" />);

    expect(screen.queryByText("Spellcheck")).toBeNull();
    // Thesaurus still renders
    expect(screen.getByText("Thesaurus")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "lasting" })).toBeTruthy(),
    );
  });

  it("shows 'No synonyms found' under Thesaurus while still offering corrections", async () => {
    vi.mocked(isMisspelled).mockReturnValue(true);
    vi.mocked(suggestCorrections).mockReturnValue(["permanently"]);
    mockDatamuse([], []);

    render(<ThesaurusPopover {...baseProps} />);

    expect(screen.getByRole("button", { name: "permanently" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/No synonyms found/)).toBeTruthy(),
    );
  });
});
