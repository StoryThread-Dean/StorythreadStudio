// components/learn/Explain.test.tsx
// =================================
// The product rule, held as a contract rather than a habit.
//
// Given as standing direction: every feature needs "either a 'what's this?' or
// 'show me how to do this' popup or full instructional for the purposes of
// teaching, learning, offering assistance, why this process is happening, is it
// necessary and or if it cost tokens."
//
// The old free-form WhatsThis could satisfy none of that and still look like
// help. So the registry is typed and this walks all of it -- a screen cannot
// explain itself badly, only completely or not at all.

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Explain } from "./Explain";
import { EXPLAIN, EXPLAIN_KEYS, NEED_WORDING, FREE, spends } from "./explanations";

afterEach(cleanup);


describe("every explanation answers all of it", () => {
  it("says what it is, in a sentence", () => {
    for (const key of EXPLAIN_KEYS) {
      const entry = EXPLAIN[key];
      expect(entry.what.length, key).toBeGreaterThan(20);
      expect(entry.what.trim().endsWith("."), key).toBe(true);
    }
  });

  it("says WHY, and not just more of what", () => {
    // The field most likely to be skipped and the one most often wanted. A
    // writer who knows why a question is asked can answer it well.
    for (const key of EXPLAIN_KEYS) {
      const entry = EXPLAIN[key];
      expect(entry.why.length, key).toBeGreaterThan(30);
      expect(entry.why, key).not.toBe(entry.what);
    }
  });

  it("says whether the writer has to do it", () => {
    for (const key of EXPLAIN_KEYS) {
      expect(["required", "recommended", "optional"], key)
        .toContain(EXPLAIN[key].needed);
    }
  });

  it("is right about money when it mentions it", () => {
    // Mentioning cost is a nice-to-have, not an obligation -- so this checks the
    // CLAIM rather than its presence. Silence about money is fine; a wrong
    // answer spends the writer's credit while promising it will not, which is
    // what backend/tests/test_explain_costs.py checks against the real route.
    for (const key of EXPLAIN_KEYS) {
      const cost = EXPLAIN[key].cost;
      if (!cost) continue;
      expect(["free", "spends"], key).toContain(cost.kind);
      if (cost.kind === "spends") {
        // "This costs tokens" is not an answer anyone can decide with.
        expect(cost.note.length, key).toBeGreaterThan(25);
      }
    }
  });

  it("still says so on everything written so far", () => {
    // Optional in the type, and worth doing anyway. If a later entry leaves it
    // out that is allowed -- this is here so dropping it becomes a visible
    // decision rather than something that quietly erodes.
    const silent = EXPLAIN_KEYS.filter(k => !EXPLAIN[k].cost);
    expect(silent).toEqual([]);
  });

  it("writes steps as things to DO, in order", () => {
    for (const key of EXPLAIN_KEYS) {
      for (const step of EXPLAIN[key].how ?? []) {
        expect(step.length, `${key}: ${step}`).toBeGreaterThan(10);
        // A step starting lowercase is usually a fragment continuing a
        // sentence, which stops being readable out of a numbered list.
        expect(step[0], `${key}: ${step}`).toBe(step[0].toUpperCase());
      }
    }
  });

  it("never uses an em dash or en dash", () => {
    // The locked product rule, and this file is prose the writer reads.
    for (const key of EXPLAIN_KEYS) {
      const entry = EXPLAIN[key];
      const all = [entry.what, entry.why, ...(entry.how ?? []),
                   entry.cost?.kind === "spends" ? entry.cost.note : ""].join(" ");
      expect(all, key).not.toMatch(/[—–]/);
    }
  });

  it("uses the app's own words, not the code's", () => {
    // The writer reads this. A term only the source uses is a leak.
    for (const key of EXPLAIN_KEYS) {
      const entry = EXPLAIN[key];
      const all = `${entry.what} ${entry.why} ${(entry.how ?? []).join(" ")}`;
      for (const leak of ["entity_id", "types.json", "codex_", "rel_inverse",
                          "ai_scope", "placeholder"]) {
        expect(all.toLowerCase(), `${key} leaks ${leak}`)
          .not.toContain(leak.toLowerCase());
      }
    }
  });
});


