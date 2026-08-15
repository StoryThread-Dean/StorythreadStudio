// features/codex/WeaveNav.tsx -- the Weave in the sidebar
// ========================================================
// The tree a writer navigates their world by:
//
//     The Weave
//       Weaving...
//     > Notes
//     > Profiles
//     > Other
//
// THREE GROUPS, ALWAYS. They are the skeleton. A writer opens this, sees
// Notes / Profiles / Other, and moves toward whichever matches what they
// are thinking about. Hiding one until it had content would mean they never
// found it, and would leave nowhere to click "+ Add New" for everything
// that belongs there.
//
// WHAT GROWS IS THE SECTIONS INSIDE. Each group opens with a default or two
// -- Author Notes; Character, Location, Lore; Event -- and everything else
// waits under "+ Add New" until the writer has a reason for it. The old
// sidebar showed every possibility at once, which reads to a beginner as
// "there is an enormous amount I am supposed to fill in". A sidebar is
// limited landscape; spending it on things nobody has used is the most
// expensive thing it can do.
//
// "+ Add New" sits at the TOP of each group's list, not the bottom, because
// it is the thing a writer is looking for when a group does not yet contain
// what they want -- and because scanning past a list to find it defeats the
// point of a short list.

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, Loader, MoreHorizontal, Network, Plus, Sparkles,
  Spool,
} from "lucide-react";

