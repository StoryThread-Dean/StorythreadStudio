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
  batches: [["c-1", "c-2"]],
  model_id: "anthropic/claude-sonnet-4",
  model_error: "",
  context_tokens: 200000,
  estimated_tokens: 2250,
  fits: true,
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
    if (url.includes("/api/extractor/models")) return respond({
      models: [
        { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4",
          context_length: 200000, cost_input_per_million: 3,
          cost_output_per_million: 15, is_free: false,
          supports_reasoning: false },
        { id: "google/gemini-2.5-flash-lite", name: "Gemini Flash Lite",
          context_length: 1048576, cost_input_per_million: 0.1,
          cost_output_per_million: 0.4, is_free: false,
          supports_reasoning: true },
        { id: "deepseek/deepseek-chat", name: "DeepSeek",
          context_length: 64000, cost_input_per_million: 0.14,
          cost_output_per_million: 0.28, is_free: false,
          supports_reasoning: false },
      ], provider: "openrouter", error: "" });
    if (url.includes("/api/extractor/model")) return respond({ ok: true });
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

  it("says what it will cost, and names the model", async () => {
    // The money rule: a writer must be able to decide before spending rather
    // than discover afterwards. The MODEL is named rather than the role,
    // because "which model just read my whole novel?" is the question the
    // first live run left unanswered.
    await open();
    const summary = body("extractor-summary");
    expect(summary).toMatch(/most expensive/i);
    expect(summary).toMatch(/anthropic\/claude-sonnet-4/);
  });

  it("counts what it is about to read", async () => {
    await open();
    const summary = body("extractor-summary");
    expect(summary).toMatch(/2 chapters/);
    // Two known entries, one of them pre-ticked as "leave alone".
    expect(summary).toMatch(/1 entry/);
  });

  it("TICKED MEANS SEND, which is the way round a writer expects", async () => {
    // Flipped after the first live run. The writer's words: "that was actually
    // confusing to me and unnatural. Generally one would want to CHECK all the
    // boxes they want to send and UNCHECK the ones they don't want."
    //
    // The suggestion is unchanged -- an entry already written up is not worked
    // on by default -- only the direction it is expressed in. A ticked list
    // beside a Send button reads as the things being sent, and inverting that
    // makes every writer hold a negation for the whole screen.
    await open();
    const boxes = within(screen.getByTestId("extractor-exclusions"))
      .getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].checked).toBe(false);  // Rosie, already written up
    expect(boxes[1].checked).toBe(true);   // Lou, thin, worth proposing for
  });

  it("sends the UNTICKED entries as the ones to leave alone", async () => {
    // The screen speaks in inclusions, the wire speaks in exclusions, and the
    // translation happens once. Getting this backwards would silently invert
    // the writer's intent on the one screen that spends money.
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => {
      const run = calls.find(c => c.url.includes("/api/extractor/run"));
      const sent = JSON.parse(String(run!.init!.body));
      expect(sent.exclude).toEqual(["e-rosie"]);
    });
  });

  it("lets the writer tick a suggestion back on", async () => {
    await open();
    const boxes = within(screen.getByTestId("extractor-exclusions"))
      .getAllByRole("checkbox") as HTMLInputElement[];
    await userEvent.click(boxes[0]);
    expect(boxes[0].checked).toBe(true);
  });

  it("offers tick all and tick none", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Tick all/ }));
    const boxes = within(screen.getByTestId("extractor-exclusions"))
      .getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.every(b => b.checked)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Tick none/ }));
    expect(boxes.every(b => !b.checked)).toBe(true);
  });

  it("says an unticked entry is still shown to the model", async () => {
    // Otherwise the writer reasonably assumes unticking hides it, and a model
    // that is not told a character exists proposes them as new.
    await open();
    const text = screen.getByTestId("extractor-setup").textContent ?? "";
    expect(text).toMatch(/still shown to the model/i);
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

  it("covers every chapter when none is picked", async () => {
    // The request now NAMES its chapters rather than sending an empty list to
    // mean everything, because a book is split into batches and each one has
    // to say which part of the book it is. "All of it" is the union of the
    // batches, and the whole-book default is that no batch is filtered out.
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => {
      const run = calls.find(c => c.url.includes("/api/extractor/run"));
      expect(run).toBeTruthy();
      const sent = JSON.parse(String(run!.init!.body));
      expect(sent.chapter_ids).toEqual(["c-1", "c-2"]);
      expect(sent.append).toBe(false);
    });
  });

  it("NAMES THE MODEL, AND ITS LIMIT, ON THIS SCREEN", async () => {
    // The first live run was made by a model the writer did not think they
    // were using: Long-context analysis was unassigned, so it fell through to
    // the Default Model. Naming the ROLE was not enough.
    await open();
    expect(body("extractor-current-model")).toMatch(/anthropic\/claude-sonnet-4/);
    // The window arrives with the catalog, a moment after the plan.
    await waitFor(() =>
      expect(body("extractor-current-model")).toMatch(/holds 200k/i));
  });

  it("REFUSES TO SPEND when the book will not fit in that model", async () => {
    // The first live run sent ~69,000 tokens to a model holding 64,000, got an
    // unreadable answer, and paid for the privilege of finding out.
    // The real numbers from the writer's own book: seven chapters, 275,535
    // characters, against deepseek-chat's 64k window. The estimate is computed
    // from the ticked chapters rather than taken from the plan, so the fixture
    // has to carry real sizes -- which is the more honest test anyway.
    await open({ "/api/extractor/plan": {
      ...PLAN,
      chapters: [
        { chapter_id: "c-1", filename: "01.md", title: "One", chars: 137768 },
        { chapter_id: "c-2", filename: "02.md", title: "Two", chars: 137767 },
      ],
      model_id: "deepseek/deepseek-chat",
      context_tokens: 64000, estimated_tokens: 68883, fits: false } });
    const warning = body("extractor-too-big");
    expect(warning).toMatch(/will not fit/i);
    expect(warning).toMatch(/68,88[0-9]/);
    expect(warning).toMatch(/64,000/);
    expect(warning).toMatch(/Nothing will be sent or charged/i);
    expect(screen.getByTestId("extractor-run").hasAttribute("disabled"))
      .toBe(true);
  });

  it("says when no model can run it at all", async () => {
    await open({ "/api/extractor/plan": {
      ...PLAN, model_id: "", model_error: "No API key for OpenRouter." } });
    expect(body("extractor-model-error")).toMatch(/No API key/);
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


// ── WHEN NOTHING CAME BACK ──────────────────────────────────────────────────
//
// The first real run of this feature returned nothing, and the screen said an
// empty result "usually means the book already says what your entries say".
// That was a confident explanation with nothing behind it, and it was wrong:
// the request had overflowed the model's context window and the answer came
// back unreadable.
//
// A wrong reason is worse than no reason. It sends the writer away satisfied
// while the feature is broken, and it wastes the one piece of evidence that
// would have explained everything.

describe("an empty result", () => {
  const emptyRun: ExtractionRun = {
    run_id: "ext-empty", created_at: "2026-08-14T19:33:00Z",
    model_used: "deepseek/deepseek-chat", scope: { whole_manuscript: true },
    entries: [],
    dropped: ["The model did not return readable JSON."],
    raw_excerpt: "I'm sorry, I can't process a request that long.",
    estimated_tokens: 68883,
    context_tokens: 64000,
  };

  async function open(run = emptyRun) {
    render(<ExtractorReview projectPath={PROJECT} run={run}
                            onChanged={() => {}} onStartOver={() => {}} />);
    return screen.findByTestId("extractor-empty");
  }

  it("never claims the book already matches the entries", async () => {
    const panel = await open();
    expect(panel.textContent).not.toMatch(/already says what your entries say/i);
  });

  it("says what actually went wrong", async () => {
    const panel = await open();
    expect(panel.textContent).toMatch(/did not return readable JSON/i);
  });

  it("shows the sizes, which is usually the whole answer", async () => {
    const panel = await open();
    expect(panel.textContent).toMatch(/68,883/);
    expect(panel.textContent).toMatch(/64,000/);
    expect(panel.textContent).toMatch(/deepseek/);
  });

  it("keeps what the model actually said", async () => {
    // The difference between a five-second diagnosis and a mystery.
    const panel = await open();
    expect(panel.textContent).toMatch(/What the model actually said/i);
    expect(panel.textContent).toMatch(/can't process a request that long/i);
  });

  it("says what to do next rather than leaving a dead end", async () => {
    const panel = await open();
    expect(panel.textContent).toMatch(/fewer chapters/i);
    expect(panel.textContent).toMatch(/larger context window/i);
  });

  it("stays sane when there is no diagnosis to give", async () => {
    // A genuinely empty result -- the model answered properly and found
    // nothing. No invented reason here either.
    const panel = await open({ ...emptyRun, dropped: [], raw_excerpt: "",
                               estimated_tokens: undefined,
                               context_tokens: undefined });
    expect(panel.textContent).toMatch(/Nothing came back/i);
    expect(panel.textContent).not.toMatch(/already says what your entries say/i);
  });
});


// ── THE DASHBOARD, AND WHY IT HAS TO BE LIVE ────────────────────────────────
//
// Asked for after the second live run: "a small dashboard of numbers that
// adjust when a chapter is selected/deselected that give a token estimate ...
// example: 68,500 approximate, unchecking a chapter results in 59,900
// approximate."
//
// The word doing the work is ADJUST. A total that only appears after the
// request is a receipt; one that moves while you tick is a decision. So the
// arithmetic is done on the screen from character counts the plan already
// sent, rather than fetched per tick -- a round trip per click would lag
// behind the clicking and be worse than no number at all.

describe("the token dashboard", () => {
  const BIG = {
    ...PLAN,
    chapters: [
      { chapter_id: "c-1", filename: "01.md", title: "One", chars: 200000 },
      { chapter_id: "c-2", filename: "02.md", title: "Two", chars: 75535 },
    ],
    context_tokens: 1048576,
    model_id: "google/gemini-2.5-flash-lite",
  };

  async function open(plan = BIG) {
    mockApi({ "/api/extractor/plan": plan });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
  }

  it("estimates the whole book before anything is ticked", async () => {
    await open();
    // 275,535 characters at roughly 4 per token.
    expect(body("extractor-token-estimate")).toMatch(/68,88[0-9]/);
  });

  it("THE NUMBER MOVES WHEN A CHAPTER IS UNTICKED", async () => {
    await open();
    const before = body("extractor-token-estimate");
    await userEvent.click(screen.getByRole("button", { name: "Two" }));
    const after = body("extractor-token-estimate");
    expect(after).not.toBe(before);
    // 200,000 characters left, so about 50,000 tokens.
    expect(after).toMatch(/50,000/);
  });

  it("counts the chapters alongside it", async () => {
    await open();
    expect(body("extractor-dashboard")).toMatch(/2 of 2/);
    await userEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(body("extractor-dashboard")).toMatch(/1 of 2/);
  });

  it("shows what the model can hold beside what the run needs", async () => {
    await open();
    expect(body("extractor-dashboard")).toMatch(/1,048,576/);
  });

  it("says the limit is unknown rather than pretending it fits", async () => {
    // A local model reports no context length. Claiming a fit we never checked
    // is how a writer pays for a request that overflows.
    await open({ ...BIG, context_tokens: 0, model_id: "local/whatever" });
    expect(body("extractor-dashboard")).toMatch(/unknown/i);
  });
});


// ── THE MODEL PICKER ON THIS SCREEN ─────────────────────────────────────────
//
// Reported: the roles list "do not list the limits at all ... Only the
// recommended are at the top listed as budget, pricier, etc."
//
// Right, and it is a difference in what the two screens are for. Everywhere
// else a request is one chapter and any model holds it, so price is the useful
// sort. Here the request is a whole book and the window decides whether it
// works at all -- so sorting by price puts the models that CANNOT do the job
// at the top of the list.

describe("choosing the model here", () => {
  async function open() {
    mockApi();
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-change-model"));
    return screen.findByTestId("extractor-model-list");
  }

  it("shows each model's window and its price", async () => {
    const list = await open();
    expect(list.textContent).toMatch(/1\.0M/);
    expect(list.textContent).toMatch(/200k/);
    expect(list.textContent).toMatch(/\$/);
  });

  it("hides the models too small for this run, and says it did", async () => {
    // 400 entries sorted by a number the writer cannot use is a list, not a
    // choice. deepseek-chat holds 64k, which cannot take a 275,000-character
    // book -- so the plan here carries the real size rather than the small
    // default, or nothing would be too small to hide.
    mockApi({ "/api/extractor/plan": {
      ...PLAN,
      chapters: [{ chapter_id: "c-1", filename: "01.md", title: "One",
                   chars: 275535 }] } });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-change-model"));
    const list = await screen.findByTestId("extractor-model-list");
    await waitFor(() => expect(list.textContent).not.toMatch(/deepseek/));
    expect(screen.getByTestId("extractor-model-picker").textContent)
      .toMatch(/too small for this run are hidden/i);
  });

  it("finds a hidden model when the writer searches for it", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Search models"), "deepseek");
    await waitFor(() =>
      expect(screen.getByTestId("extractor-model-list").textContent)
        .toMatch(/deepseek/));
  });

  it("FLAGS REASONING MODELS, which is how the second run failed", async () => {
    // A reasoning model spends its reply budget thinking before it writes, and
    // can return an empty answer that looks exactly like having nothing to say.
    const list = await open();
    expect(list.textContent).toMatch(/reasoning/);
  });

  it("saves the choice as the app-wide role, not a private copy", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /gemini/i }));
    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/extractor/model")
                                && c.init?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init!.body)).model_id)
        .toBe("google/gemini-2.5-flash-lite");
    });
  });

  it("warns when the model already chosen cannot hold the run", async () => {
    mockApi({ "/api/extractor/plan": {
      ...PLAN,
      chapters: [{ chapter_id: "c-1", filename: "01.md", title: "One",
                   chars: 275535 }],
      model_id: "deepseek/deepseek-chat", context_tokens: 64000, fits: false } });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await waitFor(() =>
      expect(screen.getByTestId("extractor-model-too-small").textContent)
        .toMatch(/Pick a bigger one/i));
  });
});


