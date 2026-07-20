// ActGroup.test.tsx
// ==================
// Component tests for the acts tree building blocks: ActGroup (collapsible
// act header with inline rename) and RowMenu (the hover '...' menu with a
// nested "Move to Act" flyout). The tree-assembly logic itself lives in
// App.tsx; these tests pin the pieces' contracts -- callbacks fire with the
// right payloads, collapse hides children, disabled items don't fire.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActGroup } from "./ActGroup";
import { RowMenu } from "./RowMenu";

afterEach(cleanup);

function renderAct(overrides: Partial<Parameters<typeof ActGroup>[0]> = {}) {
  const props = {
    title: "Act I",
    chapterCount: 2,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onRename: vi.fn(),
    menuItems: [
      { label: "Move up", onClick: vi.fn() },
      { label: "Delete act", danger: true, onClick: vi.fn() },
    ],
    children: <p>chapter rows here</p>,
    ...overrides,
  };
  render(<ActGroup {...props} />);
  return props;
}

describe("ActGroup", () => {
  it("shows the title, count, and children when expanded", () => {
    renderAct();
    expect(screen.getByText("Act I")).toBeTruthy();
    expect(screen.getByText("2 chapters")).toBeTruthy();
    expect(screen.getByText("chapter rows here")).toBeTruthy();
  });

  it("hides children when collapsed", () => {
    renderAct({ collapsed: true });
    expect(screen.queryByText("chapter rows here")).toBeNull();
  });

  it("clicking the title toggles collapse", async () => {
    const user = userEvent.setup();
    const props = renderAct();
    await user.click(screen.getByText("Act I"));
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("double-click renames: Enter commits the new title", async () => {
    const user = userEvent.setup();
    const props = renderAct();
    await user.dblClick(screen.getByText("Act I"));
    const input = screen.getByTitle(/Rename act/);
    await user.clear(input);
    await user.type(input, "Act One: Setup{Enter}");
    expect(props.onRename).toHaveBeenCalledWith("Act One: Setup");
  });

  it("shows the empty-act hint when there are no chapters", () => {
    renderAct({ chapterCount: 0, children: null });
    expect(screen.getByText(/No chapters yet/)).toBeTruthy();
  });
});

describe("RowMenu", () => {
  it("opens on click and fires a leaf action", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<RowMenu ariaLabel="Chapter actions" items={[
      { label: "Move up", onClick: onMove },
    ]} />);

    await user.click(screen.getByLabelText("Chapter actions"));
    await user.click(screen.getByText("Move up"));
    expect(onMove).toHaveBeenCalledTimes(1);
    // Menu closes after picking an item.
    expect(screen.queryByText("Move up")).toBeNull();
  });

  it("disabled items do not fire", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<RowMenu ariaLabel="Chapter actions" items={[
      { label: "Move up", disabled: true, onClick: onMove },
    ]} />);

    await user.click(screen.getByLabelText("Chapter actions"));
    await user.click(screen.getByText("Move up"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("submenu opens a flyout and fires the nested action", async () => {
    const user = userEvent.setup();
    const toActII = vi.fn();
    render(<RowMenu ariaLabel="Chapter actions" items={[
      {
        label: "Move to Act",
        submenu: [
          { label: "Act II", onClick: toActII },
          { label: "Act III", onClick: vi.fn() },
        ],
      },
    ]} />);

    await user.click(screen.getByLabelText("Chapter actions"));
    // Flyout not shown until the parent item is picked.
    expect(screen.queryByText("Act II")).toBeNull();
    await user.click(screen.getByText("Move to Act"));
    await user.click(screen.getByText("Act II"));
    expect(toActII).toHaveBeenCalledTimes(1);
  });

  it("empty submenu shows the no-other-acts hint", async () => {
    const user = userEvent.setup();
    render(<RowMenu ariaLabel="Chapter actions" items={[
      { label: "Move to Act", submenu: [] },
    ]} />);

    await user.click(screen.getByLabelText("Chapter actions"));
    await user.click(screen.getByText("Move to Act"));
    expect(screen.getByText("No other acts yet")).toBeTruthy();
  });
});
