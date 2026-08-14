// features/codex/SectionMenu.tsx -- fixing or removing one section
// =================================================================
// "Magic Sysstem" is the case this exists for. A typo in a section name
// feels permanent in a way it has no right to be, and a writer who cannot
// fix it either lives with it or loses whatever is inside it.
//
// Two actions, and they are deliberately not equally loud:
//
//   RENAME is safe and reversible, so it is one click and a text field. The
//   backend moves everything with it -- the folder, the entries already
//   written, or a note's own heading -- so nothing has to be explained.
//
//   REMOVE is where the care goes. A kind that holds entries is refused by
//   the backend with a count, and this shows that refusal rather than
//   hiding the option: a writer who cannot find "delete" assumes it is
//   impossible, where one who is told WHY learns how the app thinks. A note
//   is prose, so it is moved to notes/trash/ and the message says where.
//
// EVERY ROW HAS THIS MENU, and each row says what its own menu may offer --
// `rename` and `removal` come from the backend, beside the code that enforces
// them. It used to be absent on the sections the app depends on, which was the
// same rule written down twice AND the reason the sidebar's counts did not line
// up: a row with no menu had nothing holding the space one occupies.
//
// So the shape is now "offer everything, and be honest about what each thing
// does":
//
//   Characters can be CALLED anything. Its id and folder cannot move, because
//   the Profile Builder, the migration and profiles.py all name "character"
//   directly -- so the rename says only the name here changes, and removal
//   hides the section rather than deleting a part of the app.
//
//   The Outline is a document the app opens BY ITS FILENAME (it carries the
//   book's word target in its frontmatter), so renaming is refused with that
//   reason rather than silently making the file disappear. Removing it still
//   works: the words move to notes/trash/.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader, Pencil, Trash2, X } from "lucide-react";

import { CUSTOM_NAME_MAX, checkCustomName, tidyCustomName } from "./customName";
import type { SectionEntry } from "./api";

interface SectionMenuProps {
  section: SectionEntry;
  busy?: boolean;
  error?: string | null;
  onRename: (label: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function SectionMenu({
  section, busy, error, onRename, onRemove, onClose,
}: SectionMenuProps) {
  const [mode, setMode] = useState<"menu" | "rename" | "confirm">("menu");
  const [name, setName] = useState(section.label);
  const field = useRef<HTMLInputElement | null>(null);

  // What this row allows. Defaulted rather than assumed, so a row from an older
  // response still renders a working menu instead of an empty one.
  const rename = section.rename ?? "full";
  const removal = section.removal ?? "delete";
  const canRename = rename !== "none";

  useEffect(() => {
    if (mode === "rename") field.current?.select();
  }, [mode]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const check = checkCustomName(name);
  const isNote = section.kind === "note";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label={`${section.label} settings`}
        className="w-full max-w-sm rounded border border-border bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="flex-1 text-xs font-semibold text-text-primary">
            {section.label}
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={13} />
          </button>
        </header>

        <div className="px-3 py-3">
          {mode === "menu" && (
            <div className="space-y-1">
              {canRename ? (
                <button
                  onClick={() => setMode("rename")}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-surface"
                >
                  <Pencil size={12} className="text-violet-300" />
                  {rename === "label" ? "Change what it is called" : "Rename this section"}
                </button>
              ) : (
                /* Said rather than hidden. A missing button teaches nothing;
                   this teaches how the app is put together. */
                <p className="rounded bg-bg-surface/60 px-2 py-1.5 text-[11px] text-text-muted">
                  {section.label} is a document the app opens by name, so its
                  name is fixed. Everything you write in it is yours.
                </p>
              )}
              <button
                onClick={() => setMode("confirm")}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-surface"
              >
                <Trash2 size={12} className="text-rose-400" />
                {removal === "hide" ? "Hide this section" : "Remove it"}
              </button>
              <p className="px-2 pt-1 text-[11px] text-faint">
                {section.count > 0
                  ? `${section.count} ${section.count === 1 ? "entry" : "entries"} in here.`
                  : "Nothing in here yet."}
              </p>
            </div>
          )}

          {mode === "rename" && (
            <div>
              <label className="mb-1 block text-[11px] text-text-muted">
                What should it be called?
              </label>
              <div className="flex items-start gap-2">
                <input
                  ref={field}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && check.ok && !busy) {
                      onRename(tidyCustomName(name));
                    }
                  }}
                  maxLength={CUSTOM_NAME_MAX}
                  aria-label="New name"
                  aria-invalid={Boolean(check.problem)}
                  className="flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => onRename(tidyCustomName(name))}
                  disabled={!check.ok || busy}
                  className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                  {busy ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
                  Save
                </button>
              </div>
              {check.problem && (
                <p role="alert" className="mt-1.5 text-[11px] text-amber-200/90">
                  {check.problem}
                </p>
              )}
              {/* Said plainly, because a rename that quietly moved files
                  would be alarming to notice afterwards. */}
              <p className="mt-1.5 text-[11px] text-faint">
                {rename === "label"
                  ? "Only the name changes. This is one of the sections the app "
                    + "is built around, so its folder and everything in it stay "
                    + "exactly where they are."
                  : isNote
                    ? "Everything written in this note comes with it."
                    : section.count > 0
                      ? `All ${section.count} ${section.count === 1 ? "entry" : "entries"} come with it.`
                      : "Nothing else changes."}
              </p>
            </div>
          )}

          {mode === "confirm" && (
            <div>
              <p className="flex items-start gap-1.5 text-xs text-text-primary">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
                {removal === "hide" ? "Hide" : "Remove"} {section.label}?
              </p>
              <p className="mt-1.5 text-[11px] text-faint">
                {removal === "hide"
                  ? section.count > 0
                    // Hiding turns off "show even when empty". A section with
                    // entries in it shows because it HOLDS something, so it
                    // would stay -- and a button that appears to do nothing is
                    // worse than one that explains itself.
                    ? `This section holds ${section.count} `
                      + `${section.count === 1 ? "entry" : "entries"}, so it stays in `
                      + "the sidebar while they are in it. Move or delete those "
                      + "first if you want it gone from this story."
                    : "It leaves the sidebar. Nothing on disk moves, and you can "
                      + "bring it back any time from Add New."
                  : isNote
                    ? "The note moves to a trash folder inside notes, so nothing you "
                      + "wrote is lost. You can put it back by moving the file out again."
                    : section.count > 0
                      ? `This section holds ${section.count} `
                        + `${section.count === 1 ? "entry" : "entries"}. They have to be `
                        + "moved or deleted first -- the app will not remove your writing "
                        + "for you."
                      : "It is empty, so nothing is lost."}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={onRemove}
                  disabled={busy}
                  className="rounded bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
                >
                  {busy ? <Loader size={11} className="animate-spin" />
                        : removal === "hide" ? "Hide it" : "Remove"}
                </button>
                <button
                  onClick={() => setMode("menu")}
                  className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2.5 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
