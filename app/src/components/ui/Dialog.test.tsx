// Dialog.test.tsx -- the one way out, and the promise it keeps
// =============================================================
// Thirty-nine hand-rolled overlays disagreed about whether the backdrop
// closed, whether Escape closed, and whether either asked first. Seven wired
// the backdrop straight to onClose and five of those held typed text, which
// is how a writer lost work by clicking slightly outside a box (R11.5).
//
// So this component has to hold three things, and all three are testable:
// every exit goes through the same guard; the guard only asks when there is
// something to lose; and adopting it does not change what a dialog already
// did.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

let confirmSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

function open(props: Partial<React.ComponentProps<typeof Dialog>> = {}) {
  const onClose = vi.fn();
  render(
    <Dialog label="Test dialog" testId="d" title="Test" onClose={onClose} {...props}>
      <p>body</p>
    </Dialog>,
  );
  return onClose;
}

describe("a clean dialog closes without ceremony", () => {
  it("closes on the X with no confirm", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("closes on the backdrop with no confirm", async () => {
    const user = userEvent.setup();
    const onClose = open();
    // The overlay is the dialog's immediate parent.
    await user.click(screen.getByTestId("d").parentElement!);
    expect(onClose).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("closes on Escape with no confirm", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("does not close when a click starts inside it", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.click(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a dirty dialog asks first, on every exit", () => {
  it("asks on the X", async () => {
    const user = userEvent.setup();
    open({ dirty: true, confirmMessage: "Lose your connection reason?" });
    await user.click(screen.getByLabelText("Close"));
    expect(confirmSpy).toHaveBeenCalledWith("Lose your connection reason?");
  });

  it("asks on the backdrop -- the exit that used to skip the guard", async () => {
    const user = userEvent.setup();
    open({ dirty: true });
    await user.click(screen.getByTestId("d").parentElement!);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("asks on Escape", async () => {
    const user = userEvent.setup();
    open({ dirty: true });
    await user.keyboard("{Escape}");
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("stays open when the writer says no", async () => {
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    const onClose = open({ dirty: true });
    await user.click(screen.getByLabelText("Close"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the shape other tests depend on", () => {
  it("keeps the overlay as the dialog's immediate parent", () => {
    // WeavingPanel.test.tsx reads dialog.parentElement and expects `fixed`.
    // A portal or an extra wrapper here would break a test in a file nobody
    // would think to look at while refactoring this one.
    open();
    expect(screen.getByTestId("d").parentElement?.className).toContain("fixed");
  });

  it("can turn Escape off for a nested dialog", async () => {
    const user = userEvent.setup();
    const onClose = open({ escapes: false });
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    // The other exits still work.
    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("defaults to clean, so adopting it changes no behaviour", async () => {
    // 28 of the 35 overlays never guarded their close. Converting one of
    // those must be a styling change and nothing else.
    const user = userEvent.setup();
    open();
    await user.keyboard("{Escape}");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