// ── A RUN THAT ONLY COVERED PART OF THE BOOK ────────────────────────────────
//
// The fifth live run spent its entire reply budget and was cut off mid-word.
// The complete entries before the cut are now kept -- the writer paid for them
// -- and that creates a new way to mislead them: a partial result that looks
// exactly like a complete one.
//
// Twelve entries from a book with twenty in it is a successful-looking screen.
// They would work through it, tick it off, and never learn that their last four
// chapters produced nothing at all.

describe("a partial run", () => {
  const partial: ExtractionRun = {
    ...RUN,
    dropped: ["google/gemini-2.5-flash-lite ran out of room to reply after "
              + "32,000 tokens, so the answer was cut off part way through "
              + "your book. The 2 complete entries before the cut were kept. "
              + "Run it again over the later chapters to get the rest."],
  };

  it("SAYS the book was not fully covered, above the list", async () => {
    render(<ExtractorReview projectPath={PROJECT} run={partial}
                            onChanged={() => {}} onStartOver={() => {}} />);
    const notice = await screen.findByTestId("extractor-partial");
    expect(notice.textContent).toMatch(/did not cover your whole book/i);
    expect(notice.textContent).toMatch(/cut off part way/i);
    expect(notice.textContent).toMatch(/later chapters/i);
  });

  it("still shows the entries that did come back", async () => {
    render(<ExtractorReview projectPath={PROJECT} run={partial}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    expect(screen.getByRole("button", { name: /Rosie/ })).toBeTruthy();
  });

  it("says nothing of the sort on a clean run", async () => {
    // A warning that appears on healthy runs is one the writer learns to
    // ignore before the run where it matters.
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    expect(screen.queryByTestId("extractor-partial")).toBeNull();
  });
});


// -- WALKING A BOOK IN BATCHES -----------------------------------------------
//
// A novel cannot be answered in one reply -- measured on the writer's own book,
// where 44,227 input tokens produced more than 32,000 output tokens and was
// still cut off. So the book is split, one request per batch, and the results
// are merged into one list.
//
// The loop lives on the screen rather than inside one HTTP call on purpose. A
// ten-minute request that fails at minute nine loses everything; this keeps
// every batch that landed. Same rule Sweep.tsx follows.

describe("a book that needs more than one request", () => {
  const BOOK = {
    ...PLAN,
    chapters: [
      { chapter_id: "c-1", filename: "01.md", title: "One", chars: 90000 },
      { chapter_id: "c-2", filename: "02.md", title: "Two", chars: 90000 },
      { chapter_id: "c-3", filename: "03.md", title: "Three", chars: 90000 },
    ],
    batches: [["c-1"], ["c-2"], ["c-3"]],
    context_tokens: 1048576,
  };

  async function open(plan = BOOK) {
    mockApi({ "/api/extractor/plan": plan });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
  }

  function runCalls() {
    return calls
      .filter(c => c.url.includes("/api/extractor/run"))
      .map(c => JSON.parse(String(c.init?.body)));
  }

  /** A stub that answers every route this screen touches, with the run route
   *  under the test's control. The shared mockApi answers instantly, which is
   *  right for most tests and useless for the two below: one needs to observe
   *  a request in flight, the other needs a specific batch to fail. */
  function stubRoutes({ run }: { run: () => Promise<unknown> }) {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const ok = (payload: unknown) =>
        new Response(JSON.stringify(payload), { status: 200 });
      if (url.includes("/api/extractor/run")) {
        try {
          return ok(await run());
        } catch {
          return new Response(JSON.stringify({
            detail: { code: "unknown", message: "The provider timed out." },
          }), { status: 503 });
        }
      }
      if (url.includes("/api/extractor/models")) return ok({ models: [], error: "" });
      if (url.includes("/api/extractor/plan")) return ok(BOOK);
      return ok({});
    }));
  }


  it("says how many requests it will take, before the button", async () => {
    // Money again: three requests is three times the cost of one, and a writer
    // should know that before pressing rather than from their bill.
    await open();
    expect(body("extractor-summary")).toMatch(/3 requests/);
  });

  it("sends one request per batch, in reading order", async () => {
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => expect(runCalls().length).toBe(3));
    expect(runCalls().map(r => r.chapter_ids))
      .toEqual([["c-1"], ["c-2"], ["c-3"]]);
  });

  it("STARTS the run once and APPENDS the rest", async () => {
    // The distinction is what stops batch two wiping batch one, and what stops
    // the replace guard firing on the writer own work in progress.
    await open();
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => expect(runCalls().length).toBe(3));
    expect(runCalls().map(r => r.append)).toEqual([false, true, true]);
    expect(runCalls().map(r => r.batch_index)).toEqual([0, 1, 2]);
    expect(runCalls().every(r => r.batch_count === 3)).toBe(true);
  });

  it("says which part it is reading while it works", async () => {
    // One spinner for ten minutes is indistinguishable from a hang. The stub
    // holds each request open so the progress line exists to be read -- an
    // instant mock would finish the whole loop before anything rendered, and
    // the test would pass by never looking.
    let release = () => {};
    stubRoutes({
      run: async () => {
        await new Promise(resolve => { release = () => resolve(null); });
        return { run: RUN, progress: {}, dropped: [] };
      },
    });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-run"));

    await waitFor(() =>
      expect(body("extractor-progress-line")).toMatch(/part 1 of 3/i));
    expect(body("extractor-progress-line")).toMatch(/saved as it finishes/i);
    release();
  });

  it("only sends the batches the writer ticked", async () => {
    await open();
    // Untick chapters one and three: they should drop out of the batch list
    // entirely rather than being sent as empty requests.
    await userEvent.click(screen.getByRole("button", { name: "One" }));
    await userEvent.click(screen.getByRole("button", { name: "Three" }));
    await userEvent.click(screen.getByTestId("extractor-run"));
    await waitFor(() => expect(runCalls().length).toBe(1));
    expect(runCalls()[0].chapter_ids).toEqual(["c-2"]);
  });

  it("A FAILED BATCH KEEPS THE ONES THAT WORKED", async () => {
    // The whole reason the loop lives on the screen rather than inside one
    // request. Those batches are already saved on disk; the writer keeps what
    // they paid for and is told where it stopped.
    let seen = 0;
    stubRoutes({
      run: async () => {
        seen += 1;
        if (seen === 3) throw new Response(null, { status: 503 });
        return { run: RUN, progress: {}, dropped: [] };
      },
    });
    render(<ExtractorSetup projectPath={PROJECT} onExtracted={() => {}} />);
    await screen.findByTestId("extractor-setup");
    await userEvent.click(screen.getByTestId("extractor-run"));

    const notice = await screen.findByTestId("extractor-partial-run");
    expect(notice.textContent).toMatch(/Stopped after 2 of 3/i);
    expect(notice.textContent).toMatch(/is saved/i);
  });
});


