// features/audiobook/CastPanel.tsx
// =================================
// Who narrates this book, and who speaks in it (spec 27). The narrator
// is always here and cannot be removed; characters are added by the
// writer and given a voice each.
//
// Two things this screen has to teach without a paragraph of text:
//
//   ONE ENGINE, MANY VOICES. Speakers pick a voice, never a provider.
//   A cast that mixed the free local narrator with a paid engine would
//   price and fail line by line, and half a chapter could come back in a
//   voice nobody paid for.
//
//   THE MANUSCRIPT ALREADY KNOWS THE NAMES. A writer who typed
//   [voice:Elena] before opening this panel should not have to retype
//   "Elena" here -- those names are offered as one-click adds. Making
//   someone re-enter what the app just read is the app forgetting.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Users, X } from "lucide-react";

import { fetchCast, saveCast } from "./api";
import type { CastReport } from "./api";
import { WhatsThis } from "./WhatsThis";
import type { NarratorVoice } from "./types";

interface CastPanelProps {
  workspacePath: string;
  /** The engine's voice roster. Empty while it loads -- the panel still
   *  works, it just shows ids until the labels arrive. */
  voices: NarratorVoice[];
  onClose: () => void;
  /** Saved: whoever is behind this needs to re-read the cast (the rail's
   *  freshness badges above all -- recasting outdates a character's
   *  lines). */
  onSaved?: () => void;
}

interface Row {
  display_name: string;
  voice_id: string;
}

