// features/codex/ThreadEditor.tsx -- writing an entry that is not a profile
// =========================================================================
// The Profile Builder covers four kinds. The Weave has fourteen plus whatever
// the writer invents, so factions, governments, deities, objects, concepts,
// events and a custom "Race" had nowhere to be written. Weaving said so
// honestly -- "there is no editor for this kind of entry yet" -- which was
// better than a button that went nowhere, and is still a dead end.
//
// This is that editor. Deliberately plainer than the Profile Builder: no AI
// buttons, no gauges, no chat. An entry is mostly prose in named sections, and
// what a writer needs is somewhere to type it and a Save that means saved.
//
// FOUR RULES IT KEEPS
// -------------------
// 1. MANUAL SAVE, AND SAVED MEANS SAVED. A locked product rule. Unsaved work
//    is visible as unsaved, leaving is confirmed, and nothing is written until
//    the writer says so. The whole entry goes in one write, which is also why
//    facts are edited here rather than through a per-fact endpoint.
//
// 2. THE SECTIONS COME FROM THE REGISTRY. A Faction's headings are whatever
//    types.json says they are, including for a kind invented this morning.
//    Nothing about the shape of an entry is hardcoded here.
//
// 3. A CONFLICTING SAVE IS REFUSED, NOT MERGED. The editor sends the revision
//    it opened at. If the file changed underneath -- another window, an
//    external editor -- the backend refuses and says to reload. Silently
//    winning would lose somebody's writing.
//
// 4. THE RUN IS EDITABLE, BECAUSE THAT IS THE POINT OF THE WEAVE. A fact with
//    no point in the story is one the app cannot reason about, and Weaving
//    sends writers here to place them. "When" is a list of the writer's own
//    chapters, never a date.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, Link2, Loader, Plus, Save,
} from "lucide-react";

import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { TieEditor } from "./TieEditor";
import {
  fetchAnchors, fetchThreads, fetchTypes,
  type ChapterAnchor, type GraphNode, type ThreadSummary, type TypeEntry,
} from "./api";
// ONE Run editor, shared with the Profile Builder. It used to live in this file,
// which meant the four kinds a novelist spends their time on -- edited in the
// Profile Builder -- had no way to record a fact at all. Copying it would have
// produced two vocabularies for one idea.
import { RunEditor, RunField, runInputClass, type Fact } from "./RunEditor";

const API_BASE = "http://localhost:8000";

interface Section {
  heading: string;
  content: string;
  trait_blocks?: unknown[];
  ai_summary?: string;
}

interface Thread {
  entity_id: string;
  type: string;
  name: string;
  display_name?: string;
  aliases?: string[];
  tags?: string[];
  filename: string;
  sections: Record<string, Section>;
  ties?: unknown[];
  run?: Fact[];
  revision?: string;
}

