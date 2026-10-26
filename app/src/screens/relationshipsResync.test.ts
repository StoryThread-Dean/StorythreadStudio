// relationshipsResync.test.ts -- the page has to hear about a relationship
// ===========================================================================
// Nearly everything in the Profile Builder waits for Update. A linked
// relationship does not: recording one, correcting one, or turning one into a
// hand-typed name writes this entry's OWN Markdown while the writer is still
// looking at it. If the page is not told, it holds a stale revision and a
// stale copy of the connections, and its next Update is either refused --
// "This entry changed on disk since you opened it", for a change the writer
// made on this screen -- or accepted and quietly hands back the old list.
//
// Pinned by reading the source, because a callback nothing passes is a
// callback that does not run, and every component test of the section passes
// either way.

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob("./ProfileBuilder.tsx",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const builder = Object.values(SOURCES)[0] ?? "";

describe("the Relationships section and the page's own save", () => {
  it("actually read the page (an empty read would pass everything below)", () => {
    expect(builder.length).toBeGreaterThan(10_000);
  });

  it("has a resync for the parts the page does not own", () => {
    expect(builder).toMatch(/const resyncWeave = useCallback/);
  });

  it("is told when the Relationships section writes the file", () => {
    // Read from inside the ONE element, so another panel's callback further
    // down cannot keep this green.
    const open = builder.indexOf("<RelationshipsSection");
    expect(open).toBeGreaterThan(-1);
    expect(builder.slice(open, builder.indexOf("/>", open)))
      .toContain("onChanged={() => void resyncWeave()}");
  });

  it("takes the new fingerprint, or the next save is refused", () => {
    expect(builder).toMatch(/revision: fresh\.revision/);
  });

  it("takes the new connections, or the next save deletes them", () => {
    expect(builder).toMatch(/weave: \{ \.\.\.\(prev\.weave \?\? \{\}\), \.\.\.fresh \}/);
  });

  it("does not resync onto a different entry", () => {
    expect(builder).toMatch(/prev\.entity_id !== fresh\.entity_id/);
  });

  it("leaves the writer's buffer alone", () => {
    // A resync is not a reload: unsaved edits elsewhere on the page survive.
    const body = builder.slice(builder.indexOf("const resyncWeave"),
                               builder.indexOf("const handleSave"));
    expect(body).not.toMatch(/loadProfile|setIsDirty|source\.load/);
  });
});
