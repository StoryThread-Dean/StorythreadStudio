// components/editor/EditorAdvisorBar.tsx -- Smart Advisor Toolbar
// =================================================================
// Sits above the manuscript editor and runs the three Smart Advisor passes
// (Readability / Structure / Context). Each button:
//   - triggers /api/ai/editor-pass for its category
//   - exposes a chevron menu of subcategory checkboxes (Grammar, Clarity,
//     POV, etc.) so the writer can scope the pass before running it
//   - is "active" while a pass is in flight; clicking a different category
//     clears the previous pass before kicking off the new one
//
// Subcategory selections persist in localStorage so the writer's preferences
// survive reloads. Using a string key per category rather than one big JSON
// blob keeps reads cheap.

import { useState, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type {
  IssueCategory, IssueSubcategory, ReadabilitySubcategory, StructureSubcategory,
  ContextSubcategory, EditorIssue, EditorPassRequest, EditorPassResponse,
  ContextChip,
} from "../../types/ai";
import {
  addIssuesEffect, clearIssuesEffect, locateQuoteInDoc, type LocatedIssue,
} from "./issueOverlay";
import { Explain } from "../../components/learn/Explain";


const API_BASE = "http://localhost:8000";

// The one pass the Weave's world context is sent to. Kept as a named constant
// on both sides of the wire (backend: WEAVE_BRIEF_PASS in routers/ai.py), so
// the screen deciding what to send and the route deciding what to use cannot
// drift into disagreeing about which pass reads the world.
const WEAVE_BRIEF_PASS = "context";


// Subcategory definitions. MUST match EDITOR_PASS_SUBCATEGORIES in
// backend/app/ai/prompts.py -- adding a key on one side without the other
// produces a checkbox the AI never receives, or vice versa.
const READABILITY_SUBS: { key: ReadabilitySubcategory; label: string; help: string }[] = [
  { key: "grammar",     label: "Grammar",     help: "Grammar and punctuation errors" },
  { key: "clarity",     label: "Clarity",     help: "Unclear phrasing and ambiguous references" },
  { key: "redundancy",  label: "Redundancy",  help: "Repeated ideas, filler, redundant words" },
  { key: "descriptive", label: "Descriptive", help: "Opportunities for richer descriptive language" },
];

const STRUCTURE_SUBS: { key: StructureSubcategory; label: string; help: string }[] = [
  { key: "dialogue",  label: "Dialogue",  help: "Authenticity and distinct character voices" },
  { key: "pov",       label: "POV",       help: "POV consistency and head-hopping" },
  { key: "tone",      label: "Tone",      help: "Tone and voice consistency" },
  { key: "character", label: "Character", help: "Character development through action" },
  { key: "pacing",    label: "Pacing",    help: "Rushed transitions, dragging scenes, balance" },
];

const CONTEXT_SUBS: { key: ContextSubcategory; label: string; help: string }[] = [
  { key: "character_consistency", label: "Character",      help: "Actions and speech vs. attached profiles" },
  { key: "relationships",         label: "Relationships",  help: "Interactions vs. attached relationship dynamics" },
  { key: "setting",               label: "Setting",        help: "Descriptions vs. attached locations" },
  { key: "lore",                  label: "Lore",           help: "Facts vs. attached world-building" },
  { key: "timeline",              label: "Timeline",       help: "Event order, elapsed time, time-of-day and season continuity" },
  { key: "scene_goal",            label: "Scene Goal",     help: "Whether each scene pursues a clear goal, conflict, or change" },
];


// localStorage keys. Per-category so a malformed value in one doesn't
// poison the others.
const LS_KEYS: Record<IssueCategory, string> = {
  readability: "storythread.advisor.readability.subs",
  structure:   "storythread.advisor.structure.subs",
  context:     "storythread.advisor.context.subs",
};


// Read the saved subcategory selection for a category. Defaults to "all
// subcategories selected" when nothing is saved or the saved value is junk.
function loadSubs<T extends IssueSubcategory>(category: IssueCategory, all: T[]): T[] {
  if (typeof window === "undefined") return all;
  try {
    const raw = window.localStorage.getItem(LS_KEYS[category]);
    if (!raw) return all;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return all;
    const known = new Set<string>(all);
    const filtered = parsed.filter((k: unknown): k is T => typeof k === "string" && known.has(k as string)) as T[];
    // If the saved set is empty (writer unchecked everything and reloaded),
    // fall back to all to avoid a no-op pass on first run after reload.
    return filtered.length > 0 ? filtered : all;
  } catch {
    return all;
  }
}


function saveSubs(category: IssueCategory, subs: IssueSubcategory[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEYS[category], JSON.stringify(subs));
  } catch {
    // localStorage can be disabled (private browsing); silently ignore.
  }
}