describe("what the writer sees", () => {
  const LOCAL = {
    what: "A thing that does a thing.",
    why: "Because the other way round did not work at all.",
    needed: "recommended" as const,
    cost: FREE,
    how: ["Press the button.", "Then press the other one."],
  };

  it("offers What's this?", async () => {
    render(<Explain entry={LOCAL} />);
    expect(screen.getByRole("button", { name: /What's this/ })).toBeTruthy();
  });

  it("keeps it shut until asked", () => {
    render(<Explain entry={LOCAL} />);
    expect(screen.queryByTestId("explain-what")).toBeNull();
  });

  it("shows what, why, whether it is needed, and what it costs", async () => {
    render(<Explain entry={LOCAL} />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    const box = screen.getByTestId("explain-panel");
    expect(box.textContent).toContain("A thing that does a thing.");
    // WHY is still labelled -- that is the point of the assertion, and the
    // part writers ask for. It is a heading now rather than an inline "Why:"
    // prefix, so the panel reads as four answers rather than one paragraph.
    expect(within(box).getByText("Why")).toBeTruthy();
    expect(box.textContent).toContain(NEED_WORDING.recommended);
    expect(box.textContent).toMatch(/costs nothing/);
  });

  it("says it costs nothing rather than saying nothing about cost", async () => {
    // Silence about money reads as "probably costs something".
    render(<Explain entry={{ ...LOCAL, cost: FREE }} />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    expect(screen.getByTestId("explain-panel").textContent)
      .toMatch(/No AI is called/);
  });

  it("quotes the real cost when there is one", async () => {
    render(<Explain entry={{
      ...LOCAL,
      cost: spends("One call over this chapter only, so a few pennies at most."),
    }} />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    expect(screen.getByTestId("explain-panel").textContent)
      .toMatch(/One call over this chapter only/);
  });

  it("puts the steps in the same panel, under their own heading", async () => {
    // REPLACED A SECOND BUTTON. "What's this?" and "Show me how to do this" side
    // by side cost about 240px of chrome per use, and two of them stacked on the
    // Weaving panel read as clutter -- "I'm not sure two What'sThis? and Show me
    // how to do this is needed."
    //
    // Nothing is lost. Somebody who only wants the steps looks down past four
    // short lines instead of pressing a different button.
    render(<Explain entry={LOCAL} />);
    expect(screen.queryByRole("button", { name: /Show me how/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    const steps = screen.getByTestId("explain-how");
    expect(steps.querySelector("ol")).toBeTruthy();
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(steps.textContent).toMatch(/How to do this/);
  });

  it("is one control, not two", async () => {
    render(<Explain entry={LOCAL} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("says nothing about steps when there are none", async () => {
    render(<Explain entry={{ ...LOCAL, how: undefined }} />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    expect(screen.queryByTestId("explain-how")).toBeNull();
    expect(screen.getByTestId("explain-panel").textContent)
      .not.toMatch(/How to do this/);
  });

  it("closes when asked again", async () => {
    render(<Explain entry={LOCAL} />);
    const button = screen.getByRole("button", { name: /What's this/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(screen.queryByTestId("explain-panel")).toBeNull();
  });

  it("closes on Escape, and on a click elsewhere", async () => {
    // A floating panel dismissable only by finding its button again is a panel
    // people leave open over their own manuscript.
    render(<><Explain entry={LOCAL} /><button>somewhere else</button></>);
    const button = screen.getByRole("button", { name: /What's this/ });

    await userEvent.click(button);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("explain-panel")).toBeNull();

    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: "somewhere else" }));
    expect(screen.queryByTestId("explain-panel")).toBeNull();
  });

  it("does not push the screen around when it opens", async () => {
    // THE SMART ADVISOR BUG. Inside a wrapping toolbar the old panel grew the
    // row: it shoved the pass buttons sideways, wrapped Context onto a second
    // line and pushed the manuscript down. So the panel is out of flow, and the
    // trigger keeps its place.
    render(<Explain entry={LOCAL} />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    expect(screen.getByTestId("explain-panel").className).toMatch(/\babsolute\b/);
  });

  it("shrinks to an icon where a row is crowded", async () => {
    // Words are the better affordance, so this is for places they will not fit,
    // not a default to reach for. It still has to be findable by name.
    render(<Explain entry={LOCAL} compact />);
    const button = screen.getByRole("button", { name: /What's this/ });
    expect(button.textContent).toBe("");
    await userEvent.click(button);
    expect(screen.getByTestId("explain-panel").textContent)
      .toContain("A thing that does a thing.");
  });

  it("reads an entry out of the registry by key", async () => {
    render(<Explain of="tie.reason" />);
    await userEvent.click(screen.getByRole("button", { name: /What's this/ }));
    expect(screen.getByTestId("explain-panel").textContent)
      .toContain(EXPLAIN["tie.reason"].what);
  });

  it("renders nothing at all for a key that does not exist", () => {
    // A typo must not take the screen down. The contract test above is what
    // actually catches it.
    const { container } = render(<Explain of="nope.not.a.key" />);
    expect(container.textContent).toBe("");
  });

  it("is a button, so it is reachable by keyboard", async () => {
    render(<Explain entry={LOCAL} />);
    const button = screen.getByRole("button", { name: /What's this/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});


describe("the rule is applied, not merely available", () => {
  // A registry nothing renders is documentation, not help. This reads the real
  // component sources and asserts the screens a writer actually gets stuck on
  // carry an explanation -- the same reason test_role_call_sites.py reads the
  // router rather than trusting that roles are used.
  //
  // Deliberately a source read rather than a render: mounting every screen needs
  // its whole API mocked, and a test that expensive gets skipped rather than
  // extended when the next screen lands.

  const SOURCES = import.meta.glob(
    ["../../features/codex/*.tsx", "../../components/editor/*.tsx",
     "../../components/profiles/*.tsx"],
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>;

  function source(name: string): string {
    const key = Object.keys(SOURCES).find(k => k.endsWith(`/${name}`));
    expect(key, `${name} not found`).toBeTruthy();
    return SOURCES[key!];
  }

  /** Screens where a writer has to decide something with consequences. */
  const MUST_EXPLAIN = [
    "TieEditor.tsx",           // records what gets sent to AI
    "BindDot.tsx",             // moves a word between entries
    "WeavingPanel.tsx",        // starts a pass over the whole book
    "QuickEntry.tsx",          // creates a real file in the writer's world
    "QuickFill.tsx",           // writes into an entry they already have
    "SnagFixer.tsx",           // deletes and edits facts -- the sharpest tool here
    "EditorAdvisorBar.tsx",    // SPENDS -- a request over the whole chapter
    "IssuePopover.tsx",        // SPENDS per press, and rewrites the writer's prose
    "ThesaurusPopover.tsx",    // replaces the OS menu, so it owes an explanation
    "QuickBuildPanel.tsx",     // reads like AI, is not, and has adult tiers
    "NameGeneratorPanel.tsx",  // partial picks are valid and nobody guesses that
    "SpinePickers.tsx",        // the dropdown clearing itself looks broken
  ];

  for (const name of MUST_EXPLAIN) {
    it(`${name} offers an explanation`, () => {
      expect(source(name)).toMatch(/<Explain\s/);
    });
  }

  it("every key a screen names really exists", () => {
    // A typo renders nothing at all, which looks like a screen that simply has
    // no help -- the quietest possible failure.
    const used = new Set<string>();
    for (const text of Object.values(SOURCES)) {
      for (const match of text.matchAll(/<Explain\s+of="([^"]+)"/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(3);
    for (const key of used) {
      expect(EXPLAIN[key], `no entry for ${key}`).toBeTruthy();
    }
  });

  it("explains the required field where it is asked, not elsewhere", () => {
    // The reason line is the one thing a connection cannot be saved without, so
    // its explanation belongs beside the box rather than in a header somewhere.
    const text = source("TieEditor.tsx");
    const label = text.indexOf("In one line, why?");
    const help = text.indexOf('of="tie.reason"');
    expect(label).toBeGreaterThan(-1);
    expect(help).toBeGreaterThan(-1);
    expect(Math.abs(help - label)).toBeLessThan(400);
  });

  it("says what it spends wherever a screen actually spends", () => {
    // The two screens in this app that send the writer's prose to a model. If
    // either ever describes itself as free, the app is spending their credit
    // while telling them it is not -- backend/tests/test_explain_costs.py checks
    // the claim against the route, and this checks the claim is even made.
    for (const key of ["advisor.what", "issue.transform"]) {
      expect(EXPLAIN[key].cost?.kind, key).toBe("spends");
    }
  });

  it("says it is free wherever a screen only reads canned lists", () => {
    // Worth asserting in the other direction. These read like AI features and
    // are not, and a writer who assumes otherwise avoids the cheapest tools here.
    for (const key of ["quickbuild.what", "spine.what", "names.what",
                       "thesaurus.what"]) {
      expect(EXPLAIN[key].cost?.kind, key).toBe("free");
    }
  });

  it("tells a spending screen how to spend less", () => {
    // Knowing it costs money is only half an answer. The steps have to name the
    // cheaper way of doing the same thing.
    expect(EXPLAIN["advisor.what"].how?.some(s => /[Ss]elect/.test(s))).toBe(true);
    const cost = EXPLAIN["advisor.what"].cost;
    expect(cost?.kind === "spends" && /select/i.test(cost.note)).toBe(true);
  });

});


// ── STAYING ON SCREEN ────────────────────────────────────────────────────────
//
// Reported from live testing, on the Hidden (eyeball) control in a trait card:
// "Clicking it produces a popup that is not readable as its positioned off the
// screen."
//
// The panel is up to 30rem wide, absolutely positioned against a 13px icon.
// `align="right"` anchors its right edge to the trigger so it opens leftwards,
// which is right for a trigger near the right of the window and puts the whole
// panel out of view for one near the left.
//
// Fixing the two call sites would have closed the report. The component clamps
// itself instead, so the next Explain dropped into a crowded row cannot
// reproduce it. jsdom reports every rect as zero, so the geometry has to be
// stubbed for these to mean anything -- which is the point: without a stub, a
// test here would pass whatever the maths did.

/** Pretend the panel is `width` wide with its left edge at `left`. */
function stubGeometry(width: number, left: number, viewport = 1000) {
  const original = Element.prototype.getBoundingClientRect;
  window.innerWidth = viewport;
  Element.prototype.getBoundingClientRect = function () {
    if ((this as HTMLElement).getAttribute?.("data-testid") === "explain-panel") {
      return { width, height: 200, left, right: left + width,
               top: 0, bottom: 200, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  return () => { Element.prototype.getBoundingClientRect = original; };
}

describe("the panel stays where it can be read", () => {
  it("slides back in when the call site points it off the left edge", async () => {
    // THE REPORTED BUG, as geometry: a 480px panel whose left edge is at -300.
    const restore = stubGeometry(480, -300);
    try {
      render(<Explain of="character.subtext" compact align="right" />);
      await userEvent.click(screen.getByLabelText("What's this?"));
      const panel = screen.getByTestId("explain-panel");
      // Moved right by enough to clear the edge, plus the 8px margin.
      expect(panel.style.transform).toBe("translateX(308px)");
    } finally {
      restore();
    }
  });

  it("slides back in when it would overflow the right edge", async () => {
    const restore = stubGeometry(480, 700);   // right edge at 1180, viewport 1000
    try {
      render(<Explain of="character.subtext" compact />);
      await userEvent.click(screen.getByLabelText("What's this?"));
      expect(screen.getByTestId("explain-panel").style.transform)
        .toBe("translateX(-188px)");
    } finally {
      restore();
    }
  });

  it("leaves a panel that already fits completely alone", async () => {
    // No transform at all, rather than translateX(0px): a correction that
    // always fires is a correction nobody can reason about.
    const restore = stubGeometry(480, 200);
    try {
      render(<Explain of="character.subtext" compact />);
      await userEvent.click(screen.getByLabelText("What's this?"));
      expect(screen.getByTestId("explain-panel").style.transform).toBe("");
    } finally {
      restore();
    }
  });

  it("favours the near edge when the panel cannot fit at all", async () => {
    // Narrower window than the panel. The start of the sentence has to be
    // visible; losing the far end costs a few words, losing the near end makes
    // the whole thing useless.
    const restore = stubGeometry(480, -50, 300);
    try {
      render(<Explain of="character.subtext" compact />);
      await userEvent.click(screen.getByLabelText("What's this?"));
      const shift = Number(/translateX\((-?\d+)px\)/
        .exec(screen.getByTestId("explain-panel").style.transform)?.[1]);
      expect(shift).toBe(58);          // left edge lands on the 8px margin
    } finally {
      restore();
    }
  });
});

describe("the two triggers inside a trait card", () => {
  it("do not anchor their panels to the left of the window", async () => {
    // Both live near the LEFT of a narrow card, so both must open rightwards.
    // A source read, because the geometry that made this wrong is real-browser
    // layout that jsdom does not reproduce.
    const profileBuilder = (await import("../../screens/ProfileBuilder.tsx?raw"))
      .default as string;
    const traitWindow = (await import("../profiles/TraitWindow.tsx?raw"))
      .default as string;
    expect(profileBuilder).toContain('<Explain of="character.subtext" compact />');
    expect(traitWindow).toContain('<Explain of="character.traitWindow" compact />');
    for (const [name, source] of [["ProfileBuilder", profileBuilder],
                                  ["TraitWindow", traitWindow]] as const) {
      expect(/character\.(subtext|traitWindow)" compact align="right"/.test(source),
             `${name} still right-anchors a trait-card explanation`).toBe(false);
    }
  });
});
