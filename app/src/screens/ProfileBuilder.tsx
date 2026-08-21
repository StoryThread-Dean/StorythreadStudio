// ProfileBuilder.tsx -- The Profile Builder Screen
// ====================================================================
// Three-panel layout:
//   Left   -- profile type tabs, list of profiles, create/import buttons
//   Center -- structured form editor with importance-level trait blocks
//            (core/present/background/contextual/hidden) and an adaptive
//            word count gauge per trait block
//   Right  -- Profile Companion chat with 4 behavior modes
//            (chat/extract_traits/check_consistency/refine)
//
// Data flow:
//   1. On mount / type change: fetch profile list from backend
//   2. On profile click: fetch full profile, display in editor
//   3. As writer edits: update local state (dirty tracking)
//   4. On Ctrl+S or Save: POST to backend, mark saved

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { Plus, ChevronLeft, ChevronRight, Trash2, Download, Sparkles, Send, Bot, Settings2, ChevronDown, Scissors, HelpCircle, X, Eye, EyeOff, BookOpen } from "lucide-react";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { Explain } from "../components/learn/Explain";
import type { ProjectInfo } from "../types/project";
import type {
  Profile,
  ProfileListItem,
  ProfileSection,
  TraitBlock,
  ProfileType,
  ImportanceLevel,
} from "../types/profile";
import type { ProfileChatMessage, ProfileBehaviorMode } from "../types/ai";
import {
  IMPORTANCE_LABELS,
  SUBTEXT_HELP,
} from "../types/profile";
// WHAT KINDS OF ENTRY THIS WORLD HAS, and what sections each one holds -- read
// from the project's own types.json rather than from a table of four. This is
// what gives Governments, Factions, Deities, Religions, Creatures and Cultures
// a real editor, along with any kind the writer invents, without a line of
// per-kind code here.
import {
  isShadowed, sectionColour, useTypeRegistry, type SectionConfig,
} from "../types/sectionRegistry";
import { v4 as uuidv4 } from "uuid";
import { IMPORTANCE_HELP, getSectionHelp } from "../data/profileHelp";
import type { ImportanceLevelHelp, SectionHelp } from "../data/profileHelp";
import { formatProfileForAI } from "../utils/profileFormat";
import { autoSizeTextarea } from "../utils/autoSizeTextarea";
import { RightPanelResizer, useRightPanelWidth, RIGHT_PANEL_CLASS } from "../components/RightPanelResizer";
// Character-creation helpers: personality-spine dropdowns (Enneagram +
// archetype cheat sheets) and the side-character quick-build randomizer.
// Both insert canned, editable text -- zero AI calls.
import { SpinePickers } from "../components/profiles/SpinePickers";
import { QuickBuildPanel } from "../components/profiles/QuickBuildPanel";
import { NameGeneratorPanel } from "../components/profiles/NameGeneratorPanel";
import { Dices } from "lucide-react";
import { ROLE_SUGGESTIONS } from "../data/characterSpines";
import type { CharacterKind } from "../types/profile";
// WHERE THIS PROJECT'S ENTRIES LIVE. A converted project keeps them in
// codex/ and an unconverted one in profiles/; the screen asks rather than
// assuming, because assuming is what left twelve of the writer's characters
// with no editable page. See profileSource.ts for the whole story.
import { fetchEntriesHome, sourceFor } from "./profileSource";
// Moving a character between the two pages. A data change, kept out of
// this file so it can be tested on its own.
import { convertCharacter, type Conversion } from "./characterTemplate";
// Every secret on the page in one list, without moving any of them out of
// the section that explains them.
import { SecretsPanel } from "./SecretsPanel";
// The paged walkthrough for a secret trait. Reachable from the section it
// is about, not only from the panel that lists secrets once some exist --
// which is where it was, and which meant a writer with no secrets yet had
// no way in at all.
import { SubtextGuide } from "./SubtextGuide";
// The FIRST walkthrough a writer meets here: what each part of the page is
// for, in the order the page puts them. Deliberately shallow -- the
// per-section guides do the depth.
import { ProfilePageGuide } from "./ProfilePageGuide";
// THE RUN: how an entry changes across the book. The same editor the Weave's
// own screen uses, because a fact recorded in either place is the same fact.
// Until this landed, the four kinds a novelist actually spends their time on
// had no way to record one -- which is why the story timeline on the Weave map
// has never had anything to move through.
// WHO THIS IS TO EVERYTHING ELSE. Built and tested in an earlier commit and
// mounted NOWHERE, which is why the writer had not seen it: a component with
// no consumer is a component that does not exist. Pinned by a source-read
// test now, because this is the second time in this recovery (the first was
// the Weaving panel, rendered inside a branch that never ran).
import { ProfileConnections } from "../features/codex/ProfileConnections";
import { RunEditor } from "../features/codex/RunEditor";
import { AppearsIn } from "../features/codex/AppearsIn";
import { TraitWindow } from "../components/profiles/TraitWindow";
import { fetchAnchors, fetchThreads, type ChapterAnchor } from "../features/codex/api";
import type { EntriesHome, ProfileSource } from "./profileSource";

const API_BASE = "http://localhost:8000";


// ── Word Count Gauge ─────────────────────────────────────────────────────────
// Adaptive thresholds shift by importance level. Higher importance = more words
// tolerated, because core traits need more detail for AI to use well.
// Hidden traits have no gauge (writer-only, any length).

interface GaugeThresholds {
  sparse: number;    // 0 to this = sparse (red)
  basic: number;     // to this = basic (amber)
  good: number;      // to this = good (green)
  detailed: number;  // to this = detailed (yellow-green)
  wordy: number;     // to this = wordy (amber)
  // above wordy = bloated (red)
}

// One entry per weight. There used to be an Exclude<> here for "hidden", which
// had no gauge at all -- so the app refused to advise on the length of the
// writer's most carefully written material. A secret has a real weight now and
// gets that weight's guidance.
const GAUGE_THRESHOLDS: Record<ImportanceLevel, GaugeThresholds> = {
  core:       { sparse: 15,  basic: 40,  good: 120, detailed: 200, wordy: 350 },
  present:    { sparse: 10,  basic: 30,  good: 100, detailed: 175, wordy: 300 },
  background: { sparse: 5,   basic: 20,  good: 60,  detailed: 100, wordy: 150 },
  contextual: { sparse: 5,   basic: 15,  good: 40,  detailed: 75,  wordy: 120 },
};

type GaugeLevel = "sparse" | "basic" | "good" | "detailed" | "wordy" | "bloated";

function getGaugeLevel(wordCount: number, importance: ImportanceLevel): { level: GaugeLevel; label: string; color: string } {
  const t = GAUGE_THRESHOLDS[importance];

  if (wordCount <= t.sparse) return { level: "sparse", label: "Sparse -- add more", color: "text-red-400" };
  if (wordCount <= t.basic)  return { level: "basic",  label: "Basic",             color: "text-amber-400" };
  if (wordCount <= t.good)   return { level: "good",   label: "Good",              color: "text-emerald-400" };
  if (wordCount <= t.detailed) return { level: "detailed", label: "Detailed",      color: "text-lime-400" };
  if (wordCount <= t.wordy)  return { level: "wordy",  label: "Wordy -- trim recommended", color: "text-amber-400" };
  return { level: "bloated", label: "Too Bloated!", color: "text-red-400" };
}

