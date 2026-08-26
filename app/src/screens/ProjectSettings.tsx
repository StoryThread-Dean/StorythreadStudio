// ProjectSettings.tsx -- The "Book Details" Modal
// =================================================
// Separate from the global Settings modal (API key, model picker).
// Opened from the BOOK DETAILS section at the top of the left nav (the old
// gear icon next to the project title was removed -- this modal is the one
// home for everything book-level). It shows and edits the project.json
// values for the currently open project: title, description, the story
// facts that feed AI prompts (genre, tone, theme, setting, POV, tense,
// audience), the word-count target (stored in the outline frontmatter, not
// project.json), content mode, and the model tier/picker.
//
// Includes the dynamic Model Help Guide that changes text based on
// the writer's current settings -- educating novice writers on how
// model choices affect quality and cost.

import { useState, useEffect } from "react";
import { X, ChevronDown, HelpCircle } from "lucide-react";
import type { ProjectInfo } from "../types/project";
import type { ModelInfo } from "../types/ai";
// Content-mode filter, cost tiers, media filter, and the curated recommended
// list are shared with the global Settings screen so the two pickers behave
// identically (see utils/modelFiltering.ts).
import {
  filterModelByContentMode, RECOMMENDED_MODELS,
  modelPassesTier, modelIsTextOnly,
} from "../utils/modelFiltering";

const API_BASE = "http://localhost:8000";

// ── Cost estimate ranges per tier ─────────────────────────────────────────────
// These are high-level educational estimates, not exact prices.
// "startup" = building 5-8 profiles + world-building + writing 3-5 chapters with AI
// "session" = typical 2-3 hour writing session (profile tweaks + 1-2 chapters feedback)
const COST_ESTIMATES: Record<string, { startup: string; session: string }> = {
  free:     { startup: "$0",              session: "$0" },
  budget:   { startup: "$0.30 - $0.80",   session: "$0.05 - $0.15" },
  standard: { startup: "$0.80 - $2.50",   session: "$0.15 - $0.40" },
  premium:  { startup: "$2.00 - $6.00",   session: "$0.40 - $1.00" },
};

// Display labels for the four tier stops. The stored values are frozen (they
// live in project.json on user machines); only labels may change. Kept in the
// same order and naming as TIERS in utils/modelFiltering.ts.
const TIER_LABELS: Record<string, string> = {
  free:     "Free",
  budget:   "Lowest",
  standard: "Pricier",
  premium:  "Priority Best",
};

// ── Suggestion picker data ────────────────────────────────────────────────────
// Clickable checkbox options for the free-text story fields (Genre, Tone,
// Target Audience). New writers often freeze at a blank box; these are
// training wheels, not a taxonomy -- clicking one inserts its text into the
// box, clicking again removes it, and hand-typing anything unique ("High
// Space Adventure") always works. Grouped most-popular-first: the first
// group is the broad categories, the following groups are the popular
// subcategories under each.

interface SuggestionGroup {
  label:   string;
  options: string[];
  // Optional per-option explanations, revealed by the group's "What's this?"
  // toggle. Keyed by the exact option string. Embedded help is a first-class
  // feature here -- new writers shouldn't have to google "what is noir".
  help?:   Record<string, string>;
}

const GENRE_SUGGESTIONS: SuggestionGroup[] = [
  { label: "Popular categories",
    options: [
      "Fantasy", "Romance", "Mystery", "Thriller", "Science Fiction",
      "Horror", "Historical Fiction", "Literary Fiction",
    ],
    help: {
      "Fantasy": "Magic, invented worlds, or the supernatural at the core of the story.",
      "Romance": "The love story is the main plot; readers expect an emotionally satisfying ending.",
      "Mystery": "A crime or puzzle drives the plot; the reader follows clues toward the solution.",
      "Thriller": "Constant tension and high stakes -- the hero races to stop a threat.",
      "Science Fiction": "Speculative stories grounded in science, technology, or the future.",
      "Horror": "Written to frighten or unsettle: dread, monsters, the uncanny.",
      "Historical Fiction": "Set in a real past era, blending invented characters with period detail.",
      "Literary Fiction": "Character- and prose-driven work that prioritizes theme and style over plot.",
    }},
  { label: "Fantasy subcategories",
    options: ["Epic Fantasy", "Urban Fantasy", "Dark Fantasy", "Cozy Fantasy", "Romantasy"],
    help: {
      "Epic Fantasy": "Large-scale, often multi-book quests across richly built worlds -- sweeping wars, chosen heroes.",
      "Urban Fantasy": "Magic hidden inside the modern real world: present-day cities and the supernatural.",
      "Dark Fantasy": "Fantasy with horror's mood -- grim, violent, morally shadowed.",
      "Cozy Fantasy": "Low-stakes, comforting fantasy: warmth, community, small adventures.",
      "Romantasy": "Fantasy and romance in equal measure -- the love story matters as much as the magic.",
    }},
  { label: "Sci-Fi subcategories",
    options: ["Space Opera", "Sci-Fi Thriller", "Dystopian", "Cyberpunk", "Time Travel"],
    help: {
      "Space Opera": "Grand adventure across galaxies -- starships, empires, larger-than-life stakes.",
      "Sci-Fi Thriller": "Fast, tense plots powered by a scientific or technological threat.",
      "Dystopian": "A broken or oppressive future society the characters must survive or resist.",
      "Cyberpunk": "High tech, low life -- hackers, megacorps, neon cities.",
      "Time Travel": "Plots built around moving through time and dealing with the consequences.",
    }},
  { label: "Romance subcategories",
    options: ["Contemporary Romance", "Historical Romance", "Paranormal Romance", "Romantic Comedy"],
    help: {
      "Contemporary Romance": "Present-day love stories in realistic settings.",
      "Historical Romance": "Romance set in a past era -- Regency, Victorian, and the like.",
      "Paranormal Romance": "Love stories with supernatural partners: vampires, shifters, ghosts.",
      "Romantic Comedy": "Light, funny romance with a feel-good tone.",
    }},
  { label: "Mystery & Thriller subcategories",
    options: ["Cozy Mystery", "Police Procedural", "Psychological Thriller", "Noir"],
    help: {
      "Cozy Mystery": "Gentle, low-gore mysteries -- often an amateur sleuth in a small community.",
      "Police Procedural": "Crime solved through realistic police investigation and detective work.",
      "Psychological Thriller": "Tension from the mind: unreliable narrators, manipulation, paranoia.",
      "Noir": "Bleak, morally gray crime fiction with a cynical, atmospheric edge.",
    }},
  { label: "More",
    options: ["Adventure", "Coming of Age", "Magical Realism", "Western", "Satire"],
    help: {
      "Adventure": "Action, journeys, and physical danger drive the story.",
      "Coming of Age": "A young protagonist grows into adulthood and self-understanding.",
      "Magical Realism": "Realistic worlds where magic is woven in matter-of-factly.",
      "Western": "Frontier settings -- the American Old West and its myths.",
      "Satire": "Uses humor and exaggeration to criticize society or human folly.",
    }},
];

