// profilePageSeams.test.ts -- the two places the profile page is not one page
// ===========================================================================
// Nearly everything in the Profile Builder waits for Update. Two things on the
// same screen do not, and both of them write this entry's OWN Markdown while
// the writer is still looking at it: the Connections panel, and the
// Relationships section's linked rows. A relationship is a shared record --
// the map draws it and the other character can answer back -- so it cannot
// wait for a save that might never come.
//
// That seam is fine. What was not fine is that the page did not know about it.
//
// THE BUG THIS FILE PINS, in the writer's words:
//
//     "for relationships that hard hand typed in name with no profile
//      connection, clicking update doesn't save the profile ... I have
//      replicated this issue by creating a normal linked profile connection,
//      then adding a second non-linked profile with a hand typed name entry."
//
// Reproduced end to end against the real routes: open the entry, POST /tie,
// then POST /entity with the revision the page opened at, and the save comes
// back 409 version_conflict -- for a change the writer made themselves, on
// this screen, thirty seconds earlier. The hand-typed relationship lives in
// the page buffer and a refused save never writes the buffer, so leaving the
// profile loses it with nothing to recover and nothing that looks like a
// cause.
//
// And getting past the conflict alone would have been WORSE, not better: the
// page also carries the whole Thread through a load so a save can hand back
// what the form does not display (see profileSource.ts). Its `ties` list is
// the one from before the record, so an accepted save would silently delete
// the connection the writer had just made -- the exact loss the conflict check
// exists to prevent, arriving by the other door.
//
// So both halves are taken again from disk, and only those: resyncWeave. It is
// pinned by reading the source, because a callback nothing passes is a
// callback that does not run, and every test of the two panels below passes
// either way.

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob("./ProfileBuilder.tsx",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const builder = Object.values(SOURCES)[0];


describe("the two panels that write before the page saves", () => {
  it("has a resync for the parts the page does not own", () => {
    expect(builder).toMatch(/const resyncWeave = useCallback/);
  });

  // The wiring, read from inside ONE element. An unbounded search would run
  // past the end of the first panel and find the other panel's callback, which
  // would keep this file green with one of the two seams unwired -- and either
  // one unwired is the reported bug.
  const wiredOn = (tag: string) => {
    const open = builder.indexOf(`<${tag}`);
    expect(open).toBeGreaterThan(-1);
    return builder.slice(open, builder.indexOf("/>", open));
  };

  it("is told when the Relationships section records one", () => {
    expect(wiredOn("RelationshipsSection"))
      .toContain("onChanged={() => void resyncWeave()}");
  });

  it("is told when the Connections panel records one", () => {
    expect(wiredOn("ProfileConnections"))
      .toContain("onChanged={() => void resyncWeave()}");
  });

  it("takes the new fingerprint, or the next save is refused", () => {
    // `revision` is what POST /entity compares against. Leaving the stale one
    // in place is the reported bug exactly.
    expect(builder).toMatch(/revision: fresh\.revision/);
  });

  it("takes the new connections, or the next save deletes them", () => {
    // The carried blob is what threadFromProfile hands back for everything
    // this form does not display. A stale copy of it is a silent delete.
    expect(builder).toMatch(/weave: \{ \.\.\.\(prev\.weave \?\? \{\}\), \.\.\.fresh \}/);
  });

  it("does not resync onto a different entry", () => {
    // The writer can switch profiles while the re-read is in flight. Landing
    // it on the wrong one would give that profile somebody else's connections.
    expect(builder).toMatch(/prev\.entity_id !== fresh\.entity_id/);
  });

  it("leaves the writer's buffer alone", () => {
    // A resync is not a reload. If this ever called loadProfile or setIsDirty
    // (false), recording a relationship would throw away everything typed on
    // the page since the last save -- which is the cure being worse than the
    // disease.
    const body = builder.slice(builder.indexOf("const resyncWeave"),
                               builder.indexOf("const handleSave"));
    expect(body).not.toMatch(/loadProfile|setIsDirty|source\.load/);
  });
});


// ── One page, one size of text ───────────────────────────────────────────────
//
//     "in Profile Builder > Characters > Full AI Summary. This text is a size
//      larger than the rest of the text within this profile. All of the AI
//      generated text boxes have larger font. They should be the same sized
//      fonts as whatever the normal font size is for the rest of the text
//      boxes are, Notes for example."
//
// AutoTextarea forced `.text-entry` on above whatever the caller passed.
// `.text-entry` is a plain class in App.css, outside Tailwind's cascade layer,
// so it beat `text-sm` however the call site ordered its classes: 16px against
// 14 at the default Interface size, and 28 against 16.6 at Maximum.
//
// The comment there said it was for "profile description and notes fields".
// Those are plain textareas at `text-sm`; the only two things AutoTextarea
// renders are the two AI summary boxes. So it enlarged the machine's prose and
// not the writer's, which is backwards.

describe("the AI summary box is the size of the boxes beside it", () => {
  it("lets the call site decide the font size", () => {
    expect(builder).not.toMatch(/\["text-entry", className\]/);
    expect(builder).toMatch(/<textarea[\s\S]{0,400}className=\{className\}/);
  });

  it("sizes it like the writer's own prose fields", () => {
    // `text-sm` is what the Notes box, the section content box and every trait
    // description use. It is rem-based, so this still follows the Interface
    // size setting -- now in step with its neighbours rather than ahead.
    //
    // ONE, not two, since v2.0.6. There were two AI summary boxes: one per
    // SECTION and one for the whole profile. The per-section one is gone --
    // it cost an AI call each and was read by nothing that reaches a model.
    // The count is asserted rather than left open so that adding an
    // AutoTextarea somewhere new has to come past this rule.
    const autoTextareas = [...builder.matchAll(/<AutoTextarea[\s\S]*?\/>/g)]
      .map(m => m[0]);
    expect(autoTextareas).toHaveLength(1);
    for (const call of autoTextareas) {
      expect(call).toMatch(/\btext-sm\b/);
      expect(call).not.toMatch(/\btext-(xs|base|lg|entry)\b/);
    }
  });
});
