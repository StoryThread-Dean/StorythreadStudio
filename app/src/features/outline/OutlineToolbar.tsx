// OutlineToolbar.tsx -- the drawer of sections beside the Outline editor
// =======================================================================
// The Outline is a second main editor: raw Markdown the writer types into.
// This is the one strip of chrome above it, and it does three things.
//
//   SECTIONS      a dropdown of ready-made sections. Choosing one appends it.
//                 An entry the outline already has is disabled, because the
//                 dropdown reads the outline rather than remembering what it
//                 has handed out.
//
//   FILL FROM     writes the ten-line worksheet header -- Title, Genre, Tone,
//   BOOK DETAILS  the two targets -- from what Book Details already knows.
//                 Fills BLANK lines only; never overwrites the writer.
//
//   HEAL BANNER   says so when opening this outline converted it from the old
//                 format, and where the original went.
//
// WHAT IT REPLACED. A [+ New Template] button that appeared only while
// outline.md was open in the Raw view, and overwrote the whole file with one
// of five pre-filled scaffolds. So the only way to start a fresh outline was
// hidden inside the editor of the thing you wanted to replace, and using it
// cost you everything you had written.
//
// EVERYTHING HERE IS FREE. No model is called; see explanations.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, FilePlus2, Loader } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { Explain } from "../../components/learn/Explain";
import { OutlineGuide } from "./OutlineGuide";
import { fetchOutlinePresets, fetchOutlineWorksheet } from "./outlineApi";
import type { OutlinePreset } from "./outlineApi";
import { headingsIn, normaliseHeading } from "./headings";
import { appendPreset, fillWorksheet, scrollToHeading } from "./outlineEdits";

interface OutlineToolbarProps {
  projectPath: string;
  /** The live editor. Null until CodeMirror has mounted. */
  view: EditorView | null;
  /** Flip the unsaved indicator -- manual save is a locked rule. */
  onEdited: () => void;
  /** Set when opening this outline converted it from the old format. */
  healedBackup?: string | null;
}