// Visual gauge bar that fills proportionally
function WordGauge({ wordCount, importance }: { wordCount: number; importance: ImportanceLevel }) {
  const { level, label, color } = getGaugeLevel(wordCount, importance);
  const t = GAUGE_THRESHOLDS[importance];

  // Calculate fill percentage (0-100), capped at the bloated threshold
  const maxDisplay = t.wordy * 1.3; // gauge bar fills up to 130% of wordy threshold
  const pct = Math.min(100, (wordCount / maxDisplay) * 100);

  // Bar color matches the gauge level
  const barColor =
    level === "sparse"   ? "bg-red-500/60" :
    level === "basic"    ? "bg-amber-500/60" :
    level === "good"     ? "bg-emerald-500/60" :
    level === "detailed" ? "bg-lime-500/50" :
    level === "wordy"    ? "bg-amber-500/60" :
    "bg-red-500/60";

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {/* The gauge bar */}
      <div className="h-1 flex-1 rounded-full bg-border">
        <div
          className={`h-1 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Label */}
      <span className={`shrink-0 text-xs ${color}`}>
        {label} ({wordCount})
      </span>
    </div>
  );
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}


// ── Find & Replace helpers ───────────────────────────────────────────────────
// The Profile Builder uses plain <textarea>s instead of CodeMirror, so the
// browser has no built-in find/replace. These helpers walk every text field
// in the open profile in the same top-to-bottom order the UI displays them,
// so "Find next" navigates matches the way the writer expects.
//
// Every searchable field in the DOM is tagged with data-pb-field="<id>",
// where <id> matches the fieldId produced by walkProfileMatches. The Find
// bar uses that attribute to scroll/focus/select the exact match location.

// Escape special regex characters so a literal string can be used as a pattern.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One find result. `path` is used to dispatch a single-match Replace back
// into the profile state; `fieldId` is used to locate the field in the DOM.
interface ProfileMatch {
  fieldId: string;         // matches the data-pb-field attribute on the element
  path:    string[];       // state path: ["name"] | ["section", key, "content"] | ["trait", tbId, "description"] ...
  start:   number;         // character offset where the match begins (in the field value)
  end:     number;         // character offset where the match ends
  value:   string;         // the field value that contained this match (used by replaceAtMatch)
}

// Walk every searchable string in the profile and return an ordered list of
// matches. Order mirrors the form layout: name, role, tags, then each
// section in SECTION_CONFIGS order (trait blocks expanded, then ai_summary),
// then full_ai_summary at the end.
function walkProfileMatches(
  profile:       Profile,
  query:         string,
  caseSensitive: boolean,
  sectionOrder:  readonly { key: string; hasTraitBlocks: boolean }[],
): ProfileMatch[] {
  const out: ProfileMatch[] = [];
  if (!query) return out;
  const flags = caseSensitive ? "g" : "gi";

  function scan(text: string, fieldId: string, path: string[]) {
    if (!text) return;
    // Build a fresh regex per call so `lastIndex` state never leaks between
    // fields. Zero-width matches can't happen with a plain escaped literal,
    // but if we ever support regex queries we'd need to bump lastIndex.
    const re = new RegExp(escapeRegex(query), flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ fieldId, path, start: m.index, end: m.index + m[0].length, value: text });
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  scan(profile.name, "name", ["name"]);
  scan(profile.role, "role", ["role"]);
  // Tags render as a single joined input ("tag1, tag2"), so search the
  // joined form -- matches what the writer sees in the field.

  for (const cfg of sectionOrder) {
    const section = profile.sections[cfg.key];
    if (!section) continue;
    if (cfg.hasTraitBlocks) {
      for (const tb of section.trait_blocks) {
        scan(tb.trait,       `trait:${tb.id}:trait`,       ["trait", tb.id, "trait"]);
        scan(tb.description, `trait:${tb.id}:description`, ["trait", tb.id, "description"]);
      }
    } else {
      scan(section.content, `section:${cfg.key}:content`, ["section", cfg.key, "content"]);
    }
    scan(section.ai_summary, `section:${cfg.key}:ai_summary`, ["section", cfg.key, "ai_summary"]);
  }

  scan(profile.full_ai_summary, "full_ai_summary", ["full_ai_summary"]);

  return out;
}

// Replace just the single match referenced by `match` (not every
// occurrence). Returns a new Profile immutably. Used by the Replace button;
// Replace All uses replaceAllInProfile below.
function replaceAtMatch(profile: Profile, match: ProfileMatch, replacement: string): Profile {
  const newValue = match.value.slice(0, match.start) + replacement + match.value.slice(match.end);
  const [kind, ...rest] = match.path;

  if (kind === "name")            return { ...profile, name: newValue };
  if (kind === "role")            return { ...profile, role: newValue };
  if (kind === "full_ai_summary") return { ...profile, full_ai_summary: newValue };
  if (kind === "tags") {
    // Round-trip through the same split/trim the UI uses so empty/duplicate
    // tags are normalised identically to manual typing.
    return { ...profile, tags: newValue.split(",").map(t => t.trim()).filter(Boolean) };
  }
  if (kind === "section") {
    const [sectionKey, fieldKind] = rest;
    const section = profile.sections[sectionKey];
    if (!section) return profile;
    const updated =
      fieldKind === "content"
        ? { ...section, content:    newValue }
        : { ...section, ai_summary: newValue };
    return { ...profile, sections: { ...profile.sections, [sectionKey]: updated } };
  }
  if (kind === "trait") {
    const [tbId, fieldKind] = rest;
    const newSections: Record<string, ProfileSection> = {};
    for (const [sKey, section] of Object.entries(profile.sections)) {
      newSections[sKey] = {
        ...section,
        trait_blocks: section.trait_blocks.map(tb =>
          tb.id === tbId
            ? { ...tb, ...(fieldKind === "trait" ? { trait: newValue } : { description: newValue }) }
            : tb
        ),
      };
    }
    return { ...profile, sections: newSections };
  }
  return profile;
}

// Replace every occurrence of `query` with `replacement` across the whole
// profile in one pass. Used by the Replace All button. Implemented as a
// series of replaceAtMatch calls in reverse order so earlier offsets stay
// valid while later ones are rewritten.
function replaceAllInProfile(
  profile:       Profile,
  query:         string,
  replacement:   string,
  caseSensitive: boolean,
  sectionOrder:  readonly { key: string; hasTraitBlocks: boolean }[],
): Profile {
  const matches = walkProfileMatches(profile, query, caseSensitive, sectionOrder);
  // Walk backward so replacing later matches doesn't invalidate earlier
  // offsets within the same field value.
  let current = profile;
  for (let i = matches.length - 1; i >= 0; i--) {
    // Recompute value at replace time by re-scanning -- match.value was
    // captured from the pre-replace profile and may drift if multiple
    // matches live in the same field. Cheaper fix: re-walk once at the end
    // per field; simpler fix: recompute fresh each iteration.
    const fresh = walkProfileMatches(current, query, caseSensitive, sectionOrder);
    if (fresh.length === 0) break;
    // Replace the LAST outstanding match so indices before it stay valid.
    current = replaceAtMatch(current, fresh[fresh.length - 1], replacement);
  }
  return current;
}

// formatProfileForAI is imported from utils/profileFormat.ts -- single source
// of truth for how profiles are represented in AI prompts. Used here for
// generate-full-summary and the profile chat system.

// ── AutoTextarea ─────────────────────────────────────────────────────────────
// A textarea that auto-expands to fit its content, preventing unnecessary
// scrollbars while keeping a minimum visible height.

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
  dataField,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  // Optional identifier used by the Find & Replace bar to locate this field
  // in the DOM (data-pb-field="..."). Plain attribute passthrough since
  // this component wraps a raw <textarea>.
  dataField?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lineH = 20;
    const minH = minRows * lineH + 12;
    // Preserve scroll position across the resize (see util) so typing in a long
    // trait field doesn't fling the form to the bottom on every keystroke.
    autoSizeTextarea(el, { minH });
  }, [value, minRows]);

  // Always tag with .text-entry so profile description and notes fields
  // pick up the writer-facing font-size set by useUiScale, regardless of
  // what the caller passed in className. Caller classes still win for
  // colors / padding / borders -- only the font-size is dictated here.
  const mergedClassName = ["text-entry", className].filter(Boolean).join(" ");

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={minRows}
      style={{ resize: "none", overflow: "hidden" }}
      className={mergedClassName}
      data-pb-field={dataField}
    />
  );
}


// ChatMarkdown is now imported from components/ChatMarkdown.tsx (shared with App.tsx)


// ── Props ────────────────────────────────────────────────────────────────────
interface ProfileBuilderProps {
  project: ProjectInfo;
  initialType: ProfileType;
  /**
   * Open straight onto one entry, by its filename.
   *
   * Added for Weaving: a stop that says "Alexandra is missing her Overview --
   * open it and fill it in" has to actually open Alexandra. Landing on the
   * Characters list and leaving the writer to find her again is not the same
   * promise, and reads as a dead end.
   */
  initialFilename?: string;
  onBack: () => void;
}


// ── ProfileBuilder Component ─────────────────────────────────────────────────
export function ProfileBuilder({
  project, initialType, initialFilename, onBack,
}: ProfileBuilderProps) {

  // ── State ────────────────────────────────────────────────────────────────
  const [profileType, setProfileType] = useState<ProfileType>(initialType);
  const [profileList, setProfileList] = useState<ProfileListItem[]>([]);
  // Which folder this project's entries live in, and how many are in the other
  // one. `null` means the answer has not arrived yet, which is different from
  // "profiles" -- loading a list before knowing would read the wrong folder and
  // show an empty screen for a converted project.
  const [home, setHome] = useState<EntriesHome | null>(null);
  const [elsewhere, setElsewhere] = useState(0);
  // Whether a conversion is half-finished. See the notice further down: the
  // same condition (entries in the other folder) has two causes needing
  // opposite explanations, and without this the screen told a writer whose
  // migration had died that it had never started.
  const [migrationState, setMigrationState] =
    useState<"none" | "incomplete" | "done">("none");
  // The writer's own chapters, in order, for every "when" question the Run
  // asks. Never a date and never a number they have to work out.
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  // Everyone in the world who could hold a belief, so "whose truth" is a choice
  // rather than an id typed from memory.
  const [people, setPeople] = useState<{ entity_id: string; name: string }[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create profile form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  // Characters only: which template the new profile starts from.
  const [newKind, setNewKind] = useState<CharacterKind>("main");
  const [creating, setCreating] = useState(false);
  // Name generator toggles: one for the create form, one for the header
  // dice button on an open character profile.
  const [showCreateNameGen, setShowCreateNameGen] = useState(false);
  const [showHeaderNameGen, setShowHeaderNameGen] = useState(false);

  // Character list grouping: Main vs Side/Background, each independently
  // collapsible (session-only state -- the groups default open).
  const [mainGroupCollapsed, setMainGroupCollapsed] = useState(false);
  const [sideGroupCollapsed, setSideGroupCollapsed] = useState(false);

  // Refs for Ctrl+S handler (avoids stale closures)
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // Generation state -- tracks which field is being AI-generated
  const [generatingField, setGeneratingField] = useState<string | null>(null);

  // MOVING A CHARACTER BETWEEN THE TWO PAGES.
  //
  // Held as a pending question rather than done on click, because Main to Side
  // has one consequence worth stating first: a hidden trait dissolved into
  // prose loses the thing that kept it out of an AI prompt. `null` means
  // nothing is being asked.
  const [pageGuideOpen, setPageGuideOpen] = useState(false);
  const [templateAsk, setTemplateAsk] = useState<"main" | "side" | null>(null);
  // What the last conversion actually did, shown afterwards so the writer knows
  // where their traits went rather than hunting for them.
  const [templateDid, setTemplateDid] = useState<Conversion | null>(null);

  // Phase 6: which standalone relationship profiles were folded into the most
  // recent Full AI Summary generation. Set after a successful character-profile
  // generate-full-summary call; cleared when the writer switches profiles.
  // Surfaces the otherwise invisible relationship-aware behavior so the writer
  // can see "we used: [Alex's Father, The Mentor]" inline with the summary card.
  const [relationshipSourcesUsed, setRelationshipSourcesUsed] = useState<string[]>([]);

  // Chat state -- session-only, no server persistence
  const [chatMessages, setChatMessages] = useState<ProfileChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatModelUsed, setChatModelUsed] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Behavior mode (5 modes: chat, refine, extract_traits, check_consistency, interview)
  const [behaviorMode, setBehaviorMode] = useState<ProfileBehaviorMode>("chat");
  const [behaviorPanelOpen, setBehaviorPanelOpen] = useState(false);

  // Interview mode only: which sections the writer has checked for the next
  // expansion round. Sent as a plain line appended to their message (the
  // backend is stateless -- the checked list travels IN the chat text, so
  // the writer sees exactly what the AI sees) and cleared after each send.
  const [expandPicks, setExpandPicks] = useState<Set<string>>(new Set());

  // Importance Audit state -- AI reviews all trait blocks for importance mismatches
  const [auditFlags, setAuditFlags] = useState<{ trait: string; current_importance: string; suggested_importance: string; reason: string }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  // WHICH TRAIT TILES ARE OPEN.
  //
  // Every trait used to render as a full card -- name, description, importance,
  // gauge, two AI buttons -- so a character with twenty traits was a wall of
  // controls and the writer scrolled past their own work looking for the one
  // they wanted. Collapsed, a trait is one line they can scan.
  //
  // MORE THAN ONE STAYS OPEN, unlike the Run's facts. The writer asked for
  // exactly that: "I want the expands to remain open while Writer is working
  // within that profile, allowing the scroll to do the heavy lifting of moving
  // between tiles." Comparing two traits while editing a third is ordinary
  // work; one-at-a-time would fight it.
  const [openTraits, setOpenTraits] = useState<Set<string>>(new Set());
  const toggleTrait = useCallback((id: string) => {
    setOpenTraits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Focused section indicator
  const [focusedSection, setFocusedSection] = useState<{ key: string; heading: string } | null>(null);

  // Right panel collapse
  const [chatCollapsed, setChatCollapsed] = useState(false);

  // Right panel width -- toggleable compact/wide, persisted per localStorage.
  // Separate key from the Writing Companion so the two panels can have
  // independent preferences.
  const chatPanel = useRightPanelWidth("storythread.profileBuilder.chatWidth");

  // Find & Replace bar -- shown at the top of the center panel when the
  // writer presses Ctrl+F or Ctrl+H. Because the profile editor uses plain
  // <textarea>s, the browser's native find doesn't cover these fields; this
  // bar walks every searchable field in the open profile and does the
  // replacement via state, marking the profile dirty so the writer must
  // explicitly save (same flow as typing by hand).
  const [findOpen,       setFindOpen]       = useState(false);
  const [findQuery,      setFindQuery]      = useState("");
  const [replaceQuery,   setReplaceQuery]   = useState("");
  const [findCaseSens,   setFindCaseSens]   = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // The world's own kinds. One fetch, and the tabs, the labels and every
  // section on the page come from it.
  const registry = useTypeRegistry(project.root_path);
  const sectionsFor = useCallback(
    (type: string): SectionConfig[] => registry.sections[type] ?? [],
    [registry.sections]);

  // Section configs for the current profile type
  const allSections = useMemo(
    () => sectionsFor(profileType),
    [sectionsFor, profileType]
  );

  // A RETIRED SECTION IS HIDDEN UNLESS IT ALREADY HOLDS SOMETHING.
  //
  // Relationships Overview is the first: its job is done twice over now, by
  // Connections and by Relationship entries. Hiding it outright would leave a
  // writer's paragraph on disk with no way to reach it, so it stays on screen
  // exactly as long as there is something in it -- and disappears for good once
  // they have moved the words somewhere better.
  const sections = useMemo(
    () => allSections.filter(config => {
      if (!config.retired) return true;
      const section = profile?.sections?.[config.key];
      return Boolean(section?.content?.trim())
        || Boolean(section?.trait_blocks?.length);
    }),
    [allSections, profile]
  );

  // Which character template the OPEN profile uses. Side/background
  // characters render every section as a single free-text field (no trait
  // blocks) and get the Quick Build panel; main characters keep the full
  // trait-block editor.
  const isSideCharacter =
    profile?.type === "character" && profile.character_kind === "side";

  // Which profile types appear as tabs in the left panel.
  // Chapter-summary and scene-summary entries are still parseable for legacy
  // files, but they're reached through the main-menu sidebar (Manuscript tree
  // for chapter summaries, Summaries > Scene Summaries for scene summaries).
  // Filtering them out here removes the duplicate access point and avoids
  // confusing the writer with the same data shown in two places.
  // The kinds offered as tabs: the world's Profiles group, which is the same
  // rule the Weave sidebar follows, so a kind added in one screen is there in
  // the other. Chapter and scene summaries are not entries at all any more --
  // they are plain Markdown under summaries/ since Phase 6 -- and the registry
  // does not list them, so they drop out without a special case.
  const TAB_PROFILE_TYPES = registry.tabs;

  /** One of them, for a heading like "New Character". Labels are plural
   *  because a section holds many; this is the only place that wants the
   *  singular, and a trailing "s" is the whole rule the app's own pluraliser
   *  uses. "Bloodlines" -> "Bloodline". */
  const singular = (label: string) =>
    label.endsWith("ies") ? label.slice(0, -3) + "y"
      : label.endsWith("s") ? label.slice(0, -1)
      : label;

  /** What a kind is called on screen. */
  const labelFor = useCallback(
    (type: string) => registry.labels[type] ?? type,
    [registry.labels]);

  // Reset chat state when switching profiles
  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setChatError(null);
    setBehaviorMode("chat");
    setBehaviorPanelOpen(false);
    setFocusedSection(null);
    // The account of a template change belongs to the profile it was
    // about. Following the writer to the next one would be a receipt for
    // something they are no longer looking at.
    setTemplateDid(null);
    setTemplateAsk(null);
    // Every profile opens closed. Carrying one character's open tiles to the
    // next would hand the writer a page mid-edit that they did not leave that
    // way.
    setOpenTraits(new Set());
  }, [profile?.filename]);


  // ── Data Operations ──────────────────────────────────────────────────────

  // One question, asked once: which folder. The backend decides it (see
  // entries_home in the Python) so this screen and the sidebar can never
  // disagree about how many Characters a project has.
  useEffect(() => {
    let cancelled = false;
    fetchEntriesHome(project.root_path).then(report => {
      if (cancelled) return;
      setHome(report.home);
      setElsewhere(report.elsewhere);
      setMigrationState(report.migrationState);
    });
    return () => { cancelled = true; };
  }, [project.root_path]);

  // Chapters, once per project. Cheap, and the Run editor cannot ask "from
  // when" without them.
  useEffect(() => {
    let cancelled = false;
    fetchAnchors(project.root_path)
      .then(body => { if (!cancelled) setChapters(body.chapters ?? []); })
      .catch(() => { if (!cancelled) setChapters([]); });
    fetchThreads(project.root_path)
      .then(body => {
        if (cancelled) return;
        setPeople((body.threads ?? [])
          .map(t => ({ entity_id: t.entity_id, name: t.name })));
      })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [project.root_path]);

  // The reader and writer for that folder. Rebuilt only when the home changes,
  // so every operation below is pointed at one place for as long as the screen
  // is open.
  const source: ProfileSource | null = useMemo(
    // Waits for the registry too: a codex entry cannot be read into a form
    // whose sections are not known yet, and loading it early would drop every
    // section the form had not heard of.
    () => (home && !registry.loading && !registry.error
      ? sourceFor(project.root_path, home, sectionsFor)
      : null),
    [project.root_path, home, registry.loading, registry.error, sectionsFor]
  );

  const fetchProfileList = useCallback(async (type: ProfileType) => {
    if (!source) return;
    setListLoading(true);
    setError(null);
    setProfile(null);
    setIsDirty(false);

    try {
      setProfileList(await source.list(type));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profiles.");
      setProfileList([]);
    } finally {
      setListLoading(false);
    }
  }, [source]);

  // Waits for the home to arrive: `source` is null until then, and fetching
  // would otherwise read profiles/ for one render and replace it a moment
  // later, which looks exactly like an empty project.
  useEffect(() => {
    fetchProfileList(profileType);
  }, [profileType, fetchProfileList]);


  const loadProfile = useCallback(async (item: ProfileListItem) => {
    if (!source) return;
    setEditorLoading(true);
    setError(null);
    try {
      setProfile(await source.load(item));
      setIsDirty(false);
      // Each profile gets its own list of folded-in relationships. Clear the
      // badge from the previously open profile so it doesn't follow the writer
      // around when they switch profiles before regenerating.
      setRelationshipSourcesUsed([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      setEditorLoading(false);
    }
  }, [source]);

  const handleSave = useCallback(async () => {
    const p = profileRef.current;
    if (!p || !source) return;
    try {
      // A refused save leaves the writer's text exactly where it is, still
      // marked unsaved. That is the point of refusing rather than overwriting:
      // the words are still in the buffer to try again with.
      const saved: Profile = await source.save(p);
      setProfile(saved);
      setIsDirty(false);
      setError(null);

      // Keep the left-panel list in sync with the just-saved profile so a
      // rename (e.g. Serena -> Abby) shows up right away instead of waiting
      // until the writer switches tabs or reopens the project. Patch the
      // matching item in place by filename (filename is stable across edits).
      setProfileList(prev => {
        const idx = prev.findIndex(item => item.filename === saved.filename);
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          name:   saved.name,
          role:   saved.role,
          status: saved.status,
          // Which GROUP the row belongs to. Without this a character moved to
          // Side stayed under Main until the writer switched tabs, which is
          // exactly the "no way to move them" complaint in another form.
          character_kind: saved.character_kind ?? next[idx].character_kind,
        };
        // Re-sort so renames move the item to its alphabetical place.
        next.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    }
  }, [source]);


  // --- Delete a profile ---
  // Removes the .md file from disk and drops it from the left-panel list.
  // The writer confirms with a native dialog first so a mis-click can't
  // destroy hours of work. If the deleted profile is the one currently open
  // in the editor, we clear the editor too.
  const handleDelete = useCallback(async (item: ProfileListItem) => {
    const ok = window.confirm(
      `Delete "${item.name}"? This removes the profile file from disk and cannot be undone.`
    );
    if (!ok || !source) return;

    try {
      await source.remove(item);
      setProfileList(prev => prev.filter(p => p.filename !== item.filename));
      // If the deleted profile was open in the editor, clear the editor view.
      if (profileRef.current?.filename === item.filename) {
        setProfile(null);
        setIsDirty(false);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete profile.");
    }
  }, [source]);


  /**
   * Move the open character to the other page.
   *
   * IN MEMORY ONLY. Manual save is the product rule and this is no exception --
   * the profile is marked unsaved and the writer commits it, or switches away
   * and loses nothing. Converting is therefore free to try.
   */
  const applyTemplate = useCallback((to: "main" | "side") => {
    const current = profileRef.current;
    if (!current) return;
    const result = convertCharacter(current, to, sectionsFor("character"));
    setProfile(result.profile);
    setIsDirty(true);
    setTemplateAsk(null);
    setTemplateDid(result);
    // The left-panel row lives in the other group now. Patched here rather than
    // refetching, so the writer's unsaved work is not thrown away to move a row.
    setProfileList(prev => prev.map(item =>
      item.filename === result.profile.filename
        ? { ...item, character_kind: to }
        : item));
  }, [sectionsFor]);

  // --- Find & Replace actions ---
  // Section-order helper passed to the walker so match order matches the UI.
  // sections is already keyed by profileType and memoised above.
  const sectionOrder = useMemo(
    () => sections.map(s => ({ key: s.key, hasTraitBlocks: s.hasTraitBlocks })),
    [sections]
  );

  // Ordered list of all matches in the current profile. Recomputes on every
  // keystroke via useMemo -- cheap enough for profile-sized text.
  const findMatches: ProfileMatch[] = useMemo(
    () => (profile && findQuery
      ? walkProfileMatches(profile, findQuery, findCaseSens, sectionOrder)
      : []),
    [profile, findQuery, findCaseSens, sectionOrder]
  );

  // Which match is currently "active" (shown highlighted/selected). null
  // means the writer hasn't navigated yet -- the first Find press jumps to
  // match 0.
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number | null>(null);

  // Reset the active match pointer whenever the query changes, so a fresh
  // search starts from the top instead of resuming from a stale index.
  useEffect(() => {
    setCurrentMatchIdx(null);
  }, [findQuery, findCaseSens, profile?.filename]);

  // Open the requested entry once the list it lives in has arrived, and only
  // then -- the list is what carries the item a load needs. Guarded by a ref
  // so it happens ONCE: without that, every later list refresh would yank the
  // writer back to the entry they were sent to, discarding whatever they had
  // moved on to.
  const openedRequested = useRef(false);
  useEffect(() => {
    if (openedRequested.current || !initialFilename) return;
    const wanted = profileList.find(item => item.filename === initialFilename);
    if (!wanted) return;
    openedRequested.current = true;
    void loadProfile(wanted);
  }, [initialFilename, profileList, loadProfile]);

  // Jump the writer's cursor to one specific match: scroll its field into
  // view, focus it, and select the exact character range. This gives the
  // same "highlight the next match" feel as Ctrl+F in a real text editor.
  const scrollToMatch = useCallback((match: ProfileMatch) => {
    // Defer a tick so any pending render (e.g. after a replace) settles
    // before we query the DOM.
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-pb-field="${CSS.escape(match.fieldId)}"]`
      ) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(match.start, match.end);
      } catch {
        // Some inputs (type=text in certain states) may reject setSelectionRange
        // -- ignore and just leave the focus so the field is visibly active.
      }
    });
  }, []);

  // Find / Find Next: wrap around the match list. If there's no active
  // match yet, start at 0; otherwise step to the next index modulo length.
  const handleFindNext = useCallback(() => {
    if (findMatches.length === 0) return;
    const next = currentMatchIdx == null
      ? 0
      : (currentMatchIdx + 1) % findMatches.length;
    setCurrentMatchIdx(next);
    scrollToMatch(findMatches[next]);
  }, [findMatches, currentMatchIdx, scrollToMatch]);

  // Replace the currently-active match (or the first one if none active
  // yet), then advance to the next match. Matches the behaviour writers
  // expect from Notepad / VS Code: Replace replaces one, Replace All
  // replaces all.
  const handleReplaceSingle = useCallback(() => {
    const p = profileRef.current;
    if (!p || !findQuery || findMatches.length === 0) return;

    const idx = currentMatchIdx ?? 0;
    const match = findMatches[idx];
    if (!match) return;

    const updated = replaceAtMatch(p, match, replaceQuery);
    setProfile(updated);
    setIsDirty(true);

    // After state updates, matches recompute via useMemo. Schedule a jump
    // to the "same index" position in the new list, which effectively
    // means the next unreplaced match (since the one we just fixed is gone).
    // If we've run past the end, wrap to 0.
    requestAnimationFrame(() => {
      const fresh = walkProfileMatches(updated, findQuery, findCaseSens, sectionOrder);
      if (fresh.length === 0) {
        setCurrentMatchIdx(null);
        return;
      }
      const nextIdx = idx >= fresh.length ? 0 : idx;
      setCurrentMatchIdx(nextIdx);
      scrollToMatch(fresh[nextIdx]);
    });
  }, [findQuery, replaceQuery, findCaseSens, findMatches, currentMatchIdx, sectionOrder, scrollToMatch]);

  // Replace every match in one shot. Marks dirty so the writer sees the
  // Unsaved indicator and must explicitly Save (matches the rest of the
  // profile editor -- nothing writes to disk without Ctrl+S / Save).
  const handleReplaceAll = useCallback(() => {
    const p = profileRef.current;
    if (!p || !findQuery) return;
    const updated = replaceAllInProfile(p, findQuery, replaceQuery, findCaseSens, sectionOrder);
    setProfile(updated);
    setIsDirty(true);
    setCurrentMatchIdx(null);
  }, [findQuery, replaceQuery, findCaseSens, sectionOrder]);

  // Ctrl+S / Ctrl+F / Ctrl+H keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (isDirtyRef.current) handleSave();
      } else if (e.ctrlKey && (e.key === "f" || e.key === "h" || e.key === "F" || e.key === "H")) {
        // Open the Find & Replace bar. preventDefault stops the webview from
        // handling Ctrl+F itself (some shells show their own find popup).
        // Focus+select on mount happens in the panel via autoFocus + select().
        e.preventDefault();
        setFindOpen(true);
        // Defer the focus so the input is mounted before we try to grab it.
        setTimeout(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        }, 0);
      } else if (e.key === "Escape") {
        // Esc closes the bar if it's open, but only when the find input is
        // focused -- otherwise Escape would interrupt unrelated modals or
        // kill inline editing in the form.
        if (findOpen && document.activeElement === findInputRef.current) {
          setFindOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, findOpen]);

  const handleCreate = async () => {
    if (!newName.trim() || !source) return;
    setCreating(true);
    setError(null);
    try {
      const created: Profile = await source.create({
        type: profileType,
        name: newName.trim(),
        role: newRole.trim(),
        // Non-characters ignore this; "main" is the default template.
        characterKind: profileType === "character" ? newKind : "main",
      });
      await fetchProfileList(profileType);
      setProfile(created);
      setIsDirty(false);
      setShowCreateForm(false);
      setNewName("");
      setNewRole("");
      setNewKind("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile.");
    } finally {
      setCreating(false);
    }
  };

  const handleImport = async () => {
    if (!source) return;
    setError(null);
    const selected = await openFilePicker({
      multiple: false,
      // Any kind this world knows, not characters only -- that limit belonged to
      // the profile system rather than to the idea.
      title: "Choose an entry from another book",
      filters: [{ name: "Markdown entry", extensions: ["md"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const imported: Profile = await source.importFile(selected);
      // The kind comes from the FILE, not from whichever tab happens to be open:
      // importing a Government while looking at Characters is an ordinary thing
      // to do, and landing the writer on a list that does not contain what they
      // just imported would read as a failure.
      if (imported.type && imported.type !== profileType) {
        setProfileType(imported.type);
      } else {
        await fetchProfileList(profileType);
      }
      setProfile(imported);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import profile.");
    }
  };


  // ── Profile Field Updaters ───────────────────────────────────────────────

  function updateProfileField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile(prev => prev ? { ...prev, [key]: value } : prev);
    setIsDirty(true);
  }

  function updateSection(sectionKey: string, updates: Partial<ProfileSection>) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: { ...prev.sections[sectionKey], ...updates },
        },
      };
    });
    setIsDirty(true);
  }

  function addTraitBlock(sectionKey: string) {
    const newBlock: TraitBlock = {
      id: uuidv4(),
      trait: "",
      description: "",
      importance: "background",
    };
    // Open straight into it. Collapsed, a new trait is a blank line and the
    // button looks like it did nothing.
    setOpenTraits(prev => new Set(prev).add(newBlock.id));
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: [...prev.sections[sectionKey].trait_blocks, newBlock],
          },
        },
      };
    });
    setIsDirty(true);
  }

  // Append a line/paragraph to a section's free-text content -- the insert
  // path for the SIDE-character template, where sections are single fields
  // and Quick Build clicks land as new lines.
  function appendToSectionContent(sectionKey: string, text: string, separator = "\n") {
    setProfile(prev => {
      if (!prev) return prev;
      const existing = prev.sections[sectionKey]?.content ?? "";
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            content: existing.trim() ? existing.replace(/\s+$/, "") + separator + text : text,
          },
        },
      };
    });
    setIsDirty(true);
  }

  // Insert a PRE-FILLED trait block -- used by the spine dropdowns and the
  // quick-build randomizer. Unlike addTraitBlock (which adds an empty block
  // for hand-typing), this one arrives with canned text already in place;
  // it is still a perfectly normal block the writer edits or deletes.
  function insertPrefilledTraitBlock(
    sectionKey: string, trait: string, description: string, importance: ImportanceLevel,
  ) {
    const newBlock: TraitBlock = {
      id: uuidv4(),
      trait,
      description,
      importance,
    };
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: [...prev.sections[sectionKey].trait_blocks, newBlock],
          },
        },
      };
    });
    setIsDirty(true);
  }

  function updateTraitBlock(sectionKey: string, blockId: string, updates: Partial<TraitBlock>) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: prev.sections[sectionKey].trait_blocks.map(b =>
              b.id === blockId ? { ...b, ...updates } : b
            ),
          },
        },
      };
    });
    setIsDirty(true);
  }

  function removeTraitBlock(sectionKey: string, blockId: string) {
    setProfile(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionKey]: {
            ...prev.sections[sectionKey],
            trait_blocks: prev.sections[sectionKey].trait_blocks.filter(b => b.id !== blockId),
          },
        },
      };
    });
    setIsDirty(true);
  }


  // ── AI Generation Handlers ───────────────────────────────────────────────

  // Side-character Quick Build: spin the already-filled fields (Role, Tags,
  // trait lines, relationships, notes) into a compact Overview. A deliberate
  // writer-clicked exception to the no-ghostwriting stance -- output lands in
  // the editable Overview field, nothing saves until Ctrl+S, and clicking
  // again rerolls a different angle.
  const [quickOverviewLoading, setQuickOverviewLoading] = useState(false);
  async function generateQuickOverview() {
    if (!profile || quickOverviewLoading) return;
    setQuickOverviewLoading(true);
    setError(null);
    try {
      // Everything the writer has filled in, except the Overview itself.
      const sectionTexts: Record<string, string> = {};
      for (const cfg of sections) {
        if (cfg.key === "overview") continue;
        const text = (profile.sections[cfg.key]?.content ?? "").trim();
        if (text) sectionTexts[cfg.heading] = text;
      }
      const res = await fetch(`${API_BASE}/api/ai/generate-quick-overview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          role: profile.role,
          tags: profile.tags,
          sections: sectionTexts,
          model_id: project.default_model || undefined,
          content_mode: project.content_mode_default ?? "general",
          project_path: project.root_path,
        }),
      });
      if (!res.ok) {
        let detail = `Server returned ${res.status}.`;
        try { const err = await res.json(); detail = err.detail ?? detail; } catch { /* ignore */ }
        throw new Error(detail);
      }
      const data = await res.json();
      // Replaces the Overview field -- regenerate-for-variety is the point.
      // Still just unsaved editor state until the writer hits Ctrl+S.
      updateSection("overview", { content: data.overview ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the overview.");
    } finally {
      setQuickOverviewLoading(false);
    }
  }

  async function generateSectionSummary(sectionKey: string, sectionHeading: string) {
    if (!profile) return;
    setGeneratingField(sectionKey);
    setError(null);

    const section = profile.sections[sectionKey];
    const cfg = sections.find(c => c.key === sectionKey);

    let contentText = "";
    if (cfg?.hasTraitBlocks && section.trait_blocks.length > 0) {
      contentText = section.trait_blocks
        .map(b => `- ${b.trait} [${b.importance}]: ${b.description}`)
        .join("\n");
    } else {
      contentText = section.content;
    }

    if (!contentText.trim()) {
      setError("Section is empty -- add some content before generating a summary.");
      setGeneratingField(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-section-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          section_heading: sectionHeading,
          section_content: contentText,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Generation failed.");
      }
      const data = await res.json();
      updateSection(sectionKey, { ai_summary: data.section_summary });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate section summary.");
    } finally {
      setGeneratingField(null);
    }
  }

  async function generateFullSummary() {
    if (!profile) return;
    setGeneratingField("full_summary");
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-full-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          profile_content: formatProfileForAI(profile),
          // Phase 6: gives the backend access to profiles/relationships/ so
          // character summaries weave in how this character relates to others.
          project_path: project.root_path,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Generation failed.");
      }
      const data = await res.json();
      updateProfileField("full_ai_summary", data.full_summary);
      // Reflect what the backend folded in. Empty list when none were found
      // (or when the profile is not a character) so the badge stays hidden.
      setRelationshipSourcesUsed(Array.isArray(data.relationship_sources_used)
        ? data.relationship_sources_used
        : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate full summary.");
    } finally {
      setGeneratingField(null);
    }
  }


  // ── Importance Audit Handler ──────────────────────────────────────────────
  // Collects all trait blocks across all sections and sends them to AI for review.

  async function runImportanceAudit() {
    if (!profile) return;
    setAuditLoading(true);
    setAuditOpen(true);
    setAuditFlags([]);

    // Gather every trait block with its section heading
    const allBlocks: { trait: string; description: string; importance: string; section_heading: string }[] = [];
    for (const cfg of sectionsFor(profile.type)) {
      const section = profile.sections[cfg.key];
      if (!section?.trait_blocks) continue;
      for (const block of section.trait_blocks) {
        allBlocks.push({
          trait: block.trait,
          description: block.description,
          importance: block.importance,
          section_heading: cfg.heading,
        });
      }
    }

    if (allBlocks.length === 0) {
      setAuditFlags([]);
      setAuditLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai/audit-importance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          trait_blocks: allBlocks,
        }),
      });
      if (!res.ok) throw new Error("Audit request failed");
      const data = await res.json();
      setAuditFlags(data.flags ?? []);
    } catch {
      setAuditFlags([{ trait: "Error", current_importance: "", suggested_importance: "", reason: "Audit failed. Check your API key and model settings." }]);
    } finally {
      setAuditLoading(false);
    }
  }


  // ── Chat Handler ─────────────────────────────────────────────────────────

  async function sendChatMessage() {
    if (!profile || !chatInput.trim() || chatLoading) return;

    // Interview mode: the checked expansion sections travel inside the
    // message text itself -- visible to the writer, no hidden state.
    let messageText = chatInput.trim();
    if (behaviorMode === "interview" && expandPicks.size > 0) {
      messageText += `\n\nExpand these sections: ${[...expandPicks].join(", ")}`;
    }

    const userMessage: ProfileChatMessage = { role: "user", content: messageText };
    const newMessages = [...chatMessages, userMessage];

    setChatMessages(newMessages);
    setChatInput("");
    setExpandPicks(new Set());
    setChatLoading(true);
    setChatError(null);
    setChatModelUsed(project.default_model || null);

    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      // The Profile Companion always receives the full formatted profile
      // as its context -- no per-section selection.
      const profileContent = formatProfileForAI(profile);

      const res = await fetch(`${API_BASE}/api/ai/profile-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          profile_name: profile.name,
          profile_type: profile.type,
          profile_content: profileContent,
          messages: newMessages,
          behavior_mode: behaviorMode,
          content_mode: project.content_mode_default ?? "general",
          section_labels: sections.map(c => c.heading),
          project_path: project.root_path,
        }),
      });

      if (!res.ok) {
        let detail = `Server returned ${res.status}.`;
        try {
          const errBody = await res.json();
          detail = errBody.detail ?? detail;
        } catch {}
        throw new Error(detail);
      }

      const data = await res.json();
      if (data.model_used) setChatModelUsed(data.model_used);
      setChatMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setChatError("Request timed out. The model may be overloaded -- try again or switch to a faster model.");
      } else {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
      }
    } finally {
      clearTimeout(timeoutId);
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }


  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary text-text-primary">

      {/* ── LEFT PANEL: Type Tabs + Profile List ───────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-panel">

        {/* Back button */}
        <div className="border-b border-border px-3 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
            title="Return to the writing editor"
          >
            <ChevronLeft size={13} />
            Back to Writing
          </button>
        </div>

        {/* Profile type tabs */}
        <div className="border-b border-border px-3 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Profile Type
          </p>
          <div className="flex flex-col gap-1">
            {TAB_PROFILE_TYPES.map(type => (
              <button
                key={type}
                onClick={() => { if (type !== profileType) setProfileType(type); }}
                className={`rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  profileType === type
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-text-primary hover:bg-bg-raised"
                }`}
              >
                {labelFor(type)}
              </button>
            ))}
          </div>
        </div>

        {/* Profile list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {labelFor(profileType)}
            </p>
            <div className="flex items-center gap-1">
              {source?.canImport && (
                <button
                  onClick={handleImport}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-bg-raised hover:text-indigo-300"
                  title="Bring an entry in from another book"
                >
                  <Download size={12} /> Import
                </button>
              )}
              <button
                onClick={() => { setShowCreateForm(true); setNewName(""); setNewRole(""); }}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-bg-raised hover:text-indigo-300"
                title={`Create a new ${profileType} profile`}
              >
                <Plus size={12} /> New
              </button>
            </div>
          </div>

          {/* WHAT THIS SCREEN IS NOT SHOWING.
              Only in one direction, on purpose. If entries live in profiles/
              while the Weave's folder also holds some, those are unreachable
              from here and the writer should be told with a number. The reverse
              is not worth saying: after conversion, profiles/ is deliberately
              left in place as a copy, so counting it would raise an alarm about
              files that are meant to be there. */}
          {home === "profiles" && elsewhere > 0 && (
            <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
              <p className="text-xs text-amber-300">
                {elsewhere} {elsewhere === 1 ? "entry was" : "entries were"} made
                in the Weave and {elsewhere === 1 ? "is" : "are"} not shown here.
              </p>
              {/* TWO CAUSES, TWO SENTENCES.
                  Found walking the migration smoke test (issue #23). This
                  notice fires whenever entries sit in the folder this screen is
                  not reading, and that is true in two very different
                  situations. The wording was written for one of them and shown
                  in both, so a writer whose conversion had died four files in
                  was told the conversion had never happened -- on the screen
                  they were most likely to be standing on, at the moment most of
                  their profiles were missing. The count above was right the
                  whole time; only the explanation was wrong. */}
              {migrationState === "incomplete" ? (
                <p className="mt-1 text-xs text-text-muted">
                  A conversion was started and did not finish, so your entries
                  are split across both folders right now. Nothing has been
                  lost: your profiles were copied before anything changed. Open
                  the Weave to carry on from where it stopped, or to put
                  everything back the way it was.
                </p>
              ) : (
                <p className="mt-1 text-xs text-text-muted">
                  This project has not been brought into the Weave yet, so this
                  screen is reading your profiles folder. Bring it in from the
                  Weave to edit everything in one place. Until then, open those
                  entries from the Weave map.
                </p>
              )}
              <div className="mt-1">
                <Explain of="profile.home" compact />
              </div>
            </div>
          )}

          {listLoading && (
            <p className="text-xs text-faint">Loading...</p>
          )}

          {!listLoading && profileList.length === 0 && (
            <p className="text-xs text-faint">
              No {labelFor(profileType).toLowerCase()} yet. Click New to create one.
            </p>
          )}

          {(() => {
            // Row = the open-profile button on the left, a trash button on
            // the right. They're SEPARATE buttons because nesting a <button>
            // inside another <button> is invalid HTML. The `group` utility
            // lets the trash icon reveal on hover without flashing into
            // view when the writer is just scrolling the list.
            const renderRow = (item: ProfileListItem) => {
              const isActive = profile?.filename === item.filename;
              return (
                <div
                  key={item.filename}
                  className={`group mb-0.5 flex items-stretch rounded transition-colors ${
                    isActive ? "bg-indigo-600/20" : "hover:bg-bg-raised"
                  }`}
                >
                  <button
                    onClick={() => loadProfile(item)}
                    className={`flex-1 min-w-0 px-2 py-1.5 text-left ${
                      isActive ? "text-indigo-300" : "text-text-primary"
                    }`}
                    title={item.role ? `${item.role} -- ${item.filename}` : item.filename}
                  >
                    <p className="truncate text-sm">{item.name}</p>
                    {item.role && (
                      <p className="truncate text-xs text-text-muted">{item.role}</p>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    className="shrink-0 px-2 text-faint opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
                    title={`Delete ${item.name}`}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            };

            // Characters split into Main and Side/Background groups, each
            // collapsible. Other profile types keep the flat list.
            if (profileType !== "character") return profileList.map(renderRow);

            const mains = profileList.filter(i => (i.character_kind ?? "main") !== "side");
            const sides = profileList.filter(i => i.character_kind === "side");
            const groupHeader = (label: string, count: number, collapsed: boolean, onToggle: () => void) => (
              <button
                onClick={onToggle}
                className="mb-0.5 mt-1 flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-text-muted transition-colors hover:bg-bg-raised"
              >
                {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                {label} <span className="font-normal text-faint">({count})</span>
              </button>
            );

            return (
              <>
                {groupHeader("Main", mains.length, mainGroupCollapsed,
                  () => setMainGroupCollapsed(c => !c))}
                {!mainGroupCollapsed && mains.map(renderRow)}
                {groupHeader("Side / Background", sides.length, sideGroupCollapsed,
                  () => setSideGroupCollapsed(c => !c))}
                {!sideGroupCollapsed && sides.map(renderRow)}
              </>
            );
          })()}
        </div>
      </aside>


      {pageGuideOpen && (
        <ProfilePageGuide onClose={() => setPageGuideOpen(false)} />
      )}

      {/* WHAT IT WILL DO, BEFORE IT DOES IT. Not a confirmation for its own
          sake: Main to Side dissolves trait blocks into lines, and a hidden
          trait stops being hidden. That is worth one sentence first. */}
      {templateAsk && profile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={e => { if (e.target === e.currentTarget) setTemplateAsk(null); }}
        >
          <div role="dialog" aria-label={`Make ${profile.name} a ${templateAsk} character`}
               className="w-full max-w-md rounded border border-border bg-bg-panel p-4">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">
              Make {profile.name} a {templateAsk === "side" ? "Side" : "Main"} character?
            </h2>
            {templateAsk === "side" ? (
              <div className="space-y-2 text-xs text-text-muted">
                <p>
                  The Side page is one plain box per section. Every trait you
                  have written becomes a line in its own section, so nothing is
                  lost -- and importance levels go, because a Side character
                  does not have them.
                </p>
                {(() => {
                  const preview = convertCharacter(profile, "side",
                                                   sectionsFor("character"));
                  if (preview.dissolved === 0) {
                    return (
                      <p className="text-faint">
                        There are no traits to move, so this only changes the
                        page.
                      </p>
                    );
                  }
                  return (
                    <>
                      <p className="text-text-primary">
                        {preview.dissolved} trait
                        {preview.dissolved === 1 ? "" : "s"} will become
                        {preview.dissolved === 1 ? " a line" : " lines"} of text.
                      </p>
                      {preview.hidden > 0 && (
                        <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-amber-200">
                          {preview.hidden} of {preview.hidden === 1 ? "them is" : "them are"} marked
                          Hidden. A Side character has no Hidden level, so
                          {preview.hidden === 1 ? " that line" : " those lines"} will start with
                          "Hidden:" and AI can use {preview.hidden === 1 ? "it" : "them"} like
                          anything else you have written. Make them Main again to
                          get the level back.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-2 text-xs text-text-muted">
                <p>
                  The Main page adds a trait list to each section, with an
                  importance level per trait. Everything you have written stays
                  exactly where it is -- the lists start empty, and you can move
                  lines into them whenever you like.
                </p>
                <p className="text-faint">Nothing is rewritten.</p>
              </div>
            )}
            <p className="mt-2 text-xs text-faint">
              Nothing is saved until you save, so you can look at the result
              first.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => applyTemplate(templateAsk)}
                className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Make {templateAsk === "side" ? "Side" : "Main"}
              </button>
              <button
                onClick={() => setTemplateAsk(null)}
                className="rounded border border-border px-3 py-1 text-xs text-text-muted hover:text-text-primary"
              >
                Leave it as it is
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CENTER PANEL: Profile Editor ───────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Title bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-panel px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">
              {profile ? profile.name : "Profile Builder"}
            </span>
            {profile && (
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                {labelFor(profile.type)}
              </span>
            )}
            {/* THE PAGE'S OWN HELP, beside its title -- the one place a writer
                looks when the question is about the screen rather than about a
                field. The per-section (?) icons answer the narrower questions. */}
            <Explain of="profile.page" compact />
            <button
              onClick={() => setPageGuideOpen(true)}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300"
            >
              Show me how this page works
            </button>
            {/* WHICH PAGE THIS CHARACTER USES, and the way to change it.
                Beside the type chip because it is the same kind of fact about
                the entry, and one click from where the writer notices it is
                wrong. */}
            {profile?.type === "character" && (
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                  {isSideCharacter ? "Side" : "Main"}
                </span>
                <button
                  onClick={() => setTemplateAsk(isSideCharacter ? "main" : "side")}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300"
                  title={isSideCharacter
                    ? "Give this character the full Main page"
                    : "Move this character to the simpler Side page"}
                >
                  Make {isSideCharacter ? "Main" : "Side"}
                </button>
                <Explain of="character.template" compact />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {profile && (
              isDirty ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Unsaved
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Saved
                </span>
              )
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || !profile}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title="Save profile to disk (Ctrl+S)"
            >
              Save
            </button>
          </div>
        </div>

        {/* Find & Replace bar -- searches every text field in the open
            profile (name, role, tags, section content, trait blocks, AI
            summaries). Plain <textarea> fields can't hook into the browser's
            native find, so this custom bar walks the state and replaces in
            place. Replaces mark the profile dirty; the writer saves with
            Ctrl+S as usual. */}
        {findOpen && profile && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-panel px-4 py-2">
            {/* Find input -- Enter jumps to the next match, same as the
                Find button. Esc closes the bar. */}
            <input
              ref={findInputRef}
              type="text"
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { e.preventDefault(); setFindOpen(false); }
                if (e.key === "Enter")  { e.preventDefault(); handleFindNext();  }
              }}
              placeholder="Find..."
              className="w-48 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
            />
            {/* Replace-with input -- Enter triggers the single Replace
                (matches Notepad / VS Code behaviour where Enter in the
                replace input replaces the current match, not all). */}
            <input
              type="text"
              value={replaceQuery}
              onChange={e => setReplaceQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") { e.preventDefault(); setFindOpen(false); }
                if (e.key === "Enter" && findQuery) {
                  e.preventDefault();
                  handleReplaceSingle();
                }
              }}
              placeholder="Replace with..."
              className="w-48 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary placeholder-faint outline-none focus:border-indigo-500"
            />
            {/* Find (next) -- jumps to the next match, wraps at end. Writer
                can press it repeatedly to walk matches one at a time. */}
            <button
              onClick={handleFindNext}
              disabled={!findQuery || findMatches.length === 0}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title={findMatches.length === 0 ? "No matches" : "Jump to next match (Enter)"}
            >
              Find
            </button>
            {/* Replace -- replace JUST the current match and advance. */}
            <button
              onClick={handleReplaceSingle}
              disabled={!findQuery || findMatches.length === 0}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title={findMatches.length === 0 ? "No matches to replace" : "Replace this one match"}
            >
              Replace
            </button>
            {/* Replace All -- one-shot replace of every match in the profile. */}
            <button
              onClick={handleReplaceAll}
              disabled={!findQuery || findMatches.length === 0}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title={findMatches.length === 0 ? "No matches to replace" : `Replace all ${findMatches.length} match(es)`}
            >
              Replace All
            </button>
            <label className="flex items-center gap-1 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={findCaseSens}
                onChange={e => setFindCaseSens(e.target.checked)}
                className="accent-indigo-500"
              />
              Match case
            </label>
            {/* Match indicator: "N of M matches" when one is active,
                "N matches" otherwise. Gives the writer a sense of progress
                as they step through matches with Find. */}
            <span className="text-xs text-text-muted">
              {!findQuery
                ? "Type to search"
                : findMatches.length === 0
                ? "No matches"
                : currentMatchIdx == null
                ? (findMatches.length === 1 ? "1 match" : `${findMatches.length} matches`)
                : `${currentMatchIdx + 1} of ${findMatches.length}`}
            </span>
            <div className="ml-auto">
              <button
                onClick={() => setFindOpen(false)}
                className="rounded px-1 text-text-muted transition-colors hover:text-text-primary"
                title="Close (Esc)"
                aria-label="Close find and replace"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2">
            <p className="text-xs text-red-300">
              <span className="font-semibold">Error: </span>{error}
            </p>
          </div>
        )}

        {/* Create profile form */}
        {showCreateForm && (
          <div className="shrink-0 border-b border-border bg-bg-panel px-4 py-4">
            <p className="mb-3 text-sm font-semibold text-text-primary">
              New {singular(labelFor(profileType))}
            </p>
            <label className="mb-1 block text-xs text-text-muted">
              Name <span className="text-indigo-400">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              autoFocus
              placeholder={profileType === "character" ? "e.g. Elara Voss" : "e.g. Northwatch Harbor"}
              className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
            />
            {profileType === "character" && (
              <>
                {/* Name generator: roll given names + surnames by culture,
                    era, or fantasy race and drop the pick into Name. */}
                <button
                  type="button"
                  onClick={() => setShowCreateNameGen(v => !v)}
                  className="mb-3 flex items-center gap-1.5 text-xs text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  <Dices size={12} />
                  {showCreateNameGen ? "Hide name generator" : "Need a name?"}
                </button>
                {showCreateNameGen && (
                  <div className="mb-3">
                    <NameGeneratorPanel onPick={name => setNewName(name)} />
                  </div>
                )}

                <label className="mb-1 block text-xs text-text-muted">Role (optional)</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreate()}
                  placeholder="e.g. protagonist, mentor, antagonist"
                  className="mb-3 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                />

                {/* Template choice: Main = full trait-block editor; Side =
                    simplified one-field sections + the Quick Build roller. */}
                <label className="mb-1 block text-xs text-text-muted">Character template</label>
                <div className="mb-3 flex flex-col gap-1.5">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="characterKind"
                      checked={newKind === "main"}
                      onChange={() => setNewKind("main")}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <span className="text-xs">
                      <span className="font-medium text-text-primary">Main character</span>
                      <span className="text-faint"> -- full template with trait blocks and importance levels</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="radio"
                      name="characterKind"
                      checked={newKind === "side"}
                      onChange={() => setNewKind("side")}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <span className="text-xs">
                      <span className="font-medium text-text-primary">Side / background character</span>
                      <span className="text-faint"> -- simple one-field sections with the Quick Build trait roller</span>
                    </span>
                  </label>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {editorLoading && (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-text-muted">Loading profile...</p>
            </div>
          )}

          {!editorLoading && !profile && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="mb-2 text-sm text-text-muted">
                Select a profile from the left panel, or create a new one.
              </p>
              <p className="text-xs text-faint">
                Profiles store character details, traits, and context that AI can reference.
              </p>
            </div>
          )}

          {!editorLoading && profile && (
            <div className="mx-auto max-w-2xl">

              {/* Profile header -- name, role, status, tags */}
              <div className="mb-6 rounded border border-border bg-bg-panel p-4">
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Name</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={profile.name}
                        onChange={e => updateProfileField("name", e.target.value)}
                        data-pb-field="name"
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-indigo-500"
                      />
                      {/* Name generator toggle -- characters only */}
                      {profile.type === "character" && (
                        <button
                          type="button"
                          onClick={() => setShowHeaderNameGen(v => !v)}
                          className={`shrink-0 rounded border px-2 transition-colors ${
                            showHeaderNameGen
                              ? "border-indigo-500 text-indigo-300"
                              : "border-border text-text-muted hover:border-indigo-500 hover:text-indigo-300"
                          }`}
                          title="Roll a name (cultures, eras, fantasy races)"
                        >
                          <Dices size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Role</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={profile.role}
                        onChange={e => updateProfileField("role", e.target.value)}
                        placeholder="e.g. protagonist"
                        data-pb-field="role"
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                      />
                      {/* Role quick-pick: grouped Popular / Less Common /
                          Niche story functions. Picking fills the field;
                          hand-typing always works. Snaps back to blank --
                          it's an inserter, not a stored value. */}
                      {profile.type === "character" && (
                        <select
                          value=""
                          onChange={e => { if (e.target.value) updateProfileField("role", e.target.value); }}
                          className="w-24 shrink-0 rounded border border-border bg-bg-surface px-1 py-1.5 text-xs text-text-muted outline-none focus:border-indigo-500"
                          title="Pick a common story role"
                        >
                          <option value="">Pick...</option>
                          {ROLE_SUGGESTIONS.map(group => (
                            <optgroup key={group.group} label={group.group}>
                              {group.options.map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
                {/* SEX AND AGE, characters only -- the two facts a writer
                    states plainly about a person and then stops thinking about.
                    They belong up here with the name rather than buried in
                    prose, which is where they had to live before.

                    TAGS USED TO SIT IN THIS ROW AND ARE GONE. Nothing read them
                    except one side-character prompt: they were absent from the
                    chip serialiser and from the Weave's brief, so they reached no
                    AI path at all, and the Story Role picker auto-filled them
                    with words the app then ignored. Anything already typed stays
                    in the file. */}
                {profile.type === "character" && (
                  <div className="mb-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-text-muted">Sex</label>
                      <div className="flex gap-1.5">
                        {(["M", "F", "custom"] as const).map(option => {
                          const isCustom = option === "custom";
                          const chosen = isCustom
                            ? Boolean(profile.sex) && profile.sex !== "M" && profile.sex !== "F"
                            : profile.sex === option;
                          return (
                            <button
                              key={option}
                              onClick={() => updateProfileField(
                                "sex", isCustom ? (chosen ? profile.sex : " ") : option)}
                              className={`rounded border px-2 py-1 text-xs transition-colors ${
                                chosen
                                  ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                                  : "border-border text-text-muted hover:border-indigo-700"
                              }`}
                            >
                              {isCustom ? "Custom" : option}
                            </button>
                          );
                        })}
                        {/* Greyed until Custom is chosen, which is what the
                            writer asked for: the box is visibly not yours to
                            type in until you have said you want it. */}
                        <input
                          type="text"
                          value={profile.sex === "M" || profile.sex === "F"
                            ? "" : (profile.sex ?? "").trim()}
                          onChange={e => updateProfileField("sex", e.target.value)}
                          disabled={!profile.sex
                            || profile.sex === "M" || profile.sex === "F"}
                          placeholder="Your word for it"
                          aria-label="Custom sex"
                          data-pb-field="sex"
                          className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-text-muted">Age</label>
                      <input
                        type="text"
                        value={profile.age ?? ""}
                        onChange={e => updateProfileField("age", e.target.value)}
                        placeholder="18, 18ish, 18 months, approx 30, Unknown"
                        data-pb-field="age"
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
                      />
                      <p className="mt-1 text-xs text-faint">
                        Say it however you would say it. Blank is fine when it
                        does not matter.
                      </p>
                    </div>
                  </div>
                )}

                <div className="mb-3 w-1/2 pr-1.5">
                  <label className="mb-1 block text-xs text-text-muted">Status</label>
                  <select
                    value={profile.status}
                    onChange={e => updateProfileField("status", e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-indigo-500"
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                {/* Name generator -- opened by the dice button beside Name.
                    Picking writes into the Name field as a normal unsaved
                    edit (Ctrl+S keeps it). */}
                {showHeaderNameGen && profile.type === "character" && (
                  <div className="mb-3">
                    <NameGeneratorPanel
                      onPick={name => updateProfileField("name", name)}
                    />
                  </div>
                )}

                {/* Personality spine -- characters only, right in the header
                    under Status. Inserts into Personality Traits (trait
                    block on main, appended paragraph on side); a Story Role
                    pick also fills Role and merges its key-aspect tags. */}
                {profile.type === "character" && (
                  <div className="mt-1 border-t border-border pt-3">
                    <SpinePickers
                      onInsert={(trait, description) => {
                        if (isSideCharacter) {
                          appendToSectionContent("personality_traits", description, "\n\n");
                        } else {
                          insertPrefilledTraitBlock("personality_traits", trait, description, "core");
                        }
                      }}
                      onRolePicked={picked => {
                        // Fills the Role and nothing else. It used to merge the
                        // archetype's key-aspect tags in as well -- writing data
                        // that no part of the app ever read, into a field the
                        // writer could not tell was inert.
                        updateProfileField("role", picked.label);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* WHAT AN IMPORT LEFT BEHIND. An entry from another book
                  carries ids that mean nothing here: its connections, the
                  chapters its facts happen in, whose beliefs they were. Dropped
                  silently they are a loss the writer finds weeks later; said out
                  loud they are a short list of things to redo. */}
              {(profile.importWarnings ?? []).length > 0 && (
                <div className="mb-6 rounded border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-200">
                    Imported from another book. Some things could not come with
                    it:
                  </p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-text-muted">
                    {(profile.importWarnings ?? []).map(note => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-faint">
                    Everything you wrote came across: the name, every section,
                    every trait, and the words of every fact.
                  </p>
                </div>
              )}

              {/* WHAT JUST HAPPENED, AND WHAT IS NEXT -- the continuous-flow
                  rule. A page that silently rearranges itself leaves the writer
                  checking whether their traits are still there; this says where
                  they went and what is left to do. */}
              {templateDid && (
                <div className="mb-6 rounded border border-indigo-700/40 bg-indigo-950/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-text-muted">
                      <p className="text-text-primary">
                        {profile.name} is now a{" "}
                        {isSideCharacter ? "Side" : "Main"} character.
                      </p>
                      {templateDid.dissolved > 0 ? (
                        <p className="mt-1">
                          {templateDid.dissolved} trait
                          {templateDid.dissolved === 1 ? "" : "s"} became lines of
                          text inside the same sections.
                          {templateDid.hidden > 0 && (
                            <> The {templateDid.hidden === 1 ? "one" : templateDid.hidden}{" "}
                            marked Hidden {templateDid.hidden === 1 ? "starts" : "start"} with
                            "Hidden:" so you can find {templateDid.hidden === 1 ? "it" : "them"} again.</>
                          )}
                        </p>
                      ) : (
                        <p className="mt-1">
                          Nothing needed moving. Everything you wrote is where it
                          was.
                        </p>
                      )}
                      <p className="mt-1 text-amber-300">
                        Not saved yet -- press Save (or Ctrl+S) to keep it, or
                        switch profiles to leave it alone.
                      </p>
                    </div>
                    <button
                      onClick={() => setTemplateDid(null)}
                      aria-label="Dismiss"
                      className="shrink-0 rounded p-0.5 text-faint hover:text-text-primary"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* THE ORDER OF THIS PAGE IS DELIBERATE, and it is the writer's:
                  "Basic information first and foremost ... Next are the
                  Connections ... Next is the Overview ... Next or possibly moved
                  up is this [+ Something that changes] feature. Next are the
                  various Traits."
                  Trunk, then main branches, then branches, then leaves. Two
                  changes to their draft, both argued rather than assumed:
                  Overview sits AFTER Connections, which is the writer's own
                  correction on seeing it -- who someone IS reads better once
                  you know who they are TO people, and my argument for putting
                  it second (a fast win against Frayed) was about the app's
                  bookkeeping rather than about reading the page. The Run sits
                  above Connections
                  because Weaving builds connections FOR the writer while the Run
                  is the only part of an entry no other screen can produce. */}
              {/* Profile sections. Side characters render every section as a
                  single free-text field -- trait blocks are a main-template
                  feature, so hasTraitBlocks is forced off for them. */}
              {/* HOW THIS CHANGES ACROSS THE BOOK.
                  Under the sections, because the sections are what is true
                  throughout and this is what is true from a point onwards. The
                  spec's own opening example lives here: a heroine who believes
                  her father died, from chapter one, with the reader learning
                  otherwise in chapter fifteen. */}
              {/* Wrapped for the same gap every other block on this page has.
                  Without it the Run and Connections sat directly on top of each
                  other and read as one thing. */}
              {/* WHERE IT APPEARS, on the entry itself.
                  Reported: "the only current way to add to and make changes to
                  when a Profile ... pops up in Weave a Chapter [is the walk].
                  There needs to be a way to do this from the Profiles
                  themselves." A walk is a good place to answer a question once
                  and a bad place to change the answer later -- getting back to
                  one stop means starting a pass and walking to it, and a writer
                  fixing Serena's chapters is looking at Serena. */}
              <div className="mb-6">
                <AppearsIn
                  projectPath={project.root_path}
                  entityId={profile.entity_id}
                  appearsIn={profile.appears_in ?? []}
                  chapters={chapters}
                  name={profile.name}
                  onChanged={next => setProfile(
                    prev => (prev ? { ...prev, appears_in: next } : prev))}
                  unavailable={home === "profiles"
                    ? "Recording where an entry appears needs this project "
                      + "brought into the Weave first."
                    : undefined}
                />
              </div>

              <div className="mb-6">
              <RunEditor
                run={profile.run ?? []}
                chapters={chapters}
                people={people}
                self={{ entity_id: profile.entity_id, name: profile.name }}
                onChange={next => {
                  setProfile(prev => (prev ? { ...prev, run: next } : prev));
                  setIsDirty(true);
                }}
                unavailable={home === "profiles"
                  ? "Facts need this project brought into the Weave first. A "
                    + "profile file has nowhere to record a chapter, so the app "
                    + "would take what you typed and lose it. Bring your world "
                    + "in from the Weave and this fills in here."
                  : undefined}
              />
              </div>

              {/* CONNECTIONS, high on the page because they are most of what a
                  scene runs on and because Weaving fills them in for the writer.
                  Codex entries only -- a tie is the Weave's own idea and a
                  profiles/ file has nowhere to record one. */}
              {home === "codex" && profile.entity_id && (
                <div className="mb-6">
                  <ProfileConnections
                    projectPath={project.root_path}
                    entityId={profile.entity_id}
                    type={profile.type}
                    name={profile.name}
                  />
                </div>
              )}

              {sections.filter(cfg => cfg.key === "overview").map(cfg => {
                const section = profile.sections[cfg.key] ?? {
                  content: "", trait_blocks: [], ai_summary: "",
                };
                // KEYED BY PROFILE AND SECTION, so switching profiles remounts
                // these. Without the filename in the key React reuses the
                // component, and every AI summary the writer opened on the last
                // character would still be open on this one -- exactly what
                // "minimise upon opening the profile" asks it not to do.
                return (
                  <div key={`${profile.filename}:${cfg.key}`}>
                  <ProfileSectionEditor
                    sectionKey={cfg.key}
                    heading={cfg.heading}
                    hasTraitBlocks={cfg.hasTraitBlocks && !isSideCharacter}
                    // A Side page is plain boxes -- except that a secret cannot
                    // live in one. Prose has nowhere to carry "never say this",
                    // so any secret the section holds is shown as a trait, and
                    // only then. Structure appears where protection was asked
                    // for and nowhere else.
                    showSecretsOnly={isSideCharacter}
                    // The section this idea is named after, on either template.
                    teachesSubtext={cfg.key === "hidden_and_foreshadowing_traits"}
                    section={section}
                    profileName={profile.name}
                    profileType={profile.type}
                    onContentChange={content => updateSection(cfg.key, { content })}
                    onAiSummaryChange={ai_summary => updateSection(cfg.key, { ai_summary })}
                    onAddTraitBlock={() => addTraitBlock(cfg.key)}
                    onUpdateTraitBlock={(id, updates) => updateTraitBlock(cfg.key, id, updates)}
                    onRemoveTraitBlock={id => removeTraitBlock(cfg.key, id)}
                    chapters={chapters}
                    onGenerateSectionSummary={() => generateSectionSummary(cfg.key, cfg.heading)}
                    generatingField={generatingField}
                    openTraits={openTraits}
                    onToggleTrait={toggleTrait}
                    colour={sectionColour(cfg.key, allSections.findIndex(c => c.key === cfg.key))}
                    shadowed={isShadowed(cfg.key)}
                    onFocus={() => setFocusedSection({ key: cfg.key, heading: cfg.heading })}
                    showAiSummary={!isSideCharacter}
                    onGenerateOverview={
                      isSideCharacter && cfg.key === "overview" ? generateQuickOverview : undefined
                    }
                    generatingOverview={quickOverviewLoading}
                  />
                  </div>
                );
              })}

              {/* Importance Audit button + results (main template only --
                  side characters have no trait blocks to audit) */}
              {!isSideCharacter && sections.some(s => s.hasTraitBlocks) && (
                <div className="mb-6">
                  <button
                    onClick={runImportanceAudit}
                    disabled={auditLoading}
                    className="flex items-center gap-1.5 rounded border border-teal-700/50 px-3 py-1.5 text-xs text-teal-400 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI reviews all traits and flags importance level mismatches"
                  >
                    <Sparkles size={11} />
                    {auditLoading ? "Auditing..." : "Audit Importance Levels"}
                  </button>

                  {auditOpen && (
                    <div className="mt-3 rounded border border-teal-800/40 bg-teal-950/20 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-teal-300">Importance Audit Results</p>
                        <button
                          onClick={() => setAuditOpen(false)}
                          className="text-xs text-teal-700 hover:text-teal-400"
                        >
                          Close
                        </button>
                      </div>
                      {auditLoading ? (
                        <p className="text-xs text-teal-600 animate-pulse">Analyzing trait blocks...</p>
                      ) : auditFlags.length === 0 ? (
                        <p className="text-xs text-teal-500">All importance levels look reasonable. No mismatches found.</p>
                      ) : (
                        <div className="space-y-2">
                          {auditFlags.map((flag, i) => (
                            <div key={i} className="rounded border border-teal-800/30 bg-bg-panel p-2">
                              <div className="mb-1 flex items-center gap-2 text-xs">
                                <span className="font-medium text-teal-200">{flag.trait}</span>
                                {flag.current_importance && flag.suggested_importance && (
                                  <span className="text-teal-600">
                                    {flag.current_importance} → {flag.suggested_importance}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs leading-relaxed text-teal-400/80">{flag.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Build -- SIDE/BACKGROUND characters only (the
                  simplified template). Every click appends the option to
                  the matching section's text as a new line. */}
              {isSideCharacter && (
                <QuickBuildPanel
                  // Keyed by filename so switching profiles remounts the
                  // panel -- its Story Role select re-derives from the new
                  // profile's Role field instead of carrying stale state.
                  key={profile.filename}
                  initialRoleLabel={profile.role}
                  onInsert={(sectionKey, text) =>
                    appendToSectionContent(sectionKey, text, "\n")}
                  onInsertRoleSummary={(_trait, description) =>
                    appendToSectionContent("personality_traits", description, "\n\n")}
                />
              )}

              {/* EVERY SECRET, IN ONE PLACE. A view rather than a move: a
                  secret belongs beside what it explains, and relocating it into
                  a bucket would leave the model a floating fact with nothing to
                  attach it to. */}
              <SecretsPanel
                profile={profile}
                sections={sections}
                onSetWeight={(sectionKey, blockId, importance) =>
                  updateTraitBlock(sectionKey, blockId, { importance })}
              />

              {/* Profile sections. Side characters render every section as a
                  single free-text field -- trait blocks are a main-template
                  feature, so hasTraitBlocks is forced off for them. */}
              {sections.filter(cfg => cfg.key !== "overview").map(cfg => {
                const section = profile.sections[cfg.key] ?? {
                  content: "", trait_blocks: [], ai_summary: "",
                };
                // KEYED BY PROFILE AND SECTION, so switching profiles remounts
                // these. Without the filename in the key React reuses the
                // component, and every AI summary the writer opened on the last
                // character would still be open on this one -- exactly what
                // "minimise upon opening the profile" asks it not to do.
                return (
                  <div key={`${profile.filename}:${cfg.key}`}>
                  <ProfileSectionEditor
                    sectionKey={cfg.key}
                    heading={cfg.heading}
                    hasTraitBlocks={cfg.hasTraitBlocks && !isSideCharacter}
                    // A Side page is plain boxes -- except that a secret cannot
                    // live in one. Prose has nowhere to carry "never say this",
                    // so any secret the section holds is shown as a trait, and
                    // only then. Structure appears where protection was asked
                    // for and nowhere else.
                    showSecretsOnly={isSideCharacter}
                    // The section this idea is named after, on either template.
                    teachesSubtext={cfg.key === "hidden_and_foreshadowing_traits"}
                    section={section}
                    profileName={profile.name}
                    profileType={profile.type}
                    onContentChange={content => updateSection(cfg.key, { content })}
                    onAiSummaryChange={ai_summary => updateSection(cfg.key, { ai_summary })}
                    onAddTraitBlock={() => addTraitBlock(cfg.key)}
                    onUpdateTraitBlock={(id, updates) => updateTraitBlock(cfg.key, id, updates)}
                    onRemoveTraitBlock={id => removeTraitBlock(cfg.key, id)}
                    chapters={chapters}
                    onGenerateSectionSummary={() => generateSectionSummary(cfg.key, cfg.heading)}
                    generatingField={generatingField}
                    openTraits={openTraits}
                    onToggleTrait={toggleTrait}
                    colour={sectionColour(cfg.key, allSections.findIndex(c => c.key === cfg.key))}
                    shadowed={isShadowed(cfg.key)}
                    onFocus={() => setFocusedSection({ key: cfg.key, heading: cfg.heading })}
                    showAiSummary={!isSideCharacter}
                    onGenerateOverview={
                      isSideCharacter && cfg.key === "overview" ? generateQuickOverview : undefined
                    }
                    generatingOverview={quickOverviewLoading}
                  />
                  </div>
                );
              })}

              {/* Full AI Summary -- teal card */}
              <div className="mb-6 rounded border border-teal-800/40 bg-teal-950/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-teal-200">
                      {profile.type === "chapter_summary"
                        ? "Chapter Summary"
                        : profile.type === "scene_summary"
                        ? "Scene Summary"
                        : "Full AI Summary"}
                    </h2>
                    <p className="mt-0.5 text-xs text-teal-700">
                      {profile.type === "chapter_summary" || profile.type === "scene_summary"
                        ? "Used as AI context when attached as a context chip in the editor."
                        : profile.type === "character"
                        ? "Attached as a context chip in the editor. Click Generate to refine -- this character's Relationships Overview and any standalone relationship profiles that mention them are folded in automatically."
                        : "Attached as a context chip in the editor. Generate after filling in the sections above."}
                    </p>
                  </div>
                  <button
                    onClick={generateFullSummary}
                    disabled={generatingField === "full_summary"}
                    className="flex shrink-0 items-center gap-1 rounded border border-teal-700/50 px-2 py-0.5 text-xs text-teal-400 transition-colors hover:border-teal-500 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Generate this summary using AI based on the profile content above"
                  >
                    <Sparkles size={11} />
                    {generatingField === "full_summary" ? "Generating..." : "Generate"}
                  </button>
                </div>
                <AutoTextarea
                  value={profile.full_ai_summary}
                  onChange={e => updateProfileField("full_ai_summary", e.target.value)}
                  placeholder={
                    profile.type === "chapter_summary"
                      ? "Write a concise summary of this chapter for use as AI context..."
                      : profile.type === "scene_summary"
                      ? "Write a concise summary of this scene for use as AI context..."
                      : "Click Generate to create a full AI profile summary, or write one manually."
                  }
                  className="w-full rounded border border-teal-800/40 bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-teal-600"
                  minRows={4}
                  dataField="full_ai_summary"
                />

                {/* Phase 6 visibility cue: when the character's Full Summary
                    was just regenerated and the backend folded in standalone
                    relationship profiles, list them here. The Relationships
                    Overview section inside the profile is always considered
                    by the prompt -- this badge specifically calls out the
                    EXTRA standalone relationship files that were pulled in
                    so the writer can confirm the relationship-aware behavior
                    is firing instead of having to guess. */}
                {profile.type === "character" && relationshipSourcesUsed.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-teal-300">
                    <span className="text-teal-500">Folded in {relationshipSourcesUsed.length} relationship profile{relationshipSourcesUsed.length === 1 ? "" : "s"}:</span>
                    {relationshipSourcesUsed.map((name) => (
                      <span
                        key={name}
                        className="rounded-full border border-teal-700/50 bg-teal-950/60 px-2 py-0.5 text-teal-200"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </main>


      {/* ── RIGHT PANEL: Profile Companion Chat ────────────────────────
          Two size modes. Collapsed -> a 40px strip. Expanded -> either the
          compact or wide width chosen by the resizer. The resizer button
          cluster is only rendered when the panel is expanded; its anchor
          (`relative`) applies in both states but the absolute children are
          hidden when collapsed. */}
      <aside className={`relative flex shrink-0 flex-col border-l border-border bg-bg-panel transition-all duration-200 ${chatCollapsed ? "w-10" : RIGHT_PANEL_CLASS[chatPanel.width]}`}>

        {!chatCollapsed && (
          <RightPanelResizer width={chatPanel.width} setWidth={chatPanel.setWidth} />
        )}

        {/* Collapsed view */}
        {chatCollapsed ? (
          <button
            onClick={() => setChatCollapsed(false)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-faint transition-colors hover:bg-bg-raised hover:text-text-muted"
            title="Expand the Profile Chat panel"
          >
            <span className="text-xs font-medium" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              Profile Chat
            </span>
          </button>
        ) : (
        <>

        {/* Chat header */}
        <div className="border-b border-border px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="shrink-0 text-sm font-semibold text-text-primary">Profile Chat</h2>
              {focusedSection && (
                <span
                  className="truncate rounded-full border border-indigo-800/50 bg-indigo-900/20 px-2 py-0.5 text-xs text-indigo-400"
                  title={`Writer is focused on the "${focusedSection.heading}" section`}
                >
                  {focusedSection.heading}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {chatMessages.length > 0 && (
                <button
                  onClick={() => { setChatMessages([]); setChatError(null); }}
                  className="text-xs text-rose-700 transition-colors hover:text-rose-400"
                  title="Clear the conversation"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setChatCollapsed(true)}
                className="rounded p-0.5 text-faint transition-colors hover:bg-bg-raised hover:text-text-muted"
                title="Collapse the chat panel"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Session-only. Pick a mode below, then ask your question.
          </p>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!profile && (
            <p className="text-center text-xs text-faint">Open a profile to start chatting.</p>
          )}

          {profile && chatMessages.length === 0 && (
            <div className="flex flex-col items-center gap-3 pt-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-900/40 text-indigo-400">
                <Bot size={20} />
              </div>
              <div>
                <p className="text-sm font-medium text-text-muted">Profile Companion</p>
                <p className="mt-1 text-xs text-faint">
                  Pick a behavior mode below and type your question.
                </p>
              </div>
              <div className="w-full rounded border border-border bg-bg-primary p-2.5 text-left">
                <p className="mb-1 text-xs font-medium text-text-muted">
                  {behaviorMode === "interview" ? "Try starting with:" : "Try asking:"}
                </p>
                {(behaviorMode === "interview"
                  ? [
                      "Start the interview.",
                      "Interview me about this character from scratch.",
                    ]
                  : [
                      "How would AI use the core traits?",
                      "What's missing from this profile?",
                      "How does her voice trait affect dialogue?",
                    ]
                ).map(q => (
                  <button
                    key={q}
                    onClick={() => setChatInput(q)}
                    className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-faint transition-colors hover:bg-border hover:text-text-muted"
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="mr-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-900/60 text-indigo-400">
                  <Bot size={11} />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-tr-sm bg-indigo-600 text-white"
                    : "rounded-tl-sm border border-border bg-bg-surface text-text-primary"
                }`}
              >
                {msg.role === "user" ? (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  <ChatMarkdown content={msg.content} />
                )}
              </div>

              {msg.role === "user" && (
                <div className="ml-2 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-800/60 text-indigo-300">
                  <span className="text-xs font-bold">W</span>
                </div>
              )}
            </div>
          ))}

          {chatLoading && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
              <span>
                {chatModelUsed
                  ? <>{chatModelUsed.split("/").pop()} <span className="text-faint">thinking...</span></>
                  : "Thinking..."}
              </span>
            </div>
          )}

          {chatError && (
            <div className="rounded border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{chatError}</p>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Behavior mode selector */}
        <AiBehaviorPanel
          currentMode={behaviorMode}
          open={behaviorPanelOpen}
          onToggleOpen={() => setBehaviorPanelOpen(o => !o)}
          onSelectMode={(mode) => {
            setBehaviorMode(mode);
            setBehaviorPanelOpen(false);
            setChatMessages([]);
            setChatError(null);
            setExpandPicks(new Set());
          }}
        />

        {/* Interview mode: section-expansion checkboxes. Checked sections are
            appended to the next message ("Expand these sections: ...") so the
            AI knows which rounds of questions to run next. */}
        {behaviorMode === "interview" && profile && (
          <div className="border-t border-border px-3 py-2">
            <p className="mb-1.5 text-mini text-faint">
              Expand on next send:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sections.filter(c => c.heading !== "Overview").map(c => {
                const checked = expandPicks.has(c.heading);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setExpandPicks(prev => {
                      const next = new Set(prev);
                      if (next.has(c.heading)) next.delete(c.heading);
                      else next.add(c.heading);
                      return next;
                    })}
                    className={`rounded-full border px-2 py-0.5 text-mini transition-colors ${
                      checked
                        ? "border-indigo-500 bg-indigo-950/40 text-indigo-200"
                        : "border-border bg-bg-surface text-faint hover:border-indigo-500 hover:text-text-muted"
                    }`}
                  >
                    {checked ? "☑" : "☐"} {c.heading}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Chat input */}
        <div className="border-t border-border p-3">
          <div className="relative flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                // maxH = 7 lines × ~24px line-height + padding. Sized for
                // text-sm at the default UI scale; bigger UI scales still
                // fit ~5-6 visible lines before scrolling because
                // el.scrollHeight tracks the live rendered font size.
                autoSizeTextarea(e.currentTarget, { maxH: 7 * 24 + 14 });
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder={
                profile
                  ? "Ask about this profile... (Enter to send)"
                  : "Open a profile first"
              }
              disabled={!profile || chatLoading}
              rows={3}
              style={{ resize: "none", overflowY: "hidden" }}
              className={`text-entry flex-1 rounded border px-2 py-2 text-text-primary placeholder-text-muted outline-none focus:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50 bg-border ${
                chatInput.length > 6000
                  ? "border-red-600"
                  : chatInput.length > 3000
                  ? "border-amber-600"
                  : "border-border"
              }`}
            />
            {chatInput.length > 500 && (
              <div className={`absolute bottom-1 right-14 text-xs ${
                chatInput.length > 6000
                  ? "text-red-400"
                  : chatInput.length > 3000
                  ? "text-amber-500"
                  : "text-faint"
              }`}>
                {chatInput.length.toLocaleString()} chars
                {chatInput.length > 6000 && " -- may be too large"}
              </div>
            )}
            <button
              onClick={sendChatMessage}
              disabled={!profile || !chatInput.trim() || chatLoading}
              className="flex items-center justify-center rounded border border-border p-1.5 text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send message (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
        </>
        )}
      </aside>

    </div>
  );
}


// ── ProfileSectionEditor ──────────────────────────────────────────────────────
// Renders one section: either a plain textarea or a list of trait block cards,
// followed by an AI summary textarea.

interface ProfileSectionEditorProps {
  sectionKey: string;
  heading: string;
  hasTraitBlocks: boolean;
  /** Side template: render only the trait blocks that are secret, since those
   *  cannot be flattened into the plain box without losing their protection. */
  showSecretsOnly?: boolean;
  /** Show the "never named" help and its walkthrough beside this heading. True
   *  for the section a writer looks in for it. */
  teachesSubtext?: boolean;
  /** Which trait tiles are open, and how to toggle one. Held by the screen so
   *  the set survives a re-render and resets when the writer changes profile. */
  openTraits: Set<string>;
  onToggleTrait: (id: string) => void;
  /** This section's stripe, and the border its traits wear, so a writer finds
   *  Motivations by its colour rather than by reading six identical headings. */
  colour: { bar: string; border: string; panel?: string };
  /** True for the section a kind keeps its secrets in: a darker ground, so it
   *  reads as a room with the lights lower rather than as a warning. */
  shadowed?: boolean;
  section: ProfileSection;
  profileName: string;
  profileType: string;
  onContentChange: (content: string) => void;
  onAiSummaryChange: (ai_summary: string) => void;
  onAddTraitBlock: () => void;
  onUpdateTraitBlock: (id: string, updates: Partial<TraitBlock>) => void;
  onRemoveTraitBlock: (id: string) => void;
  onGenerateSectionSummary: () => void;
  generatingField: string | null;
  onFocus: () => void;
  // Side-character template: per-section AI Summary tiles are hidden (the
  // sections are short single fields -- summarizing them adds nothing; the
  // Full AI Summary at the bottom covers the whole profile).
  showAiSummary?: boolean;
  // Side-character Overview only: the [Generate Overview] button. A
  // writer-clicked exception to the no-ghostwriting stance, scoped to fast
  // side-character assembly -- output stays editable and unsaved.
  onGenerateOverview?: () => void;
  generatingOverview?: boolean;
  /** The book in reading order, passed through to each trait's "when is this
   *  true" control. */
  chapters: ChapterAnchor[];
}

function ProfileSectionEditor({
  sectionKey,
  heading,
  hasTraitBlocks,
  showSecretsOnly,
  teachesSubtext,
  openTraits,
  onToggleTrait,
  colour,
  shadowed,
  section,
  profileName,
  profileType,
  onContentChange,
  onAiSummaryChange,
  onAddTraitBlock,
  onUpdateTraitBlock,
  onRemoveTraitBlock,
  onGenerateSectionSummary,
  generatingField,
  onFocus,
  showAiSummary = true,
  onGenerateOverview,
  generatingOverview = false,
  chapters,
}: ProfileSectionEditorProps) {
  // Open state for the walkthrough offered beside the heading.
  const [guideOpen, setGuideOpen] = useState(false);
  // Closed on arrival. See the note beside the summary itself.
  const [summaryOpen, setSummaryOpen] = useState(false);

  const isGeneratingSummary = generatingField === sectionKey;

  return (
    <div
      className={shadowed
        // The secrets section, given its own ground rather than only its own
        // stripe. Eye-catching and unmistakably a different kind of place.
        ? `mb-6 rounded-lg border ${colour.panel} p-3`
        : "mb-6"}
      onFocus={onFocus}
    >
      {/* Section heading with its own accent + help icon for text sections */}
      <div className="mb-3 flex items-center gap-2.5 border-b border-border pb-2">
        <span className={`h-4 w-0.5 shrink-0 rounded-full ${colour.bar}`} />
        <h2 className="text-sm font-semibold text-text-primary">{heading}</h2>
        {/* (?) icon -- shows writing tips with Poor/Good/Great examples.
            Only renders if help content exists for this section. */}
        {!hasTraitBlocks && (
          <SectionHelpPopover profileType={profileType} sectionKey={sectionKey} />
        )}
        {/* WHERE A WRITER ACTUALLY LOOKS FOR THIS. The "never named" setting is
            explained here, next to the section named after it, on both
            templates and whether or not anything is marked yet. It used to be
            reachable only from the panel that lists secrets -- and that panel
            hides itself when there are none, so a writer meeting the idea for
            the first time had no way to read about it. */}
        {teachesSubtext && (
          <>
            <Explain of="character.subtext" />
            <button
              onClick={() => setGuideOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-violet-800 px-1.5 py-0.5 text-micro text-violet-200 transition-colors hover:border-violet-500"
            >
              <BookOpen size={10} /> Show me how this works
            </button>
            {guideOpen && <SubtextGuide onClose={() => setGuideOpen(false)} />}
          </>
        )}
        {/* Side-character Overview: spin the filled-in fields into a mini
            encapsulated story. Click again for a different angle. */}
        {onGenerateOverview && (
          <button
            onClick={onGenerateOverview}
            disabled={generatingOverview}
            className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            title="AI writes a short overview from the fields you've filled in (Role, Tags, traits, notes). Click again for a different take -- always editable, never saved until you save."
          >
            <Sparkles size={11} />
            {generatingOverview ? "Generating..." : "Generate Overview"}
          </button>
        )}
      </div>

      {/* SIDE PAGE, SECRETS ONLY. Shown under the plain box rather than
          instead of it: the writer keeps the simple page and keeps the one
          thing the simple page cannot express. */}
      {!hasTraitBlocks && showSecretsOnly
        && (section.trait_blocks ?? []).some(b => b.subtext || b.ai_scope === "on-request") && (
        <div className="mb-3 rounded border border-violet-900/60 bg-violet-950/10 p-2">
          <p className="mb-1.5 flex items-center gap-1 text-xs text-violet-200">
            <EyeOff size={11} />
            Never named
          </p>
          <p className="mb-2 text-xs text-faint">
            AI uses these and never says them. They stay as traits because a
            plain box has nowhere to record that.
          </p>
          {(section.trait_blocks ?? [])
            .filter(b => b.subtext || b.ai_scope === "on-request")
            .map(block => (
              <div key={block.id} className="mb-1.5 last:mb-0">
                <input
                  type="text"
                  value={block.trait}
                  onChange={e => onUpdateTraitBlock(block.id, { trait: e.target.value })}
                  placeholder="What it is"
                  className="mb-1 w-full rounded border border-border bg-bg-surface px-2 py-1 text-sm text-text-primary placeholder-faint outline-none focus:border-violet-500"
                />
                <textarea
                  value={block.description}
                  onChange={e => onUpdateTraitBlock(block.id, { description: e.target.value })}
                  rows={2}
                  placeholder="What it makes them do"
                  className="w-full resize-y rounded border border-border bg-bg-surface px-2 py-1 text-sm text-text-primary placeholder-faint outline-none focus:border-violet-500"
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-faint">
                    Weight: {block.importance}
                  </span>
                  <button
                    onClick={() => onRemoveTraitBlock(block.id)}
                    className="rounded p-0.5 text-faint hover:text-red-400"
                    title="Remove this"
                    aria-label={`Remove ${block.trait || "this secret"}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {hasTraitBlocks ? (
        <div>
          {/* PROSE IN A TRAIT SECTION IS SHOWN, not hidden.
              The file format has always allowed a section to hold both a trait
              list and a paragraph, and three things put text here: a writer
              hand-editing the Markdown, Quick Build before a character was
              promoted, and moving a character from Side to Main. Rendering only
              the list meant that text sat on disk, invisible, and the writer
              would reasonably conclude it had been eaten. Shown only when there
              IS something, so an ordinary Main character's page is unchanged. */}
          {(section.content ?? "").trim() !== "" && (
            <div className="mb-3">
              <p className="mb-1 text-xs text-text-muted">
                Notes in this section
              </p>
              <textarea
                value={section.content}
                onChange={e => onContentChange(e.target.value)}
                rows={3}
                data-pb-field={`section:${sectionKey}:content`}
                className="w-full resize-y rounded border border-border bg-bg-panel px-3 py-2 text-sm text-text-primary outline-none focus:border-indigo-500"
              />
              <p className="mt-1 text-xs text-faint">
                Written as plain notes rather than as traits. Move any of it into
                a trait below when you want AI to weigh it.
              </p>
            </div>
          )}
          {section.trait_blocks.length === 0 && (section.content ?? "").trim() === "" && (
            <p className="mb-2 text-xs text-faint">
              No traits yet. Click "Add Trait" to add one.
            </p>
          )}
          {section.trait_blocks.map(block => (
            <TraitBlockCard
              key={block.id}
              block={block}
              borderClass={colour.border}
              open={openTraits.has(block.id)}
              onToggle={() => onToggleTrait(block.id)}
              profileName={profileName}
              profileType={profileType}
              sectionKey={sectionKey}
              sectionHeading={heading}
              onUpdate={updates => onUpdateTraitBlock(block.id, updates)}
              onRemove={() => onRemoveTraitBlock(block.id)}
              chapters={chapters}
            />
          ))}
          <button
            onClick={onAddTraitBlock}
            className="mb-3 flex items-center gap-1 rounded border border-dashed border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-indigo-300"
            title="Add a trait or group of related traits"
          >
            <Plus size={12} /> Add Trait
          </button>
        </div>
      ) : (
        <>
        <textarea
          value={section.content}
          onChange={e => onContentChange(e.target.value)}
          placeholder={`Write ${heading.toLowerCase()} notes here...`}
          rows={4}
          data-pb-field={`section:${sectionKey}:content`}
          className="mb-3 w-full resize-y rounded border border-border bg-bg-panel px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
        />
        {/* SAYING WHAT A FIELD CALLED NOTES ACTUALLY DOES.
            It used to travel to the model inside the "details" bucket on
            two paths and be withheld on a third -- the same words in or
            out depending on how they happened to be sent, with nothing on
            screen saying which. It is off by default everywhere now, and
            the field says so rather than leaving the writer to guess. */}
        {sectionKey === "notes" && (
          <p className="mb-3 -mt-2 text-xs text-faint">
            Your own jottings. Not sent to AI unless you tick Notes when
            attaching this entry to a chat.
          </p>
        )}
        </>
      )}

      {/* AI Summary sub-section (hidden on the side-character template) */}
      {/* THE AI SUMMARY, CLOSED UNTIL ASKED FOR.
          It is a derived restatement of the section above it, so on a page the
          writer is reading it is the same words twice. Open, several at once
          doubled the length of every profile. Closed, it is one line -- and it
          says whether there is anything in it, so the writer never has to open
          one to find out.

          Local state, and that is deliberate: the wrapper is keyed by filename,
          so switching profiles remounts these and every summary starts closed
          again, which is what "upon opening the profile" asks for. Several stay
          open at once while the writer is in one profile. */}
      {showAiSummary && (
      <div className="rounded border border-border bg-bg-primary p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setSummaryOpen(v => !v)}
            aria-expanded={summaryOpen}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-text-muted hover:text-text-primary"
          >
            {summaryOpen ? <ChevronDown size={11} className="shrink-0" />
                         : <ChevronRight size={11} className="shrink-0" />}
            <span className="truncate">
              AI Summary: {heading}
              {!summaryOpen && (
                <span className="ml-1.5 text-faint">
                  {section.ai_summary.trim() ? "written" : "empty"}
                </span>
              )}
            </span>
          </button>
          <button
            onClick={() => { setSummaryOpen(true); onGenerateSectionSummary(); }}
            disabled={isGeneratingSummary}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-faint transition-colors hover:border-indigo-500 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            title="Generate this section summary using AI"
          >
            <Sparkles size={10} />
            {isGeneratingSummary ? "Generating..." : "Generate"}
          </button>
        </div>
        {summaryOpen && (
          <AutoTextarea
            value={section.ai_summary}
            onChange={e => onAiSummaryChange(e.target.value)}
            placeholder="Click Generate to create an AI summary, or write one manually."
            className="mt-1.5 w-full rounded border border-border bg-bg-panel px-2 py-1.5 text-xs text-text-muted placeholder-faint outline-none focus:border-indigo-500"
            minRows={2}
            dataField={`section:${sectionKey}:ai_summary`}
          />
        )}
      </div>
      )}
    </div>
  );
}


// ── ImportanceHelpPopover ─────────────────────────────────────────────────────
// Clickable (?) icon next to the importance dropdown in TraitBlockCard.
// Shows a short summary of what the current importance level does, then a
// detailed explanation with a section-specific example so the writer can see
// how importance applies differently for Physical Traits vs Voice Notes, etc.
//
// Uses a toggle pattern: click (?) to open, click X or the icon again to close.

function ImportanceHelpPopover({
  importance,
  sectionKey,
}: {
  importance: ImportanceLevel;
  sectionKey: string;
}) {
  const [open, setOpen] = useState(false);
  const help: ImportanceLevelHelp | undefined = IMPORTANCE_HELP[importance];

  if (!help) return null;

  // Find the best example for this section. Fall back to the first available
  // example if the section key doesn't have one (e.g. a future section type).
  const example =
    help.examples[sectionKey] ??
    Object.values(help.examples)[0] ??
    "";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-indigo-400"
        title={`Help: ${importance} importance level`}
      >
        <HelpCircle size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 w-72 rounded-lg border border-border bg-bg-primary p-3 shadow-xl">
          {/* Header */}
          <div className="mb-2 flex items-start justify-between">
            <p className="text-xs font-semibold text-indigo-300">
              {importance.charAt(0).toUpperCase() + importance.slice(1)} Importance
            </p>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-faint hover:text-text-primary"
            >
              <X size={10} />
            </button>
          </div>

          {/* Summary */}
          <p className="mb-2 text-xs font-medium text-text-primary">{help.summary}</p>

          {/* Detail */}
          <p className="mb-3 text-xs leading-relaxed text-text-muted">{help.detail}</p>

          {/* Section-specific example */}
          {example && (
            <div className="rounded border border-border bg-bg-surface p-2">
              <p className="mb-1 text-xs font-medium text-text-muted">Example for this section:</p>
              <p className="whitespace-pre-line text-xs leading-relaxed text-text-primary">{example}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── SectionHelpPopover ───────────────────────────────────────────────────────
// Clickable (?) icon next to text section headings (Overview, Notes, etc.).
// Shows what the writer should put in the field, plus Poor / Good / Great
// example tiers so they can see the spectrum from "AI will struggle" to
// "AI will nail this."

function SectionHelpPopover({
  profileType,
  sectionKey,
}: {
  profileType: string;
  sectionKey: string;
}) {
  const [open, setOpen] = useState(false);
  const help: SectionHelp | null = getSectionHelp(profileType, sectionKey);

  // No help content for this section -- don't render the icon at all.
  // This keeps the UI clean for sections we haven't written help for yet.
  if (!help) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-indigo-400"
        title="Writing tips for this section"
      >
        <HelpCircle size={12} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 max-h-[28rem] w-80 overflow-y-auto rounded-lg border border-border bg-bg-primary p-3 shadow-xl">
          {/* Header */}
          <div className="mb-2 flex items-start justify-between">
            <p className="text-xs font-semibold text-indigo-300">Writing Tips</p>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-faint hover:text-text-primary"
            >
              <X size={10} />
            </button>
          </div>

          {/* What to put */}
          <p className="mb-3 text-xs leading-relaxed text-text-primary">{help.whatToPut}</p>

          {/* Poor example */}
          <div className="mb-2 rounded border border-red-900/40 bg-red-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-red-400">Needs Work</p>
            <p className="mb-1 text-xs italic text-red-300/70">"{help.poorExample}"</p>
            <p className="text-xs text-red-400/60">{help.poorWhy}</p>
          </div>

          {/* Good example */}
          <div className="mb-2 rounded border border-amber-800/40 bg-amber-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-amber-400">Good</p>
            <p className="mb-1 text-xs italic text-amber-200/70">"{help.goodExample}"</p>
            <p className="text-xs text-amber-400/60">{help.goodWhy}</p>
          </div>

          {/* Great example */}
          <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2">
            <p className="mb-1 text-xs font-medium text-emerald-400">Great</p>
            <p className="mb-1 text-xs italic text-emerald-200/70">"{help.greatExample}"</p>
            <p className="text-xs text-emerald-400/60">{help.greatWhy}</p>
          </div>
        </div>
      )}
    </div>
  );
}


// ── TraitBlockCard ────────────────────────────────────────────────────────────
// Renders one trait block with importance selector, trait name, description
// textarea, and adaptive word count gauge.

interface TraitBlockCardProps {
  block: TraitBlock;
  /** Its section's colour. A trait belongs to the section it is in, and saying
   *  so in the border costs nothing and answers "which section am I in" while
   *  the writer is halfway down a long page. */
  borderClass: string;
  /** Closed by default: a trait is one scannable line until the writer wants
   *  it. Several may be open at once, which is what makes comparing two while
   *  editing a third possible. */
  open: boolean;
  onToggle: () => void;
  profileName: string;
  profileType: string;
  sectionKey: string;
  sectionHeading: string;
  onUpdate: (updates: Partial<TraitBlock>) => void;
  onRemove: () => void;
  /** The book in reading order, for "when is this true". Empty for a project
   *  with no chapters yet, which the control says rather than hiding. */
  chapters: ChapterAnchor[];
}

function TraitBlockCard({ block, borderClass, open, onToggle, profileName, profileType, sectionKey, sectionHeading, onUpdate, onRemove, chapters }: TraitBlockCardProps) {
  const wordCount = countWords(block.description);

  // AI Trim tool -- suggests a concise rewrite when description is wordy/bloated
  const [trimText, setTrimText] = useState("");
  const [trimLoading, setTrimLoading] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);

  const gaugeInfo = getGaugeLevel(wordCount, block.importance);
  const showTrimButton = gaugeInfo.level === "wordy" || gaugeInfo.level === "bloated";

  const generateTrim = async () => {
    if (!block.trait.trim() || !block.description.trim()) return;
    setTrimLoading(true);
    setTrimOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/trim-trait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profileName,
          profile_type: profileType,
          section_heading: sectionHeading,
          trait: block.trait,
          description: block.description,
          importance: block.importance,
          word_count: wordCount,
        }),
      });
      if (!res.ok) throw new Error("Trim request failed");
      const data = await res.json();
      setTrimText(data.trimmed ?? "");
    } catch {
      setTrimText("Failed to generate trim suggestion. Check your API key and model settings.");
    } finally {
      setTrimLoading(false);
    }
  };

  // "How AI uses this" preview -- on-demand AI explanation of this trait's importance
  const [previewText, setPreviewText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const generatePreview = async () => {
    if (!block.trait.trim() || !block.description.trim()) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/generate-usage-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_name: profileName,
          profile_type: profileType,
          section_heading: sectionHeading,
          trait: block.trait,
          description: block.description,
          importance: block.importance,
        }),
      });
      if (!res.ok) throw new Error("Preview generation failed");
      const data = await res.json();
      setPreviewText(data.usage_preview ?? "");
    } catch {
      setPreviewText("Failed to generate preview. Check your API key and model settings.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // WHAT A CLOSED TILE SAYS. The name is the thing being scanned for; the
  // weight and the secret marker are what a writer checks at a glance; the
  // description is truncated on a word so it never breaks mid-syllable.
  const summary = block.description.trim();
  const shortened = summary.length > 90
    ? summary.slice(0, summary.lastIndexOf(" ", 90) > 50
                       ? summary.lastIndexOf(" ", 90) : 90) + "..."
    : summary;

  if (!open) {
    return (
      <button
        onClick={onToggle}
        aria-expanded={false}
        data-testid="trait-tile"
        className={`mb-1.5 flex w-full items-start gap-2 rounded border ${borderClass} bg-bg-panel px-2 py-1.5 text-left transition-colors hover:brightness-125`}
      >
        <ChevronRight size={12} className="mt-1 shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-text-primary">
              {block.trait.trim() || "(unnamed trait)"}
            </span>
            <span className="rounded-full border border-border px-1.5 text-xs text-text-muted">
              {block.importance}
            </span>
            {block.subtext && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-700 px-1.5 text-xs text-violet-200">
                <EyeOff size={9} /> never named
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {shortened || "Nothing written yet."}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={`mb-3 rounded border-2 ${borderClass} bg-bg-panel p-3`}>
      {/* Top row: importance selector + trait name + delete button */}
      <div className="mb-2 flex items-start gap-2">
        <button
          onClick={onToggle}
          aria-expanded
          aria-label={`Close ${block.trait || "this trait"}`}
          className="mt-1 shrink-0 rounded text-faint hover:text-text-primary"
        >
          <ChevronDown size={12} />
        </button>
        {/* Importance dropdown */}
        <select
          value={block.importance}
          onChange={e => onUpdate({ importance: e.target.value as ImportanceLevel })}
          className="shrink-0 rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-indigo-500"
          title="How prominently AI uses this trait"
        >
          {(Object.keys(IMPORTANCE_LABELS) as ImportanceLevel[]).map(level => (
            <option key={level} value={level}>
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </option>
          ))}
        </select>

        {/* (?) help icon -- explains this importance level with section-specific examples */}
        <ImportanceHelpPopover importance={block.importance} sectionKey={sectionKey} />

        {/* DISCLOSURE. A separate question from the weight beside it, and
            deliberately a separate control: `hidden` used to be the fifth
            option in that dropdown, which meant a secret could not also be
            important. A villain's reason for avoiding hospitals is the most
            load-bearing thing about him AND the thing he would never say. */}
        <button
          onClick={() => onUpdate({ subtext: !block.subtext })}
          aria-pressed={Boolean(block.subtext)}
          className={`shrink-0 rounded border px-1.5 py-1 text-xs transition-colors ${
            block.subtext
              ? "border-violet-500 bg-violet-600/20 text-violet-200"
              : "border-border text-faint hover:border-violet-700 hover:text-text-muted"
          }`}
          title={block.subtext ? SUBTEXT_HELP.on : SUBTEXT_HELP.off}
        >
          {block.subtext ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>

        {/* Only once it is on. Before that the eye's tooltip is enough, and a
            second control on every trait row would be noise; after it, the
            writer has just made a decision they may want explained. */}
        {block.subtext && <Explain of="character.subtext" compact align="right" />}

        {/* Trait name */}
        <input
          type="text"
          value={block.trait}
          onChange={e => onUpdate({ trait: e.target.value })}
          placeholder="Trait name (e.g. observant, punctual)"
          data-pb-field={`trait:${block.id}:trait`}
          className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
        />

        {/* "How AI uses this" button -- generates on-demand prose explanation */}
        <button
          onClick={generatePreview}
          disabled={previewLoading || !block.trait.trim() || !block.description.trim()}
          className="shrink-0 rounded p-1 text-faint transition-colors hover:text-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="How AI uses this trait (generates a preview explanation)"
        >
          <Sparkles size={12} />
        </button>

        {/* Delete button */}
        <button
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-red-950/40 hover:text-red-400"
          title="Remove this trait"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Description textarea */}
      <textarea
        value={block.description}
        onChange={e => onUpdate({ description: e.target.value })}
        placeholder="Describe this trait in detail. Be specific to this character."
        rows={3}
        data-pb-field={`trait:${block.id}:description`}
        className="mb-1 w-full resize-y rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
      />

      {/* Word count gauge + trim button when wordy/bloated */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <WordGauge wordCount={wordCount} importance={block.importance} />
        </div>
        {showTrimButton && (
          <button
            onClick={generateTrim}
            disabled={trimLoading}
            className="mt-1 flex shrink-0 items-center gap-1 rounded border border-amber-700/50 px-1.5 py-0.5 text-xs text-amber-400 transition-colors hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            title="AI suggests a more concise version of this description"
          >
            <Scissors size={10} />
            {trimLoading ? "Trimming..." : "Trim"}
          </button>
        )}
      </div>

      {/* WHEN THIS IS TRUE. Below the description because it is a question
          about the words above it: you write the trait, then say where it
          holds. Above the AI panels because it changes what those panels are
          talking about -- a trait limited to chapter one is not what AI
          receives while the writer is in chapter twelve. */}
      <TraitWindow
        trueIn={block.true_in}
        chapters={chapters}
        onChange={true_in => onUpdate({ true_in })}
        unavailable={chapters.length === 0
          ? "No chapters yet. Write one and this trait can be tied to it."
          : undefined}
      />

      {/* AI Trim suggestion -- expandable area */}
      {trimOpen && (
        <div className="mt-2 rounded border border-amber-800/40 bg-amber-950/20 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-amber-400">Trim Suggestion</p>
            <button
              onClick={() => setTrimOpen(false)}
              className="text-xs text-amber-700 hover:text-amber-400"
            >
              Close
            </button>
          </div>
          {trimLoading ? (
            <p className="text-xs text-amber-600 animate-pulse">Generating trim...</p>
          ) : (
            <>
              <p className="mb-2 text-xs leading-relaxed text-amber-200/80">{trimText}</p>
              <button
                onClick={() => {
                  onUpdate({ description: trimText });
                  setTrimOpen(false);
                }}
                className="rounded border border-amber-700/50 px-2 py-0.5 text-xs text-amber-300 transition-colors hover:border-amber-500 hover:bg-amber-900/30 hover:text-amber-100"
                title="Replace the current description with this trimmed version"
              >
                Apply
              </button>
            </>
          )}
        </div>
      )}

      {/* "How AI uses this" preview -- expandable area below gauge */}
      {previewOpen && (
        <div className="mt-2 rounded border border-indigo-800/40 bg-indigo-950/20 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-indigo-400">How AI uses this</p>
            <button
              onClick={() => setPreviewOpen(false)}
              className="text-xs text-indigo-700 hover:text-indigo-400"
            >
              Close
            </button>
          </div>
          {previewLoading ? (
            <p className="text-xs text-indigo-600 animate-pulse">Generating preview...</p>
          ) : (
            <p className="text-xs leading-relaxed text-indigo-200/80">{previewText}</p>
          )}
        </div>
      )}
    </div>
  );
}


// ── AiBehaviorPanel ──────────────────────────────────────────────────────────
// Four simplified behavior modes for the Profile Companion.

const BEHAVIOR_MODES: { id: ProfileBehaviorMode; label: string; description: string }[] = [
  {
    id: "chat",
    label: "Chat",
    description: "Open conversation about this profile. Ask anything.",
  },
  {
    id: "refine",
    label: "Refine",
    description: "Sharpen traits, interpret how AI uses them, or get a summary of the profile.",
  },
  {
    id: "extract_traits",
    label: "Extract Traits",
    description: "Paste text and name a character. AI extracts traits organized by category.",
  },
  {
    id: "check_consistency",
    label: "Check Consistency",
    description: "Flags contradictions, overlaps, and importance level mismatches.",
  },
  {
    id: "interview",
    label: "Interview Me",
    description: "The AI interviews YOU about this character, then organizes your answers into copy/paste profile sections.",
  },
];

interface AiBehaviorPanelProps {
  currentMode: ProfileBehaviorMode;
  open: boolean;
  onToggleOpen: () => void;
  onSelectMode: (mode: ProfileBehaviorMode) => void;
}

function AiBehaviorPanel({ currentMode, open, onToggleOpen, onSelectMode }: AiBehaviorPanelProps) {
  const current = BEHAVIOR_MODES.find(m => m.id === currentMode) ?? BEHAVIOR_MODES[0];

  return (
    <div className="border-b border-teal-800/40 bg-teal-950/40">

      {/* Expanded mode list */}
      {open && (
        <div className="border-b border-teal-800/30 px-2 pb-2 pt-1.5">
          <p className="mb-2 px-1 text-xs text-teal-600">
            Choose what the AI should do. Switching mode clears the conversation.
          </p>
          {BEHAVIOR_MODES.map(mode => {
            const isActive = mode.id === currentMode;
            return (
              <button
                key={mode.id}
                onClick={() => onSelectMode(mode.id)}
                className={`mb-1 w-full rounded px-2 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-teal-700/30 text-teal-100"
                    : "text-teal-400 hover:bg-teal-900/30 hover:text-teal-200"
                }`}
              >
                <p className="text-xs font-medium">{mode.label}</p>
                <p className="mt-0.5 text-xs text-teal-600">{mode.description}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Toggle bar */}
      <button
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-teal-900/20"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 size={12} className="shrink-0 text-teal-600" />
          <span className="text-xs text-teal-500">Mode:</span>
          <span className="truncate text-xs font-medium text-teal-300">
            {current.label}
          </span>
        </div>
        <ChevronDown
          size={12}
          className={`shrink-0 text-teal-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
    </div>
  );
}
