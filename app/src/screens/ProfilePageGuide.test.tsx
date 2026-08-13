// ProfilePageGuide.test.tsx -- the page's own walkthrough
// ======================================================
// Asked for with the restructure: "We definitely need a Main 'WhatsThis'
// alongside the individual existing WhatsThis. Also a Show me how to do this
// full walkthrough first of the basics of each section. Then we can go into
// individual Show me how to do this subsections."
//
// The word doing the work is FIRST. This is the walkthrough a writer meets
// before any of the others, so what it must NOT do is teach importance weights,
// subtext, frames and reveal points -- that is the wall of information the
// restructure exists to remove. It says what each part is for, in the order the
// page puts them, and hands off.
//
// Navigation goes by page TITLE rather than by counting clicks, the convention
// the audiobook tutorial's tests settled on: a count breaks the moment a page is
// inserted in the middle.

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfilePageGuide, PROFILE_PAGE_GUIDE_TITLES } from "./ProfilePageGuide";
import { EXPLAIN } from "../components/learn/explanations";

afterEach(cleanup);

function openGuide() {
  const onClose = vi.fn();
  render(<ProfilePageGuide onClose={onClose} />);
  return { onClose };
}

async function goTo(title: string) {
  if (!screen.queryByTestId("profile-page-guide")) openGuide();
  for (let i = 0; i < PROFILE_PAGE_GUIDE_TITLES.length; i++) {
    if (screen.getByRole("dialog").querySelector("h2")?.textContent === title) return;
    const next = screen.queryByRole("button", { name: /Next/ });
    if (!next) break;
    await userEvent.click(next);
  }
  throw new Error(`never reached the page titled "${title}"`);
}


describe("the shape", () => {
  it("is paged and says how much is left", () => {
    openGuide();
    expect(screen.getByText(`Page 1 of ${PROFILE_PAGE_GUIDE_TITLES.length}`))
      .toBeTruthy();
  });

  it("opens with the whole page in order, before any part of it", async () => {
    // Trunk before branches, in the walkthrough as well as on the page.
    openGuide();
    const dialog = screen.getByTestId("profile-page-guide");
    const items = within(dialog).getAllByRole("listitem").map(li => li.textContent ?? "");
    expect(items[0]).toContain("basics");
    expect(items[1]).toContain("How this changes");
    expect(items[2]).toContain("Connections");
    expect(items[3]).toContain("Overview");
    expect(items[4]).toContain("Traits");
  });

  it("has a page for each part of the page", async () => {
    for (const title of ["The basics", "How this changes through the story",
                         "Connections", "Overview", "Traits"]) {
      expect(PROFILE_PAGE_GUIDE_TITLES).toContain(title);
    }
  });
});


describe("what it says", () => {
  it("tells the writer age is written however they say it", async () => {
    // The field most likely to be misread as a number box.
    await goTo("The basics");
    const dialog = screen.getByTestId("profile-page-guide");
    expect(within(dialog).getByText(/18 months/)).toBeTruthy();
    expect(within(dialog).getByText(/not a number field/)).toBeTruthy();
  });

  it("says why Overview sits where it does", async () => {
    // The writer moved it there themselves: who somebody IS reads better once
    // you know who they are TO people.
    await goTo("Overview");
    expect(within(screen.getByTestId("profile-page-guide"))
      .getByText(/after Connections on purpose/)).toBeTruthy();
  });

  it("says an empty Overview is what Frayed means", async () => {
    // The one section the app checks for, which nothing on the page says.
    await goTo("Overview");
    expect(within(screen.getByTestId("profile-page-guide"))
      .getByText(/Frayed/)).toBeTruthy();
  });

  it("hands off rather than teaching weights and secrecy here", async () => {
    // The restraint that makes it a FIRST walkthrough. It names the two
    // questions and points at the guide that answers them.
    await goTo("Traits");
    const dialog = screen.getByTestId("profile-page-guide");
    expect(within(dialog).getByText(/own walkthrough/)).toBeTruthy();
  });

  it("ends by saying where to stop, not only where to start", async () => {
    // A page this long reads as a list of obligations unless something says
    // otherwise. A name and one line is a real entry.
    await goTo("Where to start, and where to stop");
    const dialog = screen.getByTestId("profile-page-guide");
    expect(within(dialog).getByText(/is a real entry/)).toBeTruthy();
    expect(within(dialog).getByText(/nothing nags you/)).toBeTruthy();
  });

  it("never uses an em dash", async () => {
    for (const title of PROFILE_PAGE_GUIDE_TITLES) {
      cleanup();
      await goTo(title);
      expect(screen.getByTestId("profile-page-guide").textContent ?? "")
        .not.toMatch(/[–—]/);
    }
  });
});


describe("the page's own What's this?", () => {
  it("exists and answers the four questions", () => {
    const entry = EXPLAIN["profile.page"];
    expect(entry).toBeTruthy();
    expect(entry.what).toBeTruthy();
    expect(entry.why).toBeTruthy();
    expect(entry.needed).toBeTruthy();
    expect(entry.cost).toBeTruthy();
  });

  it("says a name and one line is enough", () => {
    // The single most useful thing to tell somebody opening a page with five
    // sections on it.
    expect(EXPLAIN["profile.page"].why).toMatch(/one line is already a real entry/);
  });

  it("is offered from the page, beside its title", () => {
    const SOURCES = import.meta.glob("./ProfileBuilder.tsx",
      { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const builder = Object.values(SOURCES)[0];
    expect(builder).toMatch(/<Explain of="profile\.page"/);
    expect(builder).toMatch(/Show me how this page works/);
    expect(builder).toMatch(/<ProfilePageGuide/);
  });
});
