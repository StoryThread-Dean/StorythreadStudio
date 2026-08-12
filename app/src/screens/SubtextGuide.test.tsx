// SubtextGuide.test.tsx + SecretsPanel -- teaching what a secret trait does
// =========================================================================
// The writer's specification for this walkthrough, near enough verbatim: pages
// 1 to N of exactly how Core through Background works on a hidden trait, with a
// real case from popular fiction, showing how the system interprets the weight
// and how it lands through Enhance, through Smart Advisor's context check, and
// through Draft -- "what it is, how it works, examples of how it works and the
// end results of different path choices from importance selections."
//
// So these tests check that the guide actually does those things, rather than
// that a dialog opens. A walkthrough that defines the setting and stops is the
// thing this was asked to replace.
//
// Navigation goes by page TITLE, never by counting clicks -- the convention the
// audiobook tutorial's tests settled on, because a count breaks the moment a
// page is inserted in the middle.

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubtextGuide, SUBTEXT_GUIDE_TITLES } from "./SubtextGuide";
import { SecretsPanel } from "./SecretsPanel";
import type { Profile } from "../types/profile";

afterEach(cleanup);

async function openGuide() {
  const onClose = vi.fn();
  render(<SubtextGuide onClose={onClose} />);
  return { onClose, dialog: screen.getByTestId("subtext-guide") };
}

/** Walk forward to a page by its title, opening the guide if it is not open. */
async function goTo(title: string) {
  if (!screen.queryByTestId("subtext-guide")) await openGuide();
  for (let i = 0; i < SUBTEXT_GUIDE_TITLES.length; i++) {
    const heading = screen.getByRole("dialog").querySelector("h2");
    if (heading?.textContent === title) return;
    const next = screen.queryByRole("button", { name: /Next/ });
    if (!next) break;
    await userEvent.click(next);
  }
  throw new Error(`never reached the page titled "${title}"`);
}