export function CastPanel({ workspacePath, voices, onClose, onSaved }: CastPanelProps) {
  const [report, setReport] = useState<CastReport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [narratorVoice, setNarratorVoice] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchCast(workspacePath);
      applyReport(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the cast.");
    }
  }, [workspacePath]);

  function applyReport(fresh: CastReport) {
    setReport(fresh);
    const characters = fresh.speakers
      .filter(s => s.role === "character")
      .map(s => ({ display_name: s.display_name, voice_id: s.voice_id }));
    const narrator = fresh.speakers.find(s => s.role === "narrator");
    setRows(characters);
    setNarratorVoice(narrator?.voice_id ?? "");
    setSnapshot(JSON.stringify({ characters, narrator: narrator?.voice_id ?? "" }));
  }

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") attemptClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dirty = report !== null
    && JSON.stringify({ characters: rows, narrator: narratorVoice }) !== snapshot;

  function attemptClose() {
    if (dirty && !window.confirm(
      "You have unsaved cast changes. Close without saving?")) return;
    onClose();
  }

  function addRow(name = "") {
    setRows(prev => [...prev, { display_name: name, voice_id: "" }]);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      applyReport(await saveCast(
        workspacePath,
        rows.filter(r => r.display_name.trim()),
        narratorVoice,
      ));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the cast.");
    } finally {
      setSaving(false);
    }
  }

  // A name typed twice would make [voice:Elena] ambiguous, and the
  // ambiguity would be resolved silently at render time.
  const duplicates = new Set(
    rows.map(r => r.display_name.trim().toLowerCase())
      .filter((name, index, all) => name && all.indexOf(name) !== index));

  function voiceSelect(value: string, onChange: (v: string) => void, label: string) {
    return (
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
      >
        <option value="">Same as the narrator</option>
        {voices.map(voice => (
          <option key={voice.id} value={voice.id}>{voice.label}</option>
        ))}
        {value && !voices.some(v => v.id === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Cast"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <Users size={15} className="text-violet-300" />
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">Cast</h2>
          <button
            onClick={attemptClose}
            aria-label="Close cast"
            className="rounded p-1 text-zinc-500 hover:text-zinc-100"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!report ? (
            <p className="text-xs text-zinc-400">
              <Loader2 size={12} className="mr-1 inline animate-spin" />
              Loading the cast...
            </p>
          ) : (
            <div className="space-y-5">
              <p className="text-[11px] leading-relaxed text-zinc-400">
                Mark a character's lines with{" "}
                <code className="rounded bg-zinc-800 px-1 text-[10px] text-violet-300">
                  [voice:Elena]...[/voice]
                </code>{" "}
                in the narration editor, and they will be read in that
                character's voice. Everything else is the narrator.
              </p>

              <section>
                <h3 className="mb-2 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Narrator
                </h3>
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[11px] text-zinc-200">
                    Narrator
                  </span>
                  {voiceSelect(narratorVoice, setNarratorVoice, "Narrator voice")}
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Reads everything that is not inside a voice marker. This is
                  the same voice as the one in the narration rail.
                </p>
              </section>

              <section>
                <h3 className="mb-2 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Characters
                </h3>

                {/* Names the manuscript already uses. One click each --
                    the app read them, so the app should offer them. */}
                {report.unassigned_names.length > 0 && (
                  <div className="mb-3 rounded border border-violet-800 bg-violet-950/30 px-2.5 py-2">
                    <p className="text-[11px] text-violet-200">
                      Your narration already asks for{" "}
                      {report.unassigned_names.length === 1 ? "a voice" : "voices"}{" "}
                      that {report.unassigned_names.length === 1 ? "is" : "are"} not
                      in the cast yet:
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {report.unassigned_names
                        .filter(name => !rows.some(
                          r => r.display_name.trim().toLowerCase() === name.toLowerCase()))
                        .map(name => (
                          <button
                            key={name}
                            onClick={() => addRow(name)}
                            className="inline-flex items-center gap-1 rounded border border-violet-700 px-2 py-0.5 text-[11px] text-violet-200 hover:border-violet-500 hover:text-violet-100"
                          >
                            <Plus size={10} /> {name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  {rows.map((row, index) => {
                    const clash = row.display_name.trim()
                      && duplicates.has(row.display_name.trim().toLowerCase());
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          aria-label={`Character ${index + 1} name`}
                          value={row.display_name}
                          placeholder="Elena"
                          onChange={e => setRows(prev => prev.map((r, i) =>
                            i === index ? { ...r, display_name: e.target.value } : r))}
                          className={"w-32 shrink-0 rounded border bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 "
                            + (clash ? "border-rose-600" : "border-zinc-700")}
                        />
                        {voiceSelect(
                          row.voice_id,
                          value => setRows(prev => prev.map((r, i) =>
                            i === index ? { ...r, voice_id: value } : r)),
                          `Voice for character ${index + 1}`)}
                        <button
                          onClick={() => setRows(prev => prev.filter((_r, i) => i !== index))}
                          aria-label={`Remove ${row.display_name || "character"}`}
                          className="shrink-0 rounded p-1 text-zinc-600 hover:text-rose-400"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {duplicates.size > 0 && (
                  <p className="mt-1.5 text-[10px] text-rose-300">
                    Two characters share a name. The narration says
                    [voice:Name], so each name has to belong to one voice.
                  </p>
                )}

                <button
                  onClick={() => addRow()}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-violet-600 hover:text-violet-300"
                >
                  <Plus size={11} /> Add a character
                </button>

                <div className="mt-2">
                  <WhatsThis label="Can characters use different engines?">
                    No -- one book, one engine. Every voice here comes from
                    the narration engine chosen in Audiobook Settings, and
                    only the voice changes per character. Mixing engines
                    would mean paying for some lines and not others, and a
                    failure part-way through a chapter would leave half of
                    it in a voice you did not choose. Switching the engine
                    later keeps your cast; you just re-pick the voices.
                  </WhatsThis>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-zinc-800 px-5 py-3">
          {error && (
            <p className="min-w-0 flex-1 truncate text-[11px] text-rose-300" title={error}>
              {error}
            </p>
          )}
          {!error && dirty && (
            <p className="flex-1 text-[11px] text-amber-300">Unsaved changes.</p>
          )}
          {!error && !dirty && <span className="flex-1" />}
          <button
            onClick={attemptClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!dirty || saving || duplicates.size > 0}
            className="inline-flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save Cast
          </button>
        </div>
      </div>
    </div>
  );
}
