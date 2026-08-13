// components/settings/ModelRolesSection.test.tsx
// ===============================================
// The Model Roles screen is where a writer decides which model does which
// kind of work. Eight roles have to fit in a settings modal, so rows are
// collapsed to one line by default and only the row being worked on shows
// its explanation and controls.
//
// Four things it must never do, each pinned below:
//
//   1. Bury the list under prose. Collapsed rows stay one line; the long
//      explanation is behind "What's this?".
//   2. Show a picker without saying what it affects. The expanded row lists
//      the features that use the role.
//   3. Show a picker that silently does nothing. Roles no feature uses yet
//      are marked reserved and say so.
//   4. Let a broken assignment look fine. An assigned role with no key does
//      NOT fall back to another model (see backend/app/ai/roles.py), so if
//      this screen stays quiet the writer only finds out when the feature
//      fails later with no explanation.

import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRolesSection, type RoleInfo } from "./ModelRolesSection";
import type { ModelInfo } from "../../types/ai";

afterEach(() => {
  // globals: false means testing-library's auto-cleanup can't hook into
  // vitest's afterEach -- call cleanup() manually so each test starts with
  // an empty DOM (see ProviderPanel.test.tsx, same reason).
  cleanup();
});

const ROLES: RoleInfo[] = [
  {
    id: "critique", label: "Critique",
    blurb: "Reading your work and telling you what is not landing.",
    detail: "Critique reads what you have already written and reports back. "
          + "This is the role where model quality shows most obviously.",
    features: ["Smart Advisor pass", "Chapter summaries"],
    reserved: false, reserved_note: "",
  },
  {
    id: "prose", label: "Prose",
    blurb: "Actually writing sentences.",
    detail: "Prose is the only role that writes sentences you might keep, "
          + "which makes it the most style-sensitive choice on this screen.",
    features: ["Draft mode", "Enhance mode"],
    reserved: false, reserved_note: "",
  },
  {
    id: "long_context", label: "Long-context analysis",
    blurb: "Taking in a whole manuscript at once.",
    detail: "Some questions cannot be answered from one chapter.",
    features: [],
    reserved: true,
    reserved_note: "Nothing uses this yet. It arrives with the Weave.",
  },
];

function model(id: string, name: string, cost: number, free = false): ModelInfo {
  return {
    id, name, context_length: 8000,
    cost_input_per_million: cost, cost_output_per_million: cost,
    output_modalities: ["text"], is_free: free,
    is_moderated: false, supports_reasoning: false,
  };
}

// Real curated ids, so recommendedPicks() actually matches them.
const CATALOG: ModelInfo[] = [
  model("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B (free)", 0, true),
  model("mistralai/mistral-nemo", "Mistral Nemo", 0.15),
  model("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", 1.0),
  model("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", 3.0),
  model("anthropic/claude-opus-4.8", "Claude Opus 4.8", 20.0),
  model("some/uncurated-model", "Uncurated Model", 2.0),
];

function renderSection(overrides: Partial<Parameters<typeof ModelRolesSection>[0]> = {}) {
  const onChange = vi.fn();
  const onNeedModels = vi.fn();
  render(
    <ModelRolesSection
      roles={ROLES}
      loadingRoles={false}
      value={{}}
      onChange={onChange}
      defaultModel="openai/gpt-4o-mini"
      providerReady={{ openrouter: true, nanogpt: false, local: false }}
      modelsByProvider={{ openrouter: CATALOG }}
      onNeedModels={onNeedModels}
      promptCaching={false}
      {...overrides}
    />
  );
  return { onChange, onNeedModels };
}

/** Open one role's row. */
async function expand(label: string) {
  await userEvent.click(screen.getByRole("button", { name: `${label} settings` }));
}


describe("the collapsed list", () => {
  it("shows every role on one line without expanding anything", () => {
    renderSection();
    expect(screen.getByText("Critique")).toBeTruthy();
    expect(screen.getByText("Prose")).toBeTruthy();
    expect(screen.getByText("Long-context analysis")).toBeTruthy();
  });

  it("keeps the long explanation out of the way until asked", () => {
    // Eight roles' worth of prose would bury the list this screen exists to
    // present. The blurb shows; the detail does not.
    renderSection();
    expect(screen.getByText(/telling you what is not landing/)).toBeTruthy();
    expect(screen.queryByText(/model quality shows most obviously/)).toBeNull();
  });

  it("offers no source or model picker while collapsed", () => {
    renderSection();
    expect(screen.queryByLabelText("Critique provider")).toBeNull();
    expect(screen.queryByLabelText("Critique model")).toBeNull();
  });

  it("names the current choice on the row itself", () => {
    renderSection({
      value: { prose: { provider: "openrouter", model: "anthropic/claude-opus-4.8" } },
    });
    expect(screen.getByTestId("role-summary-prose").textContent)
      .toContain("anthropic/claude-opus-4.8");
    // Unassigned rows say what they fall back to, in the same place.
    expect(screen.getByTestId("role-summary-critique").textContent)
      .toContain("Use Default Model");
  });

  it("opens only one row at a time", async () => {
    // A modal has limited height: two open rows push the rest off screen,
    // which is the problem this layout solves.
    renderSection();
    await expand("Critique");
    expect(screen.getByLabelText("Critique provider")).toBeTruthy();
    await expand("Prose");
    expect(screen.queryByLabelText("Critique provider")).toBeNull();
    expect(screen.getByLabelText("Prose provider")).toBeTruthy();
  });

  it("says which model unassigned roles fall back to", () => {
    renderSection();
    expect(screen.getByText(/openai\/gpt-4o-mini/)).toBeTruthy();
  });
});