describe("the guide's shape", () => {
  it("is paged, and says which page you are on", async () => {
    // "starting at a Page 1 to N" -- a writer partway through a long
    // explanation needs to know how much is left.
    await openGuide();
    expect(screen.getByText(`Page 1 of ${SUBTEXT_GUIDE_TITLES.length}`)).toBeTruthy();
    expect(SUBTEXT_GUIDE_TITLES.length).toBeGreaterThanOrEqual(8);
  });

  it("cannot go back from the first page, and ends with Done", async () => {
    await openGuide();
    expect(screen.getByRole("button", { name: /Back/ })).toHaveProperty("disabled", true);
    for (const _ of SUBTEXT_GUIDE_TITLES.slice(0, -1)) {
      await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("closes from Done and from the backdrop", async () => {
    const { onClose } = await openGuide();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});


describe("what it teaches", () => {
  it("opens by separating the two questions rather than defining a field", async () => {
    // The whole reason the split happened. A writer who leaves thinking secrecy
    // is a low importance has learned the thing that was wrong before.
    await openGuide();
    const dialog = screen.getByTestId("subtext-guide");
    expect(within(dialog).getByText(/How much does this shape them/)).toBeTruthy();
    expect(within(dialog).getByText(/May it be said out loud/)).toBeTruthy();
  });

  it("uses a character whose surface and hidden layer are both well known", async () => {
    await goTo("The example: a man whose reasons are never stated");
    const dialog = screen.getByTestId("subtext-guide");
    expect(within(dialog).getByText(/Snape/)).toBeTruthy();
    // And it says the prose is the app's, not the book's.
    expect(within(dialog).getByText(/None of it is quoted/)).toBeTruthy();
  });

  it("gives every weight its own page, with what AI receives and a passage", async () => {
    // "exactly how the Importance Core through Background works on Hidden".
    for (const title of ["Core, and secret", "Present, and secret",
                         "Background, and secret"]) {
      cleanup();
      await openGuide();
      await goTo(title);
      const dialog = screen.getByTestId("subtext-guide");
      // The line the model actually gets, marked SUBTEXT beside its weight.
      expect(within(dialog).getByText(/SUBTEXT\]/)).toBeTruthy();
      // And a worked passage, labelled as an example.
      expect(within(dialog).getByText(/written from that trait/i)).toBeTruthy();
    }
  });

  it("shows the END RESULT of each weight on one identical scene", async () => {
    // "the end results of different path choices from importance selections" --
    // the page that makes the choice concrete rather than described.
    await goTo("The same secret at three weights");
    const dialog = screen.getByTestId("subtext-guide");
    for (const label of ["Core", "Present", "Background"]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    expect(within(dialog).getByText(/the same scene/i)).toBeTruthy();
  });

  it("walks the three features the writer named", async () => {
    // Smart Advisor has its own test below, for the rule that is specific to it.
    for (const [title, wanted] of [
      ["In a Draft", /never state it/i],
      ["In an Enhance pass", /paragraph you wrote/i],
    ] as const) {
      cleanup();
      await openGuide();
      await goTo(title);
      expect(within(screen.getByTestId("subtext-guide")).getByText(wanted)).toBeTruthy();
    }
  });

  it("explains that feedback may name a secret but prose may not", async () => {
    // The distinction that was backwards until this pass, and the one a writer
    // is most likely to be surprised by.
    await goTo("In Smart Advisor's context check");
    const dialog = screen.getByTestId("subtext-guide");
    expect(within(dialog).getByText(/may name/i)).toBeTruthy();
    expect(within(dialog).getByText(/still bound by the rule/i)).toBeTruthy();
  });

  it("shows what turning it off produces, not just that it can be turned off", async () => {
    await goTo("What happens if you turn it off");
    const dialog = screen.getByTestId("subtext-guide");
    expect(within(dialog).getByText(/secret OFF/i)).toBeTruthy();
  });

  it("keeps a secret apart from a timed reveal", async () => {
    // Two different jobs, and conflating them is what made "hidden" mean three
    // things. A reveal is a fact with a chapter, on the Run.
    await goTo("A secret is not the same as a reveal");
    const dialog = screen.getByTestId("subtext-guide");
    expect(within(dialog).getByText(/Run/)).toBeTruthy();
  });

  it("never uses an em dash, anywhere in it", async () => {
    // The locked product rule, over every page rather than the first.
    for (const title of SUBTEXT_GUIDE_TITLES) {
      cleanup();
      await openGuide();
      await goTo(title);
      const text = screen.getByTestId("subtext-guide").textContent ?? "";
      expect(text).not.toMatch(/[–—]/);
    }
  });
});


// ── The panel that groups them ───────────────────────────────────────────────

function profileWith(blocks: Profile["sections"][string]["trait_blocks"]): Profile {
  return {
    entity_id: "e-1", type: "character", name: "Snape", role: "", status: "active",
    tags: [], filename: "snape.md", full_ai_summary: "", created_at: "",
    updated_at: "", character_kind: "main",
    sections: {
      motivations: { content: "", ai_summary: "", trait_blocks: blocks },
      overview: { content: "Teaches potions.", ai_summary: "", trait_blocks: [] },
    },
  };
}

describe("the secrets panel", () => {
  const secret = {
    id: "a", trait: "guilt over her death", description: "He gave her away.",
    importance: "present" as const, subtext: true,
  };

  it("says nothing at all when there are no secrets", () => {
    render(<SecretsPanel profile={profileWith([
      { id: "b", trait: "sarcastic", description: "Always.", importance: "core" },
    ])} onSetWeight={vi.fn()} />);
    expect(screen.queryByTestId("secrets-panel")).toBeNull();
  });

  it("lists each secret with the section it lives in", () => {
    // The grouping the writer asked for, WITHOUT moving anything: a secret
    // belongs beside what it explains.
    render(<SecretsPanel profile={profileWith([secret])} onSetWeight={vi.fn()} />);
    const panel = screen.getByTestId("secrets-panel");
    expect(within(panel).getByText("guilt over her death")).toBeTruthy();
    expect(within(panel).getByText("Motivations")).toBeTruthy();
  });

  it("lets a weight be corrected from here, because the old data has none", () => {
    // Everything written before the split reads as Present, since the single
    // setting never recorded a weight. Some of those are Core. This turns an
    // invisible wrong default into a short, finite job.
    const onSetWeight = vi.fn();
    render(<SecretsPanel profile={profileWith([secret])} onSetWeight={onSetWeight} />);
    expect(screen.getByText(/reads as Present/)).toBeTruthy();
  });

  it("offers the walkthrough from where the secrets are", async () => {
    render(<SecretsPanel profile={profileWith([secret])} onSetWeight={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Show me how this works/ }));
    expect(screen.getByTestId("subtext-guide")).toBeTruthy();
  });
});
