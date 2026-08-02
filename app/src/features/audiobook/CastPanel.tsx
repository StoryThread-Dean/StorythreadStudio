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

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Play, Plus, Users, X } from "lucide-react";

import { fetchCast, fetchVoiceOptions, previewVoice, saveCast } from "./api";
import type { CastReport, VoiceGroup } from "./api";
import { WhatsThis } from "./WhatsThis";

interface CastPanelProps {
  workspacePath: string;
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

const SAMPLE_LINE =
  "The road disappeared beneath the gathering snow, and somewhere behind her, "
  + "a second set of footsteps stopped.";

export function CastPanel({ workspacePath, onClose, onSaved }: CastPanelProps) {
  const [report, setReport] = useState<CastReport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [narratorVoice, setNarratorVoice] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<VoiceGroup[]>([]);
  const [sampling, setSampling] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    void (async () => {
      try {
        setGroups((await fetchVoiceOptions(workspacePath)).groups);
      } catch {
        // No roster is a thinner panel, never a broken one -- stored
        // ids still show and still save.
      }
    })();
  }, [workspacePath]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  /** Where a voice id lives, so the row can say what it is and whether
      it can be auditioned for free. */
  function groupOf(voiceId: string): VoiceGroup | undefined {
    return groups.find(g => g.voices.some(v => v.id === voiceId));
  }

  const localGroup = groups.find(g => g.provider === "local-kokoro");
  const currentGroup = groups.find(g => g.is_current) ?? localGroup;

  async function sample(voiceId: string, key: string) {
    if (!voiceId || sampling) return;
    setSampling(key);
    setError(null);
    try {
      const blob = await previewVoice(SAMPLE_LINE, voiceId, workspacePath);
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not play that voice.");
    } finally {
      setSampling(null);
    }
  }

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

  /** The voice picker: every engine's roster, grouped and labelled, with
      the ones this book cannot use disabled rather than hidden. Hiding
      them would make the app look like it has four voices; offering them
      silently would let someone cast against voices that cannot speak. */
  function voiceRow(value: string, onChange: (v: string) => void,
                    label: string, sampleKey: string) {
    const owner = groupOf(value);
    const canSample = !!value && !!owner?.free_preview;
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <select
          aria-label={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
        >
          <option value="">Same as the narrator</option>
          {groups.map(group => (
            <optgroup
              key={group.key}
              label={group.usable ? group.label : `${group.label} -- unavailable`}
            >
              {group.voices.map(voice => (
                <option key={`${group.key}:${voice.id}`} value={voice.id}
                        disabled={!group.usable}>
                  {voice.label}
                </option>
              ))}
            </optgroup>
          ))}
          {value && !owner && <option value={value}>{value}</option>}
        </select>
        <button
          onClick={() => void sample(value, sampleKey)}
          disabled={!canSample || sampling !== null}
          title={canSample
            ? "Hear this voice -- free, runs on your computer"
            : value
              ? "Hosted voices are auditioned in the Premium Narration panel, where the cost is quoted first"
              : "Pick a voice first"}
          aria-label={`Sample ${label}`}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-1.5 py-1 text-[10px] text-zinc-300 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
        >
          {sampling === sampleKey
            ? <Loader2 size={10} className="animate-spin" />
            : <Play size={10} />}
          Sample
        </button>
      </span>
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
              {/* What this does and what it costs, BEFORE anybody
                  invests an afternoon in casting a novel. The first
                  question a writer asks here is "can I even do this on
                  the free narrator?" -- so that is the first sentence. */}
              <div className="rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2.5">
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  <span className="font-semibold text-emerald-300">
                    Yes -- this works on the free local narrator.
                  </span>{" "}
                  All {localGroup?.voices.length || 54} of its voices, unlimited,
                  no key, nothing to pay. Mark a character's lines with{" "}
                  <code className="rounded bg-zinc-800 px-1 text-[10px] text-violet-300">
                    [voice:Elena]...[/voice]
                  </code>{" "}
                  and they are read in that voice; everything else stays with
                  the narrator.
                </p>
                <p className="mt-2 text-[11px] font-medium text-zinc-400">
                  Before you cast a whole novel, the limits:
                </p>
                <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-zinc-400">
                  <li>
                    <span className="text-zinc-300">One book, one engine.</span>{" "}
                    Every voice comes from{" "}
                    {currentGroup?.label.split(" -- ").slice(-1)[0] ?? "your narration engine"},
                    chosen in Audiobook Settings. Characters cannot each use a
                    different service.
                  </li>
                  <li>
                    <span className="text-zinc-300">Switching engines keeps the
                    cast but not the voices.</span> Rosters differ, so you
                    re-pick a voice per character -- and that re-narrates their
                    lines.
                  </li>
                  <li>
                    <span className="text-zinc-300">These are voices, not
                    performances.</span> A character's voice is consistent, but
                    the engine does not act: no shouting, whispering, or
                    emotion per line. Pace markers are the only performance
                    control.
                  </li>
                  <li>
                    <span className="text-zinc-300">Every marked line costs a
                    separate render.</span> Free locally. On a paid engine you
                    are billed by the character either way, so casting does not
                    cost extra -- but re-casting one character does re-render
                    all of her lines.
                  </li>
                  <li>
                    <span className="text-zinc-300">A name the cast does not
                    know reads as the narrator.</span> The editor warns you on
                    save rather than surprising you in the audio.
                  </li>
                </ul>
              </div>

              {/* Engines that exist but cannot narrate this book, each
                  saying which of the two reasons applies. A writer who
                  scrolls the voice list and finds half of it greyed out
                  needs the reason ON SCREEN, not in a tooltip. */}
              {groups.filter(g => !g.usable && g.note).map(group => (
                <div key={group.key}
                     className="rounded border border-amber-800 bg-amber-950/30 px-2.5 py-2">
                  <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-300">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {group.label}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-amber-200/90">
                    {group.note}
                  </p>
                </div>
              ))}

              <section>
                <h3 className="mb-2 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Narrator
                </h3>
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[11px] text-zinc-200">
                    Narrator
                  </span>
                  {voiceRow(narratorVoice, setNarratorVoice, "Narrator voice", "narrator")}
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
                        {voiceRow(
                          row.voice_id,
                          value => setRows(prev => prev.map((r, i) =>
                            i === index ? { ...r, voice_id: value } : r)),
                          `Voice for character ${index + 1}`,
                          `row-${index}`)}
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
