// features/codex/AddNewDialog.tsx -- "+ Add New"
// ===============================================
// The window a writer gets when they add something to their world. It opens
// pointed at the group they clicked from, but shows all three, because the
// group they clicked is a hint about what they want rather than a rule
// about what they may have.
//
// WHY A LIST RATHER THAN A BLANK FIELD. The whole design is that the
// sidebar grows as a writer needs it -- but "grows as you need it" is only
// helpful if you can SEE what is available. A blank "name your section"
// prompt puts the burden of inventing a taxonomy on someone who came here
// to write a novel. A list of ready-made kinds teaches what a world usually
// contains, which is the tutorial doing its job quietly.
//
// [Custom] is last on purpose. It is there for the world the presets do not
// fit, not as the first thing a beginner reaches for.
//
// The three groups mean different things, and the dialog says so rather
// than assuming the words are self-explanatory:
//
//   Notes     something you WRITE. Prose, in your voice.
//   Profiles  an entry ABOUT something -- a person, a place, a faction.
//   Other     genuinely neither.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader, Plus, X } from "lucide-react";

import { CUSTOM_NAME_MAX, checkCustomName, tidyCustomName } from "./customName";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import type { AvailableEntry, SectionsTree } from "./api";

const GROUP_BLURBS: Record<string, string> = {
  notes: "Something you write, in your own voice.",
  profiles: "An entry about something in your world -- a person, a place, a group.",
  other: "Anything that is neither a document nor a profile of something.",
};

interface AddNewDialogProps {
  tree: SectionsTree;
  /** The group whose "+ Add New" was clicked. Opens here. */
  openGroup: string;
  busy?: boolean;
  error?: string | null;
  onAdd: (entry: AvailableEntry) => void;
  onAddCustom: (label: string, group: string) => void;
  onClose: () => void;
}

export function AddNewDialog({
  tree, openGroup, busy, error, onAdd, onAddCustom, onClose,
}: AddNewDialogProps) {
  const [group, setGroup] = useState(openGroup);
  const [customName, setCustomName] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const nameField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (showCustom) nameField.current?.focus();
  }, [showCustom]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(
    () => tree.groups.map(g => ({
      id: g.id, label: g.label, available: g.available,
    })),
    [tree],
  );
  const current = groups.find(g => g.id === group) ?? groups[0];
  const check = checkCustomName(customName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Add to your world"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-border bg-bg-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Plus size={14} className="text-violet-300" />
          <h2 className="flex-1 text-sm font-semibold text-text-primary">
            Add to your world
          </h2>
          <button onClick={onClose} aria-label="Close"
                  className="rounded p-1 text-faint hover:text-text-primary">
            <X size={14} />
          </button>
        </header>

        {/* Which group. Opens where they came from, but all three are here:
            clicking + under Profiles is a hint, not a restriction. */}
        <div className="flex gap-1 border-b border-border px-4 py-2" role="tablist">
          {groups.map(entry => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={entry.id === current?.id}
              onClick={() => { setGroup(entry.id); setShowCustom(false); }}
              className={`rounded px-2.5 py-1 text-[11px] ${
                entry.id === current?.id
                  ? "bg-violet-600 text-white"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-[11px] text-faint">
            {GROUP_BLURBS[current?.id ?? ""] ?? ""}
          </p>

          {current && current.available.length > 0 ? (
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {current.available.map(entry => {
                const lex = threadTypeEntry(entry.id, entry.label, entry.icon);
                const Icon = lex.Icon;
                return (
                  <li key={`${entry.kind}-${entry.id}`}>
                    <button
                      onClick={() => onAdd(entry)}
                      disabled={busy}
                      title={lex.short}
                      className="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-text-primary transition-colors hover:border-violet-600 disabled:opacity-50"
                    >
                      <Icon size={13} className={TONE_CLASSES[lex.tone].text} />
                      <span className="truncate">{entry.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-faint">
              You are already using every kind this group ships with. Add one of
              your own below.
            </p>
          )}

          {/* Custom, last. For the world the presets do not fit -- not the
              first thing a beginner should reach for. */}
          <div className="mt-4 border-t border-border pt-3">
            {!showCustom ? (
              <button
                onClick={() => setShowCustom(true)}
                className="text-[11px] text-violet-300 hover:text-violet-200"
              >
                Something else...
              </button>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-primary">
                  {current?.id === "notes"
                    ? "What is this note called?"
                    : "What kind of thing is it?"}
                </label>
                <p className="mb-1.5 text-[11px] text-faint">
                  {current?.id === "notes"
                    ? "For example: Dungeon Rules, Magic Costs."
                    : "For example: Bloodline, Guild, Starship."}
                </p>
                <div className="flex items-start gap-2">
                  <input
                    ref={nameField}
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && check.ok && !busy) {
                        onAddCustom(tidyCustomName(customName), current!.id);
                      }
                    }}
                    maxLength={CUSTOM_NAME_MAX}
                    aria-label="Name"
                    aria-invalid={Boolean(check.problem)}
                    placeholder="Name"
                    className="flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => onAddCustom(tidyCustomName(customName), current!.id)}
                    disabled={!check.ok || busy}
                    className="rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    {busy ? <Loader size={12} className="animate-spin" /> : "Add"}
                  </button>
                </div>

                {check.problem && (
                  <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-200/90">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400/80" />
                    {check.problem}
                  </p>
                )}
                {check.ok && (
                  // Shown so the folder name is never a surprise later.
                  <p className="mt-1.5 text-[11px] text-faint">
                    Saved as <code className="text-text-muted">{check.id}</code> on your computer.
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