const TONE_SUGGESTIONS: SuggestionGroup[] = [
  { label: "Popular",
    options: [
      "Dark", "Lighthearted", "Humorous", "Hopeful",
      "Atmospheric", "Fast-paced", "Emotional", "Gritty",
    ],
    help: {
      "Dark": "Heavy, serious, often grim subject matter and mood.",
      "Lighthearted": "Easygoing and fun -- nothing weighs the reader down.",
      "Humorous": "Written for laughs: wit, comedy, absurdity.",
      "Hopeful": "Even through hardship, the mood points toward something better.",
      "Atmospheric": "Mood and setting are vivid enough to feel like a character.",
      "Fast-paced": "Short scenes, quick momentum, little downtime.",
      "Emotional": "Aims straight for the reader's feelings.",
      "Gritty": "Raw, unglamorous realism -- hardship shown unflinchingly.",
    }},
  { label: "More",
    options: [
      "Whimsical", "Suspenseful", "Melancholic", "Cozy", "Wry",
      "Epic", "Bleak", "Romantic", "Slow burn", "Satirical",
    ],
    help: {
      "Whimsical": "Playful, fanciful, charmingly odd.",
      "Suspenseful": "Keeps the reader anxious about what happens next.",
      "Melancholic": "A wistful, sad, reflective mood.",
      "Cozy": "Warm, safe, and comforting.",
      "Wry": "Dry, ironic humor delivered with a straight face.",
      "Epic": "Grand, sweeping, larger than life.",
      "Bleak": "Little comfort or hope -- heavy and stark.",
      "Romantic": "Centered on love, longing, and connection.",
      "Slow burn": "Tension or romance built gradually over a long stretch.",
      "Satirical": "Mocking, critical humor aimed at a target.",
    }},
];

const AUDIENCE_SUGGESTIONS: SuggestionGroup[] = [
  { label: "Popular",
    options: ["Adult", "Young Adult (13-18)", "Middle Grade (8-12)", "New Adult (18-25)"],
    help: {
      "Adult": "Written for grown readers; no category content restrictions.",
      "Young Adult (13-18)": "Teen protagonists and themes -- the biggest crossover market.",
      "Middle Grade (8-12)": "For older children: age-appropriate stakes, no explicit content.",
      "New Adult (18-25)": "Protagonists in their late teens to twenties navigating early adulthood.",
    }},
  { label: "More",
    options: ["Children (5-8)", "All ages"],
    help: {
      "Children (5-8)": "Early readers -- simple language and gentle themes.",
      "All ages": "Written to appeal across every age band.",
    }},
];

// ── NSFW suggestion sets ──────────────────────────────────────────────────────
// Adult / erotica is a large, legitimate fiction-publishing market with its
// own standard classification labels (the same ones Amazon KDP, romance
// publishers, and reader communities use). These are self-classification
// tags for the writer's own work -- they help an adult-fiction author pick
// the right genre/tone the same way the standard list helps everyone else.
//
// Deliberately NOT gated on the AI content-mode setting: labeling your book
// as erotic romance is a metadata choice, independent of whether you ask the
// AI to generate explicit text. Kept behind its own collapsed "Show NSFW
// suggestions" toggle and styled in red so it never surprises anyone.

const GENRE_NSFW: SuggestionGroup[] = [
  { label: "Erotica & erotic romance",
    options: [
      "Erotica", "Erotic Romance", "Erotic Thriller", "Erotic Fantasy",
      "Erotic Sci-Fi", "Erotic Horror", "Contemporary Erotica", "Historical Erotica",
    ],
    help: {
      "Erotica": "Explicit sexual content is central to the story, not incidental.",
      "Erotic Romance": "A full romance arc where explicit sex is integral to the relationship.",
      "Erotic Thriller": "A suspense plot carried by strong explicit sexual content.",
      "Erotic Fantasy": "Fantasy worlds with explicit sexual content.",
      "Erotic Sci-Fi": "Science fiction with explicit sexual content.",
      "Erotic Horror": "Horror blended with explicit sexual content.",
      "Contemporary Erotica": "Present-day explicit fiction.",
      "Historical Erotica": "Explicit fiction set in a past era.",
    }},
  { label: "Romance heat subgenres",
    options: [
      "Dark Romance", "Spicy Romance", "Steamy Romance", "Monster Romance",
      "Reverse Harem", "Why Choose", "Mafia Romance", "Motorcycle Club Romance",
      "Bully Romance", "Forbidden Romance",
    ],
    help: {
      "Dark Romance": "Romance with dangerous or morally gray partners and heavy themes (captivity, dubious consent -- as fiction tropes).",
      "Spicy Romance": "Romance with frequent, explicit sex scenes ('high heat').",
      "Steamy Romance": "Sensual romance with on-page sex, moderate to high heat.",
      "Monster Romance": "Romance with non-human or monstrous love interests.",
      "Reverse Harem": "One protagonist with several love interests who don't compete jealously.",
      "Why Choose": "Like reverse harem -- the lead ends up with multiple partners rather than picking one.",
      "Mafia Romance": "Romance centered on organized-crime figures.",
      "Motorcycle Club Romance": "Romance set in biker-club culture.",
      "Bully Romance": "The love interest starts as an antagonist or bully (a trope, not an endorsement).",
      "Forbidden Romance": "Love that breaks a rule or taboo -- age gap, boss/employee, and the like.",
    }},
  { label: "Kink & theme",
    options: [
      "BDSM", "Kink", "LGBTQ+ Erotica", "MM Romance", "FF Romance",
      "Polyamory", "Taboo", "Age Gap",
    ],
    help: {
      "BDSM": "Stories featuring bondage/discipline, dominance/submission, and sadomasochism dynamics.",
      "Kink": "Fiction organized around specific kinks or fetishes.",
      "LGBTQ+ Erotica": "Explicit fiction centering queer characters and relationships.",
      "MM Romance": "Male/male romance.",
      "FF Romance": "Female/female romance.",
      "Polyamory": "Relationships involving more than two committed partners.",
      "Taboo": "Deliberately transgressive themes, presented as fiction.",
      "Age Gap": "A significant age difference between adult partners.",
    }},
];

