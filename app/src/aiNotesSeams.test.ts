// aiNotesSeams.test.ts -- the standing notes, where they are wired in App.tsx
// ===========================================================================
// notes/ai-notes.md is the writer's running guidance on how the book is going,
// and it is the only material in the app that is sent with EVERY request. That
// makes two things load-bearing, and neither of them is visible from a
// component test of the context bar:
//
//   1. THE OFF SWITCH HAS TO REACH THE WIRE. The bar renders the switch; the
//      send path builds the payload. If the payload read the raw file instead
//      of the switched value, the control would look like it worked and change
//      nothing -- a whole class of bug this repo has hit repeatedly (the
//      useUiScale font sizes, the editor line-height, the never-read
//      active_style_guide). The switch is only real if the payload honours it.
//
//   2. SAVE TO AI NOTES MUST NOT WRITE ON CLICK. It puts an AI reply into a
//      human-authored file, so it opens a composer the writer edits and
//      confirms. Nothing reaches disk until they do. That keeps it inside the
//      write boundary with no new exception to a locked product rule.
//
// Read from source rather than rendered, for the reason profilePageSeams.test
// gives: App.tsx is not mountable in isolation, and a value that is computed
// and then not passed is invisible to every test that does not look.

import { describe, it, expect } from "vitest";

