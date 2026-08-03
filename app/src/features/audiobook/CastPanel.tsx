// features/audiobook/CastPanel.tsx
// =================================
// The Cast workbench (spec 27): one self-contained window where a writer
// casts their characters AND walks the chapter's dialogue, watching each
// decision land on their own text.
//
// It is not a settings dialog. The voice list is configuration that gets
// out of the way -- collapsed as soon as a cast exists -- and the
// dialogue window below it is the actual work surface. That ordering is
// deliberate: the job is marking who speaks, not filling in a form.
//
// Built against the three things this app is for:
//   TEACH -- the window shows real markers on real prose, so the syntax
//     is learned by watching rather than by reading, and every deeper
//     question sits behind a full-width button nobody has to open.
//   ASSIST -- a hundred lines of dialogue is an afternoon by hand; the
//     walk turns each one into a single click.
//   REMOVE GUESSWORK -- the colour says who speaks, the marker says what
//     will be written, and a voice can be heard before it is chosen.
//
// Nothing here writes to disk. Every change edits the editor buffer, and
// the editor's own Save is still the only thing that commits -- the same
// rule every other tool in this app follows.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, Plus, Users, X,
} from "lucide-react";

import {
  analyzeSpeakers, fetchCast, fetchSpeakerPassEstimate, fetchVoiceOptions,
  previewVoice, saveCast,
} from "./api";
import type { CastReport, SpeakerPassEstimate, VoiceRoster } from "./api";
import { castColor, castTextColor } from "./castColors";
import { DialogueWindow } from "./DialogueWindow";
import {
  chapterCast, chapterRanges, countCharacterUsage, detectSpeakerNames,
  mergeAiGuesses, removeCharacterMarkers, scanDialogue, setStopVoice,
} from "./speakerScan";
import type { ChapterRange, DialogueStop } from "./speakerScan";