export function OutlineToolbar({
  projectPath, view, onEdited, healedBackup,
}: OutlineToolbarProps) {
  const [presets, setPresets] = useState<OutlinePreset[]>([]);
  const [groups, setGroups]   = useState<string[]>([]);
  const [open, setOpen]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [note, setNote]       = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [dismissedHeal, setDismissedHeal] = useState(false);
  const [guiding, setGuiding] = useState(false);

  // The headings currently in the buffer. Recomputed when the menu opens
  // rather than on every keystroke: it is one regex over the document, and
  // the only moment the answer is looked at is while the menu is showing.
  const [headings, setHeadings] = useState<Set<string>>(new Set());

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchOutlinePresets()
      .then(data => {
        if (!alive) return;
        setPresets(data.presets);
        setGroups(data.groups);
      })
      .catch(() => { if (alive) setError("Could not load the section list."); });
    return () => { alive = false; };
  }, []);

  // Close on a click outside, the way every other menu in the app does.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu() {
    // READ THE OUTLINE, not a memory of what has been inserted. A preset
    // added and then undone with Ctrl+Z is available again immediately, and
    // a heading the writer renamed stops matching -- both of which are the
    // honest answer, because the dropdown's claim is "already in your
    // outline" rather than "you clicked this once".
    setHeadings(view ? headingsIn(view.state.doc.toString()) : new Set());
    setOpen(v => !v);
  }

  const byGroup = useMemo(() => {
    const map = new Map<string, OutlinePreset[]>();
    for (const p of presets) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return map;
  }, [presets]);

  const insert = useCallback((preset: OutlinePreset) => {
    if (!view) return;
    appendPreset(view, preset.markdown);
    onEdited();
    setOpen(false);
    // Every step proposes the next one.
    setNote(`${preset.label} added. Pick another section, or just keep typing.`);
  }, [view, onEdited]);

  const goTo = useCallback((preset: OutlinePreset) => {
    if (!view) return;
    scrollToHeading(view, preset.heading);
    setOpen(false);
    setNote(`${preset.label} is already in your outline -- jumped to it.`);
  }, [view]);

  const fill = useCallback(async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const { content } = await fetchOutlineWorksheet(projectPath);
      const filled = fillWorksheet(view, content);
      onEdited();
      // A no-op has to explain ITSELF, or it reads as a failure. Reported
      // exactly that way: "didn't seem to work because it said all of the
      // sections had filled in parts". It had worked -- there was simply
      // nothing left to do, because converting the outline already copied
      // Book Details into the header. Saying what it would have done, and
      // why it did not, is the difference between those two readings.
      setNote(
        filled === 0
          ? "Your header is already complete, so there was nothing to copy "
            + "across. This only fills lines that are EMPTY -- it never "
            + "replaces something you have written. To change a value, edit "
            + "it here or in Book Details."
          : `Filled in ${filled} ${filled === 1 ? "line" : "lines"} from Book `
            + "Details. Anything you had already written was left alone.",
      );
    } catch {
      setError("Could not read your Book Details.");
    } finally {
      setBusy(false);
    }
  }, [projectPath, view, onEdited]);

  return (
    <div className="border-b border-border bg-bg-panel px-3 py-2">
      {guiding && <OutlineGuide onClose={() => setGuiding(false)} />}

      {/* The conversion notice. Shown once, dismissible, and it names where
          the original went -- a rewrite the writer did not ask for has to be
          reversible by hand if nothing else. */}
      {healedBackup && !dismissedHeal && (
        <div
          data-testid="outline-healed"
          className="mb-2 rounded border border-accent bg-accent-soft px-2.5 py-2 text-mini text-text-primary"
        >
          <p>
            This outline was written in the old format, so the tracking block
            at the top is now plain lines you can edit. Everything you had
            written is untouched.
          </p>
          <p className="mt-1 text-text-muted">
            A copy of the original is in <code>{healedBackup}</code>
          </p>
          <button
            type="button"
            onClick={() => setDismissedHeal(true)}
            className="mt-1.5 rounded border border-border px-2 py-0.5 text-micro text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Got it
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-micro font-semibold uppercase tracking-label text-accent">
          Outline
        </span>

        {/* ── Sections ─────────────────────────────────────────────────── */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={openMenu}
            disabled={!view || presets.length === 0}
            aria-expanded={open}
            data-testid="outline-sections-button"
            className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface px-2.5 py-1 text-xs text-text-primary transition-colors hover:border-accent disabled:opacity-40"
          >
            Add a section
            <ChevronDown size={12} />
          </button>

          {open && (
            <div
              role="menu"
              data-testid="outline-sections-menu"
              className="absolute left-0 z-20 mt-1 max-h-96 w-72 overflow-y-auto rounded border border-border-strong bg-bg-panel shadow-e3"
            >
              {groups.map(group => (
                <div key={group}>
                  <p className="border-b border-border px-2.5 py-1 text-micro uppercase tracking-label text-text-muted">
                    {group}
                  </p>
                  {(byGroup.get(group) ?? []).map(preset => {
                    // A repeatable section NEVER greys out. "Already in your
                    // outline" is the wrong answer when the writer is adding
                    // their fourth character.
                    const already = !preset.repeatable
                      && headings.has(normaliseHeading(preset.heading));
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="menuitem"
                        data-testid={`outline-preset-${preset.id}`}
                        aria-disabled={already}
                        title={already ? "Already in your outline" : undefined}
                        onClick={() => (already ? goTo(preset) : insert(preset))}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                          already
                            ? "text-faint hover:bg-bg-raised"
                            : "text-text-primary hover:bg-bg-raised"
                        }`}
                      >
                        <span className="flex-1">{preset.label}</span>
                        {already && (
                          // Disabled, but not a dead end: it says why, and
                          // clicking still takes the writer to the section.
                          <span className="shrink-0 text-micro text-faint">
                            in your outline
                          </span>
                        )}
                        {preset.repeatable && !already && (
                          <span className="shrink-0 text-micro text-faint">
                            per character
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Fill from Book Details ───────────────────────────────────── */}
        <button
          type="button"
          onClick={() => void fill()}
          disabled={!view || busy}
          data-testid="outline-fill"
          className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface px-2.5 py-1 text-xs text-text-primary transition-colors hover:border-accent disabled:opacity-40"
        >
          {busy ? <Loader size={12} className="animate-spin" /> : <FilePlus2 size={12} />}
          Fill from Book Details
        </button>

        <Explain of="outline.worksheet" />

        {/* SHOW ME HOW is its own walkthrough, not a paragraph hung under
            "What's this?". That panel answers four questions and floats
            beside its button; this is nineteen sections with three worked
            examples each, and it needs pages and somewhere to stay put.
            It sits AFTER the panel because the two are read in that order:
            what this is, then how to do it. */}
        <button
          type="button"
          onClick={() => setGuiding(true)}
          data-testid="outline-guide-open"
          className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-surface px-2.5 py-1 text-xs text-text-primary transition-colors hover:border-accent"
        >
          <BookOpen size={12} /> Show me how
        </button>
      </div>

      {note && (
        <p className="mt-1.5 text-mini text-text-muted" data-testid="outline-note">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-mini text-danger">{error}</p>
      )}
    </div>
  );
}