// -- WHAT THE FIRST REAL REVIEW SESSION FOUND --------------------------------
//
// The pass landed well ("most of these trait entries were one to two liners
// that I could fold into existing traits. This is excellent"). Four things came
// out of actually working through it.

describe("folding a proposal into a trait you already have", () => {
  const withTraits = {
    ...ROSIE_THREAD,
    sections: {
      ...ROSIE_THREAD.sections,
      motivations: {
        heading: "Motivations", content: "",
        trait_blocks: [
          { trait: "Survival", description: "Will do what it takes to eat." },
          { trait: "Proving Herself", description: "Needs to be taken seriously." },
          { trait: "Seeking Purpose", description: "Wants the work to mean something." },
        ],
      },
    },
  };

  async function open() {
    mockApi({ "/api/codex/entity": withTraits });
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
  }

  it("SHOWS WHAT EACH TRAIT SAYS, not only its title", async () => {
    // Reported: five motivations called Survival, Proving Herself, Emulating
    // Resilience, Seeking Identity and Seeking Purpose are indistinguishable by
    // name. "I need the ability to see what is actually written and determine
    // which to fold into."
    await open();
    const traits = await screen.findByTestId("extractor-current-traits");
    expect(traits.textContent).toMatch(/Survival/);
    expect(traits.textContent).toMatch(/Will do what it takes to eat/);
    expect(traits.textContent).toMatch(/Needs to be taken seriously/);
  });

  it("carries the text into the fold-into picker too", async () => {
    // The column and the dropdown are read at different moments. A writer
    // choosing from the dropdown should not have to look away to know what
    // they are choosing.
    await open();
    const picker = await screen.findByTestId("extractor-merge-into");
    expect(picker.textContent).toMatch(/Survival -- Will do what it takes/);
  });

  it("clips a long description rather than making an unreadable option", async () => {
    mockApi({ "/api/codex/entity": {
      ...ROSIE_THREAD,
      sections: { ...ROSIE_THREAD.sections, motivations: {
        heading: "Motivations", content: "",
        trait_blocks: [{ trait: "Long one", description: "x".repeat(300) }],
      } },
    } });
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    const picker = await screen.findByTestId("extractor-merge-into");
    const option = picker.textContent ?? "";
    expect(option).toMatch(/\.\.\./);
    expect(option.length).toBeLessThan(200);
  });
});


