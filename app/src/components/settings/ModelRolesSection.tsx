// components/settings/ModelRolesSection.tsx -- one model per KIND of job
// =======================================================================
// Storythread Studio asks an AI to do very different things: critique a
// chapter, brainstorm, hold a whole manuscript in mind, write prose. The
// models available today are not equally good at all of those, and before
// Model Roles every one of those jobs went to a single configured model.
//
// A ROLE is a kind of job. Assigning a model to "critique" points the Smart
// Advisor, chapter summaries, scene summaries and the importance audit all
// at it, because they are all the same kind of work.
//
// LAYOUT: eight rows, collapsed by default, one line each --
//
//     > Critique   [Use Default Model v]   Reading your work and telling...
//
// Eight expanded rows would be a wall of prose in a settings modal, and a
// writer scanning for "which one is prose?" would have to read all of it.
// Collapsed, the whole system fits on one screen; the long explanation, the
// source/model pickers and the feature list appear only for the row being
// worked on. The blurb truncates rather than wrapping, so rows stay one line
// tall whatever the window width.
//
// Three things this screen must do, in order of importance:
//
//   1. Never hide what a role covers. The expanded row lists the features
//      that use it. A picker whose effect you cannot see is a picker you
//      will not touch.
//   2. Be honest about roles nothing uses yet. Those are marked `reserved`
//      by the backend and say so. A control that silently does nothing is
//      worse than one that admits it is waiting for a feature.
//   3. Say when a role cannot run. An assigned role with no API key does
//      NOT quietly fall back to another model (see ai/roles.py) -- so the
//      writer has to be told here, or the feature would just fail later
//      with no clue why.
//
// The role catalog is fetched from the backend rather than duplicated here,
// so the jobs on screen cannot drift from the roles the call sites use.

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Loader } from "lucide-react";

import { WhatsThis } from "../learn/WhatsThis";
import type { ModelInfo } from "../../types/ai";
import { recommendedPicks } from "../../utils/modelFiltering";
import { PROVIDER_META, providerMetaById } from "./providerMeta";

/** One kind of job, as described by GET /api/settings/roles. */
export interface RoleInfo {
  id: string;
  label: string;
  blurb: string;          // one line, shown collapsed
  detail: string;         // the longer "What's this?" answer
  features: string[];
  reserved: boolean;
  reserved_note: string;
}

/** What a role is pointed at. Both halves travel together: different roles
 *  may live on different services, so the model alone is not enough. */
export interface RoleAssignment {
  provider: string;
  model: string;
}

interface ModelRolesSectionProps {
  roles: RoleInfo[];
  loadingRoles: boolean;
  value: Record<string, RoleAssignment>;
  onChange: (next: Record<string, RoleAssignment>) => void;
  /** The Default Model every unassigned role falls back to. */
  defaultModel: string;
  /** Which providers have a usable key (or need none). Drives the warning
   *  AND greys out sources that are not connected yet. */
  providerReady: Record<string, boolean>;
  /** Catalogs by provider id, loaded on demand as roles point at them. */
  modelsByProvider: Record<string, ModelInfo[]>;
  onNeedModels: (providerId: string) => void;
  /** Whether prompt caching is switched on in Settings. R8.7: the backend has
   *  always computed a caveat for a role pointed at a service that does not
   *  understand the cache marker, and no screen rendered it -- so a writer who
   *  turned caching on would reasonably assume it applied to every role, and it
   *  does not. That is a claim about money, which is the one kind this app does
   *  not leave unsaid. */
  promptCaching: boolean;
}