const SOURCES = import.meta.glob("./App.tsx",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const app = Object.values(SOURCES)[0];

// THE GUARD ON THE GUARD. `?raw` returns an EMPTY STRING for some file
// types -- App.css.test.ts was silently passing every assertion that way
// until someone checked. An empty source makes every `toMatch` below fail
// loudly and every `not.toMatch` pass vacuously, so the file would look
// half-broken rather than useless. Assert it loaded before trusting any of
// it.
it("actually read App.tsx", () => {
  expect(app.length).toBeGreaterThan(50_000);
  expect(app).toContain("function App()");
});

/** The body of one JSX element, so a search cannot run past its end and find
 *  a neighbour's prop. Same guard as profilePageSeams.test.ts. */
function element(tag: string): string {
  const open = app.indexOf(`<${tag}`);
  expect(open).toBeGreaterThan(-1);
  return app.slice(open, app.indexOf("/>", open));
}


describe("the off switch reaches the wire", () => {
  it("computes what may be sent from the remembered preference", () => {
    // aiNotesToSend is the gate. Its whole job is that the payload never
    // carries something the writer said not to send -- filtering it on the
    // backend instead would be the promise kept in the wrong place, where
    // this screen's switch cannot be what decides.
    expect(app).toMatch(/const aiNotesToSend\s*=/);
    expect(app).toMatch(/weaveContext\?\.aiNotesOff === true/);
  });

  it("sends the gated value and never the raw file", () => {
    // THE ONE THAT MATTERS. `aiNotesText` is what is on disk; `aiNotesToSend`
    // is what the writer allowed. Sending the former would leave a switch
    // that visibly toggles and quietly does nothing.
    expect(app).toMatch(/ai_notes:\s*aiNotesToSend/);
    expect(app).not.toMatch(/ai_notes:\s*aiNotesText/);
  });

  it("re-sends it whenever it changes", () => {
    // The send handler is a useCallback. A value left out of its dependency
    // array is captured once, empty, at mount -- so the notes would never be
    // sent at all and nothing would fail. This already happened once to the
    // chapter outline.
    const deps = app.slice(app.indexOf("}, [chatInput, chatMessages"));
    expect(deps.slice(0, deps.indexOf("]);"))).toMatch(/aiNotesToSend/);
  });

  it("shows the bar the file itself, not the gated value", () => {
    // The row has to keep rendering while the notes are switched OFF -- that
    // is how the writer finds the switch to turn them back on. Handing it the
    // gated value would make the row vanish the moment it was used, which is
    // the shape of a control that eats itself.
    expect(element("WeaveContextBar")).toMatch(/aiNotes=\{aiNotesText\}/);
  });

  it("counts the notes against the Weave's budget", () => {
    // They are never pruned, so the world's share is what is left after them.
    // Leaving them out would let the brief spend tokens the request has
    // already committed, and the request would grow quietly instead of the
    // world's share shrinking honestly.
    expect(element("WeaveContextBar")).toMatch(/estimateTokens\(aiNotesToSend\)/);
  });
});


describe("Save to AI Notes stays inside the write boundary", () => {
  it("opens a composer rather than saving", () => {
    // The button sets the draft. It must not call the append directly: an AI
    // reply written verbatim into a human-authored file on one click is
    // exactly what the write boundary forbids.
    const button = app.slice(app.indexOf('data-testid="save-to-ai-notes"') - 400,
                             app.indexOf('data-testid="save-to-ai-notes"') + 200);
    expect(button).toMatch(/setNoteDraft\(/);
    expect(button).not.toMatch(/appendToAiNotes\(/);
  });

  it("only writes from the confirm button", () => {
    const confirm = app.slice(app.indexOf('data-testid="ai-notes-confirm"') - 400,
                              app.indexOf('data-testid="ai-notes-confirm"') + 200);
    expect(confirm).toMatch(/appendToAiNotes\(noteDraft\)/);
  });

  it("aborts the write when the file cannot be read first", () => {
    // POST /note is a WHOLE-FILE OVERWRITE. Appending means read-then-write,
    // so a failed read that fell through to the write would replace the
    // writer's entire guidance file with the one line they just typed. A 404
    // is the exception: no file yet is the first note, not a failure.
    const fn = app.slice(app.indexOf("const appendToAiNotes"));
    const body = fn.slice(0, fn.indexOf("}, [currentProject"));
    expect(body).toMatch(/res\.status !== 404/);
    expect(body).toMatch(/throw new Error/);
  });

  it("keeps what is already in the file", () => {
    const fn = app.slice(app.indexOf("const appendToAiNotes"));
    const body = fn.slice(0, fn.indexOf("}, [currentProject"));
    // The existing content is carried into what is written back. A template
    // that dropped it would be a silent deletion of everything they had.
    expect(body).toMatch(/seed/);
    expect(body).toMatch(/existing/);
  });

  it("re-reads the file after saving", () => {
    // Otherwise the writer saves a note, is told it is saved, and the next
    // request still carries the version read when the book was opened -- the
    // guidance is on disk and not in force, with nothing on screen to say so.
    const fn = app.slice(app.indexOf("const appendToAiNotes"));
    expect(fn.slice(0, fn.indexOf("}, [currentProject"))).toMatch(/setAiNotesRefresh/);
  });
});


// ── Saved conversations ──────────────────────────────────────────────────────
// Same file, because these are the same kind of claim: wiring in App.tsx that
// no component test can see, where the failure is silent rather than loud.

describe("a conversation is saved after the turn, never before", () => {
  it("persists only once the reply has arrived", () => {
    // Saving on send would write a session claiming a reply that never came
    // if the request failed. The call sits after appendTurnToHistory, which
    // is itself after the response was parsed.
    const send = app.slice(app.indexOf("const nextHistory = appendTurnToHistory"));
    const upToSave = send.slice(0, send.indexOf("persistChatSession"));
    expect(upToSave).toMatch(/setChatMessages\(nextHistory\)/);
    expect(app).toMatch(/void persistChatSession\(nextHistory\)/);
  });

  it("keeps the id the backend minted", () => {
    // Without this the next turn sends null again and every turn becomes its
    // own one-turn session in the picker.
    const fn = app.slice(app.indexOf("const persistChatSession"));
    expect(fn.slice(0, fn.indexOf("}, [currentChatId"))).toMatch(/setCurrentChatId\(saved\.chat_id\)/);
  });

  it("does not shout when bookkeeping fails", () => {
    // The writer has their reply on screen. A red banner about a failed save
    // would read as "your request failed", which is the opposite of true.
    const fn = app.slice(app.indexOf("const persistChatSession"));
    const body = fn.slice(0, fn.indexOf("}, [currentChatId"));
    expect(body).not.toMatch(/setChatError/);
  });
});


describe("reopening does not resurrect a stale chapter", () => {
  it("drops the stored materials turns rather than replaying them", () => {
    // They are DESCRIPTORS on disk, not text -- there is nothing to replay.
    // Sending one would hand the model a chapter as it stood days ago and
    // present it as current.
    const fn = app.slice(app.indexOf("const openChatSession"));
    expect(fn.slice(0, fn.indexOf("}, []);"))).toMatch(/filter\(m => !m\.hidden\)/);
  });

  it("clears the established flags so materials rebuild from today", () => {
    // THE ONE THAT WOULD BE SILENT. chapterEstablished means "the model has
    // already been sent this". True of a live conversation, false of one
    // reopened days later -- the next request is new and remembers nothing.
    // Restoring these would suppress the materials and ground the reply in
    // nothing at all.
    const fn = app.slice(app.indexOf("const openChatSession"));
    const body = fn.slice(0, fn.indexOf("}, []);"));
    expect(body).toMatch(/setChapterEstablished\(false\)/);
    expect(body).toMatch(/setEstablishedChipKeys\(new Set\(\)\)/);
    expect(body).toMatch(/setEstablishedSelection\(""\)/);
  });

  it("restores the attachments and the stance", () => {
    // A transcript with no chips is a wall of text the model has no context
    // for, and the canon/reference stance changes what the chips MEAN.
    const fn = app.slice(app.indexOf("const openChatSession"));
    const body = fn.slice(0, fn.indexOf("}, []);"));
    expect(body).toMatch(/setContextChips\(/);
    expect(body).toMatch(/setTreatAsCanon\(/);
    expect(body).toMatch(/setAskBoundaries\(/);
  });

  it("defaults the stance to canon when a session predates the field", () => {
    // `!== false` rather than `=== true`: an older session with no stance
    // recorded must not silently flip the writer into Reference mode.
    const fn = app.slice(app.indexOf("const openChatSession"));
    expect(fn.slice(0, fn.indexOf("}, []);")))
      .toMatch(/setTreatAsCanon\(setup\.treatAsCanon !== false\)/);
  });
});


describe("a conversation belongs to one book", () => {
  it("is put away when another book is opened", () => {
    // Before this, opening a second book left the first book's conversation
    // in the panel with its chips still attached and still marked
    // established -- and the next message quietly grounded in the wrong
    // novel. Survivable while chats were session-only; now it would append
    // this book's turns to a session saved under the other book's folder.
    const fn = app.slice(app.indexOf("const handleProjectOpen"));
    const body = fn.slice(0, fn.indexOf("}, [loadChapter"));
    expect(body).toMatch(/clearWritingCompanionChat\(\)/);
    expect(body).toMatch(/setCurrentChatId\(null\)/);
  });
});


describe("the summary swap changes what is SENT, never what is shown", () => {
  it("sends the recap-aware slice rather than the raw history", () => {
    expect(app).toMatch(/messages:\s*recapAwareMessages\(newMessages\)/);
  });

  it("takes the later of the two cuts", () => {
    // "New ask" and a recap both trim the history. Taking the maximum means a
    // fresh ask inside a resumed conversation does not drag the recap back
    // in, and a recap does not resend messages a new ask already moved past.
    const fn = app.slice(app.indexOf("const recapAwareMessages"));
    const body = fn.slice(0, fn.indexOf("}, [askBoundaries"));
    expect(body).toMatch(/Math\.max\(boundary, chatRecap\.through\)/);
  });

  it("stops sending the recap once an ask has moved past it", () => {
    // Nothing older is left for it to stand in for, so sending it would be
    // paying for the same context twice.
    const fn = app.slice(app.indexOf("const recapAwareMessages"));
    const body = fn.slice(0, fn.indexOf("}, [askBoundaries"));
    expect(body).toMatch(/if \(boundary >= chatRecap\.through\) return tail;/);
  });

  it("uses the VISIBLE cut, not the stored one", () => {
    // recap_through counts stored messages including hidden descriptors; a
    // reopened panel has dropped those. Slicing by the wrong one cuts in the
    // wrong place -- silently, and by however many attachments there were.
    const fn = app.slice(app.indexOf("const openChatSession"));
    expect(fn.slice(0, fn.indexOf("}, []);")))
      .toMatch(/body\.recap_visible_through/);
  });

  it("still renders every message", () => {
    // The transcript is not filtered by the recap anywhere -- the map over
    // chatMessages is untouched by it.
    expect(app).toMatch(/\{chatMessages\.map\(\(msg, i\) => \(/);
  });

  it("says so on screen and offers the way out", () => {
    expect(app).toMatch(/data-testid="chat-recap-notice"/);
    expect(app).toMatch(/data-testid="chat-send-everything"/);
    expect(app).toMatch(/setChatRecap\(null\)/);
  });

  it("does not fail the reopen when the summary cannot be bought", () => {
    // The conversation is already on screen. Failing to summarise it just
    // means sending it whole -- more expensive and completely correct.
    const fn = app.slice(app.indexOf("const openChatSession"));
    const body = fn.slice(0, fn.indexOf("}, []);"));
    const afterRecap = body.slice(body.indexOf("chat-recap"));
    expect(afterRecap).toMatch(/catch \{/);
  });

  it("clears the recap when the conversation is cleared", () => {
    // It stands in for messages that are no longer there. Left behind, it
    // would prepend a summary of a conversation the writer just threw away.
    const fn = app.slice(app.indexOf("const clearWritingCompanionChat"));
    expect(fn.slice(0, fn.indexOf("}, []);"))).toMatch(/setChatRecap\(null\)/);
  });
});


describe("the budget's decisions reach the writer", () => {
  it("sends the chapter filename so the swap can find its summary", () => {
    // Without it a chapter too big to send is DROPPED rather than summarised
    // -- still honest, but strictly worse for the answer.
    expect(app).toMatch(/chapter_filename:\s*currentChapterRef\.current\?\.filename/);
  });

  it("shows what the request had to lose", () => {
    // The difference between a budget and a silent truncation is entirely
    // whether the screen says so. A reply grounded in less than the writer
    // thinks, with nothing on screen, is the worst outcome available here.
    expect(app).toMatch(/data-testid="materials-note"/);
    expect(app).toMatch(/\{materialsNote\}/);
  });

  it("clears the note on every turn rather than only setting it", () => {
    // Left uncleared, a note from one request lingers over the next and
    // describes a swap that did not happen -- which is worse than no note,
    // because it is a specific false claim about what the model saw.
    expect(app).toMatch(/setMaterialsNote\(String\(data\.materials_note \?\? ""\)\)/);
  });
});


describe("the chapter outline is a view, not a takeover", () => {
  it("renders in the centre column with the Companion still beside it", () => {
    // It used to replace BOTH panels, so opening a chapter's plan closed the
    // AI chat -- at exactly the moment a writer most wants to argue about
    // what should happen in the chapter. The outline branch now sits where
    // <main> sits, inside the fragment that also holds the Companion aside.
    const branch = app.slice(app.indexOf('currentView === "chapter_outline" && currentOutlineChapter ?'));
    const upToAside = branch.slice(0, branch.indexOf("RIGHT PANEL: Writing Companion"));
    expect(upToAside).toMatch(/<ChapterOutlineView/);
    // The aside is still downstream of the branch, i.e. not excluded by it.
    expect(branch).toMatch(/RIGHT PANEL: Writing Companion/);
  });

  it("loads the chapter it is planning", () => {
    // The Companion, the context bar and the outline fetch are all keyed on
    // currentChapter. Without the load, a writer planning chapter 7 chats
    // about chapter 3 and the context bar offers chapter 3's plan.
    const fn = app.slice(app.indexOf("const openChapterOutline = useCallback"));
    const body = fn.slice(0, fn.indexOf("}, [loadChapter]);"));
    expect(body).toMatch(/await loadChapter\(chapter, project\)/);
  });

  it("takes the view back after the load, not before", () => {
    // loadChapter sets the view to "editor" itself, AFTER an await. Setting
    // the outline view first would be silently undone a moment later, and the
    // writer would land in the manuscript instead of the plan.
    const fn = app.slice(app.indexOf("const openChapterOutline = useCallback"));
    const body = fn.slice(0, fn.indexOf("}, [loadChapter]);"));
    expect(body.indexOf("await loadChapter"))
      .toBeLessThan(body.indexOf('setCurrentView("chapter_outline")'));
  });

  it("gives the outline the app's font setter", () => {
    // Changing the font here changes it everywhere, which is what makes this
    // feel like the same editor rather than a lookalike.
    expect(element("ChapterOutlineView")).toMatch(/onFontChange=\{setCurrentFont\}/);
  });
});
