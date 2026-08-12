// features/codex/QuickEntry.tsx -- create an entry without leaving the Weave
// ==========================================================================
// The closed-world rule, in the writer's words:
//
//     "Writer enters a pop-up UI that they DO NOT LEAVE AT ANY POINT until the
//      task is done or they X out. ... Every single process and option keeps
//      them within the Weave UI even if it taps into a creation process that
//      is normally done elsewhere. If we have to consider this a Quick Entry
//      process to establish basic information, then lets do this."
//
// So this is Quick Entry: name, kind, ONE starter field. The Weave builds the
// base level -- the framework, the entry, the connection -- and expanding it is
// the writer's later work, elsewhere. The worked example was a Government:
// "Create one > within the same popup, a new Government entry is created with
// basic information ... > Writer gets brought BACK to the walkthrough."
//
// Two callers, two shapes of the same form:
//
//   Unspun / Pinned   the name is known (it came from the prose), the kind is a
//                     guess the writer can change, and the starter box is
//                     PREFILLED with the name's own sentence from the
//                     manuscript -- their prose, so no write-boundary issue.
//
//   Unwoven           the kind and the SECTION are fixed (the question knows
//                     where its answer lands -- Government / succession), the
//                     name is the writer's, and the box starts empty because
//                     the text IS the answer. When entries of that kind already
//                     exist, adding to one is offered first: a world with a
//                     government should not get a second one per question.
//
// After creating: the continuous-flow rule. Say what happened, then ask --
// "Connect it to something now?" -- with the inline connector, whose own
// finish already advances the walk.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader, Plus, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, kindChoices, threadTypeEntry } from "./lexicon";
import { nodeLabel, type GraphNode } from "./api";
import { TieEditor } from "./TieEditor";

const API_BASE = "http://localhost:8000";

interface RegistrySection { id: string; heading: string }

interface QuickEntryProps {
  projectPath: string;
  /** What to call it. Empty means the writer names it (Unwoven). */
  name: string;
  /** Other words the prose uses for it, settled in the same create. */
  aliases?: string[];
  /** The kind it starts as. */
  kind: string;
  /** May the writer change the kind? (Unspun: yes. Unwoven: the question knows.) */
  kindLocked?: boolean;
  /** Which section the starter text lands in. Empty = the type's first. */
  section?: string;
  /** Starter text. Unspun passes the evidence sentence; Unwoven passes none. */
  prefill?: string;
  /** The question being answered, shown above the box (Unwoven). */
  asking?: string;
  /** Everything that exists, for the connect step. */
  candidates: GraphNode[];
  /** Back to the same stop, nothing made. */
  onClose: () => void;
  /** Finished here -- advance the walk. */
  onDone: () => void;
}

