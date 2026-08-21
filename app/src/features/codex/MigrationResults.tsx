// features/codex/MigrationResults.tsx -- what the conversion actually did
// =======================================================================
// From live testing, after a conversion that worked: "apparently worked but I
// have zero context of what happened and where the information went to."
//
// That is the failure this whole app is built against. The commonest
// misconception about AI-adjacent tools is that you press one button and
// something happens that you have no insight into and no say over, and the
// answer cannot be "trust it" -- it has to be "here is what it did, in your
// own words, side by side with what you wrote".
//
// So this screen has two halves and neither is optional:
//
//   THE LIST answers "where did my things go" -- grouped by kind, one row per
//   file, with the path it came from and the path it is at now. A writer can
//   take those paths to their own file manager and check.
//
//   THE COMPARISON answers "is it still mine" -- every section of one entry,
//   the original on the left and the converted on the right. Most rows will be
//   identical, and that is the point: the conversion is supposed to move the
//   writer's writing across untouched, so saying "unchanged" plainly is what
//   makes the one real difference worth looking at.
//
// The original side is read from the BACKUP, which is the copy the conversion
// actually read. profiles/ still exists but could have been edited since.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, FileText, Loader,
} from "lucide-react";

import { TONE_CLASSES, threadTypeEntry } from "./lexicon";

const API_BASE = "http://localhost:8000";

interface Entry {
  type: string;
  name: string;
  entity_id: string;
  filename: string;
  source: string;
  converted_to: string;
}

export interface MigrationReport {
  status: string;
  converted: number;
  arcs_absorbed: number;
  backup_path: string | null;
  entries: Entry[];
  warnings: string[];
  unconvertible: { folder: string; file?: string; reason: string }[];
  finished_at?: string;
}

interface Row {
  id?: string;
  field?: string;
  heading?: string;
  original: string;
  converted: string;
  changed: boolean;
  missing?: boolean;
}

interface Comparison {
  name: string;
  type: string;
  filename: string;
  original_path: string;
  converted_path: string;
  sections: Row[];
  fields: Row[];
  original_raw: string;
  converted_raw: string;
}

interface MigrationResultsProps {
  projectPath: string;
  report: MigrationReport;
}

