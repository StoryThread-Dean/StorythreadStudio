// ProjectCompletionGauge.test.tsx
// ================================
// Component tests for the Writing Progress gauge.
//
// Strategy: mock `fetch` globally so we don't need a running backend.
// The mocks return canned responses that match the shapes returned by
// GET /api/progress/summary and GET /api/progress/daily.
//
// We use @testing-library/react's `render` + `screen` to query the DOM
// the way a user would -- by visible text, role, and title attributes.
// `findBy*` queries are async (wait up to 1s for async state updates),
// which lets us test the "fetch resolves → re-render" cycle naturally.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectCompletionGauge } from "./ProjectCompletionGauge";
import type { ProgressSummary, ProgressDaily } from "../../types/progress";


// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_SUMMARY: ProgressSummary = {
  story_type: "novel",
  is_serial: false,
  percent: 40.0,
  manuscript: {
    actual_words: 36_000,
    target_words:  90_000,
    chapter_count: 12,
    weight: 100,
  },
  outline: {
    present: false,
    has_frontmatter: false,
    weight: 0,
  },
  profiles: {
    weight: 0,
    subsegments: [],
  },
  notes: {
    present: false,
    file_count: 0,
    weight: 0,
  },
};

// 7-day sparkline: 6 empty days + today with some words
const makeSparks = (todayDate: string) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - (6 - i));
    return {
      local_date: d.toISOString().slice(0, 10),
      words: i === 6 ? 800 : 0,
      tasks: 0,
      hit: false,
    };
  });

const MOCK_DAILY: ProgressDaily = {
  skill_level:      "novice",
  word_target:      1_250,
  task_target:      2,
  rollover_hour:    0,
  today_local_date: "2026-05-15",
  today_words:      800,
  today_tasks:      [],
  sparkline_7day:   makeSparks("2026-05-15"),
};


// ── Fetch mock helpers ───────────────────────────────────────────────────────

function mockFetch(summaryOverride?: Partial<ProgressSummary>) {
  const summary = { ...MOCK_SUMMARY, ...summaryOverride };
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes("/summary")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summary) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_DAILY) });
  }));
}


// ── Tests ────────────────────────────────────────────────────────────────────

describe("ProjectCompletionGauge", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    // globals: false means testing-library's auto-cleanup can't hook into
    // vitest's afterEach. Call cleanup() manually so each test starts with
    // a fresh DOM and no leaked rendered components.
    cleanup();
    vi.unstubAllGlobals();
  });


  it("renders the compact bar with the loaded percentage", async () => {
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={false}
        onToggle={() => undefined}
      />
    );
    // "40%" comes from MOCK_SUMMARY.percent (40.0).toFixed(0)
    expect(await screen.findByText("40%")).toBeTruthy();
  });


  it("shows Progress label in the compact bar", async () => {
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={false}
        onToggle={() => undefined}
      />
    );
    expect(await screen.findByText("Progress")).toBeTruthy();
  });


  it("shows slide-over header when isOpen=true", async () => {
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={true}
        onToggle={() => undefined}
      />
    );
    // "Writing Progress" is the slide-over header text rendered immediately.
    expect(await screen.findByText("Writing Progress")).toBeTruthy();
  });


  it("shows Manuscript segment in slide-over after fetch resolves", async () => {
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={true}
        onToggle={() => undefined}
      />
    );
    expect(await screen.findByText("Manuscript")).toBeTruthy();
  });


  it("renders serial placeholder for serial_fiction projects", async () => {
    mockFetch({ story_type: "serial_fiction", is_serial: true });
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={true}
        onToggle={() => undefined}
      />
    );
    expect(await screen.findByText("Serial fiction")).toBeTruthy();
  });


  it("shows 'serial' label instead of percentage in compact bar for serial fiction", async () => {
    mockFetch({ story_type: "serial_fiction", is_serial: true });
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={false}
        onToggle={() => undefined}
      />
    );
    expect(await screen.findByText("serial")).toBeTruthy();
  });


  it("calls onToggle when the compact bar button is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ProjectCompletionGauge
        projectPath="/fake/project"
        isOpen={false}
        onToggle={onToggle}
      />
    );
    // The compact bar is a single <button>. Click it.
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
