// features/codex/Extractor.test.tsx -- the Profile Extractor's two screens
// ==========================================================================
// The pass and its store are pinned in Python. What is only testable here is
// the part the writer actually touches, and one property matters more than the
// rest:
//
//   THIS PASS CARRIES NO EVIDENCE. An Overview is synthesis with no source
//   sentence to quote, so nothing verified these proposals against anything.
//   That makes the writer's click on each individual piece the ONLY safeguard
//   between a model's guess and their story bible -- which means every
//   convenience that removes a click removes the whole protection.
//
// So the interesting tests are not "does the button work". They are: is
// anything ever pre-selected (no), can a whole entry be accepted at once (no),
// is a proposal ever shown without what it would replace (no), and does the
// screen admit that none of this was checked (yes).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExtractorSetup } from "./ExtractorSetup";
import { ExtractorReview } from "./ExtractorReview";
import type { ExtractionRun } from "./extractorApi";

const PROJECT = "C:/Books/MyNovel";

const PLAN = {
  chapters: [
    { chapter_id: "c-1", filename: "01-a.md", title: "Chapter One", chars: 4000 },
    { chapter_id: "c-2", filename: "02-b.md", title: "Chapter Two", chars: 5000 },
  ],
  manuscript_chars: 9000,
  known: [
    { entity_id: "e-rosie", name: "Rosie", type: "character",
      written_chars: 900, suggest_exclude: true },
    { entity_id: "e-lou", name: "Lou", type: "character",
      written_chars: 40, suggest_exclude: false },
  ],
  has_world: true,
  unreviewed: 0,
  has_current: false,
};

const RUN: ExtractionRun = {
  run_id: "ext-abc123", created_at: "2026-08-14T10:00:00Z",
  model_used: "anthropic/claude", scope: { whole_manuscript: true },
  entries: [
    {
      item_id: "x-rosie", entity_id: "e-rosie", type: "character",
      name: "Rosie", aliases: [], unnamed: false, same_as: "",
      character_kind: "", state: "open", created_entity_id: "",
      parts: [
        { part_id: "p-1", section_id: "overview", heading: "Overview",
          form: "prose", trait_name: "",
          content: "She counts the exits in every room.",
          state: "open", applied_as: "" },
        { part_id: "p-2", section_id: "motivations", heading: "Motivations",
          form: "trait", trait_name: "Owes a debt",
          content: "To the wrong people.", state: "open", applied_as: "" },
      ],
    },
    {
      item_id: "x-tall", entity_id: "", type: "character",
      name: "The tall man", aliases: [], unnamed: true, same_as: "",
      character_kind: "side", state: "open", created_entity_id: "",
      parts: [
        { part_id: "p-3", section_id: "overview", heading: "Overview",
          form: "prose", trait_name: "",
          content: "Handles two powerful men with a word.",
          state: "open", applied_as: "" },
      ],
    },
  ],
};

/** The existing entry, as the review screen fetches it for the right column. */
const ROSIE_THREAD = {
  entity_id: "e-rosie", type: "character", name: "Rosie",
  sections: {
    overview: {
      heading: "Overview", content: "A courier. She knows the docks.",
      trait_blocks: [],
    },
    motivations: {
      heading: "Motivations", content: "",
      trait_blocks: [{ trait: "Wants out",
                       description: "Saving to leave the city." }],
    },
  },
};

let calls: Array<{ url: string; init?: RequestInit }> = [];

function mockApi(overrides: Record<string, unknown> = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });

    for (const [fragment, body] of Object.entries(overrides)) {
      if (url.includes(fragment)) {
        if (body instanceof Response) return body;
        return respond(body);
      }
    }
    if (url.includes("/api/extractor/plan")) return respond(PLAN);
    if (url.includes("/api/codex/entity")) return respond(ROSIE_THREAD);
    if (url.includes("/api/extractor/part")
        || url.includes("/api/extractor/entry")) {
      return respond({ ok: true, applied_as: "merge", progress: {
        entries: 2, entries_done: 0, parts: 3, parts_open: 2,
        parts_applied: 1, parts_dismissed: 0, new_entries: 1 } });
    }
    if (url.includes("/api/codex/thread/new")) {
      return respond({ thread: { entity_id: "e-new", type: "character",
                                 name: "The tall man", filename: "the-tall-man.md",
                                 sections: {} } });
    }
    return respond({});
  }));
}