const TONE_NSFW: SuggestionGroup[] = [
  { label: "Heat & sensuality",
    options: [
      "Sensual", "Steamy", "Spicy", "Explicit", "Graphic", "Seductive",
      "Provocative", "Smutty", "Slow-burn sensual", "Filthy",
    ],
    help: {
      "Sensual": "Emphasis on physical sensation and desire.",
      "Steamy": "Frequent on-page intimacy.",
      "Spicy": "High heat -- lots of explicit content.",
      "Explicit": "Sex is shown directly and in detail.",
      "Graphic": "Very detailed, unflinching depiction.",
      "Seductive": "A mood of enticement and allure.",
      "Provocative": "Meant to arouse or push boundaries.",
      "Smutty": "Playful term for high-heat, sex-forward writing.",
      "Slow-burn sensual": "Desire built gradually before the payoff.",
      "Filthy": "Very explicit and uninhibited in tone.",
    }},
  { label: "Edge",
    options: ["Taboo", "Kinky", "Dark and erotic", "Dominant", "Submissive", "Forbidden"],
    help: {
      "Taboo": "Transgressive, boundary-pushing themes.",
      "Kinky": "Centered on kink dynamics.",
      "Dark and erotic": "Combines a grim mood with explicit content.",
      "Dominant": "Emphasis on a dominant partner's perspective or dynamic.",
      "Submissive": "Emphasis on a submissive partner's perspective or dynamic.",
      "Forbidden": "The eroticism comes from breaking a rule or taboo.",
    }},
];

const AUDIENCE_NSFW: SuggestionGroup[] = [
  { label: "Adult (18+)",
    options: [
      "Adult 18+ (mature content)", "Adult 18+ (explicit content)",
      "Erotica readers", "Spicy romance readers", "Dark romance readers",
    ],
    help: {
      "Adult 18+ (mature content)": "For adults -- mature themes, violence, or strong language.",
      "Adult 18+ (explicit content)": "For adults -- contains explicit sexual content.",
      "Erotica readers": "Readers specifically seeking explicit fiction.",
      "Spicy romance readers": "Romance readers who want high heat.",
      "Dark romance readers": "Readers who want darker, edgier romance themes.",
    }},
];

// ── Comma-list helpers for the suggestion picker ─────────────────────────────
// The field value is treated as a comma-separated list ("Fantasy, Romantasy").
// A suggestion is "checked" when it appears as one of those parts
// (case-insensitive), so hand-typed entries and clicked entries coexist.

// Exported for unit tests (ProjectSettings.helpers.test.ts) -- this little
// parser must never mangle a hand-typed value.
export function splitParts(value: string): string[] {
  return value.split(",").map(p => p.trim()).filter(Boolean);
}

export function hasPart(value: string, option: string): boolean {
  return splitParts(value).some(p => p.toLowerCase() === option.toLowerCase());
}

export function togglePart(value: string, option: string): string {
  const parts = splitParts(value);
  const remaining = parts.filter(p => p.toLowerCase() !== option.toLowerCase());
  if (remaining.length !== parts.length) {
    return remaining.join(", ");        // was checked -> remove it
  }
  return [...parts, option].join(", "); // wasn't -> append it
}