describe("the profile you are working on", () => {
  it("IS RE-READ AFTER EVERY APPLY", async () => {
    // Reported: add a proposal as its own trait, then meet a second proposal
    // moments later that belongs with it -- and the trait just created was
    // missing from the fold-into list, because the column was fetched once
    // when the entry opened. It went stale exactly when the writer used it.
    mockApi();
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    const before = calls.filter(c => c.url.includes("/api/codex/entity")).length;

    await userEvent.click((await screen.findAllByTestId("extractor-merge"))[0]);

    await waitFor(() => {
      const after = calls.filter(c => c.url.includes("/api/codex/entity")).length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("is NOT re-read when a proposal was only thrown away", async () => {
    // Dismissing changes nothing on disk, so re-reading would be a request
    // that can only return what is already on screen.
    mockApi();
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    await waitFor(() =>
      expect(calls.some(c => c.url.includes("/api/codex/entity"))).toBe(true));
    const before = calls.filter(c => c.url.includes("/api/codex/entity")).length;

    await userEvent.click((await screen.findAllByTestId("extractor-dismiss"))[0]);
    await waitFor(() =>
      expect(screen.getAllByTestId("extractor-part-settled").length)
        .toBeGreaterThan(0));

    expect(calls.filter(c => c.url.includes("/api/codex/entity")).length)
      .toBe(before);
  });
});


describe("a described character who may already exist", () => {
  async function openTallMan() {
    mockApi({ "/api/codex/list": { threads: [
      { entity_id: "e-altas", type: "character", name: "Altas",
        filename: "altas.md", status: "active" },
      { entity_id: "e-tom", type: "character", name: "Tom the Barkeep",
        filename: "tom.md", status: "active" },
    ] } });
    render(<ExtractorReview projectPath={PROJECT} run={RUN}
                            onChanged={() => {}} onStartOver={() => {}} />);
    await screen.findByTestId("extractor-review");
    await userEvent.click(screen.getByRole("button", { name: /The tall man/ }));
  }

  it("says CREATE rather than add to", async () => {
    // Reported: "which btw doesn't make sense because we are technically
    // Creating the character, not adding TO the character."
    await openTallMan();
    expect(screen.getByTestId("extractor-create").textContent)
      .toMatch(/Create this character/i);
  });

  it("offers the other door: this is somebody I already have", async () => {
    // A described character is more often somebody the writer has under
    // another name than somebody new, so this cannot be buried.
    await openTallMan();
    expect(screen.getByTestId("extractor-who-is-this")).toBeTruthy();
  });

  it("OFFERS TWO ANSWERS AND NEVER GUESSES BETWEEN THEM", async () => {
    // The whole design. An alias is about WORDS; a tie is about THINGS.
    await openTallMan();
    await userEvent.click(screen.getByTestId("extractor-who-is-this"));
    const dialog = await screen.findByTestId("who-is-this-dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Altas/ }));

    const choices = await screen.findByTestId("who-is-this-choices");
    expect(choices.textContent).toMatch(/another way your book says/i);
    expect(choices.textContent).toMatch(/two people, and one is pretending/i);
  });

  it("says what folding two entries would COST", async () => {
    // Tom the Barkeep is a person with his own scenes and connections. Folding
    // him into Donald Morgan would delete a character the writer wrote, and
    // nothing would bring back what went with him.
    await openTallMan();
    await userEvent.click(screen.getByTestId("extractor-who-is-this"));
    const dialog = await screen.findByTestId("who-is-this-dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Altas/ }));
    const choices = screen.getByTestId("who-is-this-choices");
    expect(choices.textContent).toMatch(/still a barkeep/i);
    expect(choices.textContent).toMatch(/would delete one of them/i);
  });

  it("records the phrase as another name when they are one person", async () => {
    await openTallMan();
    await userEvent.click(screen.getByTestId("extractor-who-is-this"));
    const dialog = await screen.findByTestId("who-is-this-dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Altas/ }));
    await userEvent.click(screen.getByTestId("who-is-this-alias"));

    await waitFor(() => {
      const call = calls.find(c => c.url.includes("/api/codex/alias"));
      expect(call).toBeTruthy();
      const sent = JSON.parse(String(call!.init!.body));
      expect(sent.entity_id).toBe("e-altas");
      expect(sent.word).toBe("The tall man");
    });
  });

  it("hands a disguise to Connections rather than building a second way", async () => {
    // Two entries that relate is the Weave own job, it needs a reason line,
    // and a second place to record one is how an idea gets two vocabularies.
    await openTallMan();
    await userEvent.click(screen.getByTestId("extractor-who-is-this"));
    const dialog = await screen.findByTestId("who-is-this-dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Altas/ }));
    await userEvent.click(screen.getByTestId("who-is-this-connection"));

    const note = await screen.findByTestId("extractor-connect-note");
    expect(note.textContent).toMatch(/Both entries stay/i);
    expect(note.textContent).toMatch(/Connections/);
    expect(note.textContent).toMatch(/Nothing here has been changed/i);
  });
});