beforeEach(() => mockApi());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const body = (testId: string) => screen.getByTestId(testId).textContent ?? "";


// ── Before the money ────────────────────────────────────────────────────────

describe("the setup screen", () => {
  async function open(overrides = {}) {
    mockApi(overrides);
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
  }

  it("says what it will cost and which model does it, before the button", async () => {
    // The money rule: a writer must be able to decide before spending, not
    // discover afterwards. Naming the ROLE matters too -- otherwise "which
    // model just read my whole novel?" has no answer on screen.
    await open();
    const summary = body("extractor-summary");
    expect(summary).toMatch(/most expensive/i);
    expect(summary).toMatch(/Long-context analysis/);
  });

  it("counts what it is about to read", async () => {
    await open();
    const summary = body("extractor-summary");
    expect(summary).toMatch(/2 chapters/);
    // Two known entries, one of them pre-ticked as "leave alone".
    expect(summary).toMatch(/1 entry/);
  });

  it("ticks the already-written entries to leave alone, and NOT the thin one", async () => {
    // The smart default. Deliberately a suggestion rather than an automatic
    // skip: nothing here can know that a character from chapter two has come
    // back, so skipping would miss exactly the entry the writer wanted.
    await open();
    const boxes = within(screen.getByTestId("extractor-exclusions"))
      .getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true);   // Rosie, written up
    expect(boxes[1].checked).toBe(false);  // Lou, thin
  });

  it("lets the writer untick a suggestion", async () => {
    await open();
    const boxes = within(screen.getByTestId("extractor-exclusions"))
      .getAllByRole("checkbox") as HTMLInputElement[];
    await userEvent.click(boxes[0]);
    expect(boxes[0].checked).toBe(false);
  });

  it("says outright that nothing it proposes has been checked", async () => {
    // The honesty obligation. With no evidence carried there is no dropped
    // count to earn trust with, so it moves into the wording.
    await open();
    const text = screen.getByTestId("extractor-setup").textContent ?? "";
    expect(text).toMatch(/first draft, not an answer/i);
    // Matched on the CLAIM rather than one phrasing of it -- this sentence is
    // prose a future session may well reword, and a test that broke on the
    // wording would get "fixed" by loosening it rather than by checking that
    // the promise survived.
    expect(text).toMatch(/checked against anything/i);
    expect(text).toMatch(/\bnone of it\b|\bnot\b/i);
  });

  it("tells a writer with no world to run Weaving first, and why", async () => {
    // Not a nag. Running this on an empty world proposes a world from scratch
    // with nothing to match against: the most expensive request and the
    // noisiest result. A writer who does that concludes the feature is bad.
    await open({ "/api/extractor/plan": { ...PLAN, known: [], has_world: false } });
    const notice = body("extractor-run-weaving-first");
    expect(notice).toMatch(/Run Weaving first/i);
    expect(notice).toMatch(/build on/i);
  });

  it("sends the whole book when no chapter is picked", async () => {
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => {
      const run = calls.find(c => c.url.includes("/api/extractor/run"));
      expect(run).toBeTruthy();
      const sent = JSON.parse(String(run!.init!.body));
      expect(sent.chapter_ids).toEqual([]);
    });
  });

  it("sends the excluded entries so they are left alone", async () => {
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => {
      const run = calls.find(c => c.url.includes("/api/extractor/run"));
      const sent = JSON.parse(String(run!.init!.body));
      expect(sent.exclude).toContain("e-rosie");
    });
  });

  it("ASKS BEFORE THROWING AWAY PROPOSALS THE WRITER PAID FOR", async () => {
    // A new run supersedes the old one, which is what the writer asked for.
    // Doing it without saying what it costs is not. The count comes back in
    // the refusal so the confirm can name it.
    mockApi({
      "/api/extractor/run": new Response(JSON.stringify({
        detail: { code: "extraction_would_replace",
                  message: "You have 12 proposals you have not looked at yet.",
                  detail: "12" },
      }), { status: 409 }),
    });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-run"));

    const confirm = await screen.findByTestId("extractor-replace-confirm");
    expect(confirm.textContent).toMatch(/12 proposals/);
    expect(confirm.textContent).toMatch(/You paid for those/i);
  });

  it("does not run again until the writer says so", async () => {
    mockApi({
      "/api/extractor/run": new Response(JSON.stringify({
        detail: { code: "extraction_would_replace", message: "...", detail: "12" },
      }), { status: 409 }),
    });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-run"));
    await screen.findByTestId("extractor-replace-confirm");

    const before = calls.filter(c => c.url.includes("/api/extractor/run")).length;
    // Cancelling must leave the saved run alone.
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(calls.filter(c => c.url.includes("/api/extractor/run")).length)
      .toBe(before);
  });
});


