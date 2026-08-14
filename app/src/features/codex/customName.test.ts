// features/codex/customName.test.ts
// ==================================
// A name typed into [Custom] becomes a FOLDER or a FILE on the writer's
// disk. This is the same rule the backend enforces, applied as they type so
// they are told before pressing a button rather than after a round trip.
//
// The duplication is deliberate and the backend remains the authority, so
// the failure mode of drift is an unnecessary round trip -- never bad data.
// These tests pin the rule; test_codex_sections.py pins the other copy.

import { describe, expect, it } from "vitest";

import { CUSTOM_NAME_MAX, checkCustomName, tidyCustomName } from "./customName";


describe("names that are fine", () => {
  it("accepts a plain word", () => {
    expect(checkCustomName("Bloodline")).toMatchObject({ ok: true, id: "bloodline" });
  });

  it("accepts several words", () => {
    expect(checkCustomName("Royal Household").id).toBe("royal_household");
  });

  it("tidies stray spacing rather than refusing it", () => {
    // Somebody double-tapping the spacebar is not making a mistake worth
    // stopping them for.
    expect(checkCustomName("  Royal   Household  ").id).toBe("royal_household");
    expect(tidyCustomName("  royal   HOUSEHOLD ")).toBe("Royal Household");
  });
});


describe("names that would break something", () => {
  it("refuses numbers, and says why", () => {
    const check = checkCustomName("Order 66");
    expect(check.ok).toBe(false);
    expect(check.problem).toMatch(/no numbers/);
    // The reason matters as much as the refusal.
    expect(check.problem).toMatch(/folder on your computer/);
  });

  it("refuses punctuation and symbols", () => {
    for (const bad of ["House/Ward", "Ward: North", "Ward*", "Ward.", "<Ward>", "Ward-North"]) {
      expect(checkCustomName(bad).ok, bad).toBe(false);
    }
  });

  it("refuses names Windows cannot make a folder from", () => {
    // A writer naming a kind "Aux" is not doing anything wrong, and the
    // failure would otherwise be baffling: the folder simply cannot exist.
    for (const reserved of ["Con", "Aux", "Nul", "Prn"]) {
      expect(checkCustomName(reserved).problem, reserved)
        .toMatch(/Windows will not allow/);
    }
  });

  it("refuses a reserved name even as the first word", () => {
    expect(checkCustomName("Aux Chamber").ok).toBe(false);
  });

  it("refuses an overlong name", () => {
    expect(checkCustomName("A".repeat(CUSTOM_NAME_MAX + 1)).problem)
      .toMatch(/too long/);
  });
});


describe("an untouched field", () => {
  it("is not an error", () => {
    // Colouring it red before the writer has typed anything is scolding
    // them for opening a dialog.
    for (const empty of ["", "   "]) {
      const check = checkCustomName(empty);
      expect(check.ok).toBe(false);
      expect(check.problem).toBe("");
    }
  });
});
