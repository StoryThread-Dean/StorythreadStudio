// features/theme/themeTokens.ts -- every colour a writer may assign
// ==================================================================
// The 56 `--st-*` role tokens, grouped the way App.css groups them, each with
// a plain-language label and a note of whether it carries alpha.
//
// WHY A REGISTRY AND NOT A SCAN OF App.css AT RUNTIME. The editor needs three
// things the stylesheet does not carry: an ORDER a person can navigate, a
// LABEL that says what the colour is for rather than what it is called, and
// the knowledge that eleven of them need an alpha control. So it is written
// down here -- and `themeTokens.test.ts` reads App.css and fails the build if
// the two lists disagree in EITHER direction. A token added to the stylesheet
// and not here would be unreachable in the editor and silently unthemeable;
// one here and not in the stylesheet would be a control that does nothing.
//
// THE LABELS ARE THE WRITER'S WORDS, NOT THE CODE'S. `--st-bg-raised` is "Hover
// and menus", not "L3 surface". A writer picking colours needs to know where
// the colour lands, and the token name is the one piece of information they
// already have on screen.

/** One assignable colour. */
export interface ThemeToken {
  /** The custom property, exactly as App.css declares it. */
  name: string;
  /** What it paints, in the writer's terms. */
  label: string;
  /**
   * True for the eleven tokens written as `rgb(R G B / A)`.
   *
   * Alpha is load-bearing on every one of them: the three inks composite onto
   * four different surfaces, the `-soft` fills are a tint OVER a card, the
   * scrim is the dimming itself, and the active line is a whisper on top of
   * the page. Flattening any of them to opaque hex picks one background and is
   * wrong on the rest.
   */
  hasAlpha?: boolean;
  /**
   * Present for the three ink tokens: the surface to measure contrast against
   * when warning the writer that their choice is unreadable.
   *
   * `bg-panel` rather than `bg-primary` because a panel is where most of the
   * app's text actually sits, and it is the surface the shipped themes were
   * measured on.
   */
  contrastAgainst?: string;
}

export interface ThemeTokenGroup {
  /** The heading, matching the comment that groups these in App.css. */
  title: string;
  /** One line on what the group is for. */
  blurb: string;
  tokens: ThemeToken[];
}