export function MigrationResults({ projectPath, report }: MigrationResultsProps) {
  const [open, setOpen] = useState<Entry | null>(null);

  const groups = groupByKind(report.entries ?? []);

  if (open) {
    return <Detail projectPath={projectPath} entry={open}
                   onBack={() => setOpen(null)} />;
  }

  return (
    <div data-testid="migration-results" className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-text-primary">
        <Check size={14} className="text-emerald-400" />
        {report.converted === 1
          ? "1 entry is now in the Weave."
          : `${report.converted} entries are now in the Weave.`}
      </p>

      {report.arcs_absorbed > 0 && (
        <p className="text-mini text-text-muted">
          {report.arcs_absorbed} series arc
          {report.arcs_absorbed === 1 ? "" : "s"} became dated facts on the
          entries they belong to, rather than separate entries of their own.
        </p>
      )}

      {report.backup_path && (
        <p className="text-mini text-faint">
          Your originals were copied to{" "}
          <span className="text-text-muted">{report.backup_path}</span> before
          anything was written, and are still there. Your{" "}
          <span className="text-text-muted">profiles/</span> folder is
          untouched too.
        </p>
      )}

      {/* Grouped by kind, because that is how a writer thinks about their own
          world -- not by the order the conversion happened to walk folders. */}
      {groups.map(group => (
        <div key={group.type}>
          <p className="flex items-center gap-1.5 text-mini font-semibold uppercase tracking-wide text-faint">
            <group.Icon size={11} className={group.tone} />
            {group.label}
          </p>
          <ul className="mt-1 space-y-0.5">
            {group.entries.map(entry => (
              <li key={entry.converted_to}>
                <button
                  onClick={() => setOpen(entry)}
                  className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-surface"
                >
                  <ChevronRight size={11} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                    {entry.name}
                  </span>
                  {/* The path, on the row. A writer should be able to go and
                      look at the file without asking the app where it is. */}
                  <span className="hidden shrink-0 text-micro text-faint group-hover:inline">
                    {entry.converted_to}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {(report.warnings?.length ?? 0) > 0 && (
        <div>
          <p className="text-mini font-semibold uppercase tracking-wide text-amber-200/90">
            Worth knowing
          </p>
          <ul className="mt-1 space-y-0.5 text-mini text-amber-200/80">
            {report.warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      {(report.unconvertible?.length ?? 0) > 0 && (
        <div>
          <p className="text-mini font-semibold uppercase tracking-wide text-rose-200/90">
            Left alone
          </p>
          <ul className="mt-1 space-y-0.5 text-mini text-rose-200/80">
            {report.unconvertible.map(u => (
              <li key={`${u.folder}/${u.file ?? ""}`}>
                {u.folder}{u.file ? `/${u.file}` : ""} -- {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-border pt-2 text-mini text-faint">
        Click any entry above to see it before and after, field by field.
      </p>
    </div>
  );
}


function Detail({ projectPath, entry, onBack }: {
  projectPath: string; entry: Entry; onBack: () => void;
}) {
  const [diff, setDiff] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/codex/migrate/compare`
        + `?project_path=${encodeURIComponent(projectPath)}`
        + `&type=${encodeURIComponent(entry.type)}`
        + `&filename=${encodeURIComponent(entry.filename)}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? "That comparison could not be read.");
      }
      setDiff(body as Comparison);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That comparison could not be read.");
    }
  }, [projectPath, entry]);

  useEffect(() => { void load(); }, [load]);

  const rows = [...(diff?.fields ?? []), ...(diff?.sections ?? [])];
  const changed = rows.filter(r => r.changed).length;
  const missing = rows.filter(r => r.missing).length;

  return (
    <div data-testid="migration-detail" className="space-y-3">
      <button onClick={onBack}
              className="inline-flex items-center gap-1 text-mini text-violet-300 hover:text-violet-200">
        <ArrowLeft size={11} /> Back to everything that was converted
      </button>

      <h3 className="text-sm font-semibold text-text-primary">{entry.name}</h3>

      {error && (
        <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 px-2 py-1.5 text-mini text-rose-200">
          {error}
        </p>
      )}

      {!diff && !error && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Loader size={12} className="animate-spin" /> Reading both versions...
        </p>
      )}

      {diff && (
        <>
          {/* The headline. "Nothing changed" is the expected answer and the
              reassuring one, so it is said out loud rather than left to be
              inferred from a wall of identical rows. */}
          <p className={`text-xs ${missing > 0 ? "text-rose-200"
              : changed > 0 ? "text-amber-200/90" : "text-emerald-300"}`}>
            {missing > 0 ? (
              <>
                <AlertTriangle size={12} className="mr-1 inline" />
                {missing} {missing === 1 ? "field" : "fields"} did not come
                across. Your original is still in the backup, untouched.
              </>
            ) : changed > 0 ? (
              <>{changed} {changed === 1 ? "field differs" : "fields differ"} from
                your original. Everything else came across word for word.</>
            ) : (
              <>Every field came across word for word. Nothing was changed.</>
            )}
          </p>

          <p className="text-micro text-faint">
            Left: {diff.original_path}<br />Right: {diff.converted_path}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] table-fixed border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-mini text-faint">
                  <th className="w-32 py-1 pr-2 font-medium">Field</th>
                  <th className="py-1 pr-2 font-medium">What you wrote</th>
                  <th className="py-1 font-medium">In the Weave</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const label = row.heading ?? row.field ?? row.id ?? "";
                  return (
                    <tr key={label}
                        className={`border-b border-border/50 align-top ${
                          row.missing ? "bg-rose-950/20"
                            : row.changed ? "bg-amber-950/10" : ""}`}>
                      <td className="py-1.5 pr-2 text-text-muted">
                        {label}
                        {row.missing ? (
                          <span className="ml-1 text-micro text-rose-300">missing</span>
                        ) : row.changed ? (
                          <span className="ml-1 text-micro text-amber-300/80">changed</span>
                        ) : null}
                      </td>
                      <td className="whitespace-pre-wrap py-1.5 pr-2 text-text-muted">
                        {row.original || <span className="text-faint">empty</span>}
                      </td>
                      <td className="whitespace-pre-wrap py-1.5 text-text-primary">
                        {row.converted || <span className="text-faint">empty</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => setRaw(v => !v)}
            className="inline-flex items-center gap-1 text-mini text-violet-300 hover:text-violet-200"
          >
            <FileText size={11} />
            {raw ? "Hide the files themselves" : "Show me the files themselves"}
          </button>

          {/* Because a field-by-field table is an interpretation, and the
              writer is entitled to the thing itself. */}
          {raw && (
            <div className="grid gap-2 md:grid-cols-2">
              <pre className="max-h-64 overflow-auto rounded border border-border bg-black/40 p-2 text-micro text-text-muted">
                {diff.original_raw}
              </pre>
              <pre className="max-h-64 overflow-auto rounded border border-border bg-black/40 p-2 text-micro text-text-muted">
                {diff.converted_raw}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}


/** Entries grouped by kind, each with the icon and tone that kind uses
 *  everywhere else -- so the vocabulary is the same here as in the sidebar. */
function groupByKind(entries: Entry[]) {
  const order: string[] = [];
  const byType = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!byType.has(entry.type)) {
      byType.set(entry.type, []);
      order.push(entry.type);
    }
    byType.get(entry.type)!.push(entry);
  }
  return order.map(type => {
    const lex = threadTypeEntry(type);
    return {
      type,
      label: plural(lex.term),
      Icon: lex.Icon,
      tone: TONE_CLASSES[lex.tone].text,
      entries: byType.get(type)!.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/** "Character" -> "Characters". The sidebar labels are plural, so these are
 *  too; a heading that read "Character" over four rows looks like a mistake. */
function plural(term: string): string {
  if (/(s|x|z|ch|sh)$/i.test(term)) return `${term}es`;
  if (/[^aeiou]y$/i.test(term)) return `${term.slice(0, -1)}ies`;
  return `${term}s`;
}