// ── Working through what came back ──────────────────────────────────────────

describe("the review screen", () => {
  async function open(run: ExtractionRun = RUN) {
    render(<ExtractorReview projectPath={PROJECT} run={run}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
  }

  it("shows the proposal BESIDE what the entry already says", async () => {
    // The two columns are the design. A proposal judged in the abstract is
    // guesswork; a writer who cannot see their own words cannot tell whether
    // the proposal adds anything, and cannot understand what Merge would do.
    await open();
    const part = (await screen.findAllByTestId("extractor-part"))[0];
    await waitFor(() =>
      expect(part.textContent).toContain("A courier. She knows the docks."));
    expect(part.textContent).toContain("She counts the exits in every room.");
    expect(part.textContent).toMatch(/What you have now/i);
  });

  it("offers no way to accept everything at once", async () => {
    // THE test for this screen. With nothing verifying the proposals, the
    // per-item click is the whole safeguard, so a convenience that applied
    // several at once would remove it entirely.
    await open();
    const text = screen.getByTestId("extractor-review").textContent ?? "";
    expect(text).not.toMatch(/apply all/i);
    expect(text).not.toMatch(/accept all/i);
    expect(text).not.toMatch(/add everything/i);
  });

  it("nothing arrives already chosen", async () => {
    await open();
    const boxes = screen.queryAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.every(b => !b.checked)).toBe(true);
    // And the fold-into picker starts empty rather than guessing a trait.
    const picker = await screen.findByTestId("extractor-merge-into");
    expect((picker as HTMLSelectElement).value).toBe("");
  });

  it("merging a section appends rather than replacing", async () => {
    await open();
    await userEvent.click((await screen.findAllByTestId("extractor-merge"))[0]);
    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/extractor/part"));
      const sent = JSON.parse(String(call!.init!.body));
      expect(sent.action).toBe("merge");
      expect(sent.entity_id).toBe("e-rosie");
    });
  });

  it("REQUIRES the writer to say which trait a fold goes into", async () => {
    // Merging into a trait the app picked is how a writer's own wording gets
    // overwritten, and a mangled trait is easy to miss because it still
    // carries their label. So the button is dead until they choose.
    await open();
    const fold = await screen.findByRole("button", { name: /Fold in/ });
    expect(fold.hasAttribute("disabled")).toBe(true);

    await userEvent.selectOptions(
      await screen.findByTestId("extractor-merge-into"), "Wants out");
    expect(fold.hasAttribute("disabled")).toBe(false);
  });

  it("offers the writer's own traits as the fold targets", async () => {
    await open();
    const picker = await screen.findByTestId("extractor-merge-into");
    expect(picker.textContent).toContain("Wants out");
  });

  it("throwing a proposal away touches no entry", async () => {
    await open();
    await userEvent.click((await screen.findAllByTestId("extractor-dismiss"))[0]);
    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/extractor/part"));
      expect(JSON.parse(String(call!.init!.body)).action).toBe("dismiss");
    });
  });

  it("says when the read was made, and does not claim to know if it is stale", async () => {
    // The manuscript may have moved under a long review and nothing flags it.
    // That is the direct consequence of there being one saved run, and it is
    // the writer's call rather than an oversight -- so the screen states the
    // date and leaves re-running to them.
    await open();
    expect(body("extractor-when")).toMatch(/Read on/);
  });
});


// ── The characters Weaving structurally cannot see ──────────────────────────