export const THEME_TOKEN_GROUPS: ThemeTokenGroup[] = [
  {
    title: "Surfaces",
    blurb:
      "The grounds everything sits on. These alternate rather than climb: a "
      + "panel lifts off the page, and an inset sinks back into the panel.",
    tokens: [
      { name: "--st-bg-primary",   label: "The window itself" },
      { name: "--st-bg-panel",     label: "Cards, dialogs, sidebars" },
      { name: "--st-bg-surface",   label: "Inputs and wells (sunk into a panel)" },
      { name: "--st-bg-raised",    label: "Hover and menus" },
      { name: "--st-bg-panel-alt", label: "Spare panel shade (currently unused)" },
      { name: "--st-scrim",        label: "The dimming behind a dialog", hasAlpha: true },
      { name: "--st-paper",        label: "The wordmark plate" },
      { name: "--st-brand-deep",   label: "Brand fills only" },
    ],
  },
  {
    title: "Ink",
    blurb:
      "Text, in three levels. These carry transparency so they sit correctly "
      + "on every surface above -- the contrast figure beside each one is "
      + "measured against a panel, and under 4.5 is hard to read.",
    tokens: [
      { name: "--st-text-primary", label: "Body copy and headings", hasAlpha: true, contrastAgainst: "--st-bg-panel" },
      { name: "--st-text-muted",   label: "Labels and secondary text", hasAlpha: true, contrastAgainst: "--st-bg-panel" },
      { name: "--st-faint",        label: "Hints, counts, timestamps", hasAlpha: true, contrastAgainst: "--st-bg-panel" },
      { name: "--st-on-accent",    label: "Text on a filled accent button", contrastAgainst: "--st-accent-fill" },
    ],
  },
  {
    title: "Lines",
    blurb: "Borders and the focus ring. Opaque, because half the app draws them at 60%.",
    tokens: [
      { name: "--st-border",        label: "Ordinary borders" },
      { name: "--st-border-strong", label: "Emphasised borders" },
      { name: "--st-focus",         label: "Keyboard focus ring" },
    ],
  },
  {
    title: "Accent",
    blurb:
      "Links, primary actions, and \"you are here\". Each family runs light to "
      + "dark: the plain one is text, -fill is a solid button, -soft is a tint.",
    tokens: [
      { name: "--st-accent",        label: "Accent text and links" },
      { name: "--st-accent-strong", label: "Accent, emphasised" },
      { name: "--st-accent-muted",  label: "Accent, quieter" },
      { name: "--st-accent-fill",   label: "Filled accent button" },
      { name: "--st-accent-soft",   label: "Accent tint behind a card", hasAlpha: true },
    ],
  },
  {
    title: "Meaning",
    blurb:
      "The colours that say what happened. Keep these distinguishable from "
      + "each other and from the accent, or a warning stops reading as one.",
    tokens: [
      { name: "--st-secondary",        label: "Information and progress" },
      { name: "--st-secondary-strong", label: "Information, emphasised" },
      { name: "--st-secondary-muted",  label: "Information, quieter" },
      { name: "--st-secondary-fill",   label: "Filled information button" },
      { name: "--st-secondary-soft",   label: "Information tint", hasAlpha: true },

      { name: "--st-success",        label: "Success and completion" },
      { name: "--st-success-strong", label: "Success, emphasised" },
      { name: "--st-success-muted",  label: "Success, quieter" },
      { name: "--st-success-fill",   label: "Filled success button" },
      { name: "--st-success-soft",   label: "Success tint", hasAlpha: true },

      { name: "--st-warn",        label: "Warnings and cost" },
      { name: "--st-warn-strong", label: "Warning, emphasised" },
      { name: "--st-warn-muted",  label: "Warning, quieter" },
      { name: "--st-warn-fill",   label: "Filled warning button" },
      { name: "--st-warn-soft",   label: "Warning tint", hasAlpha: true },

      { name: "--st-danger",        label: "Errors and destructive actions" },
      { name: "--st-danger-strong", label: "Danger, emphasised" },
      { name: "--st-danger-muted",  label: "Danger, quieter" },
      { name: "--st-danger-fill",   label: "Filled danger button" },
      { name: "--st-danger-soft",   label: "Danger tint", hasAlpha: true },
    ],
  },
  {
    title: "Feature identity",
    blurb:
      "Violet is the Weave everywhere in this app, and green is the Audiobook "
      + "Converter. Changing these changes what a writer recognises a feature by.",
    tokens: [
      { name: "--st-weave",        label: "The Weave" },
      { name: "--st-weave-strong", label: "The Weave, emphasised" },
      { name: "--st-weave-muted",  label: "The Weave, quieter" },
      { name: "--st-weave-fill",   label: "Filled Weave button" },
      { name: "--st-weave-soft",   label: "Weave tint", hasAlpha: true },
      { name: "--st-audio",        label: "Audiobook Converter" },
    ],
  },
  {
    title: "Categorical",
    blurb:
      "Positional stripes for the sidebar's sections -- a scale, not a set. "
      + "Section three is whatever colour three is, so these want to stay "
      + "distinguishable from each other rather than mean anything.",
    tokens: [
      { name: "--st-kind-1", label: "Section colour 1" },
      { name: "--st-kind-2", label: "Section colour 2" },
      { name: "--st-kind-3", label: "Section colour 3" },
      { name: "--st-kind-4", label: "Section colour 4" },
      { name: "--st-kind-5", label: "Section colour 5" },
      { name: "--st-kind-6", label: "Section colour 6" },
      { name: "--st-kind-7", label: "Section colour 7" },
      { name: "--st-kind-8", label: "Section colour 8" },
    ],
  },
  {
    title: "Editor layers",
    blurb:
      "Inside the writing editor, and the two places your own prose is painted "
      + "on. The active line is a whisper on purpose -- it marks where you are "
      + "without competing with the words.",
    tokens: [
      { name: "--st-selection",   label: "Selected text background" },
      { name: "--st-active-line", label: "The line the cursor is on", hasAlpha: true },
    ],
  },
];

/** Every token, flat, in the order the editor lists them. */
export const THEME_TOKENS: ThemeToken[] =
  THEME_TOKEN_GROUPS.flatMap(g => g.tokens);

/** Every token name, for validating what comes off the wire. */
export const THEME_TOKEN_NAMES: string[] = THEME_TOKENS.map(t => t.name);

/** The eleven that must keep an alpha channel. */
export const ALPHA_TOKEN_NAMES: string[] =
  THEME_TOKENS.filter(t => t.hasAlpha).map(t => t.name);

/** A stored custom theme: token name to CSS colour string. */
export type CustomTheme = Record<string, string>;

/**
 * Keep only the tokens the app actually has, dropping anything else.
 *
 * A stored theme is writer data that outlives releases. If a token is retired,
 * an old settings.json still carries it, and passing it through to
 * `style.setProperty` would litter the DOM with dead properties forever. If a
 * token is ADDED, it is simply absent here and falls back to the shipped dark
 * value, which is why the editor seeds every token on creation rather than
 * storing only what was changed.
 */
export function sanitizeCustomTheme(raw: unknown): CustomTheme {
  if (!raw || typeof raw !== "object") return {};
  const known = new Set(THEME_TOKEN_NAMES);
  const out: CustomTheme = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(k) && typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}
