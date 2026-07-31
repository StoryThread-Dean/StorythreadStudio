// SayEditor.test.tsx
// ===================
// The [say] popout's contract: the brackets are chrome (only the spoken
// form is typeable), Accept wraps the current occurrence and hops to
// the next, already-overridden occurrences are skipped, Preview sends
// the word's SENTENCE with the override applied, and an empty spoken
// form cannot be accepted.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { SayEditor } from "./SayEditor";

const CONTENT = "Lara smiled. Then Lara ran. [say:LAR-ah]Lara[/say] won.";
const WS = "C:\\Audiobooks\\Book";

function renderEditor(overrides: Partial<Parameters<typeof SayEditor>[0]> = {}) {
  const props = {
    content: CONTENT,
    start: CONTENT.indexOf("Lara"),
    end: CONTENT.indexOf("Lara") + "Lara".length,
    workspacePath: WS,
    voiceId: "af_heart",
    onApply: vi.fn(),
    onClose: vi.fn(),
    onLocate: vi.fn(),
    anchor: null,
    ...overrides,
  };
  render(<SayEditor {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SayEditor", () => {
  it("counts only occurrences that are not already overridden", () => {
    renderEditor();
    // Three Laras in the text; the [say]-wrapped one does not count.
    expect(screen.getByText("Next (1 of 2)")).toBeTruthy();
  });

  it("Accept wraps the word and hops to the next occurrence", () => {
    const props = renderEditor();
    const acceptButton = () => screen.getByText("Accept").closest("button")!;
    expect((acceptButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Spoken form"),
                     { target: { value: "LAR-ah" } });
    fireEvent.click(acceptButton());
    expect(props.onApply).toHaveBeenCalledOnce();
    const [next] = (props.onApply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain("[say:LAR-ah]Lara[/say] smiled.");
    expect(next).toContain("Then Lara ran.");        // later one untouched
  });

  it("Next skips without editing", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByText("Next (1 of 2)"));
    expect(props.onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Next \(2 of 2\)/)).toBeTruthy();
    expect(props.onLocate).toHaveBeenLastCalledWith(CONTENT.indexOf("Then Lara") + 5);
  });

  it("Preview sends the word in the fixed carrier phrase", async () => {
    const posted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(String(init?.body));
      return {
        ok: true,
        headers: { get: () => null },
        blob: async () => new Blob(["wav"]),
      };
    }));
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x") });
    const play = vi.fn();
    vi.stubGlobal("Audio", class { play = play; pause = vi.fn(); });

    renderEditor();
    fireEvent.change(screen.getByLabelText("Spoken form"),
                     { target: { value: "LOR-uh" } });
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => expect(posted.length).toBe(1));
    const body = JSON.parse(posted[0]);
    // A CONSTANT carrier with the word mid-sentence: bare single words
    // garble at their edges (engine worst case), and extracting the
    // writer's own sentence tripped over the "." in [pause:0.8].
    expect(body.text).toBe("You will hear [say:LOR-uh]Lara[/say] in the narration.");
    expect(body.voice_id).toBe("af_heart");
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
  });

  it("tips are an accordion: opening one section closes the other", () => {
    renderEditor();
    expect(screen.queryByText(/Spell out the sounds/)).toBeNull();
    fireEvent.click(screen.getByText(/Tips: ways writers use this/));

    // All section TITLES visible, no bodies yet. The essential five
    // lead, in the user's order, with the highlight color.
    const titles = screen.getAllByRole("button").map(b => b.textContent ?? "");
    const firstFive = titles.filter(t =>
      /Spell out the sounds|Sounding out the Vowels|inFlection|Space vs Hyphen|multiple Pronunciations/.test(t));
    expect(firstFive.length).toBe(5);
    expect(screen.getByText(/Case changes the inFlection/).className)
      .toContain("text-blue-300");
    expect(screen.getByText(/Characters to AVOID/).className)
      .not.toContain("text-blue-300");
    expect(screen.queryByText(/silent h after a vowel/)).toBeNull();

    // Open the vowel section -- its body appears.
    fireEvent.click(screen.getByText(/Sounding out the Vowels/));
    expect(screen.getByText(/silent h after a vowel/)).toBeTruthy();

    // Open another -- the first CLOSES (one at a time).
    fireEvent.click(screen.getByText(/Space vs Hyphen vs Apostrophe/));
    expect(screen.getByText(/softest internal break/)).toBeTruthy();
    expect(screen.queryByText(/silent h after a vowel/)).toBeNull();

    // Clicking the open section closes it.
    fireEvent.click(screen.getByText(/Space vs Hyphen vs Apostrophe/));
    expect(screen.queryByText(/softest internal break/)).toBeNull();
  });
});