describe("a character the book describes but never names", () => {
  async function openAt(name: string) {
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    await userEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  }

  it("keeps the description as the name and says why", async () => {
    // The one thing that must never happen is the app inventing a name to fill
    // the field. "The tall man" is what the book calls him.
    await openAt("The tall man");
    expect(screen.getByTestId("extractor-unnamed").textContent)
      .toMatch(/described, not named/i);
    const review = screen.getByTestId("extractor-review").textContent ?? "";
    expect(review).toMatch(/describes this person without naming them/i);
  });

  it("does not nag the writer into naming them", async () => {
    // An unnamed character is a FINISHED state, not an incomplete one. A writer
    // who has not decided who this is must not be pushed into deciding.
    await openAt("The tall man");
    const review = screen.getByTestId("extractor-review").textContent ?? "";
    expect(review).not.toMatch(/needs a name/i);
    expect(review).not.toMatch(/unnamed character.*incomplete/i);
  });

  it("will not let its pieces land until the writer makes the entry", async () => {
    // Roadmap decision 9. Auto-creating on first apply would be convenient and
    // would make the largest unverified write in the app.
    await openAt("The tall man");
    const part = (await screen.findAllByTestId("extractor-part"))[0];
    expect(part.textContent).toMatch(/Make the entry above first/i);
    expect(within(part).queryByTestId("extractor-merge")).toBeNull();
  });

  it("creates it base-level, as a Side character, and says so", async () => {
    await openAt("The tall man");
    const review = screen.getByTestId("extractor-review").textContent ?? "";
    expect(review).toMatch(/arrives as a Side character/i);

    await userEvent.click(screen.getByTestId("extractor-create"));
    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/codex/thread/new"));
      expect(call).toBeTruthy();
      const sent = JSON.parse(String(call!.init!.body));
      expect(sent.name).toBe("The tall man");
      expect(sent.character_kind).toBe("side");
    });
  });

  it("records what the new entry became, so a second click cannot double it", async () => {
    await openAt("The tall man");
    await userEvent.click(screen.getByTestId("extractor-create"));
    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/extractor/entry"));
      expect(JSON.parse(String(call!.init!.body)).created_entity_id).toBe("e-new");
    });
  });
});


describe("a reveal", () => {
  it("is offered as a question, never carried out", async () => {
    // "The hulking figure ... turns out to be Altas" is one character with two
    // labels. Folding them is the writer's call; the app does not merge on a
    // hunch, and the wording has to make that unmistakable.
    const run: ExtractionRun = {
      ...RUN,
      entries: [{ ...RUN.entries[1], same_as: "e-altas" }],
    };
    render(<ExtractorReview projectPath={PROJECT} run={run}
                            onChanged={() => {}} onStartOver={() => {}} />);
    const notice = await screen.findByTestId("extractor-same-as");
    expect(notice.textContent).toMatch(/yours to decide/i);
    expect(notice.textContent).toMatch(/nothing has been merged/i);
  });
});


// ── The walkthrough ─────────────────────────────────────────────────────────
//
// R2.12f's lesson, applied rather than remembered: a guide that hangs off a
// surface the writer is not looking at is documentation, not help. The page
// that saves them money is the ORDER one, so it has to be reachable from the
// screen they are on BEFORE they spend, and from the one they land on after.

describe("Show me how this works", () => {
  it("is offered on the setup screen, before any money is spent", async () => {
    mockApi();
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-show-me"));
    expect(await screen.findByTestId("extractor-guide")).toBeTruthy();
  });

  it("is offered on the review screen too, where a writer may land first", async () => {
    // The screen opens on a SAVED run whenever one exists, so a writer coming
    // back a week later never passes the setup screen at all.
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    await userEvent.click(screen.getByTestId("extractor-show-me"));
    expect(await screen.findByTestId("extractor-guide")).toBeTruthy();
  });

  it("teaches the order of operations, which is what saves money", async () => {
    mockApi();
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-show-me"));
    const guide = await screen.findByTestId("extractor-guide");
    // Page two is the one people get wrong.
    await userEvent.click(within(guide).getByRole("button", { name: /Next/ }));
    expect(guide.textContent).toMatch(/Run Weaving first/i);
    expect(guide.textContent).toMatch(/Free pass first, paid pass second/i);
  });

  it("says the proposals are unchecked, in the guide as well as on the screen", async () => {
    // The honesty obligation is not satisfied by saying it once somewhere.
    mockApi();
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-show-me"));
    const guide = await screen.findByTestId("extractor-guide");
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(within(guide).getByRole("button", { name: /Next/ }));
    }
    expect(guide.textContent).toMatch(/only check there is/i);
  });

  it("contains no em dashes, which the app forbids in anything a writer reads", async () => {
    mockApi();
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-show-me"));
    const guide = await screen.findByTestId("extractor-guide");
    // Walk every page rather than checking the first.
    for (let i = 0; i < 7; i += 1) {
      expect(guide.textContent ?? "").not.toMatch(/[\u2014\u2013]/);
      const next = within(guide).queryByRole("button", { name: /Next/ });
      if (!next) break;
      await userEvent.click(next);
    }
  });
});
