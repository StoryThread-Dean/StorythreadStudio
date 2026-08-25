// components/profiles/RolePicker.tsx -- the one Role control
// ===========================================================
// Spec: docs/character-spine-spec.md section 6.
//
// THERE WERE TWO, and the better-looking one was worse. A narrow grouped select
// beside the Role field with 28 options and no explanation of any of them, and
// a second one below in SpinePickers with 15 archetypes that DID carry
// per-option help the writer called "helpful and useful". Reported as
// confusing, which it was: the list with the better coverage had no help, and
// the list with the help had the shorter list.
//
// So: one control, the grouped list, and the help moved up and expanded to
// cover every role rather than 15 of them.
//
// ── IT APPENDS ──────────────────────────────────────────────────────────────
//
// Both old controls ASSIGNED. The report: a character already marked "Merchant,
// Red Herring" lost both the moment Everyman was picked -- "choosing Everyman
// literally erases what currently exists in Role." Adding a role is now adding
// a role, and picking one twice does nothing rather than duplicating it.
//
// ── THE ARCHETYPE GUIDANCE SURVIVES ─────────────────────────────────────────
//
// Deleting the second dropdown would have deleted the "weakness to write
// toward" text with it, which is the most useful content in the whole feature.
// It lives in the help panel now, and inserting it is an explicit press --
// picking a role writes the role name and nothing else.

import { useState } from "react";
import { HelpCircle, Plus } from "lucide-react";

import {
  ROLE_CATALOG, addRole, splitRoles, spineOptionById,
  ARCHETYPE_OPTIONS, type RoleOption,
} from "../../data/characterSpines";

interface RolePickerProps {
  role: string;
  onChange: (role: string) => void;
  /** Put an archetype's writing guidance into Personality Traits. */
  onInsertGuidance: (roleName: string, text: string) => void;
}

export function RolePicker({ role, onChange, onInsertGuidance }: RolePickerProps) {
  const [showHelp, setShowHelp] = useState(false);
  const taken = new Set(splitRoles(role).map(r => r.toLowerCase()));

  const add = (option: RoleOption) => onChange(addRole(role, option.name));

  const guidanceFor = (option: RoleOption): string | null => {
    if (!option.archetype) return null;
    return spineOptionById(ARCHETYPE_OPTIONS, option.archetype)?.summary ?? null;
  };

  return (
    <>
      <div className="flex gap-1.5">
        <select
          value=""
          onChange={e => {
            const option = ROLE_CATALOG.flatMap(g => g.options)
              .find(o => o.name === e.target.value);
            if (option) add(option);
          }}
          aria-label="Add a story role"
          data-testid="role-add"
          className="w-28 shrink-0 rounded border border-border bg-bg-surface px-1 py-1.5 text-xs text-text-muted outline-none focus:border-accent-fill"
          title="Add a story role"
        >
          <option value="">Add role...</option>
          {ROLE_CATALOG.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.options.map(o => (
                // An already-added role stays listed and is disabled, so the
                // writer can see it is there rather than wondering where it
                // went. addRole is a no-op anyway; this just says so sooner.
                <option key={o.name} value={o.name}
                        disabled={taken.has(o.name.toLowerCase())}>
                  {o.name}{taken.has(o.name.toLowerCase()) ? " (added)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowHelp(h => !h)}
          data-testid="role-help-toggle"
          aria-expanded={showHelp}
          className={`flex shrink-0 items-center gap-0.5 rounded px-1 text-mini transition-colors ${
            showHelp ? "text-accent" : "text-faint hover:text-accent"
          }`}
          title="What do these roles mean?"
        >
          <HelpCircle size={12} />
          What's this?
        </button>
      </div>

      {showHelp && (
        <div
          data-testid="role-help"
          className="mt-1.5 max-h-72 overflow-y-auto rounded border border-accent-fill/40 bg-accent-soft/20 p-2"
        >
          <p className="mb-1.5 text-mini text-text-muted">
            A character can hold several of these at once. Adding one keeps the
            ones already there.
          </p>
          {ROLE_CATALOG.map(group => (
            <div key={group.group} className="mb-2">
              <p className="mb-0.5 text-micro font-semibold uppercase tracking-label text-accent">
                {group.group}
              </p>
              {group.options.map(o => {
                const guidance = guidanceFor(o);
                return (
                  <div key={o.name} className="mb-1">
                    <p className="text-mini leading-snug text-text-muted">
                      <button
                        type="button"
                        onClick={() => add(o)}
                        disabled={taken.has(o.name.toLowerCase())}
                        data-testid={`role-help-add-${o.name}`}
                        className="mr-1 font-medium text-text-primary underline decoration-dotted hover:text-accent disabled:no-underline disabled:opacity-50"
                        title={taken.has(o.name.toLowerCase())
                          ? "Already on this character"
                          : `Add ${o.name}`}
                      >
                        {o.name}
                      </button>
                      {o.help}
                    </p>
                    {/* THE GUIDANCE, and it is inserted only when asked. This
                        is the content the removed second dropdown used to
                        carry, and it used to arrive whether the writer wanted
                        it or not, along with an overwritten Role field. */}
                    {guidance && (
                      <p className="ml-1 mt-0.5 text-micro leading-snug text-faint">
                        {guidance}
                        <button
                          type="button"
                          onClick={() => onInsertGuidance(o.name, guidance)}
                          data-testid={`role-guidance-${o.name}`}
                          className="ml-1 inline-flex items-center gap-0.5 rounded border border-border px-1 py-px text-micro text-text-muted hover:border-accent-fill hover:text-text-primary"
                        >
                          <Plus size={8} /> Add to Personality
                        </button>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
