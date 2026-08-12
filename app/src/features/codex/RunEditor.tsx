// features/codex/RunEditor.tsx -- how an entry changes across the story
// =====================================================================
// The reason the Weave exists. A fact with no point in the book is true
// everywhere or nowhere, so nothing downstream can reason about it; a fact with
// a chapter attached is what lets the app tell a model who somebody was in
// chapter seven rather than who they end up being.
//
// EXTRACTED RATHER THAN COPIED, and that is the point of this file existing.
// This editor was inside ThreadEditor, which serves the kinds the Weave added
// (factions, governments, deities, objects). The four kinds a novelist actually
// spends their time on -- characters, relationships, locations, lore -- are
// edited in the Profile Builder, which had no fact UI at all. That is why the
// story timeline on the Weave map has never done anything for a real project:
// it had nothing to move through.
//
// Writing a second one would have produced two vocabularies for one idea, which
// is the failure this whole recovery keeps finding. So there is one component,
// used by both screens, and a fact recorded in either place is the same fact.
//
// THREE SWITCHES, AND THEY ARE GENUINELY DIFFERENT QUESTIONS
//
//   From when      when it BECOMES true. Blank is a real answer: an unplaced
//                  fact is a state the writer needs to be able to see.
//   Whose truth    true of the world, or believed by one character. This is
//                  what makes "she believes her father died" recordable without
//                  making it true.
//   The reader     when the READER learns it. Blank means "as it happens",
//                  which is the ordinary case; a chapter here is a reveal held
//                  back, and it is what spoiler mode on the map hides against.
//
// The third one had no control anywhere until now, on either screen, which is
// why the spec's own opening example -- the heroine who believes her father died
// until chapter fifteen -- could not be recorded end to end.
//
// ONE OPEN AT A TIME, the rest as single lines. The writer's own words after
// recording three facts on one character: "seeing how the landscape is becoming
// very Bulky and busy on the Profiles page ... Truncate it into a Detailed line
// entry below ... Only allowing one of these to be expanded at any given time
// keeping the landscape clean and less busy."
//
// So a fact reads as one sentence -- when it starts, what is true, whose it is,
// when the reader learns it -- and opens into the full form when clicked. Six
// facts is then six lines rather than a screen and a half of controls, and the
// Run becomes something a writer can scan.

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import type { ChapterAnchor, Fact } from "./api";

// Re-exported so a caller that renders the editor does not need two imports.
export type { Fact };

export const runInputClass =
  "w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs "
  + "text-text-primary outline-none focus:border-indigo-500";

export function RunField({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="mt-2 block">
      <span className="block text-[11px] font-medium text-text-muted">{label}</span>
      {hint && <span className="mb-0.5 block text-[10px] text-faint">{hint}</span>}
      {children}
    </label>
  );
}

interface RunEditorProps {
  run: Fact[];
  chapters: ChapterAnchor[];
  /**
   * Who can hold a belief: every entry in the world, so "whose truth" is a
   * choice rather than an id typed from memory.
   *
   * A frame is stored as an entity id. The control used to be a text box with
   * the hint "name a character", which was quietly wrong in the worst way: a
   * writer types "Alexandra Langford", it saves, it looks right, and it never
   * resolves as her belief because nothing matches that string to her entry.
   * Same rule as the chapter pickers -- the writer chooses, the app keeps the id.
   */
  people?: { entity_id: string; name: string }[];
  /** The entry being edited, offered first: most beliefs on a character's page
   *  are that character's own. */
  self?: { entity_id: string; name: string };
  /** The whole list back, so the caller owns its own buffer and its own dirty
   *  tracking. Both screens are manual-save and neither writes from here. */
  onChange: (run: Fact[]) => void;
  /**
   * Shown instead of the editor when this project cannot hold facts yet.
   *
   * A profiles/ file has no Run in its format, so on an unconverted project the
   * honest answer is to say why rather than to offer a control that silently
   * drops what the writer types.
   */
  unavailable?: string;
}