// A single group of chips, with an optional per-group "What's this?" toggle
// that lists a one-line definition of every option. `accent` swaps the
// palette between the standard (indigo) and NSFW (red) lists so the two are
// unmistakable at a glance.
function ChipGroup({
  value,
  onChange,
  group,
  accent,
}: {
  value: string;
  onChange: (next: string) => void;
  group: SuggestionGroup;
  accent: "indigo" | "red";
}) {
  const [showHelp, setShowHelp] = useState(false);

  const checkedClass = accent === "red"
    ? "border-danger-fill/60 bg-danger-soft/30 text-danger"
    : "border-accent-fill/60 bg-accent-soft/30 text-accent";
  const helpLinkClass = accent === "red"
    ? "text-danger-muted/70 hover:text-danger-muted"
    : "text-accent/70 hover:text-accent";
  const helpTermClass = accent === "red" ? "text-danger" : "text-accent";

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-micro font-semibold uppercase tracking-wider text-faint">
          {group.label}
        </p>
        {group.help && (
          <button
            type="button"
            onClick={() => setShowHelp(h => !h)}
            className={`text-micro transition-colors ${helpLinkClass}`}
            title="Explain each option in this group"
            aria-expanded={showHelp}
          >
            {showHelp ? "Hide" : "What's this?"}
          </button>
        )}
      </div>

      {/* Definitions, shown above the chips so the reader has context before
          clicking. Only the options that actually have help text appear. */}
      {showHelp && group.help && (
        <dl className="mb-1.5 space-y-0.5 rounded bg-bg-panel/60 px-2 py-1.5 text-mini leading-snug">
          {group.options.filter(opt => group.help?.[opt]).map(opt => (
            <div key={opt}>
              <dt className={`inline font-semibold ${helpTermClass}`}>{opt}</dt>
              <dd className="inline text-text-muted"> &ndash; {group.help?.[opt]}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap gap-1">
        {group.options.map(opt => {
          const checked = hasPart(value, opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(togglePart(value, opt))}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-mini transition-colors ${
                checked
                  ? checkedClass
                  : "border-border bg-bg-panel text-text-muted hover:border-faint hover:text-text-primary"
              }`}
              title={checked ? `Remove "${opt}"` : `Add "${opt}"`}
            >
              <span aria-hidden="true">{checked ? "☑" : "☐"}</span>
              <span>{opt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── SuggestionPicker ─────────────────────────────────────────────────────────
// The "Show suggestions" toggle + grouped checkbox chips under a text field.
// Collapsed by default so experienced writers who just type see no clutter.
//
// Optional `nsfwGroups`: an adult/erotica set behind its own SECOND toggle
// at the bottom ("Show NSFW suggestions"), styled red. It's independent of
// the standard toggle and of the AI content-mode setting -- classifying your
// book's genre is metadata, not a generation switch.
function SuggestionPicker({
  value,
  onChange,
  groups,
  nsfwGroups,
}: {
  value: string;
  onChange: (next: string) => void;
  groups: SuggestionGroup[];
  nsfwGroups?: SuggestionGroup[];
}) {
  const [open, setOpen]         = useState(false);
  const [nsfwOpen, setNsfwOpen] = useState(false);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-mini text-accent/80 transition-colors hover:text-accent"
        title="Common choices -- click to add or remove them from the box above"
      >
        {open ? "Hide suggestions" : "Show suggestions..."}
      </button>

      {open && (
        <div className="mt-1.5 space-y-2 rounded border border-border bg-bg-surface/50 p-2">
          {groups.map(group => (
            <ChipGroup key={group.label} value={value} onChange={onChange} group={group} accent="indigo" />
          ))}

          {/* NSFW sub-section: its own toggle at the bottom, always available
              (not tied to the AI content mode), red so it's distinct. */}
          {nsfwGroups && nsfwGroups.length > 0 && (
            <div className="border-t border-border pt-2">
              <button
                type="button"
                onClick={() => setNsfwOpen(o => !o)}
                className="text-mini font-medium text-danger-muted/90 transition-colors hover:text-danger-muted"
                title="Adult / erotica classification labels -- optional, for mature fiction"
              >
                {nsfwOpen ? "Hide NSFW suggestions" : "Show NSFW suggestions..."}
              </button>

              {nsfwOpen && (
                <div className="mt-1.5 space-y-2 rounded border border-danger-soft/50 bg-danger-soft/20 p-2">
                  <p className="text-micro text-danger-muted/70">
                    Adult / erotica labels for classifying mature fiction. Optional, and separate from your AI content-mode setting.
                  </p>
                  {nsfwGroups.map(group => (
                    <ChipGroup key={group.label} value={value} onChange={onChange} group={group} accent="red" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Point of View help content ───────────────────────────────────────────────
// Plain-language explanations + a popularity-based recommendation, shown
// behind a "What's this?" toggle next to the POV label. Same embedded-help
// philosophy as the Writing Companion's mode help.
const POV_HELP: { name: string; what: string; note: string }[] = [
  {
    name: "First",
    what: "The narrator IS a character: \"I walked into the room.\" The reader lives inside one head, hearing every thought.",
    note: "Very popular in Young Adult, romance, and thrillers. Maximum intimacy; the tradeoff is you can only show what that one character sees and knows.",
  },
  {
    name: "Second",
    what: "The story addresses the reader directly: \"You walk into the room.\"",
    note: "Rare and experimental -- striking in short fiction, exhausting over a novel. Pick it deliberately, not by default.",
  },
  {
    name: "Third Limited",
    what: "\"She walked into the room\" -- but the camera stays behind ONE character's eyes per scene, sharing only their thoughts.",
    note: "The most popular choice in modern fiction, and the safest default: nearly first-person intimacy with more flexibility.",
  },
  {
    name: "Third Omniscient",
    what: "An all-knowing narrator who can dip into anyone's thoughts and comment on the story from above -- the classic 19th-century voice.",
    note: "Gives an epic, storyteller feel but is the hardest to control: sliding between heads mid-scene (\"head-hopping\") reads as a mistake unless handled deliberately.",
  },
  {
    name: "Multiple",
    what: "Several point-of-view characters, each owning their chapters or scenes (each usually written in first or third limited).",
    note: "Standard for epic fantasy and dual-POV romance. Works best with clear breaks at every switch so the reader always knows whose head they're in.",
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface ProjectSettingsProps {
  project: ProjectInfo;
  onClose: () => void;
  onProjectUpdated: (updated: ProjectInfo) => void;
}


// ── ProjectSettings Component ─────────────────────────────────────────────────
export function ProjectSettings({ project, onClose, onProjectUpdated }: ProjectSettingsProps) {

  // Editable fields (initialized from current project)
  const [title, setTitle]             = useState(project.title);
  // THE SERIES NAME. Loaded from series.json rather than from `project`,
  // which only carries series_id and series_path -- the name itself was never
  // on this screen at all, so there was nothing to show and nothing to edit.
  const [seriesName, setSeriesName]   = useState("");
  const [seriesLoaded, setSeriesLoaded] = useState("");
  const [description, setDescription] = useState(project.description);
  const [genre, setGenre]             = useState("");
  const [tone, setTone]               = useState("");
  // Story facts added with the Book Details rework. All of these (plus
  // genre/tone above) are auto-injected into AI prompts as STORY CONTEXT.
  const [theme, setTheme]                     = useState("");
  const [storySetting, setStorySetting]       = useState("");   // "setting" clashes with React naming habits
  const [pointOfView, setPointOfView]         = useState("");
  const [tense, setTense]                     = useState("");
  const [targetAudience, setTargetAudience]   = useState("");
  // Word Count target -- kept as a string for the input; parsed on save.
  // The backend stores it in notes/outline.md frontmatter (the Progress
  // gauge's source of truth), never in project.json.
  const [targetWordCount, setTargetWordCount] = useState("");
  // Both targets live in the outline worksheet rather than project.json, so
  // the Writing Progress gauge has one place to read them from.
  const [targetChapterCount, setTargetChapterCount] = useState("");
  const [contentMode, setContentMode] = useState(project.content_mode_default);
  const [costTier, setCostTier]       = useState("standard");
  const [projectModel, setProjectModel] = useState(project.default_model ?? "");

  // Model list for the per-project picker
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Global text-only preference -- the media-capability filter applies to this
  // picker too so image/video output models stay out of a writing app's list.
  const [textOnlyFilter, setTextOnlyFilter] = useState(true);
  // Active AI provider (global setting). The model list is that provider's
  // catalog, so warnings and filters here need to know which one it is.
  const [aiProvider, setAiProvider] = useState("openrouter");

  // Outline template section -- tracks the current template and lets the writer
  // swap it. The initial value comes from project.json (may be null for older
  // projects created before templates existed).
  // True after the writer changes the radio, before they click Apply.
  // Prevents flashing "Applied!" from a previous run.

  // Help guide expanded state
  const [showGuide, setShowGuide] = useState(false);
  // Point of View "What's this?" panel
  const [showPovHelp, setShowPovHelp] = useState(false);

  // UI state
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Load full project.json + model list on mount
  useEffect(() => {
    async function loadProjectSettings() {
      try {
        const params = new URLSearchParams({ root_path: project.root_path });
        const res = await fetch(`${API_BASE}/api/projects/settings?${params}`);
        if (res.ok) {
          const data = await res.json();
          setGenre(data.genre ?? "");
          setTone(data.tone ?? "");
          setTheme(data.theme ?? "");
          setStorySetting(data.setting ?? "");
          setPointOfView(data.point_of_view ?? "");
          setTense(data.tense ?? "");
          setTargetAudience(data.target_audience ?? "");
          setTargetWordCount(
            data.target_word_count != null ? String(data.target_word_count) : ""
          );
          setTargetChapterCount(
            data.target_chapter_count != null ? String(data.target_chapter_count) : ""
          );
          setCostTier(data.cost_tier ?? "standard");
          setProjectModel(data.default_model ?? "");
        }
      } catch { /* use defaults */ }
    }
    async function loadModels() {
      try {
        const res = await fetch(`${API_BASE}/api/ai/models`);
        if (res.ok) {
          const data: ModelInfo[] = await res.json();
          setModels(data);
        }
      } catch { /* models optional */ }
    }
    async function loadGlobalFilters() {
      // The text-only preference plus the active AI provider. The provider
      // matters here because the model list comes from whichever provider is
      // active, and providers without pricing data (NanoGPT) can't use the
      // cost-tier filter.
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          setTextOnlyFilter(data.text_only_filter ?? true);
          setAiProvider(data.ai_provider ?? "openrouter");
        }
      } catch { /* default stays on */ }
    }
    loadProjectSettings();
    loadModels();
    loadGlobalFilters();
  }, [project.root_path]);


  // --- Save ---
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    // Word Count target: only sent when it parses as a positive number.
    // Blank = leave the outline's value alone (never zero it by accident).
    const parsedTarget = parseInt(targetWordCount.replace(/[,\s]/g, ""), 10);
    if (targetWordCount.trim() !== "" && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
      setError("Word Count target must be a number.");
      setSaving(false);
      return;
    }

    // Same rule for the chapter target: blank leaves it alone.
    const parsedChapters = parseInt(targetChapterCount.replace(/[,\s]/g, ""), 10);
    if (targetChapterCount.trim() !== ""
        && (!Number.isFinite(parsedChapters) || parsedChapters < 0)) {
      setError("Chapter Count target must be a number.");
      setSaving(false);
      return;
    }

    try {
      // THE SERIES NAME FIRST, and only when it actually changed. It lives in
      // a different file (series.json, one level up) so it is a separate
      // request -- but it saves on the same button, because to the writer it is
      // one screen and one Save.
      //
      // Before the project settings, deliberately: if the series write fails,
      // the writer is told and nothing else has moved yet.
      if (project.series_path && seriesName.trim() !== seriesLoaded) {
        if (!seriesName.trim()) {
          setError("A series needs a name. It is how you find it again.");
          setSaving(false);
          return;
        }
        const sres = await fetch(`${API_BASE}/api/series/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder_path: project.series_path,
            name: seriesName.trim(),
          }),
        });
        if (!sres.ok) {
          const e = await sres.json().catch(() => ({}));
          throw new Error(e.detail ?? "Could not rename the series.");
        }
        setSeriesLoaded(seriesName.trim());
      }

      const res = await fetch(`${API_BASE}/api/projects/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_path:            project.root_path,
          title:                title.trim() || project.title,
          description:          description,
          genre:                genre,
          tone:                 tone,
          theme:                theme,
          setting:              storySetting,
          point_of_view:        pointOfView,
          tense:                tense,
          target_audience:      targetAudience,
          ...(targetWordCount.trim() !== "" ? { target_word_count: parsedTarget } : {}),
          ...(targetChapterCount.trim() !== ""
            ? { target_chapter_count: parsedChapters } : {}),
          content_mode_default: contentMode,
          cost_tier:            costTier,
          default_model:        projectModel || null,  // empty string = use global
        }),
      });

      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail ?? "Save failed.");
      }

      const data = await res.json();
      setSaved(true);

      // Notify parent so the in-memory project matches what we just saved.
      // IMPORTANT: default_model MUST be included here. App.tsx sends
      // currentProject.default_model on every AI request (App.tsx:~1114). If we
      // leave it out, the spread of the OLD `project` keeps the stale model in
      // memory, so a model change silently has no effect until the writer fully
      // reopens the project -- which looks exactly like "saving didn't work".
      onProjectUpdated({
        ...project,
        title: data.title ?? project.title,
        description: data.description ?? project.description,
        content_mode_default: data.content_mode_default ?? project.content_mode_default,
        default_model: data.default_model ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }




  // Read the series name once, for a book that belongs to one. It lives in
  // series.json beside the book folder, not in project.json.
  useEffect(() => {
    if (!project.series_path) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/series/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_path: project.series_path }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        // A series folder that has gone missing is not an error worth blocking
        // the whole settings screen over -- the field just stays empty and the
        // path below it still tells the writer where it was.
        if (cancelled || !data?.name) return;
        setSeriesName(String(data.name));
        setSeriesLoaded(String(data.name));
      })
      .catch(() => { /* same reasoning */ });
    return () => { cancelled = true; };
  }, [project.series_path]);

  // ── Dynamic guide text generators ────────────────────────────────────────
  const costs = COST_ESTIMATES[costTier] ?? COST_ESTIMATES.standard;
  const tierLabel = TIER_LABELS[costTier] ?? "Standard";

  function getContentModeGuide(): string {
    if (contentMode === "explicit") {
      return "Free models like Mistral and Gemma can technically handle explicit content, but many writers find their output formulaic and limited, particularly for dialogue, character voice, and intimate scenes. Budget models ($0.50-1/M) produce noticeably better results. Standard models ($1-15/M) offer the most natural, character-aware output for this content type. The difference is most apparent in scenes that require emotional nuance alongside explicit content.";
    }
    if (contentMode === "mature") {
      return "Mature content (violence, dark themes, non-explicit adult content) is supported by most models at budget tier and above. Free models may occasionally refuse or soften certain scenes.";
    }
    return "Most AI models handle general fiction well. You have the widest selection at every price tier.";
  }

  function getRecommendation(): string {
    if (contentMode === "explicit" && costTier === "free") {
      return "Consider raising your tier to Lowest. The improvement in AI output quality for explicit content is significant, and the cost is minimal ($0.30-0.80 to get started).";
    }
    if (contentMode === "explicit" && costTier === "budget") {
      return "The Lowest paid tier is a solid choice for explicit fiction. You will see noticeably better character voice and scene quality compared to free models.";
    }
    if (contentMode === "explicit" && (costTier === "standard" || costTier === "premium")) {
      return "Good choice for explicit fiction. Pricier and Priority Best models produce the most natural output for character-driven adult content.";
    }
    if (contentMode === "mature" && costTier === "free") {
      return "Free models handle most mature content, but may occasionally soften or refuse darker scenes. The Lowest paid tier eliminates this limitation.";
    }
    if (costTier === "free") {
      return "This setup works well for getting started. You can always raise the tier later if you want more detailed or nuanced AI feedback.";
    }
    if (costTier === "premium") {
      return "Priority Best gives you access to the most capable models. Best for writers who want the highest quality AI feedback and are comfortable with higher costs.";
    }
    return "This is a balanced setup. Good quality AI feedback at a reasonable cost.";
  }


  // ── Derived: model-picker options ──────────────────────────────────────────
  // The models list comes live from OpenRouter, so a model the project saved
  // earlier can vanish from it -- the provider deprecated/renamed it, or the
  // content-mode filter now hides it. When that happens a plain <select> can't
  // display the stored value (no matching <option>), so it silently shows the
  // FIRST option instead. That tricked a writer into thinking their model was
  // fine and re-saving the stale, dead model on a blind Save. To prevent that
  // we detect the orphaned value and render an explicit option for it, clearly
  // flagged as unavailable, plus a warning nudging them to pick a current one.
  // Candidate models for this project: content-mode compatible, within the
  // project's cost tier, and (if the global preference is on) text-output only.
  // This is where the project's cost tier actually filters candidates -- the
  // tier is enforced at pick time rather than at request time because model
  // prices only exist in the live OpenRouter list, not on the backend.
  // Providers without published pricing (NanoGPT) skip the tier filter --
  // every model would fail a price cap when all costs read as unknown.
  const tiersApply = aiProvider !== "nanogpt";
  const visibleModels = models.filter(m =>
    filterModelByContentMode(m, contentMode, aiProvider)
    && (!tiersApply || modelPassesTier(m, costTier))
    && (!textOnlyFilter || modelIsTextOnly(m))
  );
  const projectModelInList =
    projectModel !== "" && visibleModels.some(m => m.id === projectModel);
  const projectModelMissing = projectModel !== "" && !projectModelInList;

  // Recommended models that exist in the live list AND pass the content-mode
  // filter -- pinned in their own <optgroup> at the top of the picker. Same
  // curated list and live-list cross-check the global Settings screen uses, so
  // a deprecated recommendation never appears here either.
  const recommendedOptions = RECOMMENDED_MODELS.filter(rec =>
    visibleModels.some(m => m.id === rec.id)
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-bg-panel shadow-e4">

        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          <h2 className="text-base font-semibold text-text-primary">Book Details</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "1.25rem 1.5rem" }}>
          <div className="space-y-6">

            {/* ── Project Info ──────────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Project Info
              </h3>

              <div className="mb-4">
                {/* "Book title", not "Title": with a Series name on the same
                    screen, a bare Title is ambiguous about which of the two it
                    means. */}
                <label className="mb-1 block text-xs font-medium text-text-primary"
                       htmlFor="book-title">
                  Book title
                </label>
                <input
                  id="book-title"
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  data-testid="book-title"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                />
                <p className="mt-1 text-mini text-faint">
                  Renaming does not move the folder on disk, so nothing you have
                  backed up changes name.
                </p>
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Genre</label>
                <p className="mb-1 text-xs text-faint">
                  Auto-injected into AI prompts as story context.
                </p>
                <input
                  type="text"
                  value={genre}
                  onChange={e => setGenre(e.target.value)}
                  placeholder="e.g. epic fantasy, sci-fi thriller, contemporary romance"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
                <SuggestionPicker value={genre} onChange={setGenre} groups={GENRE_SUGGESTIONS} nsfwGroups={GENRE_NSFW} />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Tone</label>
                <p className="mb-1 text-xs text-faint">
                  Auto-injected into AI prompts as story context.
                </p>
                <input
                  type="text"
                  value={tone}
                  onChange={e => setTone(e.target.value)}
                  placeholder="e.g. dark, atmospheric, slow burn, humorous"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
                <SuggestionPicker value={tone} onChange={setTone} groups={TONE_SUGGESTIONS} nsfwGroups={TONE_NSFW} />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Theme</label>
                <p className="mb-1 text-xs text-faint">
                  The idea the story keeps returning to. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={theme}
                  onChange={e => setTheme(e.target.value)}
                  placeholder="e.g. redemption, found family, the cost of power"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Setting</label>
                <p className="mb-1 text-xs text-faint">
                  Where and when the story happens. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={storySetting}
                  onChange={e => setStorySetting(e.target.value)}
                  placeholder="e.g. a storm-locked island kingdom, near-future Chicago"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Word Count Target</label>
                <p className="mb-1 text-xs text-faint">
                  Target length in words. Drives the Writing Progress gauge
                  (stored in the outline, not project settings). Leave blank to keep the current target.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={targetWordCount}
                  onChange={e => setTargetWordCount(e.target.value)}
                  placeholder="e.g. 90000"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
              </div>

              {/* Chapter target. Stored beside the word target in the outline
                  worksheet, for the same reason: the gauge reads one place. */}
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-text-primary">Chapter Count Target</label>
                <p className="mb-1 text-xs text-faint">
                  How many chapters you are planning. Shown beside your word
                  count in the Writing Progress gauge (stored in the outline,
                  not project settings). Leave blank to keep the current target.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={targetChapterCount}
                  onChange={e => setTargetChapterCount(e.target.value)}
                  placeholder="e.g. 30"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
              </div>

              {/* POV and Tense side by side -- both are short pick-lists */}
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    Point of View
                    <button
                      type="button"
                      onClick={() => setShowPovHelp(h => !h)}
                      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-micro transition-colors ${
                        showPovHelp
                          ? "text-accent"
                          : "text-faint hover:text-accent"
                      }`}
                      title="What do these options mean, and which should I pick?"
                      aria-expanded={showPovHelp}
                    >
                      <HelpCircle size={11} />
                      <span>What's this?</span>
                    </button>
                  </label>
                  <select
                    value={pointOfView}
                    onChange={e => setPointOfView(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                    title="Narration perspective. Auto-injected into AI prompts."
                  >
                    <option value="">(not set)</option>
                    <option value="First">First</option>
                    <option value="Second">Second</option>
                    <option value="Third Limited">Third Limited</option>
                    <option value="Third Omniscient">Third Omniscient</option>
                    <option value="Multiple">Multiple</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-primary">Tense</label>
                  <select
                    value={tense}
                    onChange={e => setTense(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                    title="Narration tense. Auto-injected into AI prompts."
                  >
                    <option value="">(not set)</option>
                    <option value="Past">Past</option>
                    <option value="Present">Present</option>
                  </select>
                </div>
              </div>

              {/* POV explainer -- expands full-width below the POV/Tense row
                  so the two-column grid doesn't squeeze the text. */}
              {showPovHelp && (
                <div className="mb-3 rounded border border-accent-fill/40 bg-accent-soft/20 p-3">
                  <div className="space-y-2">
                    {POV_HELP.map(pov => (
                      <div key={pov.name}>
                        <p className="text-xs font-semibold text-accent">{pov.name}</p>
                        <p className="text-xs text-text-muted">{pov.what}</p>
                        <p className="text-xs text-faint">{pov.note}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 border-t border-accent-fill/40 pt-2 text-xs text-text-muted">
                    <span className="font-semibold text-accent">Not sure? </span>
                    Pick <span className="text-text-primary">Third Limited</span> -- it's
                    the most popular choice in modern fiction and the easiest to keep
                    consistent. Writing Young Adult or romance and want the reader glued
                    to one voice? <span className="text-text-primary">First</span> is the
                    genre favorite. Juggling a big cast (epic fantasy, dual-POV romance)?
                    Choose <span className="text-text-primary">Multiple</span>.
                  </p>
                </div>
              )}

              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-text-primary">Target Audience</label>
                <p className="mb-1 text-xs text-faint">
                  Who the book is for. Auto-injected into AI prompts.
                </p>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  placeholder="e.g. Adult, Young Adult, Middle Grade"
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                />
                <SuggestionPicker value={targetAudience} onChange={setTargetAudience} groups={AUDIENCE_SUGGESTIONS} nsfwGroups={AUDIENCE_NSFW} />
              </div>

              {/* THE SERIES NAME, editable. It used to be a read-only box
                  showing a folder path and not even the name -- and the only
                  place the name could EVER be set was the "Make this a series"
                  checkbox on the new-book form, typed once before the writer
                  had written a word of the thing they were naming. */}
              {project.series_id && (
                <div className="rounded border border-secondary-fill/40 bg-secondary-soft/20 p-3">
                  <label className="mb-1 block text-xs font-medium text-secondary-muted"
                         htmlFor="series-name">
                    Series name
                  </label>
                  <input
                    id="series-name"
                    type="text"
                    value={seriesName}
                    onChange={e => setSeriesName(e.target.value)}
                    placeholder="The name this series goes by"
                    data-testid="series-name"
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                  />
                  <p className="mt-1 text-mini text-faint">
                    Shared by every book in this series, and sent to AI as part
                    of the story context. Renaming it here does not move the
                    folder on disk, so nothing you have backed up changes name.
                  </p>
                  <p className="mt-1 text-mini text-faint">
                    Folder: {project.series_path}
                  </p>
                </div>
              )}
            </section>


            {/* ── Content & Models ──────────────────────────────────────── */}
            <section>
              <h3 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Content & Models
              </h3>

              {/* Content Mode */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Content Mode</label>
                <p className="mb-2 text-xs text-faint">
                  Controls how AI assistants handle mature or explicit story content for this project.
                </p>
                <div className="flex flex-col gap-2">
                  {[
                    { value: "general",  label: "General",  desc: "Standard fiction" },
                    { value: "mature",   label: "Mature",   desc: "Violence, dark themes, non-explicit adult" },
                    { value: "explicit", label: "Explicit", desc: "Adult fiction with explicit content" },
                  ].map(opt => (
                    <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name="contentMode"
                        value={opt.value}
                        checked={contentMode === opt.value}
                        onChange={() => setContentMode(opt.value)}
                        className="mt-0.5 accent-accent-fill"
                      />
                      <div>
                        <span className="text-xs font-medium text-text-primary">{opt.label}</span>
                        <span className="ml-2 text-xs text-faint">{opt.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Model Cost Tier */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Model Cost Tier</label>
                <p className="mb-2 text-xs text-faint">
                  Caps how expensive the models offered in this project's picker are.
                  Also drives the cost guidance below.
                </p>
                <select
                  value={costTier}
                  onChange={e => setCostTier(e.target.value)}
                  className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                >
                  <option value="free">Free (free models only)</option>
                  <option value="budget">Lowest ($0-1/M input)</option>
                  <option value="standard">Pricier ($1-15/M input)</option>
                  <option value="premium">Priority Best (all models)</option>
                </select>
              </div>

              {/* Per-Project Model Selection
                  Auto-filtered by content mode:
                  - General: all models shown
                  - Mature: all models shown (most handle mature content)
                  - Explicit: only unmoderated models shown (moderated ones refuse explicit)
              */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-medium text-text-primary">Project Model</label>
                <p className="mb-2 text-xs text-faint">
                  Choose a specific model for this project. Leave blank to use the global default.
                  {contentMode === "explicit" && (
                    <span className="ml-1 text-warn-fill">
                      Showing only unmoderated models (explicit mode).
                    </span>
                  )}
                  {contentMode === "mature" && (
                    <span className="ml-1 text-warn-fill">
                      Hiding known moderated providers (mature mode).
                    </span>
                  )}
                </p>
                {models.length > 0 ? (
                  <select
                    value={projectModel}
                    onChange={e => setProjectModel(e.target.value)}
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-fill"
                  >
                    <option value="">Use global default</option>
                    {/* Orphaned stored model: render it so the select shows the
                        TRUE saved value instead of snapping to the first option.
                        Flagged so the writer knows it must be replaced. */}
                    {projectModelMissing && (
                      <option value={projectModel}>
                        {projectModel} (unavailable -- select a current model)
                      </option>
                    )}
                    {/* Recommended group, pinned at the top. Curated + cross-checked
                        against the live list, so no deprecated slugs appear. */}
                    {recommendedOptions.length > 0 && (
                      <optgroup label="★ Recommended">
                        {recommendedOptions.map(rec => {
                          const m = visibleModels.find(vm => vm.id === rec.id)!;
                          return (
                            <option key={`rec-${rec.id}`} value={rec.id}>
                              {m.name} -- {rec.note}
                              {m.is_free ? " (free)" : ` ($${m.cost_input_per_million.toFixed(2)}/M)`}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {/* All models (recommended ones are repeated here too, under
                        their natural list, which is fine for a dropdown). */}
                    <optgroup label="All models">
                      {visibleModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.is_free ? " (free)" : ` ($${m.cost_input_per_million.toFixed(2)}/M)`}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={projectModel}
                    onChange={e => setProjectModel(e.target.value)}
                    placeholder="e.g. anthropic/claude-3.5-sonnet (leave blank for global)"
                    className="w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder-faint outline-none focus:border-accent-fill"
                  />
                )}
                {/* Loud warning when the saved model is no longer selectable.
                    This is the case that produced the silent "HTTP 404" -- the
                    model is dead but the project still points at it. */}
                {projectModelMissing && models.length > 0 && (
                  <p className="mt-1 text-xs text-warn-fill">
                    This project is set to <span className="font-mono">{projectModel}</span>, which
                    is not in the current model list from your AI provider
                    ({aiProvider === "nanogpt" ? "NanoGPT" : "OpenRouter"}). If the model came from a
                    different provider, or was deprecated or renamed, AI requests will fail until you
                    pick a current model above (or change the provider in Settings). If it is only
                    hidden by this project's content mode, cost tier, or the text-only filter,
                    requests still work, but consider picking a model that fits your filters.
                  </p>
                )}
                {projectModel && !projectModelMissing && (
                  <p className="mt-1 text-xs text-success-fill">
                    This project will use {projectModel.split("/").pop()} for all AI requests.
                  </p>
                )}
              </div>
            </section>


            {/* ── Help Guide (expandable) ───────────────────────────────── */}
            <section>
              <button
                onClick={() => setShowGuide(g => !g)}
                className="flex w-full items-center justify-between rounded border border-border bg-bg-primary px-4 py-3 text-left transition-colors hover:border-accent-fill"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle size={14} className="text-accent-muted" />
                  <span className="text-xs font-semibold text-text-primary">
                    Model Choosing Guide
                  </span>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-text-muted transition-transform ${showGuide ? "rotate-180" : ""}`}
                />
              </button>

              {showGuide && (
                <div className="mt-2 space-y-4 rounded border border-border bg-bg-primary p-4">

                  {/* Section A: What does the tier floor do? */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-accent">
                      What does the model quality floor do?
                    </p>
                    <p className="text-xs leading-relaxed text-text-muted">
                      The quality floor sets the minimum capability level for AI assistance
                      in this project. Free models are available to everyone at no cost.
                      Budget and Standard models produce more nuanced, character-aware
                      results but cost money per use through your OpenRouter account.
                    </p>
                  </div>

                  {/* Section B: Cost estimates (dynamic based on tier) */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-accent">
                      What will this cost me?
                    </p>
                    <p className="mb-1 text-xs text-text-muted">
                      At the <span className="font-medium text-text-primary">{tierLabel}</span> tier:
                    </p>
                    <div className="rounded border border-border bg-bg-panel p-3">
                      <p className="text-xs text-text-primary">
                        Getting started (5-8 profiles, world-building, 3-5 chapters with AI feedback):
                        <span className="ml-1 font-semibold text-success-muted">{costs.startup}</span>
                      </p>
                      <p className="mt-1 text-xs text-text-primary">
                        Typical writing session after that (profile tweaks, feedback on 1-2 chapters):
                        <span className="ml-1 font-semibold text-success-muted">{costs.session}</span>
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-faint">
                      These are rough estimates. Actual costs depend on the specific model,
                      how much text you send, and how often you use AI features.
                    </p>
                  </div>

                  {/* Section C: Content mode impact (dynamic) */}
                  <div>
                    <p className="mb-1 text-xs font-semibold text-accent">
                      How does content mode affect model choice?
                    </p>
                    <p className="text-xs leading-relaxed text-text-muted">
                      {getContentModeGuide()}
                    </p>
                  </div>

                  {/* Section D: Recommendation (dynamic based on ALL settings) */}
                  <div className="rounded border border-accent-fill/40 bg-accent-soft/20 p-3">
                    <p className="mb-1 text-xs font-semibold text-accent">
                      Recommendation for your project
                    </p>
                    <p className="text-xs leading-relaxed text-text-primary">
                      {getRecommendation()}
                    </p>
                  </div>

                </div>
              )}
            </section>

          </div>
        </div>

        {/* Footer */}
        <div
          className="shrink-0 border-t border-border"
          style={{ padding: "1rem 1.5rem" }}
        >
          {error && <p className="mb-2 text-xs text-danger-muted">{error}</p>}
          {saved && !error && (
            <p className="mb-2 text-xs text-success-muted">Settings saved.</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-accent-fill px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-fill disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
