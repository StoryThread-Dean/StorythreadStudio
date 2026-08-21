// icons.test.tsx -- the app's own marks keep lucide's contract
// ==============================================================
// Every icon in this app is tinted by having a TEXT COLOUR applied to it
// (TONE_CLASSES hands out `text-weave`, `text-accent` and friends) and sized
// by a `size` prop. That only works because lucide's components render an
// svg with `stroke="currentColor"` and no fill.
//
// So a hand-drawn mark that hardcodes a stroke, or forgets `fill="none"`, or
// ignores `size`, does not fail -- it renders. It just renders the wrong
// colour, or a filled black blob, in whichever one of a hundred call sites
// happened to get it. These are cheap checks against an expensive kind of
// silent wrongness.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  NeedleThread, RunningStitch, Loom, SpoolMark, Thimble, WarpWeft, PinStitch,
  StitchRule,
} from "./index";

afterEach(cleanup);

const MARKS = { NeedleThread, RunningStitch, Loom, SpoolMark, Thimble, WarpWeft, PinStitch };

describe("every mark follows lucide's rendering contract", () => {
  for (const [name, Mark] of Object.entries(MARKS)) {
    it(`${name}: inherits colour, never paints its own`, () => {
      const { container } = render(<Mark />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("fill")).toBe("none");
      // A hardcoded colour anywhere inside would survive tinting and show up
      // as the one icon that ignored the theme.
      expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
    });

    it(`${name}: takes a size, and squares it`, () => {
      const { container } = render(<Mark size={13} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe("13");
      expect(svg.getAttribute("height")).toBe("13");
      // The 24x24 grid is what keeps stroke weights consistent between these
      // and the lucide icons sitting next to them in the same row.
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    });

    it(`${name}: accepts a className, which is how it gets tinted`, () => {
      const { container } = render(<Mark className="text-weave" />);
      expect(container.querySelector("svg")!.classList).toContain("text-weave");
    });

    it(`${name}: is hidden from screen readers`, () => {
      // Every one of these sits beside its own label. Announcing the icon as
      // well would read the same thing twice.
      const { container } = render(<Mark />);
      expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    });
  }
});

describe("the stitch rule", () => {
  it("stretches rather than scaling, so the stitches stay the same size", () => {
    // preserveAspectRatio="none" plus a non-scaling stroke: a divider in a
    // narrow panel and one across the window should look like the same
    // stitching, not the same drawing at two zoom levels.
    const { container } = render(<StitchRule />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.querySelector("path")!.getAttribute("vector-effect"))
      .toBe("non-scaling-stroke");
  });

  it("is dashed, which is the entire point of it", () => {
    const { container } = render(<StitchRule />);
    expect(container.querySelector("path")!.getAttribute("stroke-dasharray")).toBeTruthy();
  });
});

describe("the browser tab and the About panel show the same mark", () => {
  // TWO MARKS EXIST, ON PURPOSE, and it is worth saying which is which.
  //
  // The BRAND is app/public/storythreadstudio.png -- custom artwork, a wide
  // script lockup with the quill. It cannot be a 16px browser tab icon and it
  // cannot sit in a narrow panel, so it is not used for either.
  //
  // NeedleThread is the square mark for those two places. It is drawn twice
  // by necessity -- the favicon is a static file and cannot import a
  // component -- so the paths are compared here. Two copies of a drawing
  // drifting apart is the sort of thing nobody notices for a year.
  const SOURCE = Object.values(
    import.meta.glob("./index.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] as string;
  const FAVICON = Object.values(
    import.meta.glob("../../../public/storythread-mark.svg", {
      query: "?raw", import: "default", eager: true,
    }),
  )[0] as string;

  it("read both files", () => {
    expect(SOURCE.length).toBeGreaterThan(500);
    expect(FAVICON.length).toBeGreaterThan(100);
  });

  it("draws the same three paths as NeedleThread", () => {
    for (const d of ["M3 21 14.2 9.8", "M14.6 5.3C10 3 5.5 6.5 8 10.4"]) {
      expect(SOURCE, `NeedleThread should draw ${d}`).toContain(d);
      expect(FAVICON, `the favicon should draw ${d}`).toContain(d);
    }
    expect(FAVICON).toContain('cx="17"');
  });
});
