// utils/chatSessions.test.ts
// ==========================
// Mostly about relativeDay, because it is the only thing in this file with a
// decision in it, and because getting it wrong is the kind of bug nobody
// files: a picker that says "today" next to last night's conversation is
// merely confusing, so the writer works around it and never mentions it.

import { describe, it, expect } from "vitest";

import { relativeDay, chatLabel, type ChatSummary } from "./chatSessions";

/** 2026-09-06, 09:00 local. A morning, so "last night" is a real case. */
const NOW = new Date(2026, 8, 6, 9, 0, 0);

/** Local-time constructor, so these tests mean the same thing in any zone. */
const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h).toISOString();


describe("relativeDay", () => {
  it("calls this morning today", () => {
    expect(relativeDay(at(2026, 8, 6, 8), NOW)).toBe("today");
  });

  it("calls last night yesterday, not ten hours ago", () => {
    // THE ONE THAT MATTERS, and the reason this is calendar arithmetic
    // rather than a duration divided by 86,400,000. A conversation at 11pm
    // is "yesterday" to someone at 9am the next morning. Elapsed hours would
    // say "today", which is wrong in the way the writer would notice.
    expect(relativeDay(at(2026, 8, 5, 23), NOW)).toBe("yesterday");
  });

  it("counts days for the first week", () => {
    expect(relativeDay(at(2026, 8, 2), NOW)).toBe("4 days ago");
    expect(relativeDay(at(2026, 8, 3), NOW)).toBe("3 days ago");
  });

  it("keeps counting days well past a week, because that is what was asked for", () => {
    // The writer's own examples were "4 days ago" and "23 days ago". A date
    // library would say "3 weeks ago" for the second, which rounds away the
    // thing that makes it recognisable -- these labels exist so a
    // conversation can be placed against a week of work.
    expect(relativeDay(at(2026, 7, 14), NOW)).toBe("23 days ago");
    expect(relativeDay(at(2026, 7, 30), NOW)).toBe("7 days ago");
  });

  it("gives up on days eventually", () => {
    // NOTE the 0-based months: at(2026, 5, 6) is 6 JUNE, which is 92 days
    // before 6 September and therefore 3 months, not 4. Written out because
    // getting this wrong is how the first version of this test failed.
    expect(relativeDay(at(2026, 5, 6), NOW)).toBe("3 months ago");   // 6 June
    expect(relativeDay(at(2026, 3, 6), NOW)).toBe("5 months ago");   // 6 April
    expect(relativeDay(at(2025, 8, 6), NOW)).toBe("a year ago");
  });

  it("crosses a month boundary correctly", () => {
    // 1 Sept from 6 Sept is five days, not "last month".
    expect(relativeDay(at(2026, 8, 1), NOW)).toBe("5 days ago");
  });

  it("says nothing rather than guessing at a bad timestamp", () => {
    expect(relativeDay("", NOW)).toBe("");
    expect(relativeDay("not a date", NOW)).toBe("");
  });

  it("says nothing for a future timestamp", () => {
    // A laptop resuming, a timezone change, a clock corrected mid-session.
    // "in -3 days" beside a real conversation looks like a broken app; no
    // label at all just looks like a conversation with no date.
    expect(relativeDay(at(2026, 8, 9), NOW)).toBe("");
  });
});


describe("chatLabel", () => {
  // RELATIVE TO TODAY, not a fixed date. chatLabel reads the real clock (it
  // takes no `now`), so a hardcoded timestamp here means the expected label
  // changes every morning -- this file went red overnight the first time,
  // for no reason but the calendar.
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };

  const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({
    chat_id: "chat-000000000001", surface: "profile",
    subject: "Frodo Baggins", title: "Frodo Baggins -- relationships buildout",
    created_at: daysAgo(4), updated_at: daysAgo(4),
    turns: 6, has_recap: false, ...over,
  });

  it("reads the way the writer asked for it", () => {
    // Their own example: "4 days ago - Frodo Baggins - relationships buildout".
    expect(chatLabel(summary())).toBe(
      "4 days ago -- Frodo Baggins -- relationships buildout");
  });

  it("falls back to the title alone when the date is unusable", () => {
    expect(chatLabel(summary({ updated_at: "" }))).toBe(
      "Frodo Baggins -- relationships buildout");
  });
});
