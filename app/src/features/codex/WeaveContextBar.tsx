// features/codex/WeaveContextBar.tsx -- what the Weave will tell the AI
// ======================================================================
// This screen exists because of a product rule, and the rule is written here
// in full because the code is answerable to it:
//
//     EXPLICITLY INSPECTABLE AND CONTROLLABLE CONTEXT. AI may automatically
//     receive story context relevant to the current point in the story, but
//     the writer must be able to inspect what will be sent, remove individual
//     Threads, exclude categories, and turn automatic Weave context off
//     entirely. No context is transmitted until the writer initiates an AI
//     action.
//
// Four obligations, four controls on this screen: the list carries the
// inspection, each row has a remove, each kind has an exclude, and the switch
// turns the whole thing off and returns the app to attachments only.
//
// AND A MAP ABOVE THE LIST, because the spec said so and it was right:
//
//     "The inspect panel is a small map, not a list: the Threads going into
//      the brief, drawn with their Ties, at the anchor being written."
//
// This shipped as a list alone, with a documented argument about screen space,
// while the spec was not in the repository to argue back. The list is still the
// only thing that can carry per-Thread cost, a remove button and the exact
// words -- but eight names in a column cannot show that Alexandra and Dean are
// connected while the Guild is attached to nothing, which is the judgement a
// writer makes in one look. So: both (recovery task R1.3). See BriefShape.
//
// NOTHING HERE SENDS ANYTHING. Assembling a brief is a local calculation --
// POST /api/codex/context reads files and does arithmetic. The brief travels
// only when the writer starts an AI action, and then it travels as part of
// that request. Said out loud on the panel, because "what will be sent" is a
// sentence a writer is entitled to distrust until it explains itself.
//
// WHY A BAR AND NOT A PANEL BESIDE THE CHAT. The companion column is already
// carrying chips, a stance toggle and the conversation; a permanent list of
// eight Threads would push the writer's own words off screen. So the bar
// states the shape in one line -- how many Threads, roughly what it costs --
// and the detail floats over the app when asked for, which is the same
// convention every "What's this?" already uses.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Loader, RotateCw, Undo2, X } from "lucide-react";

import { BriefShape } from "./BriefShape";
import { Explain } from "../../components/learn/Explain";
import { TONE_CLASSES, threadTypeEntry } from "./lexicon";
import { fetchAnchors, fetchGraph, type GraphEdge } from "./api";
import { fetchBrief, type Brief } from "./weavingApi";

/** What the writer has decided about automatic world context, per book. */
export interface WeaveContextPrefs {
  /** Off entirely. Absent/false means on, which is what the rule describes. */
  off?: boolean;
  /** Threads dropped by hand, by entity_id. */
  excludedIds?: string[];
  /** Whole kinds dropped, by type id. */
  excludedTypes?: string[];
}

interface WeaveContextBarProps {
  projectPath: string;
  /** The chapter open in the editor. Resolved to its anchor here rather than
   *  by the caller, because the brief is assembled AS OF that point -- which
   *  is the whole reason the Weave is time-aware -- and the caller should not
   *  have to know that chapters have anchors. */
  chapterFilename: string | null;
  /** What the writer is working on -- drives which Threads count as named
   *  in the scene. Only bound mentions count; a guess here would put the
   *  wrong character's beliefs in front of the model. */
  text: string;
  /** Tokens the writer's own attachments already claim. They are never
   *  pruned, so the Weave's budget is what is left after them. */
  pinnedTokens: number;
  prefs: WeaveContextPrefs;
  onPrefsChange: (next: WeaveContextPrefs) => void;
  /** The assembled brief, handed up so the send path can carry it. */
  onBriefChange: (brief: string) => void;
}