/** A fact as one readable line: when, what, whose, and when the reader learns
 *  it. The parts a writer scans for, in the order they think about them. */
export function factSummary(
  fact: Fact,
  chapters: ChapterAnchor[],
  holders: { entity_id: string; name: string }[],
): string {
  const chapterName = (anchor: string | null | undefined) => {
    if (!anchor) return "";
    const index = chapters.findIndex(c => c.anchor === anchor);
    return index === -1 ? "" : `${index + 1}. ${chapters[index].title}`;
  };

  const parts: string[] = [];
  parts.push(chapterName(fact.at) ? `From ${chapterName(fact.at)}` : "Not placed yet");

  const value = (fact.value ?? "").trim();
  // Truncated on a word so a line never ends mid-syllable.
  if (value) {
    const short = value.length > 70
      ? value.slice(0, value.lastIndexOf(" ", 70) > 40
                       ? value.lastIndexOf(" ", 70) : 70) + "..."
      : value;
    parts.push(short);
  } else {
    parts.push("(nothing written yet)");
  }

  const frame = fact.frame && fact.frame !== "truth" ? fact.frame : "";
  if (frame) {
    const who = holders.find(h => h.entity_id === frame);
    parts.push(who ? `${who.name} believes it` : "one character believes it");
  }

  if (fact.revealed_at) {
    const reveal = chapterName(fact.revealed_at);
    if (reveal) parts.push(`reader learns it at ${reveal}`);
  }

  return parts.join(" | ");
}

