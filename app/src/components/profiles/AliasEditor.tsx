// components/profiles/AliasEditor.tsx -- every word this entry answers to
// =======================================================================
// Spec: docs/weave-spec.md, appendix 2, section A4.
//
// The report, 2026-08-25: "We need to build a way for A) writer can manually
// type in the known Aliases before even going to Weaving walkthrough."
//
// The machinery has existed since v2.0.0 and only Weaving could reach it. Every
// route to an alias started from a word the scan found in the MANUSCRIPT --
// which is closed to a writer building the world first, with profiles, lore,
// relationships, outline and beats all before chapter 1. Their nicknames are
// knowledge they have now, and the app had nowhere to put it.
//
// ── IT EDITS THE BUFFER, LIKE EVERY OTHER FIELD ON THIS SCREEN ──────────────
//
// Weaving's POST /alias writes immediately, because Weaving is a walkthrough
// answering one question at a time. This screen is not: the app's locked rule
// is manual save, so an alias typed here is unsaved work until Ctrl+S, exactly
// like the name above it. Two behaviours for one field would be worse than
// either.
//
// ── NOTHING IS GENERATED ────────────────────────────────────────────────────
//
// The app does not offer "Gwen" because the name is Gwendolyn. A guessed alias
// the writer does not notice is a wrong binding they never chose -- and a wrong
// binding is invisible, because being invisible is exactly what a correct alias
// does. Every word here is one somebody typed.

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Explain } from "../learn/Explain";

interface AliasEditorProps {
  aliases: string[];
  onChange: (aliases: string[]) => void;
  /** What this entry is filed under, so a duplicate of it can be refused. */
  name: string;
  /**
   * Names and aliases already used by OTHER entries, lower-cased.
   *
   * One word cannot mean two things, or a mention of it would match neither --
   * the same rule POST /alias enforces with `alias_taken`. Checked here so the
   * writer is told while typing rather than on save.
   */
  taken?: Map<string, string>;
}

export function AliasEditor({ aliases, onChange, name, taken }: AliasEditorProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const word = draft.trim().replace(/\s+/g, " ");
    if (!word) return;

    // Already true. Not an error: the writer's belief about their own world is
    // correct and there is nothing to do. Same stance POST /alias takes.
    const mine = [name, ...aliases].map(a => a.toLowerCase());
    if (mine.includes(word.toLowerCase())) {
      setError(`This entry already answers to "${word}".`);
      setDraft("");
      return;
    }

    const owner = taken?.get(word.toLowerCase());
    if (owner) {
      // The wording is the route's own, because it explains the CONSEQUENCE
      // rather than just refusing.
      setError(`"${word}" already means ${owner}. One word cannot mean two `
               + `things, or mentions of it would match neither. Use a longer `
               + `form here, or rename the other one.`);
      return;
    }

    setError(null);
    setDraft("");
    onChange([...aliases, word]);
  };

  return (
    <div data-testid="alias-editor">
      <div className="mb-1 flex items-center gap-1.5">
        <label className="text-xs text-text-muted" htmlFor="alias-input">
          Also known as
        </label>
        <Explain of="profile.aliases" compact />
      </div>

      {aliases.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1" data-testid="alias-list">
          {aliases.map(alias => (
            <li key={alias}
                className="inline-flex items-center gap-1 rounded border border-border bg-bg-surface px-1.5 py-0.5 text-mini text-text-primary">
              {alias}
              <button
                type="button"
                onClick={() => onChange(aliases.filter(a => a !== alias))}
                aria-label={`Remove ${alias}`}
                className="text-faint hover:text-danger-muted"
              >
                <X size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          id="alias-input"
          type="text"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null); }}
          // Enter adds, because typing three nicknames should not need three
          // trips to a button.
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          // INSTRUCTION, NOT AN EXAMPLE. It read "Jim", and a placeholder
          // that looks like a filled-in value is one a writer reads as data:
          // "why does the character I just made already have the alias Jim?"
          // The name field above it is the writer's own, so a plausible name
          // sitting under it reads as something the app decided.
          placeholder="Alias or nickname used"
          aria-label="Add another name"
          className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          data-testid="alias-add"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 text-mini text-text-muted transition-colors hover:border-accent-fill hover:text-text-primary disabled:opacity-40"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {error && (
        <p role="alert" data-testid="alias-error"
           className="mt-1 text-mini text-warn-strong">
          {error}
        </p>
      )}
    </div>
  );
}