import { CONCEPTS, TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { AddNewDialog } from "./AddNewDialog";
import { SectionMenu } from "./SectionMenu";
import {
  addNote, addType, deleteSection, fetchSections, renameSection, showType,
  type AvailableEntry, type SectionEntry, type SectionsTree,
} from "./api";

/** Which target a rename or removal names: a kind has an id, a note is a
 *  file. Keeping this in one place stops the two callers disagreeing. */
function targetOf(section: SectionEntry): { id?: string; filename?: string } {
  return section.kind === "note"
    ? { filename: section.filename }
    : { id: section.id };
}

// EVERY ROW GETS THE MENU, and what it offers comes from the backend.
//
// There used to be a list here of the sections the app depends on, and they got
// no menu at all. Two things were wrong with that. It was these rules written
// down a second time, in the place least able to enforce them. And it was
// visible: a row with no menu had nothing holding the space a menu occupies, so
// "Characters 13" sat flush against the edge while "Factions 2" sat a
// menu-width in from it -- which is how the writer found it.
//
// The rules are in backend/app/codex/sections.py now, beside the code that
// carries them out, and every row sends `rename` and `removal` saying what its
// own menu may offer. A refusal is still shown as a refusal: a writer told
// "this holds four entries" learns how the app thinks, where one who finds no
// button assumes it is impossible.

interface WeaveNavProps {
  projectPath: string;
  /** Which section is open, so the row can show as active. */
  activeSection?: string | null;
  onOpenSection: (section: SectionEntry) => void;
  onOpenWeave: () => void;
  onOpenWeaving?: () => void;
  /** The Profile Extractor (v2.0.1): the AI pass that reads the manuscript
   *  and proposes what the entries should SAY. A sibling of Weaving rather
   *  than part of it, because Weaving has to be done FIRST -- the request
   *  carries a snippet of each entry, so the entries must exist. */
  onOpenExtractor?: () => void;
}

export function WeaveNav({
  projectPath, activeSection, onOpenSection, onOpenWeave, onOpenWeaving, onOpenExtractor,
}: WeaveNavProps) {
  const [tree, setTree] = useState<SectionsTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Collapsed rather than open: three closed groups is a tree a writer can
  // take in at a glance, which is the point.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<SectionEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTree(await fetchSections(projectPath));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your world.");
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void load(); }, [load]);

  async function add(action: () => Promise<SectionsTree>) {
    setBusy(true);
    setAddError(null);
    try {
      setTree(await action());
      setAdding(null);
    } catch (e) {
      // Kept in the dialog rather than closing it -- a refused name is
      // something to correct, not to start over.
      setAddError(e instanceof Error ? e.message : "That could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function edit(action: () => Promise<SectionsTree>) {
    setBusy(true);
    setEditError(null);
    try {
      setTree(await action());
      setEditing(null);
    } catch (e) {
      // Held open. The commonest failure here is "this section still holds
      // four entries", which is something to act on rather than a dead end.
      setEditError(e instanceof Error ? e.message : "That could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-faint">
        <Loader size={11} className="animate-spin" /> Reading your world...
      </p>
    );
  }

  if (error) {
    return (
      <p className="px-3 py-2 text-[11px] text-rose-300">{error}</p>
    );
  }

  return (
    <div data-testid="weave-nav">
      <button
        onClick={onOpenWeave}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-text-primary hover:text-violet-300"
        title={CONCEPTS.weave.short}
      >
        <Network size={13} className="text-violet-300" />
        The Weave
      </button>

      {/* Weaving sits directly under the title: it is the thing that helps
          you FILL the tree, so it belongs above the tree rather than buried
          inside one of its groups. */}
      <button
        onClick={onOpenWeaving}
        disabled={!onOpenWeaving}
        // Weaving SHIPPED; the fallback title is only for a mount with no
        // handler wired (the app always passes one). The old string said
        // "not built yet", which outlived the build by two redesigns.
        title={onOpenWeaving
          ? CONCEPTS.weaving.short
          : "Weaving is not available here."}
        className="flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left text-[11px] text-text-muted hover:text-violet-300 disabled:cursor-default disabled:text-faint disabled:hover:text-faint"
      >
        <Spool size={12} />
        Weaving...
      </button>

      {/* Beside Weaving, deliberately, and second. The ORDER is the feature:
          Weaving finds the names for free, this fills them in for money, and a
          writer who runs this first gets a world proposed from scratch with
          nothing to match against. The screen it opens says so too. */}
      <button
        onClick={onOpenExtractor}
        disabled={!onOpenExtractor}
        title={onOpenExtractor
          ? "Read your manuscript and propose what each entry should say. Run Weaving first."
          : "The Profile Extractor is not available here."}
        className="flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left text-[11px] text-text-muted hover:text-violet-300 disabled:cursor-default disabled:text-faint disabled:hover:text-faint"
      >
        <Sparkles size={12} />
        Profile Extractor...
      </button>

      {tree?.groups.map(group => {
        const isCollapsed = collapsed[group.id] ?? true;
        return (
          <div key={group.id}>
            <button
              onClick={() => setCollapsed(c => ({ ...c, [group.id]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-text-muted hover:text-text-primary"
            >
              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              {group.label}
            </button>

            {!isCollapsed && (
              <div className="pb-1">
                {/* At the TOP: it is what a writer wants when the group does
                    not yet contain what they are after. */}
                <button
                  onClick={() => { setAdding(group.id); setAddError(null); }}
                  className="flex w-full items-center gap-1.5 py-1 pl-8 pr-3 text-left text-[11px] text-violet-300 hover:text-violet-200"
                >
                  <Plus size={11} /> Add New
                </button>

                {group.sections.map(section => {
                  const lex = threadTypeEntry(section.id, section.label, section.icon);
                  const Icon = lex.Icon;
                  const active = activeSection === section.id;
                  return (
                    <div
                      key={`${section.kind}-${section.id}`}
                      className={`group/row flex w-full items-center pl-8 pr-1 ${
                        active ? "bg-bg-surface" : ""
                      }`}
                    >
                      <button
                        onClick={() => onOpenSection(section)}
                        title={lex.short}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-[11px] ${
                          active ? "text-text-primary" : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        <Icon size={11} className={TONE_CLASSES[lex.tone].text} />
                        <span className="flex-1 truncate">{section.label}</span>
                        {section.count > 0 && (
                          <span className="text-faint">{section.count}</span>
                        )}
                      </button>
                      {/* On every row. It holds its space whether or not it
                          is showing, which is what keeps the counts in a
                          column instead of some flush and some indented. */}
                      <button
                        onClick={() => { setEditing(section); setEditError(null); }}
                        aria-label={`${section.label} settings`}
                        className="ml-1 shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-text-primary focus:opacity-100 group-hover/row:opacity-100"
                      >
                        <MoreHorizontal size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {editing && (
        <SectionMenu
          section={editing}
          busy={busy}
          error={editError}
          onClose={() => { setEditing(null); setEditError(null); }}
          onRename={label => void edit(
            () => renameSection(projectPath, targetOf(editing), label))}
          onRemove={() => void edit(
            async () => {
              // HIDING IS NOT DELETING, and a kind the app ships with is only
              // ever hidden: its section leaves the sidebar and nothing on disk
              // moves, so "+ Add New" brings it back with everything in it.
              if (editing.removal === "hide") {
                return await showType(projectPath, editing.id, false);
              }
              const result = await deleteSection(projectPath, targetOf(editing));
              // Where a note went, said out loud. A delete that silently
              // keeps a copy is as dishonest as one that silently does not.
              if (result.moved_to) setMovedTo(result.moved_to);
              return result;
            })}
        />
      )}

      {movedTo && (
        <p className="px-3 py-1 text-[11px] text-faint">
          Moved to <span className="text-text-muted">{movedTo}</span>.
        </p>
      )}

      {adding && tree && (
        <AddNewDialog
          tree={tree}
          openGroup={adding}
          busy={busy}
          error={addError}
          onClose={() => { setAdding(null); setAddError(null); }}
          onAdd={(entry: AvailableEntry) => {
            // A PRESET already exists -- it is only waiting to be shown.
            // For a kind that means asking for the section; for a note it
            // means creating the file, because a note IS its file.
            void add(() => entry.kind === "note"
              ? addNote(projectPath, entry.label)
              : showType(projectPath, entry.id));
          }}
          onAddCustom={(label, group) => {
            // Notes add a DOCUMENT; the other two add a KIND. That is the
            // difference between "something you write" and "a kind of thing
            // you keep entries about".
            void add(() => group === "notes"
              ? addNote(projectPath, label)
              : addType(projectPath, label, group));
          }}
        />
      )}
    </div>
  );
}