export function RunEditor({
  run, chapters, onChange, unavailable, people, self,
}: RunEditorProps) {
  // Which fact is open. One at a time, and a new one opens itself -- there is
  // nothing to read on a fact that has not been written yet.
  const [openId, setOpenId] = useState<string | null>(null);
  // The entry itself first, then everything else, with no duplicate if it is
  // already in the list.
  const holders = [
    ...(self ? [self] : []),
    ...(people ?? []).filter(p => p.entity_id !== self?.entity_id),
  ];

  function change(index: number, patch: Partial<Fact>) {
    onChange(run.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)));
  }

  function add() {
    const id = `f-new-${run.length + 1}`;
    onChange([...run, {
      // A local id until it is saved. The backend mints a real one for a fact
      // that arrives without, so this only has to be unique in the buffer.
      id,
      at: chapters[0]?.anchor ?? "",
      axis: "",
      value: "",
    }]);
    // Open straight into it. A new fact collapsed to "(nothing written yet)"
    // would be a button that appeared to do nothing.
    setOpenId(id);
  }

  return (
    <section data-testid="run-editor" className="mt-4 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-text-primary">
          How this changes through the story
        </h4>
        <Explain of="thread.run" compact />
      </div>
      <p className="mt-0.5 text-[11px] text-faint">
        Anything that becomes true at a point in the book rather than being true
        throughout. This is what lets the app tell your AI who someone was in
        chapter seven instead of who they end up being.
      </p>

      {unavailable ? (
        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
          {unavailable}
        </p>
      ) : (
        <>
          {run.length === 0 ? (
            <p className="mt-2 text-[11px] text-faint">
              Nothing yet. The sections above are for what is true throughout.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {run.map((fact, i) => {
                const open = openId === fact.id;
                return (
                <li key={fact.id}
                    data-testid="fact"
                    className="rounded border border-border">
                  {/* THE LINE. What a writer reads when they are not editing:
                      when it starts, what is true, whose it is, and when the
                      reader finds out. */}
                  <button
                    onClick={() => setOpenId(open ? null : fact.id)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left text-[11px] text-text-muted hover:text-text-primary"
                  >
                    {open ? <ChevronDown size={11} className="mt-0.5 shrink-0" />
                          : <ChevronRight size={11} className="mt-0.5 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      {factSummary(fact, chapters, holders)}
                    </span>
                  </button>

                  {open && (
                  <div className="border-t border-border px-2 pb-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <RunField label="What changes"
                              hint="A short name for the thing that changes, so two facts about it can replace each other.">
                      <input
                        value={fact.axis ?? ""}
                        onChange={e => change(i, { axis: e.target.value })}
                        aria-label={`What changes ${i + 1}`}
                        placeholder="belief.father"
                        className={runInputClass}
                      />
                    </RunField>
                    <RunField label="From when">
                      <select
                        value={fact.at ?? ""}
                        onChange={e => change(i, { at: e.target.value })}
                        aria-label={`From when ${i + 1}`}
                        className={runInputClass}
                      >
                        {/* An unplaced fact is a real state and has to be
                            selectable, or the writer could not see that it IS
                            unplaced. */}
                        <option value="">Not placed yet</option>
                        {chapters.map((chapter, n) => (
                          <option key={chapter.chapter_id} value={chapter.anchor}>
                            {n + 1}. {chapter.title}
                          </option>
                        ))}
                      </select>
                    </RunField>
                  </div>

                  <RunField label="What is true">
                    <textarea
                      value={fact.value ?? ""}
                      onChange={e => change(i, { value: e.target.value })}
                      aria-label={`What is true ${i + 1}`}
                      rows={2}
                      className={runInputClass}
                    />
                  </RunField>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <RunField label="Whose truth"
                              hint="True of the world, or something only one character believes. A belief recorded this way does not make it true.">
                      <select
                        value={fact.frame || "truth"}
                        onChange={e => change(i, { frame: e.target.value })}
                        aria-label={`Whose truth ${i + 1}`}
                        className={runInputClass}
                      >
                        <option value="truth">True of the world</option>
                        {holders.map(person => (
                          <option key={person.entity_id} value={person.entity_id}>
                            Only {person.name} believes this
                          </option>
                        ))}
                        {/* A frame already on the file that is not in the list --
                            an entry deleted since, or a hand-edit. Shown as-is
                            rather than silently reset to "true of the world",
                            which would change what the writer recorded. */}
                        {fact.frame && fact.frame !== "truth"
                          && !holders.some(p => p.entity_id === fact.frame) && (
                          <option value={fact.frame}>
                            {fact.frame} (not in this world any more)
                          </option>
                        )}
                      </select>
                    </RunField>
                    {/* WHEN THE READER LEARNS IT, which is not when it becomes
                        true and never was. Nothing could set this until now, on
                        any screen, which is why a belief held until chapter
                        fifteen could be recorded and the reveal could not. */}
                    <RunField label="The reader learns this"
                              hint="Leave as it happens for the ordinary case. Pick a chapter for something the reader finds out later than the characters do.">
                      <select
                        value={fact.revealed_at ?? ""}
                        onChange={e => change(i, { revealed_at: e.target.value })}
                        aria-label={`The reader learns this ${i + 1}`}
                        className={runInputClass}
                      >
                        <option value="">As it happens</option>
                        {chapters.map((chapter, n) => (
                          <option key={chapter.chapter_id} value={chapter.anchor}>
                            {n + 1}. {chapter.title}
                          </option>
                        ))}
                      </select>
                    </RunField>
                  </div>

                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <RunField label="AI may see">
                      <select
                        value={fact.ai_scope ?? "always"}
                        onChange={e => change(i, { ai_scope: e.target.value })}
                        aria-label={`AI may see ${i + 1}`}
                        className={runInputClass}
                      >
                        <option value="always">Always</option>
                        <option value="on-request">Only when asked</option>
                        <option value="never">Never</option>
                      </select>
                    </RunField>
                    <button
                      onClick={() => onChange(run.filter((_, n) => n !== i))}
                      aria-label={`Remove ${fact.axis || "this"}`}
                      className="ml-auto rounded p-1 text-faint hover:text-rose-300"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  </div>
                  )}
                </li>
                );
              })}
            </ul>
          )}

          <button
            onClick={add}
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-violet-300 hover:text-violet-200"
          >
            <Plus size={11} /> Something that changes
          </button>
        </>
      )}
    </section>
  );
}
