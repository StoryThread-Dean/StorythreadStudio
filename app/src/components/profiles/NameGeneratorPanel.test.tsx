// NameGeneratorPanel.test.tsx
// ============================
// The generator panel's contract: dropdown carries region optgroups plus
// Fantasy, the era select hides for races, chips deal 6+6, PARTIAL accept
// works (given-only or surname-only is a valid pick), and the fallback
// note shows when the backend served a substitute era.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NameGeneratorPanel } from "./NameGeneratorPanel";

const CULTURES_RESPONSE = {
  cultures: [
    { id: "british", label: "British", region: "Europe" },
    { id: "japanese", label: "Japanese", region: "Asia" },
  ],
  eras: [
    { id: "medieval", label: "Medieval / Renaissance (pre-1700)" },
    { id: "colonial", label: "Colonial / Victorian (1700-1900)" },
  ],
};

const GIVEN_POOL = ["Geoffrey", "Alys", "Cecily", "Rowan", "Edmund", "Maud", "Hugh", "Petra"];
const SURNAME_POOL = ["Ashworth", "Fletcher", "Hartley", "Bellamy", "Croft", "Winslow", "Marsh"];

function mockFetch(usedEra = "medieval") {
  return vi.fn(async (url: string) => {
    const body = url.includes("/cultures")
      ? CULTURES_RESPONSE
      : url.includes("kind=given")
      ? { names: GIVEN_POOL, used_era: usedEra }
      : { names: SURNAME_POOL, used_era: usedEra };
    return { json: async () => body } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  // globals: false -- RTL's auto-cleanup can't hook vitest's afterEach.
  cleanup();
  vi.unstubAllGlobals();
});

async function pickBritish() {
  const [cultureSelect] = screen.getAllByRole("combobox");
  fireEvent.change(cultureSelect, { target: { value: "c:british" } });
  await waitFor(() => expect(screen.getByText("Given names")).toBeTruthy());
}

describe("NameGeneratorPanel", () => {
  it("renders region optgroups plus Fantasy", async () => {
    render(<NameGeneratorPanel onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    const groups = document.querySelectorAll("optgroup");
    const labels = [...groups].map(g => g.getAttribute("label"));
    expect(labels).toContain("Europe");
    expect(labels).toContain("Asia");
    expect(labels).toContain("Fantasy");
  });

  it("deals 6 given chips and 6 surname chips for a culture", async () => {
    render(<NameGeneratorPanel onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    await pickBritish();
    // 6 given + 6 surname chips (pools are big enough here).
    for (const name of GIVEN_POOL.slice(0, 0)) void name; // (chips are a random subset)
    const chips = document.querySelectorAll("button.rounded-full");
    expect(chips.length).toBe(12);
  });

  it("partial accept: a given name alone enables Use and fires onPick", async () => {
    const onPick = vi.fn();
    render(<NameGeneratorPanel onPick={onPick} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    await pickBritish();

    const chips = [...document.querySelectorAll("button.rounded-full")];
    const givenChip = chips.find(c => GIVEN_POOL.includes(c.textContent ?? ""))!;
    fireEvent.click(givenChip);

    const useButton = screen.getByText("Use this name") as HTMLButtonElement;
    expect(useButton.disabled).toBe(false);
    fireEvent.click(useButton);
    expect(onPick).toHaveBeenCalledWith(givenChip.textContent);
  });

  it("partial accept: a surname alone also works", async () => {
    const onPick = vi.fn();
    render(<NameGeneratorPanel onPick={onPick} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    await pickBritish();

    const chips = [...document.querySelectorAll("button.rounded-full")];
    const surnameChip = chips.find(c => SURNAME_POOL.includes(c.textContent ?? ""))!;
    fireEvent.click(surnameChip);
    fireEvent.click(screen.getByText("Use this name"));
    expect(onPick).toHaveBeenCalledWith(surnameChip.textContent);
  });

  it("composes given + surname into a full name", async () => {
    const onPick = vi.fn();
    render(<NameGeneratorPanel onPick={onPick} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    await pickBritish();

    const chips = [...document.querySelectorAll("button.rounded-full")];
    const givenChip = chips.find(c => GIVEN_POOL.includes(c.textContent ?? ""))!;
    const surnameChip = chips.find(c => SURNAME_POOL.includes(c.textContent ?? ""))!;
    fireEvent.click(givenChip);
    fireEvent.click(surnameChip);
    fireEvent.click(screen.getByText("Use this name"));
    expect(onPick).toHaveBeenCalledWith(`${givenChip.textContent} ${surnameChip.textContent}`);
  });

  it("hides the era select for fantasy races and still deals names", async () => {
    render(<NameGeneratorPanel onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    const [cultureSelect] = screen.getAllByRole("combobox");
    fireEvent.change(cultureSelect, { target: { value: "f:dark_elf" } });

    await waitFor(() => expect(screen.getByText("Given names")).toBeTruthy());
    // Era select gone: only the culture + gender selects remain.
    expect(screen.getAllByRole("combobox").length).toBe(2);
    const chips = document.querySelectorAll("button.rounded-full");
    expect(chips.length).toBe(12);
  });

  it("fantasy rerolls are row-independent (given reroll leaves surnames alone)", async () => {
    render(<NameGeneratorPanel onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());
    const [cultureSelect] = screen.getAllByRole("combobox");
    fireEvent.change(cultureSelect, { target: { value: "f:orc" } });
    await waitFor(() => expect(screen.getByText("Given names")).toBeTruthy());

    const surnamesBefore = [...document.querySelectorAll("button.rounded-full")]
      .map(c => c.textContent)
      .slice(6);  // chips render given row first, surname row second

    fireEvent.click(screen.getByTitle("Reroll given names"));

    const surnamesAfter = [...document.querySelectorAll("button.rounded-full")]
      .map(c => c.textContent)
      .slice(6);
    // Rerolling the given row must not reshuffle the surnames the writer
    // is still considering.
    expect(surnamesAfter).toEqual(surnamesBefore);
  });

  it("shows the fallback note when the backend substituted the era", async () => {
    vi.stubGlobal("fetch", mockFetch("colonial"));
    render(<NameGeneratorPanel onPick={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("British")).toBeTruthy());

    const [cultureSelect] = screen.getAllByRole("combobox");
    fireEvent.change(cultureSelect, { target: { value: "c:british" } });
    await waitFor(() => expect(screen.getByText("Given names")).toBeTruthy());
    // Request medieval; the mock says colonial was served.
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "medieval" } });
    await waitFor(() =>
      expect(screen.getByText(/closest available/)).toBeTruthy(),
    );
  });
});