interface CastPanelProps {
  workspacePath: string;
  /** The narration buffer, live from the editor. */
  content: string;
  /** Buffer edit -- the caller marks the editor dirty. */
  onContentChange: (next: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}

interface Row {
  display_name: string;
  /** Nicknames the book uses for this character. */
  aliases: string[];
  voice_id: string;
  premium_voice_id: string;
}

const SAMPLE_LINE =
  "The road disappeared beneath the gathering snow, and somewhere behind her, "
  + "a second set of footsteps stopped.";

const NARRATOR = "Narrator";

// How the chapter gets marked. The ladder is ordered by how much is done
// FOR the writer, and the free rung sits above every paid one on purpose:
// the prose usually names its own speakers ("...," Lara said), and a tag
// the writer wrote is not a guess. The AI is only ever asked about what
// is left over, which is both cheaper and the part it is good at.
type PassMode = "manual" | "free" | "free-ai" | "auto";

const MODES: { value: PassMode; label: string; blurb: string; usesAi: boolean }[] = [
  { value: "manual", label: "Manual -- I'll do every line", usesAi: false,
    blurb: "Nothing is decided for you. Walk the chapter and click who speaks." },
  { value: "free", label: "Automatic (free) -- use my dialogue tags", usesAi: false,
    blurb: "Marks every line your prose already names, and stops on the rest. "
         + "No AI, no cost, instant." },
  { value: "free-ai", label: "Automatic + AI -- recommended", usesAi: true,
    blurb: "Your tags first, then the AI names the lines it is confident "
         + "about. Stops on anything it is unsure of." },
  { value: "auto", label: "Fully automatic (AI) -- expect mistakes", usesAi: true,
    blurb: "Marks every line, including the ones the AI is unsure about. "
         + "Fastest, and the one that needs reviewing afterwards." },
];

// Above this, an AI guess is confident enough to apply without asking.
// A model's own number is not calibrated -- it is a ranking, not a
// probability -- so this is a tuned threshold, not a promise.
const CONFIDENT = 0.8;

export function CastPanel({
  workspacePath, content, onContentChange, onClose, onSaved,
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
  const [voicesOpen, setVoicesOpen] = useState<boolean | null>(null);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [stopIndex, setStopIndex] = useState(0);
  const [showOthers, setShowOthers] = useState(false);
  // Opens on the free rung, not the recommended one. A panel that opens
  // already pointed at a paid action presumes; the recommendation is
  // labelled in the list where the writer can choose it deliberately.
  const [mode, setMode] = useState<PassMode>("free");
  const [passState, setPassState] = useState<"idle" | "running">("idle");
  const [passNote, setPassNote] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<SpeakerPassEstimate | null>(null);
  // Provenance, session-only: which lines the AI decided rather than the
  // writer or their own tags. Keyed by the line's first quoted words,
  // which survive the offsets shifting underneath. This is what makes
  // the fastest mode safe -- the review is scoped instead of a hunt.
  const [aiMarked, setAiMarked] = useState<Set<string>>(new Set());
  const [reviewOnly, setReviewOnly] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── The cast ────────────────────────────────────────────────────────

  function applyReport(fresh: CastReport) {
    setReport(fresh);
    const characters = fresh.speakers
      .filter(s => s.role === "character")
      .map(s => ({
        display_name: s.display_name,
        aliases: s.aliases ?? [],
        voice_id: s.voice_id,
        premium_voice_id: s.premium_voice_id ?? "",
      }));
    const narrator = fresh.speakers.find(s => s.role === "narrator");
    setRows(characters);
    setNarratorVoice(narrator?.voice_id ?? "");
    setNarratorPrintVoice(narrator?.premium_voice_id ?? "");
    setIgnored(fresh.ignored_names ?? []);
    setSnapshot(JSON.stringify({
      characters, narrator: narrator?.voice_id ?? "",
      narratorPrint: narrator?.premium_voice_id ?? "",
      ignored: fresh.ignored_names ?? [],
    }));
    // Voices open when there is nothing cast yet (that IS the job), and
    // out of the way once there is (the job is now the dialogue).
    setVoicesOpen(prev => prev ?? characters.length === 0);
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
      } catch { /* stored ids still show and still save */ }
    })();
  }, [workspacePath]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const dirty = report !== null && JSON.stringify({
    characters: rows, narrator: narratorVoice, narratorPrint: narratorPrintVoice,
    ignored,
  }) !== snapshot;

  const attemptClose = useCallback(() => {
    if (dirty && !window.confirm(
      "You have unsaved cast changes. Close without saving them?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") attemptClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attemptClose]);

  async function handleSaveCast() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      applyReport(await saveCast(
        workspacePath, rows.filter(r => r.display_name.trim()),
        narratorVoice, narratorPrintVoice, ignored));
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

  /** Removing a character is the one destructive act in this panel, so
      it counts the real damage first. An unused character goes quietly;
      a used one says how many lines and which chapters, and makes clear
      the WORDS survive -- those lines simply go back to the narrator. */
  function removeCharacter(index: number) {
    const name = rows[index].display_name.trim();
    const usage = name ? countCharacterUsage(content, name) : { lines: 0, chapters: [] };
    if (usage.lines > 0) {
      const where = usage.chapters.length === 1
        ? `in "${usage.chapters[0]}"`
        : `across ${usage.chapters.length} chapters`;
      const ok = window.confirm(
        `${name} is used on ${usage.lines} line${usage.lines === 1 ? "" : "s"} `
        + `${where}.\n\n`
        + "Removing this character deletes those voice markers everywhere in "
        + "the book, not just this chapter. The dialogue itself stays -- those "
        + "lines go back to the narrator.\n\nAre you sure?");
      if (!ok) return;
      onContentChange(removeCharacterMarkers(content, name));
    }
    setRows(prev => prev.filter((_r, i) => i !== index));
  }

  // ── The walk ────────────────────────────────────────────────────────

  const chapters = useMemo<ChapterRange[]>(() => chapterRanges(content), [content]);
  const chapter = chapters[Math.min(chapterIndex, chapters.length - 1)];
  const allStops = useMemo(
    () => (chapter ? scanDialogue(content, chapter) : []),
    [content, chapter]);
  // "Review AI choices" narrows the walk to the lines the model decided,
  // which is what makes the fastest mode safe to use: checking twenty
  // guesses is work, hunting for them in a hundred lines is not.
  const stops = useMemo(
    () => (reviewOnly
      ? allStops.filter(s => aiMarked.has(s.quotes[0]?.text ?? ""))
      : allStops),
    [allStops, reviewOnly, aiMarked]);
  const stop = stops[stopIndex] ?? null;

  const castNames = useMemo(
    () => [NARRATOR, ...rows.map(r => r.display_name.trim()).filter(Boolean)],
    [rows]);

  /** Which character a detected or hand-typed name belongs to. "Lexi"
   *  resolves to Alexandra; an unknown name resolves to nothing. */
  const resolveName = useCallback((name: string): string => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return "";
    const owner = rows.find(r =>
      [r.display_name, ...r.aliases].some(n => n.trim().toLowerCase() === wanted));
    return owner ? owner.display_name.trim() : "";
  }, [rows]);

  // Every spelling already spoken for -- a name belongs to exactly one
  // character, or the marker would be ambiguous.
  const taken = useMemo(() => new Set([
    ...rows.flatMap(r => [r.display_name, ...r.aliases]),
    ...ignored,
  ].map(n => n.trim().toLowerCase()).filter(Boolean)), [rows, ignored]);

  // Names the book speaks for that nobody has claimed yet.
  const detected = useMemo(
    () => detectSpeakerNames(content).filter(n => !taken.has(n.toLowerCase())),
    [content, taken]);

  // Who this chapter actually uses: marked speakers plus anyone its prose
  // names in a tag. A thirty-character book shows three buttons.
  const present = useMemo(() => {
    if (!chapter) return [];
    const here = chapterCast(content, chapter).map(n => n.toLowerCase());
    return castNames.filter(n =>
      n === NARRATOR || here.includes(n.toLowerCase()));
  }, [content, chapter, castNames]);
  const others = castNames.filter(n => !present.includes(n));

  const assignedCount = allStops.filter(s => s.assigned).length;
  const remaining = allStops.length - assignedCount;
  const aiCount = allStops.filter(
    s => s.assigned && aiMarked.has(s.quotes[0]?.text ?? "")).length;

  // Start on the first undecided line -- the writer opened this to work,
  // not to scroll past what they already did.
  useEffect(() => {
    const first = stops.findIndex(s => !s.assigned);
    setStopIndex(first < 0 ? 0 : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);

  // ── Running a pass ──────────────────────────────────────────────────

  const chapterChars = chapter ? chapter.end - chapter.start : 0;
  const activeMode = MODES.find(m => m.value === mode)!;

  // Only fetched when a paid mode is picked, and only for this chapter.
  useEffect(() => {
    if (!activeMode.usesAi || !chapterChars) { setEstimate(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await fetchSpeakerPassEstimate(workspacePath, chapterChars);
        if (!cancelled) setEstimate(fresh);
      } catch { if (!cancelled) setEstimate(null); }
    })();
    return () => { cancelled = true; };
  }, [activeMode.usesAi, chapterChars, workspacePath]);

  /** Apply a batch of decisions in one pass over the buffer.
   *
   *  Right to left, so each splice leaves the earlier offsets valid --
   *  and never over a line the writer already decided: their answer
   *  outranks both their tags and the model.
   */
  function applyBatch(decided: Array<{ stop: DialogueStop; name: string }>,
                      fromAi: Set<string>) {
    let next = content;
    for (const { stop, name } of [...decided].reverse()) {
      next = setStopVoice(next, stop, name);
    }
    if (next !== content) onContentChange(next);
    if (fromAi.size) {
      setAiMarked(prev => new Set([...prev, ...fromAi]));
    }
  }

  async function runPass() {
    if (!chapter || passState === "running") return;
    setPassNote(null);
    // Nicknames resolve: a chapter that says "Lexi said" marks Alexandra.
    const inCast = (name: string) => !!resolveName(name);

    // The free rung, always: every line the writer's own prose names.
    const open = stops.filter(s => !s.assigned);
    const tagged = open.filter(s => s.guessSource === "tag" && inCast(s.guess));
    const uncast = [...new Set(open
      .filter(s => s.guess && !inCast(s.guess))
      .map(s => s.guess))];

    if (mode === "manual") {
      setPassNote("Manual: nothing was decided for you. Walk the lines below.");
      return;
    }

    if (mode === "free") {
      applyBatch(tagged.map(s => ({ stop: s, name: resolveName(s.guess) })), new Set());
      setPassNote(
        `Marked ${tagged.length} line${tagged.length === 1 ? "" : "s"} from your `
        + `own dialogue tags. ${open.length - tagged.length} left to decide.`
        + (uncast.length ? ` Not cast yet: ${uncast.join(", ")}.` : ""));
      return;
    }

    // The AI rungs. The free pass runs FIRST, so the model is only ever
    // asked about what the prose did not already answer.
    setPassState("running");
    try {
      const body = content.slice(chapter.start, chapter.end);
      const result = await analyzeSpeakers(workspacePath, body.slice(0, 24000));
      const merged = mergeAiGuesses(stops, result.proposals);
      const decided: Array<{ stop: DialogueStop; name: string }> = [];
      const fromAi = new Set<string>();
      for (const stop of merged) {
        if (stop.assigned || !stop.guess || !inCast(stop.guess)) continue;
        const sure = stop.guessSource === "tag"
          || (stop.confidence ?? 0) >= CONFIDENT;
        if (mode === "auto" || sure) {
          decided.push({ stop, name: resolveName(stop.guess) });
          if (stop.guessSource === "ai") fromAi.add(stop.quotes[0].text);
        }
      }
      applyBatch(decided, fromAi);
      const left = open.length - decided.length;
      setPassNote(
        `Marked ${decided.length} line${decided.length === 1 ? "" : "s"} `
        + `(${tagged.length} from your tags, ${fromAi.size} by AI). `
        + `${left} left to decide.`
        + (fromAi.size ? " Use Review AI choices to check its work." : "")
        + (uncast.length ? ` Not cast yet: ${uncast.join(", ")}.` : ""));
    } catch (e) {
      setPassNote((e instanceof Error ? e.message : "The AI pass failed.")
        + " Your tags and the manual walk below still work.");
    } finally {
      setPassState("idle");
    }
  }

  const assign = useCallback((name: string | null) => {
    if (!stop) return;
    onContentChange(setStopVoice(content, stop, name));
  }, [stop, content, onContentChange]);

  const accept = useCallback(() => {
    setStopIndex(i => Math.min(i + 1, Math.max(stops.length - 1, 0)));
  }, [stops.length]);

  // ── Voice pickers ───────────────────────────────────────────────────

  const printReady = !!printRoster?.configured && !!printRoster.has_api_key
    && printRoster.voices.length > 0;

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

  function proVoice(value: string, onChange: (v: string) => void, label: string) {
    return (
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
      >
        {/* "None chosen" is a sanity check, not a placeholder: a writer
            who never set these can be sure they have not quietly armed a
            paid render. */}
        <option value="">-- None chosen</option>
        {(printRoster?.voices ?? []).map(voice => (
          <option key={voice.id} value={voice.id}>{voice.label}</option>
        ))}
        {value && !(printRoster?.voices ?? []).some(v => v.id === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    );
  }

  const HELP: { key: string; label: string; body: React.ReactNode }[] = [
    { key: "needed", label: "Is this needed?", body: (
      <>
        No. A book read entirely by one narrator is a finished audiobook,
        and most are. This is here if you want it, and it costs nothing to
        try: everything below runs on your free local narrator, so you can
        cast a chapter, listen to it, and undo the whole thing by closing
        the editor without saving. Play with it. Nothing is committed until
        you press Save back in the editor.
      </>
    ) },
    { key: "how", label: "How do I set the voices?", body: (
      <>
        Here. Add a character, give them a voice, then walk the chapter's
        dialogue below and click who says each line -- the marker is
        written for you.
        <br /><br />
        You can also do it by hand in the editor if you prefer: wrap the
        spoken words in{" "}
        <code className="rounded bg-zinc-800 px-1 text-[10px] text-violet-300">
          [voice:Elizabeth Bennet]"I could easily forgive his pride."[/voice]
        </code>{" "}
        and it means exactly the same thing. This window is just faster,
        and it shows you the result as you go.
      </>
    ) },
    { key: "limits", label: "What are the limits?", body: (
      <>
        A voice is not a performance. The engine gives each character a
        consistent voice, but it does not act -- no shouting, whispering,
        or emotion per line. Pace markers are the only performance control
        there is.
        <br /><br />
        Voice ids do not carry between engines, so a character needs a
        voice for each pass you use: one from your free local narrator for
        drafting, and a Pro voice only if you choose to print with a paid
        engine. Changing a character's voice re-narrates their lines and
        nothing else.
        <br /><br />
        A name your cast does not know reads as the narrator. The editor
        warns you when you save rather than surprising you in the audio.
      </>
    ) },
    { key: "cost", label: "Does casting cost more?", body: (
      <>
        Locally, no -- and locally is where almost all of this happens.
        Your own narrator is free and unlimited, so a book with six voices
        costs exactly what a book with one costs: nothing. Cast the whole
        novel, change your mind twice, regenerate every chapter. Still
        nothing.
        <br /><br />
        The Pro voices exist so that the option is here rather than sending
        you to another service for it. If you use one, you are billed by
        the character whether one voice reads the book or six -- so casting
        itself still costs nothing extra. What costs is CHANGING a voice
        after a paid render, because that character's lines are narrated
        again.
      </>
    ) },
  ];

  return (
    <div
      role="dialog"
      aria-label="Cast"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-5 py-3">
          <Users size={15} className="text-violet-300" />
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">Cast</h2>
          <button onClick={attemptClose} aria-label="Close cast"
                  className="rounded p-1 text-zinc-500 hover:text-zinc-100">
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
            <div className="space-y-4">
              <p className="text-[12px] leading-relaxed text-zinc-300">
                Give each character their own voice, and every dialogue line
                you mark as theirs is read in that voice. The rest is read
                as the narrator.
              </p>

              {/* Depth on request, one row each, nothing open by default. */}
              <div className="space-y-1">
                {HELP.map(item => (
                  <div key={item.key}>
                    <button
                      onClick={() => setOpenHelp(prev =>
                        prev === item.key ? null : item.key)}
                      className={"flex w-full items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-[11px] transition-colors "
                        + (openHelp === item.key
                          ? "border-violet-700 bg-violet-950/30 text-violet-200"
                          : "border-zinc-700 text-zinc-300 hover:border-violet-700 hover:text-violet-200")}
                    >
                      {openHelp === item.key
                        ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      {item.label}
                    </button>
                    {openHelp === item.key && (
                      <p className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                        {item.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>

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

              {/* ── VOICES ───────────────────────────────────────────── */}
              <section>
                <button
                  onClick={() => setVoicesOpen(v => !v)}
                  className="flex w-full items-center gap-1.5 border-b border-zinc-800 pb-2 text-left"
                >
                  {voicesOpen ? <ChevronDown size={12} className="text-zinc-500" />
                              : <ChevronRight size={12} className="text-zinc-500" />}
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Voices
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {rows.length === 0
                      ? "start here -- add the characters who speak"
                      : `${rows.length} character${rows.length === 1 ? "" : "s"}`
                        + " -- narrator reads the rest"}
                  </span>
                </button>

                {voicesOpen && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
                      <span className="w-32 shrink-0">Character</span>
                      <span className="flex-1">Draft voice (free, local)</span>
                      {printReady && <span className="flex-1">Pro / Premium voice</span>}
                      <span className="w-5 shrink-0" />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-32 shrink-0 text-[11px] text-zinc-200">
                          Narrator
                        </span>
                        {draftVoice(narratorVoice, setNarratorVoice,
                                    "Narrator voice", "narrator")}
                        {printReady && proVoice(narratorPrintVoice,
                                                setNarratorPrintVoice,
                                                "Narrator Pro voice")}
                        <span className="w-5 shrink-0" />
                      </div>

                      {rows.map((row, index) => {
                        const name = row.display_name.trim();
                        const clash = name && rows.some((r, i) =>
                          i !== index
                          && r.display_name.trim().toLowerCase() === name.toLowerCase());
                        return (
                          <div key={index}>
                            <div className="flex items-center gap-2">
                            <input
                              aria-label={`Character ${index + 1} name`}
                              value={row.display_name}
                              placeholder="Elena"
                              onChange={e => setRows(prev => prev.map((r, i) =>
                                i === index ? { ...r, display_name: e.target.value } : r))}
                              className={"w-32 shrink-0 rounded border bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 "
                                + (clash ? "border-rose-600" : "border-zinc-700")}
                              style={name && !clash
                                ? { borderLeft: `3px solid ${castColor(name, castNames)}` }
                                : undefined}
                            />
                            {draftVoice(
                              row.voice_id,
                              value => setRows(prev => prev.map((r, i) =>
                                i === index ? { ...r, voice_id: value } : r)),
                              `Voice for character ${index + 1}`, `row-${index}`)}
                            {printReady && proVoice(
                              row.premium_voice_id,
                              value => setRows(prev => prev.map((r, i) =>
                                i === index ? { ...r, premium_voice_id: value } : r)),
                              `Pro voice for character ${index + 1}`)}
                            <button
                              onClick={() => removeCharacter(index)}
                              aria-label={`Remove ${name || "character"}`}
                              className="w-5 shrink-0 rounded text-zinc-600 hover:text-rose-400"
                            >
                              <X size={12} />
                            </button>
                            </div>

                            {/* Nicknames, folded away until asked for.
                                Most characters have none, and a row of
                                empty alias boxes would make the common
                                case look complicated. */}
                            <button
                              onClick={() => setExpanded(e => (e === index ? null : index))}
                              className="ml-1 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-violet-300"
                            >
                              {expanded === index
                                ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              {row.aliases.length === 0
                                ? "Also called..."
                                : `Also called ${row.aliases.join(", ")}`}
                            </button>

                            {expanded === index && (
                              <div className="ml-4 mt-1 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-2">
                                <p className="text-[10px] leading-relaxed text-zinc-500">
                                  Nicknames your book uses for{" "}
                                  {name || "this character"} -- Lexi, Lex, Alexa.
                                  They are read in this character's voice, and the
                                  marker written into your text always says{" "}
                                  {name || "the full name"}.
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  {row.aliases.map(alias => (
                                    <span
                                      key={alias}
                                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300"
                                    >
                                      {alias}
                                      <button
                                        onClick={() => setRows(prev => prev.map((r, i) =>
                                          i === index
                                            ? { ...r, aliases: r.aliases.filter(a => a !== alias) }
                                            : r))}
                                        aria-label={`Remove nickname ${alias}`}
                                        className="text-zinc-600 hover:text-rose-400"
                                      >
                                        <X size={9} />
                                      </button>
                                    </span>
                                  ))}
                                  {detected.length > 0 ? (
                                    <select
                                      aria-label={`Add a nickname for character ${index + 1}`}
                                      value=""
                                      onChange={e => {
                                        const alias = e.target.value;
                                        if (!alias) return;
                                        setRows(prev => prev.map((r, i) =>
                                          i === index
                                            ? { ...r, aliases: [...r.aliases, alias] } : r));
                                      }}
                                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-200"
                                    >
                                      <option value="">+ a name found in your book</option>
                                      {detected.map(n => (
                                        <option key={n} value={n}>{n}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-[10px] text-zinc-600">
                                      No unclaimed names left to add.
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {detected.length > 0 && (
                      <div className="mt-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-2">
                        <p className="text-[10px] leading-relaxed text-zinc-500">
                          <span className="text-zinc-300">
                            Names found in your book:
                          </span>{" "}
                          add one as a character, or let the narrator read them.
                          Some of these will be nicknames -- add the character
                          first, then open "Also called" on their row and pick
                          the nickname there.
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {detected.map(name => (
                            <span key={name} className="inline-flex items-center overflow-hidden rounded border border-zinc-700">
                              <button
                                onClick={() => setRows(prev => [...prev, {
                                  display_name: name, aliases: [],
                                  voice_id: "", premium_voice_id: "" }])}
                                className="px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-950/50"
                              >
                                + {name}
                              </button>
                              <button
                                onClick={() => setIgnored(prev => [...prev, name])}
                                aria-label={`Ignore ${name}`}
                                title={`The narrator reads ${name}. Stops offering the name.`}
                                className="border-l border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-200"
                              >
                                ignore
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {ignored.length > 0 && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-600">
                        Narrator reads:
                        {ignored.map(name => (
                          <span key={name} className="inline-flex items-center gap-1">
                            {name}
                            <button
                              onClick={() => setIgnored(prev => prev.filter(n => n !== name))}
                              aria-label={`Stop ignoring ${name}`}
                              className="hover:text-zinc-300"
                            >
                              <X size={9} />
                            </button>
                          </span>
                        ))}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => setRows(prev => [...prev, {
                          display_name: "", aliases: [],
                          voice_id: "", premium_voice_id: "" }])}
                        className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-violet-600 hover:text-violet-300"
                      >
                        <Plus size={11} /> Add a character
                      </button>
                      <button
                        onClick={() => void handleSaveCast()}
                        disabled={!dirty || saving}
                        className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                      >
                        {saving && <Loader2 size={11} className="animate-spin" />}
                        Save Cast
                      </button>
                      {dirty && (
                        <span className="text-[10px] text-amber-300">
                          Save the cast to use these voices below.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* ── THE WALK ─────────────────────────────────────────── */}
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Dialogue
                  </span>
                  <select
                    aria-label="Chapter"
                    value={chapterIndex}
                    onChange={e => setChapterIndex(Number(e.target.value))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200"
                  >
                    {chapters.map((c, i) => (
                      <option key={i} value={i}>{c.title}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-zinc-600">
                    {stops.length === 0
                      ? "no dialogue found in this chapter"
                      : `line ${Math.min(stopIndex + 1, stops.length)} of ${stops.length}`}
                  </span>
                </div>

                {/* The ladder. Nothing runs until Start, so a stray
                    click can never spend money, and the cost of the
                    chosen mode is on screen before it is pressed. */}
                <div className="mb-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Marking mode"
                      value={mode}
                      onChange={e => { setMode(e.target.value as PassMode);
                                       setPassNote(null); }}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
                    >
                      {MODES.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => void runPass()}
                      disabled={passState === "running" || rows.length === 0}
                      title={rows.length === 0
                        ? "Add a character first -- there is nobody to mark lines as."
                        : "Run this mode over the chapter"}
                      className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                    >
                      {passState === "running"
                        && <Loader2 size={11} className="animate-spin" />}
                      Start
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                    {activeMode.blurb}
                    {activeMode.usesAi && (
                      <span className="ml-1 text-zinc-400">
                        {estimate === null ? "Working out the cost..."
                          : estimate.price_known
                            ? `About ${estimate.cost_usd !== null && estimate.cost_usd < 0.01
                                ? "a cent" : `$${(estimate.cost_usd ?? 0).toFixed(2)}`}`
                              + ` for this chapter on ${estimate.model_id}.`
                            : estimate.note}
                      </span>
                    )}
                  </p>
                  {passNote && (
                    <p className="mt-1 text-[10px] leading-relaxed text-violet-300">
                      {passNote}
                    </p>
                  )}
                </div>

                {/* Who is in this chapter -- one click each. */}
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {present.map(name => {
                    const active = stop?.assigned
                      ? stop.assigned.toLowerCase() === name.toLowerCase()
                      : name === NARRATOR;
                    const color = name === NARRATOR ? "" : castColor(name, castNames);
                    return (
                      <button
                        key={name}
                        onClick={() => assign(name === NARRATOR ? null : name)}
                        disabled={!stop}
                        className={"rounded border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 "
                          + (active ? "" : "border-zinc-700 text-zinc-200 hover:border-zinc-500")}
                        style={active
                          ? { backgroundColor: color || "#52525B",
                              borderColor: color || "#71717A",
                              color: color ? castTextColor(color) : "#F4F4F5" }
                          : color
                            ? { borderColor: `${color}80`, color }
                            : undefined}
                      >
                        {name}
                      </button>
                    );
                  })}
                  {others.length > 0 && (
                    showOthers ? others.map(name => (
                      <button
                        key={name}
                        onClick={() => assign(name)}
                        disabled={!stop}
                        className="rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
                        style={{ borderColor: `${castColor(name, castNames)}40` }}
                      >
                        {name}
                      </button>
                    )) : (
                      <button
                        onClick={() => setShowOthers(true)}
                        className="rounded border border-dashed border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        + {others.length} more in this book
                      </button>
                    )
                  )}
                  {stop?.assigned && (
                    <button
                      onClick={() => assign(null)}
                      className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-rose-600 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <DialogueWindow content={content} stop={stop} castNames={castNames} />

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setStopIndex(i => Math.max(0, i - 1))}
                    disabled={stopIndex === 0}
                    className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  >
                    &lt;- Back
                  </button>
                  <button
                    onClick={accept}
                    disabled={!stop}
                    className="rounded bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    Accept
                  </button>
                  <button
                    onClick={accept}
                    disabled={!stop}
                    className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  >
                    Skip
                  </button>
                  {stop?.guess && !stop.assigned && resolveName(stop.guess) && (
                    <span className="text-[10px] text-zinc-500">
                      your text says {stop.guess}
                      {resolveName(stop.guess).toLowerCase() !== stop.guess.toLowerCase()
                        && ", which is"}{" "}
                      <button
                        onClick={() => assign(resolveName(stop.guess))}
                        aria-label={`Use ${resolveName(stop.guess)}`}
                        className="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500"
                      >
                        {resolveName(stop.guess)}
                      </button>
                    </span>
                  )}
                </div>

                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                  <span>{remaining} line{remaining === 1 ? "" : "s"} left</span>
                  <span>{assignedCount} assigned</span>
                  {aiCount > 0 && (
                    <button
                      onClick={() => { setReviewOnly(v => !v); setStopIndex(0); }}
                      className={"rounded border px-1.5 py-0.5 text-[10px] "
                        + (reviewOnly
                          ? "border-violet-500 text-violet-200"
                          : "border-zinc-700 text-zinc-400 hover:border-violet-600")}
                    >
                      {reviewOnly ? "Reviewing AI choices" : `Review ${aiCount} AI choice${aiCount === 1 ? "" : "s"}`}
                    </button>
                  )}
                  <span>{present.length - 1} character{present.length - 1 === 1 ? "" : "s"} in this chapter</span>
                  <span className="text-zinc-600">
                    Markers go to the editor only -- press Save there to keep them.
                  </span>
                </p>
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
          {!error && <span className="flex-1" />}
          <button
            onClick={attemptClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