export interface EditorAdvisorBarProps {
  // The CodeMirror view to dispatch issue effects on. Optional because the
  // editor mounts asynchronously; the bar disables its buttons until view
  // is available rather than rendering nothing.
  view:          EditorView | null;
  // Chapter text used for the AI request AND for resolving quote -> range.
  // Must reflect the editor's current state (passed from App.tsx, which
  // mirrors the doc string into chapter content state).
  chapterText:   string;
  // Filename of the chapter currently open in the editor. Forwarded to the
  // backend so the Writing Progress gauge can record which file the advisor
  // pass ran against. Null when no chapter is open (the buttons disable in
  // that state anyway).
  chapterFilename: string | null;
  contextChips:  ContextChip[];
  /** What the Weave assembled, already inspectable by the writer in the bar
   *  above the chat. Empty when world context is off, has nothing to say, or
   *  the writer emptied it. Used on the Context pass only -- see
   *  WEAVE_BRIEF_PASS. */
  weaveBrief:    string;
  modelId:       string | null;
  contentMode:   string;
  projectPath:   string | null;
  // How many issues are currently visible in the editor. Drives the count
  // pill and the Done button. Owned by App.tsx because it also drives the
  // popover lifecycle.
  issueCount:    number;
  // Tells App.tsx to reset its issue tracking. Called when the writer hits
  // Done or when the bar starts a new pass (before the new issues come in).
  onClearIssues: () => void;
  // Notifies App.tsx of new issues so it can update its own count + caches.
  onAddIssues:   (issues: LocatedIssue[]) => void;
  // Number of profile-type chips (character / relationship / location / lore)
  // currently attached. Drives the Context attach-profiles button and the
  // (i) info hint that vanishes once at least one profile is present.
  profileChipCount:      number;
  // Opens the AI panel's chip picker so the writer can attach profiles
  // without leaving the Smart Advisor bar.
  onOpenProfilePicker:   () => void;
}