export function WeaveContextBar({
  projectPath, chapterFilename, text, pinnedTokens, prefs, onPrefsChange,
  onBriefChange,
}: WeaveContextBarProps) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  // The world's edges, for drawing the brief's shape. Fetched when the panel
  // is opened rather than on mount: the bar itself needs no map, and most
  // visits to a chapter never open the panel at all.
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  // WHETHER "NOW" IS SETTLED YET. Nothing is assembled until it is, and that
  // is a correctness rule rather than a nicety: with no anchor the brief is
  // assembled as of the END of the book, so a writer who opened chapter four
  // and sent immediately would have been handed a brief that knew chapter
  // nineteen. The Weave is time-aware precisely so that cannot happen.
  const [anchorReady, setAnchorReady] = useState(false);

  // THE PROSE IS READ, NOT WATCHED. What the writer is typing decides which
  // Threads count as named here, but re-assembling on every keystroke would
  // make the bar's number flicker while they work and fire a request per
  // letter. So the text is read at assembly time from a ref, and assembly
  // happens when something structural changes -- the chapter, an exclusion,
  // the switch -- or when the writer asks for it again.
  const textRef = useRef(text);
  textRef.current = text;

  // Which anchor "now" is. A chapter the Weave has never seen has no anchor,
  // and that is not an error: the brief is then assembled as of the end of
  // the book, which is what a writer outside a chapter would expect.
  useEffect(() => {
    let cancelled = false;
    setAnchorReady(false);
    if (!chapterFilename) {
      setAt(null);
      setAnchorReady(true);          // outside a chapter, the end IS the answer
      return;
    }
    fetchAnchors(projectPath)
      .then(r => {
        if (cancelled) return;
        const match = r.chapters.find(c => c.filename === chapterFilename);
        setAt(match?.anchor ?? null);
      })
      .catch(() => { if (!cancelled) setAt(null); })
      .finally(() => { if (!cancelled) setAnchorReady(true); });
    return () => { cancelled = true; };
  }, [projectPath, chapterFilename]);

  const off = prefs.off === true;
  const excludedIds = useMemo(() => prefs.excludedIds ?? [], [prefs.excludedIds]);
  const excludedTypes = useMemo(
    () => prefs.excludedTypes ?? [], [prefs.excludedTypes]);

  // Keyed on the CONTENT of the exclusion lists rather than the arrays, which
  // the parent rebuilds on every render -- the same trap that used to wipe
  // half-typed boxes in Quick Fill.
  const idKey = JSON.stringify(excludedIds);
  const typeKey = JSON.stringify(excludedTypes);

  const load = useCallback(async () => {
    if (off) {
      setBrief(null);
      onBriefChange("");
      return;
    }
    // Nothing is handed up before "now" is known -- see anchorReady. Sending
    // an end-of-book brief from chapter four would be worse than sending none.
    if (!anchorReady) return;
    setBusy(true);
    setError(null);
    try {
      const built = await fetchBrief(projectPath, {
        at, text: textRef.current, pinnedTokens,
        excludeIds: JSON.parse(idKey) as string[],
        excludeTypes: JSON.parse(typeKey) as string[],
        enabled: true,
      });
      setBrief(built);
      // A refused brief is NOT sent. Half a world reads as a whole one, and
      // the model has no way to tell it was handed a fragment.
      onBriefChange(built.refused ? "" : built.brief);
    } catch (e) {
      setError(e instanceof Error ? e.message
                                  : "The world context could not be read.");
      // Nothing assembled means nothing travels. Failing closed is the only
      // safe direction here: sending a stale brief would describe a world the
      // writer has since changed.
      setBrief(null);
      onBriefChange("");
    } finally {
      setBusy(false);
    }
  }, [projectPath, at, anchorReady, pinnedTokens, idKey, typeKey, off,
      onBriefChange]);

  useEffect(() => { void load(); }, [load]);

  function setPrefs(patch: Partial<WeaveContextPrefs>) {
    onPrefsChange({ off, excludedIds, excludedTypes, ...patch });
  }

  const threads = brief?.threads ?? [];
  const tokens = brief?.token_estimate ?? 0;
  // Kinds present in the world's brief, so the exclude control offers only
  // categories that mean something here rather than all fourteen.
  const kinds = useMemo(() => {
    const seen = new Set<string>();
    for (const piece of threads) seen.add(piece.type);
    for (const kind of excludedTypes) seen.add(kind);
    return [...seen].sort();
  }, [threads, excludedTypes]);

  return (
    <div className="border-t border-border px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Globe size={12} className={off ? "text-faint" : "text-violet-300"} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
          {off ? (
            "World context off -- only what you attach is sent."
          ) : busy && !brief ? (
            "Working out what to send..."
          ) : brief?.refused ? (
            <span className="text-amber-200/90">
              World context does not fit and was not sent.
            </span>
          ) : threads.length === 0 ? (
            "Nothing from your world to send yet."
          ) : (
            <>
              Sending{" "}
              <span className="text-text-primary">
                {threads.length} {threads.length === 1 ? "Thread" : "Threads"}
              </span>{" "}
              from your world, about {tokens.toLocaleString()} tokens
            </>
          )}
        </span>

        {!off && (
          <button
            onClick={() => {
              setOpen(true);
              // The shape needs the world's Ties. A failure here costs the map
              // and nothing else -- the list still works, so it is not worth an
              // error message.
              // Defaulted, not trusted. A response without the key would
              // otherwise crash the whole panel on `edges.filter` -- taking
              // the list and every control down with the decoration.
              void fetchGraph(projectPath, { at: at ?? undefined,
                                            hideSpoilers: false })
                .then(g => setEdges(g.edges ?? []))
                .catch(() => setEdges([]));
            }}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary"
          >
            Inspect
          </button>
        )}
        {/* The off switch, always reachable and never behind the panel: a
            writer who wants it off wants it off NOW, not after reading a
            list of what they are turning off. */}
        <button
          onClick={() => setPrefs({ off: !off })}
          aria-pressed={!off}
          aria-label="Send world context"
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            off ? "border border-border text-faint hover:text-text-primary"
                : "border border-violet-700 bg-violet-950/40 text-violet-200"
          }`}
        >
          {off ? "Turn on" : "On"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-1 text-[10px] text-rose-300">{error}</p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            role="dialog"
            aria-label="What the Weave will send"
            data-testid="weave-context-panel"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-violet-900 bg-bg-panel"
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Globe size={14} className="shrink-0 text-violet-300" />
              <h2 className="flex-1 text-xs font-semibold text-text-primary">
                What your world will tell the AI
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Close"
                      className="rounded p-0.5 text-faint hover:text-text-primary">
                <X size={13} />
              </button>
            </header>

            <div className="p-3">
              <div className="mb-2">
                <Explain of="weave.context" />
              </div>

              {/* AS OF WHEN, before anything else. A brief assembled at
                  chapter four deliberately does not know chapter nineteen,
                  and a writer who does not know that would read a short list
                  as the app having lost half their world. */}
              <p className="mb-2 text-[11px] text-text-muted">
                Assembled as of{" "}
                <span className="text-text-primary">
                  {brief?.as_of ? "where you are writing" : "the end of the book"}
                </span>
                . Later chapters are deliberately left out -- the AI is told
                what your story knows so far, not what you know.
              </p>

              {brief?.refused && (
                <p role="alert"
                   className="mb-2 rounded border border-amber-700/60 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-200/90">
                  {brief.refusal} Nothing from your world is being sent this
                  turn -- half a profile reads as a whole one, so it is
                  refused rather than cut short.
                </p>
              )}

              {busy && (
                <p className="mb-2 flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Loader size={11} className="animate-spin" /> Working it out...
                </p>
              )}

              {/* ── The SHAPE, then the list ───────────────────────────── */}
              {threads.length > 0 && (
                <BriefShape
                  threads={threads.map(p => ({ entity_id: p.entity_id,
                                               name: p.name, type: p.type }))}
                  edges={edges}
                  asOfLabel={brief?.as_of
                    ? "where you are writing" : "the end of the book"}
                />
              )}

              {threads.length === 0 && !busy ? (
                <p className="mb-2 text-[11px] text-faint">
                  Nothing from your world is being sent. That is ordinary early
                  on: Threads arrive here once your writing names them, or once
                  they connect to something it names.
                </p>
              ) : (
                <ul className="mb-2 space-y-1" data-testid="brief-threads">
                  {threads.map(piece => {
                    const kind = threadTypeEntry(piece.type);
                    const KindIcon = kind.Icon;
                    return (
                      <li key={piece.entity_id}
                          className="flex items-start gap-2 rounded border border-border px-2 py-1.5">
                        <KindIcon size={12}
                                  className={`mt-0.5 shrink-0 ${TONE_CLASSES[kind.tone].text}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-text-primary">
                            {piece.name}
                          </span>
                          {/* WHY it is here. This is the line that makes the
                              panel worth opening -- a list of names answers
                              "what" and leaves "why on earth" unanswered. */}
                          <span className="block text-[10px] text-faint">
                            {piece.reason}
                            {piece.pinned ? " -- you attached it, so it is never dropped" : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">
                          ~{piece.tokens.toLocaleString()}
                        </span>
                        <button
                          onClick={() => setPrefs({
                            excludedIds: [...excludedIds, piece.entity_id],
                          })}
                          aria-label={`Remove ${piece.name}`}
                          className="shrink-0 rounded p-0.5 text-faint hover:text-rose-300"
                        >
                          <X size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* ── Put one back ───────────────────────────────────────── */}
              {excludedIds.length > 0 && (
                <div className="mb-2 rounded border border-border p-2">
                  <p className="mb-1 text-[10px] text-text-muted">
                    Removed by you, and staying removed until you say otherwise:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {excludedIds.map(id => (
                      <button
                        key={id}
                        onClick={() => setPrefs({
                          excludedIds: excludedIds.filter(x => x !== id),
                        })}
                        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary"
                      >
                        <Undo2 size={9} /> {id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── A whole category at a time ─────────────────────────── */}
              {kinds.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] text-text-muted">
                    Or leave out a whole kind of thing:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {kinds.map(kind => {
                      const entry = threadTypeEntry(kind);
                      const dropped = excludedTypes.includes(kind);
                      return (
                        <button
                          key={kind}
                          onClick={() => setPrefs({
                            excludedTypes: dropped
                              ? excludedTypes.filter(x => x !== kind)
                              : [...excludedTypes, kind],
                          })}
                          aria-pressed={dropped}
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            dropped
                              ? "border-border text-faint line-through"
                              : "border-violet-800 bg-violet-950/30 text-violet-200"
                          }`}
                        >
                          {entry.term}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── What was dropped to fit ────────────────────────────── */}
              {brief && brief.omitted.length > 0 && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] text-violet-300 hover:text-violet-200">
                    {brief.omitted.length} left out to fit
                  </summary>
                  {/* Reported rather than silently dropped: a brief that
                      quietly omitted half the world would be worse than one
                      never assembled, because the writer would trust it. */}
                  <ul className="mt-1 space-y-0.5">
                    {brief.omitted.map(o => (
                      <li key={o.entity_id} className="text-[10px] text-faint">
                        {o.name} -- {o.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {(brief?.withheld_spoilers || brief?.withheld_by_scope) ? (
                <p className="mb-2 text-[10px] text-faint">
                  {brief.withheld_spoilers > 0 && (
                    <>{brief.withheld_spoilers} held back as not yet revealed
                      to the reader. </>
                  )}
                  {brief.withheld_by_scope > 0 && (
                    <>{brief.withheld_by_scope} you marked as never for AI.</>
                  )}
                </p>
              ) : null}

              {/* ── Where the window went ──────────────────────────────── */}
              {brief && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] text-violet-300 hover:text-violet-200">
                    Where the room went
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(brief.budget).map(([name, value]) => (
                      <li key={name}
                          className="flex justify-between text-[10px] text-faint">
                        <span>{name.replace(/_/g, " ")}</span>
                        <span>{Number(value).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* ── The words themselves ───────────────────────────────── */}
              {brief?.brief && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] text-violet-300 hover:text-violet-200">
                    Read it exactly as the AI will
                  </summary>
                  <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-muted">
                    {brief.brief}
                  </pre>
                </details>
              )}

              <p className="mb-2 text-[10px] text-faint">
                Working this out sends nothing anywhere -- it is arithmetic on
                files already on your machine. It travels only when you ask
                the AI for something, and only then.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="inline-flex flex-col items-start rounded border border-emerald-800 bg-emerald-950/30 px-2.5 py-1 text-left text-xs font-semibold text-text-primary hover:bg-emerald-950/50"
                >
                  <span>Looks right</span>
                  <span className="text-[10px] font-normal text-faint">
                    back to writing, with this ready to send
                  </span>
                </button>
                <button
                  onClick={() => void load()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
                >
                  <RotateCw size={11} /> Work it out again
                </button>
                <button
                  onClick={() => { setPrefs({ off: true }); setOpen(false); }}
                  className="inline-flex flex-col items-start rounded border border-border px-2.5 py-1 text-left text-xs text-text-muted hover:text-text-primary"
                >
                  <span>Turn world context off</span>
                  <span className="text-[10px] text-faint">
                    only what you attach by hand gets sent
                  </span>
                </button>
              </div>

              {prefs.off === false && excludedIds.length === 0
               && excludedTypes.length === 0 && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-faint">
                  <Check size={9} /> Nothing removed -- this is everything the
                  Weave thinks is worth saying here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
