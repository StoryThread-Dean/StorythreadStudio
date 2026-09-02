// ToggleSwitch.test.tsx
// ======================
// A switch, not a checkbox -- and its LOOK carries the state, which is the
// point (a glance at the rail should answer "am I drafting or doing this
// properly?"). Both halves of that contract are pinned here.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { ToggleSwitch } from "./ToggleSwitch";

afterEach(cleanup);

describe("ToggleSwitch", () => {
  it("is a real switch with its state on the element", () => {
    render(<ToggleSwitch checked={false} onChange={vi.fn()} label="Draft/Testing pass" />);
    const toggle = screen.getByRole("switch", { name: "Draft/Testing pass" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("reports the flipped value", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} label="Mode" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is faded when off and bright when on", () => {
    const { rerender } = render(
      <ToggleSwitch checked={false} onChange={vi.fn()} label="Mode" tone="amber" />);
    const off = screen.getByRole("switch");
    expect(off.className).toContain("opacity-60");
    expect(screen.getByText("Mode").className).toContain("text-text-muted");

    rerender(<ToggleSwitch checked onChange={vi.fn()} label="Mode" tone="amber" />);
    const on = screen.getByRole("switch");
    expect(on.className).toContain("opacity-100");
    expect(screen.getByText("Mode").className).toContain("text-warn-strong");
  });

  it("shows a hint and can be disabled", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked onChange={onChange} label="Mode"
                         hint="What this does" disabled />);
    expect(screen.getByText("What this does")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