export function EditorAdvisorBar({
  view, chapterText, chapterFilename, contextChips, weaveBrief, modelId, contentMode, projectPath,
  issueCount, onClearIssues, onAddIssues,
  profileChipCount, onOpenProfilePicker,
}: EditorAdvisorBarProps) {

  // The category whose subcategory menu is currently open. null = no menu.
  // We don't allow more than one menu open at once -- it's a tighter UI
  // and a writer running a pass doesn't typically need to compare across
  // categories.
  const [openMenu, setOpenMenu] = useState<IssueCategory | null>(null);

  // Whether the Context (i) info popover is showing. Cleared by clicking
  // outside the bar, same as openMenu.
  const [showContextInfo, setShowContextInfo] = useState(false);

  // The category whose pass is currently running. null = idle. Drives the
  // disabled state on every button so the writer can't spam-trigger
  // overlapping requests.
  const [running, setRunning] = useState<IssueCategory | null>(null);

  // Whether the running pass is scoped to a selection (vs the whole chapter).
  // Captured at click time so the progress text stays accurate even if the
  // writer changes their selection while the request is in flight.
  const [runningIsSelection, setRunningIsSelection] = useState(false);

  // Live snapshot of the editor's current selection. Polled from the view
  // (CodeMirror doesn't expose a React-friendly subscription out of the box
  // without modifying the editor's extension array, which lives elsewhere).
  // null = no qualifying selection; the pass runs on the whole chapter.
  // We require at least 5 words to count as a real scoped selection so a
  // stray double-click or single-word highlight doesn't accidentally narrow
  // the pass.
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; words: number } | null>(null);

  // Seconds elapsed since the current pass started. Drives the rotating
  // status text on the right side. Held in state (not a ref) because the
  // status string is derived from this value and needs to re-render.
  const [elapsed, setElapsed] = useState(0);

  // Last error from a failed pass, if any. Cleared on the next attempt.
  const [error, setError] = useState<string | null>(null);

  // Tick the elapsed counter once a second while a pass is in flight.
  // Cleaned up in the cleanup function so a fast-completing pass doesn't
  // leak the interval. Reset to 0 every time `running` flips to a new
  // category so the status text starts from "Reading chapter..." again.
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(e => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Subcategory selections, loaded from localStorage on mount. Stored as
  // sets-as-arrays so saves are JSON-stable.
  const [readabilitySubs, setReadabilitySubs] = useState<ReadabilitySubcategory[]>(
    () => loadSubs<ReadabilitySubcategory>("readability", READABILITY_SUBS.map(s => s.key)),
  );
  const [structureSubs, setStructureSubs] = useState<StructureSubcategory[]>(
    () => loadSubs<StructureSubcategory>("structure", STRUCTURE_SUBS.map(s => s.key)),
  );
  const [contextSubs, setContextSubs] = useState<ContextSubcategory[]>(
    () => loadSubs<ContextSubcategory>("context", CONTEXT_SUBS.map(s => s.key)),
  );

  // Click-outside dismissal for the open menu and the context info popover.
  // Both share the same handler so only one listener is ever active.
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openMenu == null && !showContextInfo) return;
    function onClick(e: MouseEvent) {
      if (!barRef.current) return;
      if (!barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setShowContextInfo(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [openMenu, showContextInfo]);


  // Persist subcategory changes to localStorage.
  useEffect(() => { saveSubs("readability", readabilitySubs); }, [readabilitySubs]);
  useEffect(() => { saveSubs("structure",   structureSubs);   }, [structureSubs]);
  useEffect(() => { saveSubs("context",     contextSubs);     }, [contextSubs]);


  // Poll the editor's selection so the scope pill updates live. We sample
  // every 200ms (cheap; reads two numbers and possibly slices the doc) and
  // only update React state when the selection range actually changed. This
  // avoids the heavier CodeMirror-extension wiring needed to subscribe via
  // an updateListener, which would require modifying MarkdownEditor.tsx.
  useEffect(() => {
    if (!view) {
      setSelectionInfo(null);
      return;
    }
    let lastFrom = -1;
    let lastTo = -1;
    function poll() {
      if (!view) return;
      const sel = view.state.selection.main;
      if (sel.from === lastFrom && sel.to === lastTo) return;
      lastFrom = sel.from;
      lastTo   = sel.to;
      if (sel.empty || sel.from === sel.to) {
        setSelectionInfo(null);
        return;
      }
      const text = view.state.sliceDoc(sel.from, sel.to);
      const words = countWords(text);
      if (words < 5) {
        // Too small to be intentional scoping. Treat as no selection.
        setSelectionInfo(null);
        return;
      }
      setSelectionInfo({ text, words });
    }
    poll();
    const id = window.setInterval(poll, 200);
    return () => window.clearInterval(id);
  }, [view]);


  // Toggle one subcategory key inside a list. Generic so the same helper
  // works for all three categories.
  function toggleSub<T extends IssueSubcategory>(key: T, list: T[], setList: (v: T[]) => void) {
    if (list.includes(key)) {
      setList(list.filter(k => k !== key));
    } else {
      setList([...list, key]);
    }
  }


  // Run a pass. Always clears any prior pass first (one category at a
  // time), then fires the request, then resolves quotes and dispatches
  // the new issues onto the editor.
  async function runPass(category: IssueCategory) {
    if (!view) return;
    if (running) return;  // Defensive -- shouldn't be clickable while running.

    // Clear the previous pass NOW so the writer gets immediate visual
    // feedback that something changed. The new issues will populate when
    // the request resolves.
    view.dispatch({ effects: clearIssuesEffect.of() });
    onClearIssues();

    const subs: IssueSubcategory[] =
      category === "readability" ? readabilitySubs :
      category === "structure"   ? structureSubs :
      contextSubs;

    if (subs.length === 0) {
      setError("Pick at least one subcategory before running this pass.");
      return;
    }

    // Decide scope at click time (not from polled state) so we use the
    // selection exactly as it stands the moment the writer hit the button.
    // Re-applies the 5-word floor in case the polled value is stale.
    const sel = view.state.selection.main;
    let passText  = chapterText;
    let isSelection = false;
    if (!sel.empty && sel.from !== sel.to) {
      const sliced = view.state.sliceDoc(sel.from, sel.to);
      if (countWords(sliced) >= 5) {
        passText    = sliced;
        isSelection = true;
      }
    }

    setRunning(category);
    setRunningIsSelection(isSelection);
    setError(null);
    setOpenMenu(null);

    const payload: EditorPassRequest = {
      category,
      subcategories:    subs,
      chapter_text:     passText,
      is_selection:     isSelection,
      context_chips:    contextChips,
      model_id:         modelId ?? undefined,
      content_mode:     contentMode,
      project_path:     projectPath,
      chapter_filename: chapterFilename,
      // THE WEAVE'S WORLD, ON THE CONTEXT PASS ONLY.
      //
      // Context is the pass that checks the writing against the STORY --
      // continuity, established facts, whether somebody is behaving like
      // themselves -- so it is the only one the world can change the answer
      // for. Readability is prose mechanics and Structure is shape; sending
      // them a brief would be paying for tokens neither reads.
      //
      // This gap was reported rather than found: attached profiles already
      // reached all three passes through this same request, so a writer
      // reasonably assumed the Threads did too. The backend refuses it for
      // the other two as well -- one of us deciding is a rule, both of us
      // deciding is a guarantee.
      weave_brief:      category === WEAVE_BRIEF_PASS ? weaveBrief : "",
    };

    try {
      const res = await fetch(`${API_BASE}/api/ai/editor-pass`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail ?? `Server returned ${res.status}.`);
      }
      const data: EditorPassResponse = await res.json();

      // Resolve each issue's quote against the current chapter text. We
      // pull from the LIVE editor state (not the chapter_text we sent)
      // because the writer might have typed during the request.
      const docNow = view.state.doc.toString();
      const located: LocatedIssue[] = [];
      for (const issue of data.issues as EditorIssue[]) {
        const range = locateQuoteInDoc(docNow, issue.quote);
        if (!range) continue;  // Quote no longer present -- silent drop.
        located.push({
          issue,
          from:         range.from,
          to:           range.to,
          passCategory: category,
        });
      }

      // Hand the located issues to the editor and to App.tsx in one shot.
      // CodeMirror's StateField turns them into highlights; App.tsx
      // updates its issueCount.
      view.dispatch({ effects: addIssuesEffect.of(located) });
      onAddIssues(located);

      if (located.length === 0 && data.issues.length > 0) {
        setError(
          `The model returned ${data.issues.length} issues but none of their quotes match the current chapter. Try saving recent edits and rerunning.`,
        );
      } else if (data.issues.length === 0) {
        setError("No issues found in the active subcategories.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pass failed.");
    } finally {
      setRunning(null);
    }
  }


  function clearAll() {
    if (!view) return;
    view.dispatch({ effects: clearIssuesEffect.of() });
    onClearIssues();
    setError(null);
  }


  // Render one of the three category buttons. Includes the chevron + menu
  // for its subcategory toggles. Active styling: button glows in its
  // category color while a pass is running.
  function CategoryButton({
    category, subs, allSubs, setSubs, label, color,
  }: {
    category: IssueCategory;
    subs:     IssueSubcategory[];
    allSubs:  { key: IssueSubcategory; label: string; help: string }[];
    setSubs:  (v: IssueSubcategory[]) => void;
    label:    string;
    color:    string;     // Tailwind border/text color, e.g. "border-warn-fill text-warn"
  }) {
    const isRunning = running === category;
    const isMenuOpen = openMenu === category;

    return (
      <div className="relative">
        <div className={`flex items-stretch overflow-hidden rounded border ${color}`}>
          <button
            onClick={() => runPass(category)}
            disabled={running != null || !view}
            className={`px-3 py-1 text-xs font-semibold transition-colors hover:bg-opacity-30 disabled:cursor-not-allowed disabled:opacity-50 ${color.replace("border-", "hover:bg-")}/20`}
            title={`Run ${label} pass`}
          >
            {isRunning ? `${label}...` : label}
          </button>
          <button
            onClick={() => setOpenMenu(isMenuOpen ? null : category)}
            disabled={running != null}
            className={`border-l ${color} px-1.5 py-1 text-xs hover:bg-opacity-30 disabled:cursor-not-allowed disabled:opacity-50 ${color.replace("border-", "hover:bg-")}/20`}
            title="Configure subcategories"
            aria-label="Open subcategory menu"
          >
            ▾
          </button>
        </div>

        {/* Subcategory dropdown. Anchored to the button. */}
        {isMenuOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded border border-border bg-bg-panel p-2 text-xs shadow-lg">
            <p className="mb-1 text-micro uppercase tracking-wide text-faint">
              Look for
            </p>
            <div className="space-y-1">
              {allSubs.map(s => (
                <label key={s.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-accent-soft/20">
                  <input
                    type="checkbox"
                    checked={subs.includes(s.key)}
                    onChange={() => toggleSub(s.key as IssueSubcategory, subs, setSubs)}
                    className="mt-0.5 h-3 w-3 accent-accent-fill"
                  />
                  <span className="flex flex-col">
                    <span className="text-text-primary">{s.label}</span>
                    <span className="text-micro text-faint">{s.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }


  return (
    <div ref={barRef} className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-primary px-3 py-1.5">
      <span className="text-micro uppercase tracking-wide text-faint">Smart Advisor</span>
      {/* THE FIRST PLACE IN THIS APP WHERE HELP HAS TO TALK ABOUT MONEY.
          A pass reads the whole chapter unless something is selected, so
          "select first" is not a tip -- it is the difference in the bill.

          compact because this is a crowded toolbar: worded triggers took enough
          width to shove the pass buttons along the row. The panel floats, so
          opening it no longer grows this row and wraps Context onto a second
          line. */}
      <Explain of="advisor.what" compact />

      <CategoryButton
        category="readability"
        subs={readabilitySubs}
        allSubs={READABILITY_SUBS as { key: IssueSubcategory; label: string; help: string }[]}
        setSubs={(v) => setReadabilitySubs(v as ReadabilitySubcategory[])}
        label="Readability"
        color="border-warn-fill text-warn"
      />

      <CategoryButton
        category="structure"
        subs={structureSubs}
        allSubs={STRUCTURE_SUBS as { key: IssueSubcategory; label: string; help: string }[]}
        setSubs={(v) => setStructureSubs(v as StructureSubcategory[])}
        label="Structure"
        color="border-weave-fill text-weave"
      />

      {/* Context group: category button + profile attach + (i) info hint.
          Context is the only pass that depends on external data (profiles)
          so it gets extra affordances to remind the writer to attach them. */}
      <div className="flex items-center gap-1">
        <CategoryButton
          category="context"
          subs={contextSubs}
          allSubs={CONTEXT_SUBS as { key: IssueSubcategory; label: string; help: string }[]}
          setSubs={(v) => setContextSubs(v as ContextSubcategory[])}
          label="Context"
          color="border-secondary-fill text-secondary"
        />

        {/* Attach / profile-count button. Shows "Attach Profiles" when none
            are attached, switching to a count pill once at least one is
            present. Always clickable so the writer can add more or refresh. */}
        {profileChipCount === 0 ? (
          <button
            onClick={onOpenProfilePicker}
            disabled={running != null}
            className="rounded border border-secondary-fill bg-secondary-soft/20 px-2 py-0.5 text-micro text-secondary hover:bg-secondary-fill/40 disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach character, relationship, location, or lore profiles for Context to use"
          >
            Attach Profiles
          </button>
        ) : (
          <button
            onClick={onOpenProfilePicker}
            disabled={running != null}
            className="rounded border border-secondary-fill bg-secondary-soft/10 px-2 py-0.5 text-micro text-secondary-muted hover:bg-secondary-fill/20 disabled:cursor-not-allowed disabled:opacity-50"
            title="Add or refresh attached profiles"
          >
            {profileChipCount} {profileChipCount === 1 ? "profile" : "profiles"}
          </button>
        )}

        {/* (i) info popover -- only shown when no profiles are attached.
            Disappears once the writer has attached at least one profile,
            since Context will then have something to work with. */}
        {profileChipCount === 0 && (
          <div className="relative">
            <button
              onClick={() => setShowContextInfo(prev => !prev)}
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-secondary-fill text-2xs font-bold text-secondary-fill hover:border-secondary-fill hover:text-secondary"
              title="Why does Context need profiles?"
              aria-label="Context help"
            >
              i
            </button>
            {showContextInfo && (
              <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded border border-secondary-fill bg-bg-panel p-2.5 shadow-lg">
                <p className="mb-1 text-mini font-semibold text-secondary">Context needs profiles</p>
                <p className="text-mini text-text-muted">
                  Context checks the chapter against your attached character,
                  relationship, location, and lore profiles. Without profiles
                  there is nothing to compare and very few issues will surface.
                </p>
                <p className="mt-1.5 text-mini text-secondary-muted">
                  Click <span className="font-semibold">Attach Profiles</span> to get started.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right-side area. While a pass is in flight, shows rotating status
          text (Reading chapter / Looking for issues / etc.) so the writer
          knows the AI is working through the chapter rather than wondering
          if the click registered. When idle, shows the issue-count pill
          and the Done button. The two states are mutually exclusive --
          there's no useful count or Done while we're still gathering. */}
      <div className="ml-auto flex items-center gap-2">
        {running ? (
          <span className="flex items-center gap-1.5 text-mini italic text-accent">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-muted" />
            {progressText(running, elapsed, runningIsSelection)}
          </span>
        ) : (
          <>
            {/* Scope pill: tells the writer what the next pass will cover.
                Shows "selection (N words)" when there's a qualifying
                selection, otherwise "full chapter". Hidden while a pass
                is running -- the progress text covers that case. */}
            <span
              className={`rounded-full border px-2 py-0.5 text-micro ${
                selectionInfo
                  ? "border-warn-fill bg-warn-soft/20 text-warn-strong"
                  : "border-border bg-bg-elev text-faint"
              }`}
              title={
                selectionInfo
                  ? "Smart Advisor will run on your current selection."
                  : "No selection. Smart Advisor will run on the whole chapter."
              }
            >
              {selectionInfo
                ? `selection (${selectionInfo.words} ${selectionInfo.words === 1 ? "word" : "words"})`
                : "full chapter"}
            </span>
            {issueCount > 0 && (
              <span className="rounded-full border border-accent-fill bg-accent-soft/30 px-2 py-0.5 text-micro text-accent-strong">
                {issueCount} {issueCount === 1 ? "issue" : "issues"}
              </span>
            )}
            {issueCount > 0 && (
              <button
                onClick={clearAll}
                className="rounded border border-border px-2 py-0.5 text-xs text-faint hover:text-text-muted"
                title="Clear all highlights"
              >
                Done
              </button>
            )}
          </>
        )}
      </div>

      {/* Error message, full-width on its own row when present. Keeps the
          button row stable in height. */}
      {error && (
        <p className="basis-full text-mini text-danger-muted">{error}</p>
      )}
    </div>
  );
}


// Rotating status string for the in-flight indicator. Driven by elapsed
// seconds rather than abstract progress (the AI doesn't report progress)
// so the writer sees the text shift over time and feels the request is
// alive. The phases are honest in the sense that the model genuinely DOES
// read the chapter, then identify candidate issues, then format them --
// our wording just gives that hidden process a face.
function progressText(
  category: IssueCategory,
  elapsedSeconds: number,
  isSelection: boolean,
): string {
  // Display label for the category. Short so the right-side area doesn't
  // wrap the toolbar onto a second row.
  const label =
    category === "readability" ? "readability" :
    category === "structure"   ? "structure" :
                                 "context";

  // Scope-aware first phase. After the read step the wording is identical
  // whether we're on a selection or a whole chapter -- the AI's work past
  // that point looks the same to the writer.
  if (elapsedSeconds < 3) return isSelection ? "Reading the selection..." : "Reading the chapter...";
  if (elapsedSeconds < 8) return "Looking for issues...";
  if (elapsedSeconds < 18) return `Reviewing for ${label}...`;
  return "Finishing up...";
}


// Lightweight word counter for the scope pill. Splits on whitespace and
// drops empty tokens. Doesn't try to be Unicode-clever about apostrophes
// or hyphenation -- a couple of words off in either direction does not
// affect the 5-word floor used to qualify a selection.
function countWords(text: string): number {
  if (!text) return 0;
  const tokens = text.trim().split(/\s+/);
  return tokens.filter(Boolean).length;
}