interface ThreadEditorProps {
  projectPath: string;
  /** Which kind of entry is being edited. */
  typeId: string;
  /** Open straight onto one entry. */
  initialFilename?: string;
  onBack: () => void;
  /** So the shell can show the unsaved-changes indicator it already has. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function ThreadEditor({
  projectPath, typeId, initialFilename, onBack, onDirtyChange,
}: ThreadEditorProps) {
  const [type, setType] = useState<TypeEntry | null>(null);
  const [list, setList] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [tying, setTying] = useState(false);

  const lex = threadTypeEntry(typeId, type?.label);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const loadList = useCallback(async () => {
    try {
      const [types, threads, anchors] = await Promise.all([
        fetchTypes(projectPath),
        fetchThreads(projectPath, typeId),
        fetchAnchors(projectPath),
      ]);
      setType(types.types.find(t => t.id === typeId) ?? null);
      setList(threads.threads);
      setChapters(anchors.chapters);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this world.");
    }
  }, [projectPath, typeId]);

  useEffect(() => { void loadList(); }, [loadList]);

  const open = useCallback(async (entityId: string) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `${API_BASE}/api/codex/entity?project_path=${encodeURIComponent(projectPath)}`
        + `&entity_id=${encodeURIComponent(entityId)}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That entry could not be read.");
      }
      setThread(body as Thread);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That entry could not be read.");
    } finally {
      setBusy(false);
    }
  }, [projectPath]);

  // Open the requested entry once its list has arrived. Guarded by a ref so a
  // later refresh cannot yank the writer back to it, discarding what they had
  // moved on to.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialFilename || list.length === 0) return;
    const wanted = list.find(item => item.filename === initialFilename);
    if (!wanted) return;
    opened.current = true;
    void open(wanted.entity_id);
  }, [initialFilename, list, open]);

  /** Anything that edits the buffer goes through here, so nothing can change
   *  the entry without the writer being told it is unsaved. */
  function edit(change: (draft: Thread) => void) {
    setThread(current => {
      if (!current) return current;
      const draft: Thread = JSON.parse(JSON.stringify(current));
      change(draft);
      return draft;
    });
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    if (!thread) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/codex/entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_path: projectPath,
          thread,
          // What it opened at. The backend refuses rather than overwriting if
          // the file moved underneath.
          base_revision: thread.revision ?? null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be saved.");
      }
      setThread({ ...thread, revision: body.revision });
      setDirty(false);
      setSaved(true);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /** Leaving with unsaved work is confirmed, never silent. */
  function leave(go: () => void) {
    if (!dirty || window.confirm(
      "You have unsaved changes to this entry. Leave without saving?")) {
      setDirty(false);
      go();
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/codex/thread/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_path: projectPath, type: typeId, name }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That could not be added.");
      }
      setAdding(false);
      setNewName("");
      await loadList();
      await open(body.thread.entity_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be added.");
    } finally {
      setBusy(false);
    }
  }

  const sections = useMemo(() => type?.sections ?? [], [type]);

  return (
    <div data-testid="thread-editor" className="flex h-full min-h-0">
      {/* ── The entries of this kind ──────────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button onClick={() => leave(onBack)} aria-label="Back"
                  className="rounded p-0.5 text-faint hover:text-text-primary">
            <ArrowLeft size={13} />
          </button>
          <lex.Icon size={13} className={TONE_CLASSES[lex.tone].text} />
          <h2 className="flex-1 truncate text-xs font-semibold text-text-primary">
            {lex.term}
          </h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {list.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-faint">
              Nothing here yet.
            </p>
          ) : list.map(item => (
            <button
              key={item.entity_id}
              onClick={() => leave(() => void open(item.entity_id))}
              className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                thread?.entity_id === item.entity_id
                  ? "bg-bg-surface text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="border-t border-border p-2">
          {adding ? (
            <div className="flex items-start gap-1.5">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void create(); }}
                placeholder={`New ${lex.term.toLowerCase()}`}
                aria-label="Name"
                autoFocus
                className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
              />
              <button onClick={() => void create()} disabled={!newName.trim() || busy}
                      className="rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 text-[11px] text-violet-300 hover:text-violet-200"
            >
              <Plus size={11} /> Add {lex.term.toLowerCase()}
            </button>
          )}
        </div>
      </aside>

      {/* ── The entry ─────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p role="alert"
             className="m-3 flex items-start gap-1.5 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-xs text-rose-200">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {!thread ? (
          <p className="p-6 text-xs text-faint">
            {busy ? "Reading..." : `Pick a ${lex.term.toLowerCase()} on the left, or add one.`}
          </p>
        ) : (
          <div className="mx-auto max-w-3xl p-4">
            {/* Save, and the state of the buffer. Manual save is a locked rule,
                so unsaved work has to LOOK unsaved. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="flex-1 text-sm font-semibold text-text-primary">
                {thread.display_name || thread.name}
              </h3>
              {dirty && (
                <span data-testid="unsaved"
                      className="text-[11px] text-amber-300">Unsaved changes</span>
              )}
              {saved && !dirty && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                  <Check size={11} /> Saved
                </span>
              )}
              <button
                onClick={() => setTying(true)}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
              >
                <Link2 size={11} /> Connections
              </button>
              <button
                onClick={() => void save()}
                disabled={!dirty || busy}
                className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {busy ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </button>
            </div>

            {/* ── What it is called ─────────────────────────────────── */}
            <div className="grid gap-2 sm:grid-cols-2">
              <RunField label="Name" hint="What it is. The official one.">
                <input
                  value={thread.name}
                  onChange={e => edit(d => { d.name = e.target.value; })}
                  aria-label="Name"
                  className={runInputClass}
                />
              </RunField>
              <RunField label="Shown as"
                     hint="What the story calls it, if that differs. Leave empty to use the name.">
                <input
                  value={thread.display_name ?? ""}
                  onChange={e => edit(d => { d.display_name = e.target.value; })}
                  aria-label="Shown as"
                  className={runInputClass}
                />
              </RunField>
              <RunField label="Also called"
                     hint="One per line. Every one of these finds this entry, anywhere in your writing.">
                <textarea
                  value={(thread.aliases ?? []).join("\n")}
                  onChange={e => edit(d => {
                    d.aliases = e.target.value.split("\n")
                      .map(a => a.trim()).filter(Boolean);
                  })}
                  aria-label="Also called"
                  rows={3}
                  className={runInputClass}
                />
              </RunField>
              <RunField label="Tags" hint="One per line.">
                <textarea
                  value={(thread.tags ?? []).join("\n")}
                  onChange={e => edit(d => {
                    d.tags = e.target.value.split("\n")
                      .map(t => t.trim()).filter(Boolean);
                  })}
                  aria-label="Tags"
                  rows={3}
                  className={runInputClass}
                />
              </RunField>
            </div>

            {/* ── The sections this KIND has, from the registry ─────── */}
            {sections.map(section => (
              <RunField key={section.id} label={section.heading}>
                <textarea
                  value={thread.sections?.[section.id]?.content ?? ""}
                  onChange={e => edit(d => {
                    d.sections = d.sections ?? {};
                    d.sections[section.id] = {
                      ...(d.sections[section.id] ?? { heading: section.heading }),
                      heading: section.heading,
                      content: e.target.value,
                    };
                  })}
                  aria-label={section.heading}
                  rows={5}
                  className={`${runInputClass} font-serif`}
                />
              </RunField>
            ))}

            {/* ── The Run ───────────────────────────────────────────── */}
            <RunEditor
              run={thread.run ?? []}
              chapters={chapters}
              people={list.map(t => ({ entity_id: t.entity_id, name: t.name }))}
              self={{ entity_id: thread.entity_id, name: thread.name }}
              onChange={next => edit(d => { d.run = next; })}
            />
          </div>
        )}
      </div>

      {tying && thread && (
        <TieEditor
          projectPath={projectPath}
          thread={{
            entity_id: thread.entity_id, type: thread.type, name: thread.name,
            display_name: thread.display_name ?? "",
            aliases: thread.aliases ?? [], placeholder: false,
          } as GraphNode}
          candidates={[]}
          onClose={() => setTying(false)}
          onChanged={() => { /* ties are written by that editor, not this one */ }}
        />
      )}
    </div>
  );
}