export function QuickEntry({
  projectPath, name: presetName, aliases, kind: presetKind, kindLocked,
  section, prefill, asking, candidates, onClose, onDone,
}: QuickEntryProps) {
  const [name, setName] = useState(presetName);
  const [kind, setKind] = useState(presetKind);
  // MAIN OR SIDE, and it starts on Side.
  //
  // Weaving finds a name in the prose and offers to make an entry for it. Every
  // such entry used to arrive as a Main character -- the full trait-block page
  // with an importance level per trait -- because the create route could not
  // carry the template at all. So a book's walk-ons all landed in the Main
  // group, and the writer reported exactly that: "the side characters are
  // automatically grouped in the Main characters section with no way to move
  // them to side."
  //
  // Side is the default because of what this button IS. A name the prose
  // mentions once is far more often a shopkeeper than a viewpoint character,
  // and the cost of the two mistakes is not symmetrical: a Side page promoted
  // later loses nothing, while a Main page for a walk-on is six empty trait
  // sections asking to be filled in.
  const [characterKind, setCharacterKind] = useState<"main" | "side">("side");
  const [text, setText] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Section ids and headings per type, from the registry -- guessed nowhere.
  // Posting starter text to a section the type lacks is refused by name, so
  // the form has to know the real sections before it offers a box.
  const [sections, setSections] = useState<Record<string, RegistrySection[]>>({});
  // The entry just made, which flips the form into the what-next step.
  const [made, setMade] = useState<GraphNode | null>(null);
  // Whether `made` was APPENDED TO rather than created. The receipt has to
  // say which -- "Created: Government" over an entry that existed for ten
  // chapters reads as the app having just made a duplicate.
  const [appended, setAppended] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // Adding the answer to an entry that already exists (Unwoven only).
  const [addingTo, setAddingTo] = useState<GraphNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/codex/types?project_path=${encodeURIComponent(projectPath)}`);
        const body = await response.json();
        if (cancelled || !response.ok) return;
        const byType: Record<string, RegistrySection[]> = {};
        for (const t of body.types ?? []) {
          byType[t.id] = (t.sections ?? []).map(
            (s: { id: string; heading?: string; label?: string }) =>
              ({ id: s.id, heading: s.heading ?? s.label ?? s.id }));
        }
        setSections(byType);
      } catch {
        if (!cancelled) setSections({});
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  const kindSections = sections[kind] ?? [];
  const landing = useMemo(() => {
    if (section) {
      return kindSections.find(s => s.id === section)
        ?? { id: section, heading: section };
    }
    return kindSections[0];
  }, [kindSections, section]);

  // Existing entries of this kind, offered before creating a second one.
  // Placeholders are not offered: an answer landing in a bare stub would be
  // recorded against a word rather than a thing.
  const existing = useMemo(
    () => (asking
      ? candidates.filter(n => n.type === kind && !n.placeholder)
      : []),
    [candidates, kind, asking]);

  const kindEntry = threadTypeEntry(kind);

  async function create() {
    if (!name.trim() || busy) return;
    // The starter text has an ADDRESS -- a section of the new entry -- and
    // when the registry could not be read there is no address to send it to.
    // The first version quietly created the entry WITHOUT the text, which is
    // the worst of the three options: the writer's words vanished and the
    // receipt said success. Refusing out loud keeps the words in the box.
    if (text.trim() && !landing) {
      setError(
        "The starter text has nowhere to land -- this kind's sections could "
        + "not be read. Try again in a moment, or clear the text box to "
        + "create the entry without it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        project_path: projectPath, type: kind, name: name.trim(),
        aliases: aliases ?? [],
      };
      // Only means anything for a character, and the backend ignores it
      // elsewhere -- sent only where it is true, so a Location's file does not
      // carry a line about character templates.
      if (kind === "character") {
        body.character_kind = characterKind;
      }
      if (text.trim() && landing) {
        body.sections = { [landing.id]: text.trim() };
      }
      const response = await fetch(`${API_BASE}/api/codex/thread/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await response.json();
      if (!response.ok) {
        throw new Error(answer?.detail?.message ?? "That could not be created.");
      }
      setMade({
        entity_id: answer.thread.entity_id, type: kind, name: name.trim(),
        display_name: "", aliases: aliases ?? [], placeholder: !text.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be created.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The answer lands in an entry that already exists.
   *
   * APPENDS rather than replaces when the section already says something --
   * this form must never be able to erase a paragraph the writer wrote
   * somewhere else. GET first for the revision, so a save that would collide
   * with an edit made elsewhere is refused instead of clobbering it.
   */
  async function addToExisting(node: GraphNode) {
    if (!text.trim() || !landing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const got = await fetch(
        `${API_BASE}/api/codex/entity?project_path=${encodeURIComponent(projectPath)}`
        + `&entity_id=${encodeURIComponent(node.entity_id)}`);
      const thread = await got.json();
      if (!got.ok) {
        throw new Error(thread?.detail?.message ?? "That entry could not be read.");
      }
      const current = thread.sections?.[landing.id];
      const before = String(current?.content ?? "").trim();
      thread.sections = {
        ...thread.sections,
        [landing.id]: {
          heading: current?.heading ?? landing.heading,
          trait_blocks: current?.trait_blocks ?? [],
          ai_summary: current?.ai_summary ?? "",
          content: before ? `${before}\n\n${text.trim()}` : text.trim(),
        },
      };
      const saved = await fetch(`${API_BASE}/api/codex/entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, thread,
                               base_revision: thread.revision ?? null }),
      });
      if (!saved.ok) {
        const body = await saved.json();
        throw new Error(body?.detail?.message ?? "That could not be saved.");
      }
      setAddingTo(null);
      setAppended(true);
      setMade(node);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONCE SOMETHING EXISTS, CLOSING IS FINISHING.
   *
   * Before the create, X and the backdrop mean "back to the stop, nothing
   * made" -- onClose. AFTER the create the entry is on disk whether or not the
   * writer answers "connect it now?", so backing out has to record the stop as
   * done and advance. The first version returned to the stop unchanged, where
   * the create button was still live -- and pressing it again made a SECOND
   * copy of the same entry. Two empty Deans came from exactly this.
   */
  const close = made ? onDone : onClose;

  // ── The connect step, inside the same popup ───────────────────────────────
  if (connecting && made) {
    return (
      <TieEditor
        projectPath={projectPath}
        thread={made}
        candidates={candidates}
        onClose={() => setConnecting(false)}
        onDone={onDone}
        onChanged={() => { /* the scan re-derives on the next pass */ }}
      />
    );
  }

  const KindIcon = kindEntry.Icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-label={made
          ? `${appended ? "Added to" : "Created"}: ${nodeLabel(made)}`
          : "Quick entry"}
        data-testid="quick-entry"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <KindIcon size={14}
                    className={`shrink-0 ${TONE_CLASSES[kindEntry.tone].text}`} />
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            {made
              ? `${appended ? "Added to" : "Created"}: ${nodeLabel(made)}`
              : `New ${kindEntry.term}`}
          </h2>
          <button onClick={close} aria-label="Close"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        {made ? (
          // ── WHAT HAPPENED, AND WHAT IS NEXT -- the continuous-flow rule. ──
          <div className="p-3">
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-200">
              <Check size={12} className="mt-0.5 shrink-0" />
              <span>
                {appended ? (
                  <>
                    Your answer was added to{" "}
                    <span className="font-medium text-text-primary">
                      {nodeLabel(made)}
                    </span>
                    {landing ? ` under ${landing.heading}` : ""}. Everything
                    already written there was kept.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-text-primary">
                      {nodeLabel(made)}
                    </span>{" "}
                    is now a {kindEntry.term} in your world. It is a base to
                    build on -- you can expand it any time from the sidebar.
                  </>
                )}
              </span>
            </p>

            <p className="mt-2.5 text-xs text-text-primary">
              Connect it to something now?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setConnecting(true)}
                className="inline-flex items-center gap-1.5 rounded border border-violet-700 bg-violet-950/40 px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-violet-900/50"
              >
                <Plus size={11} className="text-violet-300" />
                Yes -- choose the connection
              </button>
              <button
                onClick={onDone}
                className="inline-flex flex-col items-start rounded border border-border px-2.5 py-1 text-left text-xs text-text-muted hover:border-text-muted hover:text-text-primary"
              >
                <span>No, I am good for now</span>
                <span className="text-[10px] text-faint">
                  takes you to the next thing in the walk
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            {asking && (
              <p className="mb-2 rounded border border-border bg-bg-surface px-2 py-1.5 text-[11px] text-text-muted">
                {asking}
              </p>
            )}

            <div className="mb-2">
              <Explain of="weaving.quick-entry" />
            </div>

            {/* Adding to something that exists, offered BEFORE the blank form:
                a world with a government should not get a second one for every
                question about how it works. */}
            {existing.length > 0 && !addingTo && (
              <div className="mb-3 rounded border border-border p-2">
                <p className="mb-1 text-[11px] text-text-muted">
                  Your world already has{" "}
                  {existing.length === 1
                    ? `a ${kindEntry.term}`
                    : `${existing.length} of these`}. The answer can land there
                  instead of making another:
                </p>
                <ul>
                  {existing.slice(0, 5).map(node => (
                    <li key={node.entity_id}>
                      <button
                        onClick={() => setAddingTo(node)}
                        className="w-full rounded px-1 py-0.5 text-left text-xs text-text-muted hover:bg-bg-surface hover:text-text-primary"
                      >
                        {nodeLabel(node)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {addingTo ? (
              <>
                <label htmlFor="qe-text"
                       className="mb-1 block text-[11px] text-text-muted">
                  Add to {nodeLabel(addingTo)}
                  {landing ? ` under ${landing.heading}` : ""}. Anything already
                  written there is kept -- this goes after it.
                </label>
                <textarea
                  id="qe-text"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={4}
                  aria-label="The answer"
                  className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void addToExisting(addingTo)}
                    disabled={busy || !text.trim()}
                    className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    {busy ? <Loader size={11} className="animate-spin" />
                          : <Check size={11} />}
                    Add it
                  </button>
                  <button
                    onClick={() => setAddingTo(null)}
                    className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <label htmlFor="qe-name"
                       className="mb-1 block text-[11px] text-text-muted">
                  What is it called?
                </label>
                <input
                  id="qe-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  aria-label="Name"
                  className="mb-2 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                />

                {/* WHICH PAGE THIS CHARACTER GETS. Characters only, because
                    nothing else has two templates. Kept above the starter box
                    so the writer decides the shape before they write into
                    it. */}
                {kind === "character" && (
                  <fieldset className="mb-2">
                    <legend className="mb-1 text-[11px] text-text-muted">
                      How much of a character are they?
                    </legend>
                    <div className="flex gap-1.5">
                      {([
                        { value: "side" as const, label: "Side",
                          hint: "One page, plain boxes. Right for anyone the "
                            + "story mentions rather than follows." },
                        { value: "main" as const, label: "Main",
                          hint: "The full page: traits, importance levels, "
                            + "voice notes. Right for a viewpoint character." },
                      ]).map(option => (
                        <label
                          key={option.value}
                          title={option.hint}
                          className={`flex-1 cursor-pointer rounded border px-2 py-1.5 text-[11px] ${
                            characterKind === option.value
                              ? "border-violet-500 bg-violet-600/15 text-text-primary"
                              : "border-border text-text-muted hover:border-violet-700"
                          }`}
                        >
                          <input
                            type="radio"
                            name="qe-character-kind"
                            value={option.value}
                            checked={characterKind === option.value}
                            onChange={() => setCharacterKind(option.value)}
                            className="sr-only"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-faint">
                      {characterKind === "side"
                        ? "You can make them a Main character later without "
                          + "losing anything."
                        : "Six trait sections to fill in. Side is usually the "
                          + "better start."}
                    </p>
                  </fieldset>
                )}

                {!kindLocked && (
                  <>
                    <label htmlFor="qe-kind"
                           className="mb-1 block text-[11px] text-text-muted">
                      What kind of thing is it?
                    </label>
                    <select
                      id="qe-kind"
                      value={kind}
                      onChange={e => setKind(e.target.value)}
                      aria-label="What kind of thing"
                      className="mb-2 w-full rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                    >
                      {kindChoices().map(group => (
                        <optgroup key={group.group} label={group.group}>
                          {group.kinds.map(k => (
                            <option key={k.id} value={k.id}>{k.term}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </>
                )}

                <label htmlFor="qe-text"
                       className="mb-1 block text-[11px] text-text-muted">
                  {asking
                    ? "Your answer, in a line or two"
                    : landing
                      ? `A line for its ${landing.heading}`
                      : "A line about it"}
                  {" "}<span className="text-faint">optional</span>
                </label>
                <textarea
                  id="qe-text"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={3}
                  aria-label={asking ? "The answer" : "Starter text"}
                  className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                />
                {prefill && (
                  <p className="mt-1 text-[10px] text-faint">
                    Prefilled from your own writing -- edit it or clear it.
                  </p>
                )}

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void create()}
                    disabled={busy || !name.trim()}
                    className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    {busy ? <Loader size={11} className="animate-spin" />
                          : <Check size={11} />}
                    Create it
                  </button>
                  <button
                    onClick={onClose}
                    className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