describe("an expanded row", () => {
  it("explains the job in more than the one line already on the row", async () => {
    renderSection();
    await expand("Critique");
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/model quality shows most obviously/)).toBeTruthy();
  });

  it("names the features that use the role", async () => {
    // Without this the writer is choosing a model for a word, not for work.
    renderSection();
    await expand("Critique");
    await userEvent.click(screen.getByRole("button", { name: /what's this/i }));
    expect(screen.getByText(/Smart Advisor pass/)).toBeTruthy();
  });
});


describe("roles nothing uses yet", () => {
  it("says so on the collapsed row instead of showing a blurb", () => {
    renderSection();
    expect(screen.getByText(/Nothing uses this yet/)).toBeTruthy();
  });

  it("still opens, so the shape of the system is visible", async () => {
    renderSection();
    await expand("Long-context analysis");
    expect(screen.getByLabelText("Long-context analysis provider")).toBeTruthy();
  });
});


describe("choosing a source", () => {
  it("greys out a source that is not connected", async () => {
    renderSection();
    await expand("Prose");
    const select = screen.getByLabelText("Prose provider");
    const nanogpt = within(select).getByRole("option", { name: /NanoGPT/ }) as HTMLOptionElement;
    const openrouter = within(select).getByRole("option", { name: /^OpenRouter/ }) as HTMLOptionElement;
    expect(nanogpt.disabled).toBe(true);
    expect(openrouter.disabled).toBe(false);
  });

  it("says WHY a greyed-out source is unavailable rather than just dimming it", async () => {
    renderSection();
    await expand("Prose");
    const select = screen.getByLabelText("Prose provider");
    expect(within(select).getByRole("option", { name: /NanoGPT -- not connected/ })).toBeTruthy();
  });

  it("asks for that service's catalog when a source is picked", async () => {
    const { onNeedModels } = renderSection();
    await expand("Prose");
    await userEvent.selectOptions(screen.getByLabelText("Prose provider"), "openrouter");
    expect(onNeedModels).toHaveBeenCalledWith("openrouter");
  });

  it("clears the model when the source changes", async () => {
    // Catalogs do not overlap, so keeping the old id would leave a selection
    // that cannot resolve on the new service.
    const { onChange } = renderSection({
      value: { prose: { provider: "openrouter", model: "anthropic/claude-opus-4.8" } },
    });
    await expand("Prose");
    await userEvent.selectOptions(screen.getByLabelText("Prose provider"), "");
    expect(onChange).toHaveBeenCalledWith({});
  });
});


describe("the model list", () => {
  it("puts a short recommended group at the top, labelled by price", async () => {
    renderSection({ value: { prose: { provider: "openrouter", model: "" } } });
    await expand("Prose");
    const select = screen.getByLabelText("Prose model");
    const groups = within(select).getAllByRole("group");
    expect(groups[0].getAttribute("label")).toBe("Recommended");
    // The price bucket IS the recommendation's context -- no notes needed.
    expect(groups[0].textContent).toMatch(/Free/);
    expect(groups[0].textContent).toMatch(/Priority Best/);
  });

  it("keeps the recommended list short", async () => {
    renderSection({ value: { prose: { provider: "openrouter", model: "" } } });
    await expand("Prose");
    const groups = within(screen.getByLabelText("Prose model")).getAllByRole("group");
    const count = within(groups[0] as HTMLElement).getAllByRole("option").length;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(7);
  });

  it("does not repeat a recommended model in the full list", async () => {
    renderSection({ value: { prose: { provider: "openrouter", model: "" } } });
    await expand("Prose");
    const select = screen.getByLabelText("Prose model");
    const values = within(select).getAllByRole("option")
      .map(o => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(new Set(values).size).toBe(values.length);
  });

  it("still offers models that are not on the curated list", async () => {
    renderSection({ value: { prose: { provider: "openrouter", model: "" } } });
    await expand("Prose");
    expect(within(screen.getByLabelText("Prose model"))
      .getByRole("option", { name: "Uncurated Model" })).toBeTruthy();
  });

  it("falls back to free text when the catalog could not be loaded", async () => {
    // A missing key or an unreachable local server should not block a writer
    // who already knows the model id.
    renderSection({
      value: { prose: { provider: "nanogpt", model: "" } },
      modelsByProvider: { nanogpt: [] },
    });
    await expand("Prose");
    const field = screen.getByLabelText("Prose model") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
  });
});


describe("an assignment that cannot run", () => {
  it("warns, because the role will refuse rather than substitute", async () => {
    renderSection({
      value: { prose: { provider: "nanogpt", model: "some/model" } },
      providerReady: { openrouter: true, nanogpt: false, local: false },
    });
    await expand("Prose");
    const warning = screen.getByTestId("role-warning-prose");
    expect(warning.textContent).toMatch(/no key connected/i);
    // The point of the warning: it will NOT quietly use another model.
    expect(warning.textContent).toMatch(/refuse/i);
  });

  it("flags the collapsed row too, so it is visible without opening it", () => {
    renderSection({
      value: { prose: { provider: "nanogpt", model: "some/model" } },
      providerReady: { openrouter: true, nanogpt: false, local: false },
    });
    // The row carries a warning icon; without it a broken assignment would
    // be invisible in a list that is collapsed by default.
    const row = screen.getByTestId("role-row-prose");
    expect(row.querySelector("svg.text-amber-400")).toBeTruthy();
  });

  it("stays quiet for an assignment that works", async () => {
    renderSection({
      value: { prose: { provider: "openrouter", model: "anthropic/claude-opus-4.8" } },
    });
    await expand("Prose");
    expect(screen.queryByTestId("role-warning-prose")).toBeNull();
  });

  it("does not warn about a role that is merely unassigned", () => {
    // Unassigned is the normal, supported state -- it uses the Default Model.
    renderSection();
    expect(screen.queryByTestId("role-warning-critique")).toBeNull();
  });
});


describe("loading", () => {
  it("says it is loading rather than showing an empty list of jobs", () => {
    renderSection({ loadingRoles: true, roles: [] });
    expect(screen.getByText(/loading roles/i)).toBeTruthy();
  });
});


// ── R8.7: the caching caveat, which was computed and never shown ────────────
//
// The backend has set a `caveat` on exactly this condition since Model Roles
// shipped, and no screen read it. That matters more than an ordinary missing
// message because it is a claim about MONEY: prompt caching is a single toggle
// in Settings, so a writer who turns it on has every reason to think it covers
// every role they have assigned, and it only covers the services that
// understand the marker.
//
// test_provider_caching_claims.py binds this screen's provider registry to the
// backend's, so the wording here cannot outlive the fact behind it.

describe("what caching does not reach", () => {
  it("says so when a role points at a service that cannot cache", async () => {
    renderSection({
      promptCaching: true,
      value: { prose: { provider: "nanogpt", model: "some/model" } },
    });
    await expand("Prose");
    const note = screen.getByTestId("role-no-caching-prose").textContent ?? "";
    expect(note).toContain("NanoGPT");
    expect(note).toContain("not be discounted");
  });

  it("frames it as a cost, not as a fault", async () => {
    // The role RUNS. Dressing this as a warning next to the real one (an
    // assignment that will refuse) would teach the writer to read neither.
    renderSection({
      promptCaching: true,
      value: { prose: { provider: "nanogpt", model: "some/model" } },
    });
    await expand("Prose");
    expect(screen.getByTestId("role-no-caching-prose").textContent)
      .toContain("Everything still works");
  });

  it("says nothing when caching is off", async () => {
    // Nothing is being lost, so there is nothing to admit. A note that is
    // always there is a note nobody reads.
    renderSection({
      promptCaching: false,
      value: { prose: { provider: "nanogpt", model: "some/model" } },
    });
    await expand("Prose");
    expect(screen.queryByTestId("role-no-caching-prose")).toBeNull();
  });

  it("says nothing when the service does cache", async () => {
    renderSection({
      promptCaching: true,
      value: { prose: { provider: "openrouter", model: "anthropic/claude-opus-4.8" } },
    });
    await expand("Prose");
    expect(screen.queryByTestId("role-no-caching-prose")).toBeNull();
  });

  it("says nothing about an unassigned role", async () => {
    // Unassigned uses the Default Model, whose provider is the active one --
    // a different question, answered on the provider panel.
    renderSection({ promptCaching: true });
    await expand("Prose");
    expect(screen.queryByTestId("role-no-caching-prose")).toBeNull();
  });
});