export function ModelRolesSection({
  roles, loadingRoles, value, onChange, defaultModel,
  providerReady, modelsByProvider, onNeedModels, promptCaching,
}: ModelRolesSectionProps) {

  // One row open at a time. Settings is a modal with limited height, and two
  // open rows push the rest of the list off screen -- which is the problem
  // this layout exists to solve.
  const [openRole, setOpenRole] = useState<string | null>(null);

  // Ask for a catalog the first time a role points at a provider. Roles are
  // usually all on one service, so loading every provider up front would be
  // several requests nobody needed.
  const pointedAt = Object.values(value).map(a => a.provider);
  useEffect(() => {
    for (const id of new Set(pointedAt)) {
      if (id && !modelsByProvider[id]) onNeedModels(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointedAt.join(",")]);

  function assign(role: string, patch: Partial<RoleAssignment>) {
    const current = value[role] ?? { provider: "", model: "" };
    onChange({ ...value, [role]: { ...current, ...patch } });
  }

  function clear(role: string) {
    const updated = { ...value };
    delete updated[role];
    onChange(updated);
  }

  if (loadingRoles) {
    return (
      <p className="flex items-center gap-2 text-xs text-faint">
        <Loader size={12} className="animate-spin" /> Loading roles...
      </p>
    );
  }

  return (
    <div data-testid="model-roles-section">
      <p className="mb-3 text-xs text-faint">
        Point each kind of work at the model that is best at it. Anything left
        unassigned uses your Default Model
        {defaultModel ? <> (<span className="text-text-muted">{defaultModel}</span>)</> : null}
        , which is how the app behaved before this screen existed.
      </p>

      <div className="overflow-hidden rounded border border-border">
        {roles.map(role => {
          const assignment = value[role.id];
          const isAssigned = Boolean(assignment?.provider && assignment?.model);
          const isOpen = openRole === role.id;
          const catalog = assignment?.provider
            ? modelsByProvider[assignment.provider] ?? []
            : [];
          const picks = recommendedPicks(catalog);
          const pickIds = new Set(picks.map(p => p.model.id));
          // An assigned role that cannot run will NOT fall back to another
          // model, so this warning is the only place a writer learns it.
          const providerBroken = isAssigned && providerReady[assignment.provider] === false;
          // R8.7. Not a fault and not a warning: the role runs. It is a COST
          // fact, and one a writer cannot find out any other way -- caching is a
          // single switch in Settings, so the reasonable assumption is that it
          // covers everything.
          const noCaching = isAssigned && promptCaching
            && providerMetaById(assignment.provider).supportsCaching === false;

          // What the collapsed row shows in place of the picker: the model if
          // one is chosen, otherwise the honest default.
          const summary = isAssigned ? assignment.model : "Use Default Model";

          return (
            <div
              key={role.id}
              data-testid={`role-row-${role.id}`}
              className="border-b border-border last:border-b-0"
            >
              {/* Collapsed row: name, current choice, one-line blurb. */}
              <button
                type="button"
                onClick={() => setOpenRole(isOpen ? null : role.id)}
                aria-expanded={isOpen}
                aria-label={`${role.label} settings`}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-bg-raised/60"
              >
                {isOpen
                  ? <ChevronDown size={12} className="shrink-0 text-faint" />
                  : <ChevronRight size={12} className="shrink-0 text-faint" />}

                <span className="w-36 shrink-0 truncate text-xs font-medium text-text-primary">
                  {role.label}
                </span>

                <span
                  data-testid={`role-summary-${role.id}`}
                  className={`flex w-44 shrink-0 items-center justify-between gap-1 rounded border border-border px-1.5 py-0.5 text-mini ${
                    isAssigned ? "text-success" : "text-text-muted"
                  }`}
                >
                  <span className="truncate">{summary}</span>
                  <ChevronDown size={10} className="shrink-0 opacity-60" />
                </span>

                {providerBroken && (
                  <AlertTriangle size={11} className="shrink-0 text-warn-muted" />
                )}

                {/* Truncated, not wrapped: rows stay one line tall so the
                    whole list is scannable at a glance. */}
                <span className="min-w-0 flex-1 truncate text-mini text-faint">
                  {role.reserved ? role.reserved_note : role.blurb}
                </span>
              </button>

              {/* Expanded: the explanation and the actual controls. */}
              {isOpen && (
                <div className="border-t border-border/60 bg-bg-primary/40 px-6 py-3">
                  <p className="mb-1 text-mini leading-relaxed text-text-muted">
                    {role.blurb}
                  </p>
                  <div className="mb-3">
                    <WhatsThis label="What's this?">
                      <p className="mb-1.5">{role.detail}</p>
                      {role.features.length > 0 ? (
                        <p className="text-faint">
                          Features that use this role: {role.features.join(" · ")}
                        </p>
                      ) : (
                        <p className="text-warn/80">{role.reserved_note}</p>
                      )}
                    </WhatsThis>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="flex items-center gap-1.5 text-mini text-text-muted">
                      From Source:
                      <select
                        aria-label={`${role.label} provider`}
                        value={assignment?.provider ?? ""}
                        onChange={e => {
                          const provider = e.target.value;
                          if (!provider) { clear(role.id); return; }
                          // Changing service invalidates the model: catalogs
                          // do not overlap, and keeping the old id would show
                          // a selection that cannot resolve.
                          assign(role.id, { provider, model: "" });
                          onNeedModels(provider);
                        }}
                        className="rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
                      >
                        <option value="">Use Default Model</option>
                        {PROVIDER_META.map(p => {
                          // Sources with no key (or, for local, no address)
                          // are greyed out rather than hidden: seeing that
                          // NanoGPT exists but is not connected is useful,
                          // and hiding it would look like it is unsupported.
                          const ready = providerReady[p.id] !== false;
                          return (
                            <option key={p.id} value={p.id} disabled={!ready}>
                              {p.label}{ready ? "" : " -- not connected"}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    {assignment?.provider && (
                      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-mini text-text-muted">
                        Model:
                        {catalog.length > 0 ? (
                          <select
                            aria-label={`${role.label} model`}
                            value={assignment.model}
                            onChange={e => assign(role.id, { model: e.target.value })}
                            className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
                          >
                            <option value="">Choose a model...</option>
                            {/* A short recommended list, spread across price
                                buckets and labelled by bucket. The category
                                name is the whole recommendation -- no notes,
                                nothing further to read. */}
                            {picks.length > 0 && (
                              <optgroup label="Recommended">
                                {picks.map(p => (
                                  <option key={`rec-${p.model.id}`} value={p.model.id}>
                                    {p.tierLabel} -- {p.model.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label={picks.length > 0 ? "All models" : "Models"}>
                              {catalog
                                .filter(m => !pickIds.has(m.id))
                                .map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </optgroup>
                          </select>
                        ) : (
                          // No catalog: the key is missing or the service is
                          // unreachable. Free text rather than an empty
                          // dropdown, so a writer who knows the id is not
                          // blocked by our fetch failing.
                          <input
                            aria-label={`${role.label} model`}
                            value={assignment.model}
                            onChange={e => assign(role.id, { model: e.target.value })}
                            placeholder="Model id"
                            className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                          />
                        )}
                      </label>
                    )}
                  </div>

                  {providerBroken && (
                    <p
                      data-testid={`role-warning-${role.id}`}
                      className="mt-2 flex items-start gap-1.5 rounded-r border-l-2 border-warn-fill/70 bg-warn-soft/20 px-2 py-1 text-micro leading-relaxed text-warn-strong/90"
                    >
                      <AlertTriangle size={11} className="mt-0.5 shrink-0 text-warn-muted/80" />
                      <span>
                        This role is set to a source with no key connected, so it
                        will refuse rather than quietly using another model.
                        Connect it above, or set this role back to your Default
                        Model.
                      </span>
                    </p>
                  )}

                  {noCaching && (
                    <p
                      data-testid={`role-no-caching-${role.id}`}
                      className="mt-2 flex items-start gap-1.5 rounded-r border-l-2 border-border bg-bg-surface px-2 py-1 text-micro leading-relaxed text-text-muted"
                    >
                      <Info size={11} className="mt-0.5 shrink-0 text-faint" />
                      <span>
                        Prompt caching is on, but{" "}
                        {providerMetaById(assignment.provider).label} does not
                        support it, so repeat {role.label.toLowerCase()} requests
                        will not be discounted. Everything still works -- it just
                        costs full price each time.
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <WhatsThis label="Why assign models per job?">
          Models have different strengths. One may be excellent at spotting a
          limp sentence and mediocre at writing a new one; another holds a
          whole novel in mind but is expensive for small mechanical passes.
          Assigning per job lets you use each where it is strongest and keep
          the cheap ones on the cheap work. Leaving everything unassigned is
          perfectly fine -- the app then behaves exactly as it did before.
        </WhatsThis>
      </div>
    </div>
  );
}
