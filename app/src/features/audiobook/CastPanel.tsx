// features/audiobook/CastPanel.tsx
// =================================
// Who narrates this book, and who speaks in it (spec 27).
//
// Written against the three things this app is for. TEACH: one short
// line says what a cast is and shows the marker, and everything deeper
// lives behind "What's this?" so nobody has to read a wall of text to
// start. ASSIST: the names the manuscript already uses are one click to
// add, and the walkthrough does the line-by-line marking a writer would
// otherwise do by hand. REMOVE GUESSWORK: every voice can be heard
// before it is chosen, and the panel never offers a voice that cannot
// speak.
//
// The model that took two tries to get right: a book has TWO narration
// passes at once -- the free local narrator it is drafted with, and the
// hosted engine it may be printed with. Voice ids do not carry between
// them, so each speaker holds one of each. An earlier build stored a
// single voice and decided availability by "is this the book's current
// engine", which greyed out the entire local roster the moment a print
// engine was chosen and papered the panel with alerts for engines nobody
// had selected.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Play, Plus, Users, Wand2, X } from "lucide-react";

import { fetchCast, fetchVoiceOptions, previewVoice, saveCast } from "./api";
import type { CastReport, VoiceRoster } from "./api";
import { WhatsThis } from "./WhatsThis";

interface CastPanelProps {
  workspacePath: string;
  onClose: () => void;
  /** Saved: the rail re-reads the cast (recasting outdates that
   *  character's lines, and the toolbar shows the count). */
  onSaved?: () => void;
  /** Close and wrap the editor's current selection in a voice span. */
  onMarkSelection?: () => void;
  /** Close and start the line-by-line walk. */
  onStartWalkthrough?: () => void;
}

interface Row {
  display_name: string;
  voice_id: string;
  premium_voice_id: string;
}

const SAMPLE_LINE =
  "The road disappeared beneath the gathering snow, and somewhere behind her, "
  + "a second set of footsteps stopped.";

