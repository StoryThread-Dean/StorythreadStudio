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

import { render, screen, cleanup } from "@testing-library/react";
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

  it("says what it spends, every time", () => {
    // Including when the answer is nothing. Most of this app is free and
    // writers assume the opposite, because a model-shaped app trains people to
    // expect a meter running.
    for (const key of EXPLAIN_KEYS) {
      const cost = EXPLAIN[key].cost;
      expect(["free", "spends"], key).toContain(cost.kind);
      if (cost.kind === "spends") {
        // "This costs tokens" is not an answer anyone can decide with.
        expect(cost.note.length, key).toBeGreaterThan(25);
      }
    }
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
                   entry.cost.kind === "spends" ? entry.cost.note : ""].join(" ");
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
    expect(box.textContent).toContain("Why:");
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
      expect(EXPLAIN[key].cost.kind, key).toBe("spends");
    }
  });

  it("says it is free wherever a screen only reads canned lists", () => {
    // Worth asserting in the other direction. These read like AI features and
    // are not, and a writer who assumes otherwise avoids the cheapest tools here.
    for (const key of ["quickbuild.what", "spine.what", "names.what",
                       "thesaurus.what"]) {
      expect(EXPLAIN[key].cost.kind, key).toBe("free");
    }
  });

  it("tells a spending screen how to spend less", () => {
    // Knowing it costs money is only half an answer. The steps have to name the
    // cheaper way of doing the same thing.
    expect(EXPLAIN["advisor.what"].how?.some(s => /[Ss]elect/.test(s))).toBe(true);
    expect(EXPLAIN["advisor.what"].cost.kind === "spends"
      && /select/i.test(EXPLAIN["advisor.what"].cost.note)).toBe(true);
  });

});
