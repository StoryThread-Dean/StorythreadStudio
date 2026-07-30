// InsertWalkthrough.test.tsx
// ===========================
// The walkthrough panel's contract: stops walk in order from the start
// offset, Apply commits the proposal through onApplyEdit (buffer edit,
// never a save), Skip advances without touching text, per-kind muting
// filters the walk, marker repairs replace in place, and Ctrl+Enter is
// the keyboard fast path.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { InsertWalkthrough } from "./InsertWalkthrough";

const TEXT = 'She made a decision. "A cult." Lexa nodded. [pace:=2]Fast bit.[/pace]';

function renderPanel(overrides: Partial<Parameters<typeof InsertWalkthrough>[0]> = {}) {
  const props = {
    content: TEXT,
    startOffset: 0,
    onApplyEdit: vi.fn(),
    onHighlight: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<InsertWalkthrough {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InsertWalkthrough", () => {
  it("walks stops in order and highlights the current one", () => {
    const props = renderPanel();
    expect(screen.getByText(/stop 1 of/)).toBeTruthy();
    // First stop: the narration-to-dialogue hand-off after "decision."
    expect(screen.getByText("Narration hands off to dialogue")).toBeTruthy();
    expect(props.onHighlight).toHaveBeenCalledWith(
      TEXT.indexOf(".") + 1, 0);
  });

  it("Apply commits the default proposal as a buffer edit", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Pause 0\.4s/ }).closest("button")!);
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain('She made a decision. [pause:0.4] "A cult."');
    // Progress reflects the applied count.
    expect(screen.getByText(/1 applied/)).toBeTruthy();
  });

  it("Skip advances without editing", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(props.onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/stop 2 of/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/stop 1 of/)).toBeTruthy();
  });

  it("muting a trigger kind removes its stops from the walk", () => {
    renderPanel();
    const total = screen.getByText(/stop 1 of (\d+)/).textContent!;
    fireEvent.click(screen.getByRole("checkbox", { name: /Before dialogue/ }));
    expect(screen.queryByText("Narration hands off to dialogue")).toBeNull();
    expect(screen.getByText(/stop 1 of (\d+)/).textContent).not.toBe(total);
  });

  it("marker repairs replace the broken marker in place", () => {
    const props = renderPanel();
    // Walk to the broken [pace:=2] stop.
    while (!screen.queryByText(/Unreadable pace value/)) {
      fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Fix to \[pace:\+2\]/ }));
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain("[pace:+2]Fast bit.[/pace]");
    expect(next).not.toContain("[pace:=2]");
  });

  it("Ctrl+Enter applies the default from anywhere", () => {
    const props = renderPanel();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
  });

  it("Escape closes the walkthrough", () => {
    const props = renderPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("Auto-apply requires a confirm, applies beats, leaves repairs manual", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Auto-apply \d+ beats/ }));
    // The warning strip appears; nothing applied yet.
    expect(screen.getByText(/unintended audio effects/i)).toBeTruthy();
    expect(props.onApplyEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Yes, apply all/ }));
    expect(props.onApplyEdit).toHaveBeenCalledOnce();
    const [next] = (props.onApplyEdit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(next).toContain('She made a decision. [pause:0.4] "A cult."');
    expect(next).toContain("[pace:=2]");           // repair NOT auto-fixed
    // The walk continues with the repair as the remaining stop.
    expect(screen.getByText(/Unreadable pace value/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Auto-apply/ })).toBeNull();
  });

  it("Keep walking cancels the auto-apply confirm", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Auto-apply \d+ beats/ }));
    fireEvent.click(screen.getByRole("button", { name: /Keep walking through instead/ }));
    expect(props.onApplyEdit).not.toHaveBeenCalled();
    expect(screen.queryByText(/unintended audio effects/i)).toBeNull();
  });

  it("says so plainly when there is nothing to suggest", () => {
    renderPanel({ content: "# Heading\n\nOne long ordinary paragraph of prose without any dialogue at all in it." });
    expect(screen.getByText(/nothing to suggest/)).toBeTruthy();
  });
});