export function CastPanel({
  workspacePath, onClose, onSaved, onMarkSelection, onStartWalkthrough,
}: CastPanelProps) {
  const [report, setReport] = useState<CastReport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [narratorVoice, setNarratorVoice] = useState("");
  const [narratorPrintVoice, setNarratorPrintVoice] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRoster, setDraftRoster] = useState<VoiceRoster | null>(null);
  const [printRoster, setPrintRoster] = useState<VoiceRoster | null>(null);
  const [sampling, setSampling] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function applyReport(fresh: CastReport) {
    setReport(fresh);
    const characters = fresh.speakers
      .filter(s => s.role === "character")
      .map(s => ({
        display_name: s.display_name,
        voice_id: s.voice_id,
        premium_voice_id: s.premium_voice_id ?? "",
      }));
    const narrator = fresh.speakers.find(s => s.role === "narrator");
    setRows(characters);
    setNarratorVoice(narrator?.voice_id ?? "");
    setNarratorPrintVoice(narrator?.premium_voice_id ?? "");
    setSnapshot(JSON.stringify({
      characters,
      narrator: narrator?.voice_id ?? "",
      narratorPrint: narrator?.premium_voice_id ?? "",
    }));
  }

  const load = useCallback(async () => {
    try {
      applyReport(await fetchCast(workspacePath));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the cast.");
    }
  }, [workspacePath]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const options = await fetchVoiceOptions(workspacePath);
        setDraftRoster(options.draft);
        setPrintRoster(options.print);
      } catch {
        // No roster is a thinner panel, never a broken one -- stored
        // ids still show and still save.
      }
    })();
  }, [workspacePath]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const dirty = report !== null && JSON.stringify({
    characters: rows, narrator: narratorVoice, narratorPrint: narratorPrintVoice,
  }) !== snapshot;

  const attemptClose = useCallback(() => {
    if (dirty && !window.confirm(
      "You have unsaved cast changes. Close without saving?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") attemptClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attemptClose]);

  function addRow(name = "") {
    setRows(prev => [...prev, { display_name: name, voice_id: "", premium_voice_id: "" }]);
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
        narratorPrintVoice,
      ));
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the cast.");
    } finally {
      setSaving(false);
    }
  }

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

  // A name typed twice would make [voice:Elena] ambiguous, and the
  // ambiguity would be resolved silently at render time.
  const duplicates = new Set(
    rows.map(r => r.display_name.trim().toLowerCase())
      .filter((name, index, all) => name && all.indexOf(name) !== index));

  const printReady = !!printRoster?.configured && !!printRoster.has_api_key
    && printRoster.voices.length > 0;

  /** A draft-voice picker plus its Sample button. Local previews are
      free and instant, which is what makes "hear it before you choose
      it" a reasonable default rather than a paid gamble. */
  function draftVoice(value: string, onChange: (v: string) => void,
                      label: string, sampleKey: string) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <select
          aria-label={label}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
        >
          <option value="">Same as the narrator</option>
          {(draftRoster?.voices ?? []).map(voice => (
            <option key={voice.id} value={voice.id}>{voice.label}</option>
          ))}
          {value && !(draftRoster?.voices ?? []).some(v => v.id === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
        <button
          onClick={() => void sample(value, sampleKey)}
          disabled={!value || sampling !== null}
          title={value ? "Hear this voice -- free, runs on your computer"
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

  function printVoice(value: string, onChange: (v: string) => void, label: string) {
    return (
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
      >
        <option value="">Same as the narrator</option>
        {(printRoster?.voices ?? []).map(voice => (
          <option key={voice.id} value={voice.id}>{voice.label}</option>
        ))}
        {value && !(printRoster?.voices ?? []).some(v => v.id === value) && (
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
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
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
              {/* ONE line of what, ONE example, and depth on request. */}
              <div>
                <p className="text-[12px] leading-relaxed text-zinc-300">
                  Give a character their own voice, and every line you mark
                  as theirs is read in it. Everything else stays with the
                  narrator. Free on your local narrator.
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-zinc-500">
                  <span className="text-violet-300">[voice:Elena]</span>
                  "This cannot continue," she said.
                  <span className="text-violet-300">[/voice]</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-4">
                  <WhatsThis label="How do I mark the lines?">
                    Three ways, and you can mix them. Select a line and press
                    Mark selection below -- the marker is typed around it for
                    you. Or run the Cast Walkthrough, which finds every line
                    of dialogue in the chapter and lets you click who says
                    each one. Or type the markers yourself; they are plain
                    text and the narration copy stays readable in any editor.
                    Nothing you do here is saved until you press Save in the
                    editor, so it is always safe to try.
                  </WhatsThis>
                  <WhatsThis label="What are the limits?">
                    A voice is not a performance. The engine gives each
                    character a consistent voice, but it does not act -- no
                    shouting, whispering, or emotion per line. Pace markers
                    are the only performance control there is.
                    <br /><br />
                    Voice ids do not carry between engines, so a character
                    needs a voice for each pass you use: one from your free
                    local narrator for drafting, and one from your print
                    engine if you print with a paid voice. Changing a
                    character's voice re-narrates their lines and nothing
                    else.
                    <br /><br />
                    A name your cast does not know reads as the narrator.
                    The editor warns you when you save rather than
                    surprising you in the audio.
                  </WhatsThis>
                  <WhatsThis label="Does casting cost more?">
                    No. Locally, everything is free and unlimited. On a paid
                    engine you are billed by the character whether one voice
                    reads the book or six, so casting itself costs nothing
                    extra. What does cost is CHANGING a voice later: that
                    character's lines are re-narrated, and re-narrating is
                    what you pay for.
                  </WhatsThis>
                </div>
              </div>

              {/* Only ever ONE warning, and only about an engine the
                  writer actually chose. */}
              {draftRoster?.note && (
                <p className="flex items-start gap-1.5 rounded border border-amber-800 bg-amber-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {draftRoster.note}
                </p>
              )}
              {printRoster?.configured && printRoster.note && (
                <p className="flex items-start gap-1.5 rounded border border-amber-800 bg-amber-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {printRoster.note}
                </p>
              )}

              <section>
                <div className="mb-2 flex items-baseline gap-2 border-b border-zinc-800 pb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Voices
                  </h3>
                  <span className="text-[10px] text-zinc-600">
                    Draft = your free local narrator
                    {printReady && ` -- Print = ${printRoster?.label}`}
                  </span>
                </div>

                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
                  <span className="w-32 shrink-0">Character</span>
                  <span className="flex-1">Draft voice (free)</span>
                  {printReady && <span className="flex-1">Print voice</span>}
                  <span className="w-5 shrink-0" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-[11px] text-zinc-200">
                      Narrator
                    </span>
                    {draftVoice(narratorVoice, setNarratorVoice,
                                "Narrator voice", "narrator")}
                    {printReady && printVoice(narratorPrintVoice,
                                              setNarratorPrintVoice,
                                              "Narrator print voice")}
                    <span className="w-5 shrink-0" />
                  </div>

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
                        {draftVoice(
                          row.voice_id,
                          value => setRows(prev => prev.map((r, i) =>
                            i === index ? { ...r, voice_id: value } : r)),
                          `Voice for character ${index + 1}`,
                          `row-${index}`)}
                        {printReady && printVoice(
                          row.premium_voice_id,
                          value => setRows(prev => prev.map((r, i) =>
                            i === index ? { ...r, premium_voice_id: value } : r)),
                          `Print voice for character ${index + 1}`)}
                        <button
                          onClick={() => setRows(prev => prev.filter((_r, i) => i !== index))}
                          aria-label={`Remove ${row.display_name || "character"}`}
                          className="w-5 shrink-0 rounded text-zinc-600 hover:text-rose-400"
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

                {/* Names the manuscript already uses. One click each --
                    the app read them, so the app should offer them. */}
                {report.unassigned_names.filter(name => !rows.some(
                  r => r.display_name.trim().toLowerCase() === name.toLowerCase())).length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">
                      Already in your narration:
                    </span>
                    {report.unassigned_names
                      .filter(name => !rows.some(
                        r => r.display_name.trim().toLowerCase() === name.toLowerCase()))
                      .map(name => (
                        <button
                          key={name}
                          onClick={() => addRow(name)}
                          className="inline-flex items-center gap-1 rounded border border-violet-700 px-2 py-0.5 text-[11px] text-violet-200 hover:border-violet-500"
                        >
                          <Plus size={10} /> {name}
                        </button>
                      ))}
                  </div>
                )}

                <button
                  onClick={() => addRow()}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-violet-600 hover:text-violet-300"
                >
                  <Plus size={11} /> Add a character
                </button>
              </section>

              {/* The two marking tools, HERE rather than on the main
                  toolbar: they exist only for writers who chose to use a
                  cast, and a book with a single narrator should never
                  see them. */}
              <section>
                <h3 className="mb-2 border-b border-zinc-800 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Mark who speaks
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => { onStartWalkthrough?.(); onClose(); }}
                    disabled={rows.length === 0 || dirty}
                    title={dirty
                      ? "Save the cast first, then walk the dialogue."
                      : "Go through the chapter's dialogue line by line and click who says each one"}
                    className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    <Wand2 size={12} /> Cast Walkthrough
                  </button>
                  <button
                    onClick={() => { onMarkSelection?.(); onClose(); }}
                    disabled={rows.length === 0}
                    title="Wrap the text you have selected in the editor with a voice marker"
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-200 hover:border-violet-600 hover:text-violet-300 disabled:opacity-40"
                  >
                    Mark selection
                  </button>
                  {rows.length === 0 && (
                    <span className="text-[10px] text-zinc-500">
                      Add a character first.
                    </span>
                  )}
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
