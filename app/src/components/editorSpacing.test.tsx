// editorSpacing.test.tsx -- the spacing the writer set is the spacing on screen
// =============================================================================
// Two separate promises, both of which have already been broken once, and
// neither of which any source-reading test can keep.
//
//   1. LINE HEIGHT reaches the text. CodeMirror's baseTheme declares
//      `.cm-scroller { line-height: 1.4 }`, and .cm-scroller sits between
//      .cm-editor and the prose -- so a line-height on the root selector is
//      blocked before it arrives. The editor shipped that way and rendered at
//      1.4 for its whole life while the source read 1.8.
//
//   2. PARAGRAPHS are separated. Line height spaces every line equally, so in
//      a manuscript that ends paragraphs with a single newline -- which is how
//      real ones are written -- it cannot put a gap between paragraphs. That
//      was reported as the spacing control being broken a second time: "the
//      spaces in the main editor are literally next to each other after a full
//      paragraph."
//
// These assert against the CSS CodeMirror actually INJECTS when the editor is
// mounted, which is the only place the answer really lives. jsdom does no
// layout, so measuring rendered geometry is not available -- but the emitted
// rule is, and the rule is what was wrong both times.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  resolveLineHeight, PARAGRAPH_BEFORE_DEFAULT, PARAGRAPH_AFTER_DEFAULT,
} from "../hooks/useEditorSpacing";

afterEach(cleanup);

/** Every CSS rule CodeMirror has injected into the document. */
function injectedRules(): string[] {
  return Array.from(document.querySelectorAll("style"))
    .map(s => s.textContent ?? "")
    .join("\n")
    .split(/[\n}]/)
    .map(r => r.trim())
    .filter(Boolean);
}

/** The rule this editor emitted for a selector, if any. */
function ruleFor(selector: string): string | undefined {
  // The editor's own theme class is generated, so match on the selector tail
  // and take the rule that carries our font -- that is unambiguously ours.
  return injectedRules().find(
    r => r.includes(selector + " {") && r.includes("Georgia"),
  );
}

function mount() {
  render(
    <MarkdownEditor
      defaultValue={"First paragraph.\nSecond paragraph.\n"}
      onChange={() => {}}
      font={"Georgia, serif" as never}
      onEditorReady={() => {}}
    />,
  );
}

describe("line height reaches the prose", () => {
  it("declares it on .cm-content, past CodeMirror's .cm-scroller", () => {
    mount();
    const rule = ruleFor(".cm-content");
    expect(rule, "the editor emitted no .cm-content rule").toBeTruthy();
    // The shipped default is 1.5 lines.
    expect(rule).toContain(`line-height: ${resolveLineHeight("one_half", 1)}`);
  });

  it("does not leave a line-height on the root, where it would be dead", () => {
    mount();
    const root = injectedRules().find(
      r => /^\.\S+ \{/.test(r) && r.includes("font-size: 16px"),
    );
    expect(root, "no root rule found").toBeTruthy();
    expect(root, "a line-height here is overridden by .cm-scroller").not.toContain("line-height");
  });
});

describe("paragraphs are separated from each other", () => {
  it("pads each .cm-line, which with wrapping is one paragraph", () => {
    mount();
    const rule = ruleFor(".cm-line");
    expect(rule, "the editor emitted no .cm-line rule").toBeTruthy();
    expect(rule).toMatch(/padding: [\d.]+pt 2px [\d.]+pt 6px/);
  });

  it("writes the full padding shorthand, not just padding-bottom", () => {
    // CodeMirror's baseTheme sets `padding: 0 2px 0 6px` on .cm-line. A lone
    // padding-bottom only wins while this rule is injected later, which is an
    // ordering assumption nothing enforces.
    mount();
    const rule = ruleFor(".cm-line")!;
    expect(rule).not.toMatch(/padding-bottom/);
  });

  it("uses the writer's own Before and After, in points", () => {
    // A derived half-line was tried first and overshot -- "its doing a bit
    // more than I hadn't anticipated". The gap is a decision now, not
    // arithmetic off the line height, and it ships at Word's 0 / 8.
    mount();
    const rule = ruleFor(".cm-line")!;
    const m = rule.match(/padding: ([\d.]+)pt 2px ([\d.]+)pt 6px/)!;
    expect(Number(m[1])).toBe(PARAGRAPH_BEFORE_DEFAULT);
    expect(Number(m[2])).toBe(PARAGRAPH_AFTER_DEFAULT);
  });

  it("keeps the paragraph gap independent of the line height", () => {
    // The two are separate measurements. If the gap were still derived from
    // line height, changing one would silently move the other.
    mount();
    const rule = ruleFor(".cm-line")!;
    const after = Number(rule.match(/padding: [\d.]+pt 2px ([\d.]+)pt 6px/)![1]);
    expect(after).not.toBeCloseTo(resolveLineHeight("one_half", 1) * 0.5, 2);
  });
});
