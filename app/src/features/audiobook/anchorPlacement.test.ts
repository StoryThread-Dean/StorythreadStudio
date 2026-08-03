// anchorPlacement.test.ts
// ========================
// Where a popout that points at a word is allowed to sit. The [say]
// editor GROWS after it opens -- tips accordion, occurrence counter,
// preview player -- so "clamp it into view" is not enough: flush with
// the bottom edge still leaves nowhere to expand.

import { describe, it, expect } from "vitest";

import { clampAnchor } from "./anchorPlacement";

const BOX = { height: 800, width: 1000, popoutWidth: 416 };

describe("clampAnchor", () => {
  it("leaves a word in the upper half exactly where it is", () => {
    expect(clampAnchor({ top: 120, left: 200 }, BOX))
      .toEqual({ top: 120, left: 200 });
  });

  it("never places the popout below halfway, however low the word is", () => {
    // The live bug: it appeared at the bottom of the screen and its
    // expanding sections had nowhere to go.
    expect(clampAnchor({ top: 780, left: 100 }, BOX).top).toBe(400);
    expect(clampAnchor({ top: 5000, left: 100 }, BOX).top).toBe(400);
  });

  it("keeps clear of the top edge", () => {
    expect(clampAnchor({ top: -50, left: 100 }, BOX).top).toBe(8);
  });

  it("keeps the whole popout on screen horizontally", () => {
    // 1000 wide, 416 popout, 8 margin -> 576 is as far right as it goes.
    expect(clampAnchor({ top: 100, left: 900 }, BOX).left).toBe(576);
    expect(clampAnchor({ top: 100, left: -20 }, BOX).left).toBe(8);
  });

  it("does not pin the popout to the ceiling in a short editor", () => {
    // Half of a tiny container is still a sane place to open.
    const tiny = { height: 40, width: 300, popoutWidth: 416 };
    const placed = clampAnchor({ top: 200, left: 200 }, tiny);
    expect(placed.top).toBe(20);
    expect(placed.left).toBe(8);     // narrower than the popout: hug left
  });
});
