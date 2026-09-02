# Appearance -- specification

**Status:** shipped 2026-09-01. Source of truth for the five Appearance
controls and for the colour contract every theme in the app is held to.

Where this document and the code disagree, **the code is wrong** until the
writer rules otherwise. Behaviour changes belong in the same commit as the
change to this file.

---

## Why this document exists

Appearance grew into a five-control feature area with a measurable colour
contract, and none of it was written down anywhere a person could check the
build against. Its rules lived in comments inside `app/src/App.css` and in
prose in `CLAUDE.md`. That is precisely the arrangement Appendix 1 of
`weave-spec.md` exists to warn about: a design nothing is compared to.

It was written after two reports from one prospective user, both of which
turned out to be real defects rather than preferences, and one of which had
been shipping since the editor was first written.

> "The maximum font size is way too small. the writing area should also have a
> separate control for th text font size (vs UI font size which is more
> difficult to all to freely change without triggering other window/tile/card
> issues)"

> "I tried evaluating your app but I can't as the Light color scheme is causing
> a very fast headache from eye strain. It breaks the cardinal rule of UI design
> 'Never decrease the contrast of the small text unless you have an excellent
> reason (such as using gray text to indicate disabled and thus irrelevant
> controls). The dark scheme has similar issues for similar reasons. Why fade
> the font color for smaller text."

---

## 1. The five controls

All five live in Settings > Appearance and all five are saved **globally**, in
`~/.storythread/settings.json`, not per book. A writer's eyes do not change
between projects.

| Control | Key | Sizes / sets | Explicitly does NOT |
|---|---|---|---|
| Theme | `theme` | The palette: dark, light, or the writer's own (`custom_theme`) | Touch the Audiobook Converter, which is charcoal in all three |
| Interface size | `ui_scale` | The app around the work: menus, sidebars, dialogs, labels, buttons | Touch the manuscript |
| Editor text size | `editor_font_pt` | The writer's prose in all Markdown editors, plus the Converter's narration editor | Touch the chrome, or Reader Mode |
| Line spacing | `line_spacing`, `line_spacing_multiple` | The gap between wrapped lines *inside* a paragraph, in every prose surface including narration | Put a gap *between* paragraphs |
| Paragraph spacing | `paragraph_space_before`, `paragraph_space_after` | The gap between one paragraph and the next, in the CodeMirror editors | Change the lines inside one, or reach the narration textarea (nothing to pad) |

### 1.1 Interface size and Editor text size are two controls on purpose

This is the writer's own reasoning and it is correct: chrome is "more difficult
to freely change without triggering other window/tile/card issues". Chrome text
shares its box with buttons, tables and cards, so growing it has consequences
three panels away, which is why it moves in measured steps. Prose in a
line-wrapping editor has no layout to break, so it can afford a much wider
range and a free-form Custom value.

Wanting dense menus above a roomy manuscript is an ordinary preference. So is
the reverse.

### 1.2 Interface size

Seven steps, applied as an inline `font-size` on `<html>`, which moves every
rem-based Tailwind utility:

| id | root px | Note |
|---|---|---|
| `default` | 16 | |
| `larger` | 17 | |
| `larger_plus` | 18 | |
| `largest` | 19 | Was the ceiling until 2026-09-01 |
| `huge` | 20 | |
| `huge_plus` | 22 | |
| `maximum` | 24 | +50%. `text-xs` lands at 18px, `text-mini` at 16.5px |

The first four ids are **never renamed**. They sit in every existing writer's
`settings.json`, and `largest` no longer being the largest is a cosmetic wart;
losing a saved choice is not.

A second map, `TEXT_ENTRY_PX`, drives `--text-entry-size` for the five
`.text-entry` surfaces (chat boxes, description textareas) with bigger jumps,
because +1px on a surface you type into is imperceptible.

**Known limitation, deliberately not fixed here.** Lucide icons take a numeric
`size=` prop in pixels and do not scale with the root. At `maximum` they sit
beside 18px text looking a size small. The honest fix is a `useIconSize()`
applied at several hundred call sites; it is on the roadmap, and
`tests/manual-smoke.md` tells the tester so they do not file it as a bug.

### 1.3 Editor text size

Range **9pt to 24pt**, default **12pt**, offered as buttons (10/11/12/14/16/18)
plus a Custom number box committed **on blur** -- committing per keystroke
reflows the manuscript under a writer typing "2" on the way to "24".

Also bound to `Ctrl +` / `Ctrl -` (one point per press) and `Ctrl 0` (back to
12pt). The shortcuts call the same setter as the Settings control, so the two
cannot disagree and a nudge is persisted like any other choice.

**Points, not pixels, and this is load-bearing.** At CSS's 96dpi, 12pt is
*exactly* 16px -- the literal the editor hardcoded before this control existed.
So the default is not a new number a writer must judge; it is "the editor has
always been 12pt", which is also standard manuscript size. It also lets the
Appearance section speak one unit for the writer's own document, since
paragraph spacing is already in points.

**The default is non-negotiable.** Same rule as line spacing defaulting to
"1.5 lines" because it resolves to 1.75 next to the old hardcoded 1.8: an
upgrade must never silently reflow somebody's book.
`resolveEditorFontPx(12) === 16` is pinned in both languages.

### 1.4 Which surfaces Editor text size reaches

Every surface holding the writer's own prose, which is seven places, not six:

- the manuscript, the Outline, notes and both summary editors -- all
  `MarkdownEditor`, which reads the store once on everyone's behalf;
- the **Audiobook Converter's narration editor**, which is a plain `<textarea>`
  rather than a `MarkdownEditor` (the marker grammar needs raw text and stable
  character offsets), and therefore had to be wired separately.

That last one is the trap. Wiring the six `MarkdownEditor` surfaces looked like
finishing the job, and the seventh went on rendering at a fixed `text-sm` --
reported as "I have the font side one way but it appears visibly different in
the Audiobook generator". **A new prose surface that is not a `MarkdownEditor`
must read `useEditorFontSize` itself.**

The narration editor keeps `font-mono` deliberately: `[pause]`, `[say:...]` and
`[voice:NAME]` are bracket-dense and a fixed pitch keeps them scannable, and the
walkthrough teaches the grammar in mono. Only the size follows the setting, plus
line height. Paragraph spacing does not apply -- a textarea has no per-paragraph
element to pad.

### 1.5 The Audiobook Converter's type ramp

The converter was built a full step smaller than the writing app. Nothing caught
it because every size there is a legitimate rem step that scales with Interface
size correctly; it was a different design rather than a broken control:

| | `<= 11px` | of total size classes |
|---|---|---|
| Writing app | 41% | `text-xs` dominates |
| Audiobook | 72% | `text-mini` / `text-micro` dominate |

`CastPanel` is the extreme: 48 of its 52 size classes are 10px or 11px.

`.audiobook-theme` therefore declares its **own type ramp**, one pixel up at
every step (9/10/11/12/14 becomes 10/11/12/13/15), keeping the ladder's shape so
the screen's internal hierarchy survives.

This works because Tailwind v4 compiles `text-mini` to
`font-size: var(--text-mini)` -- the variable is read at use time, so
redefining the step inside the scope moves all 247 call sites without editing
one. **Verified against the built stylesheet, not assumed**, and pinned by
tests: if Tailwind ever inlined the value instead, the override would silently
do nothing and every audiobook screen would quietly go back to being small.

**The cost, stated so it is a decision:** `text-mini` now means 11px in the
writing app and 12px inside the converter, so a shared component (`GuidedWalk`,
`WhatsThis`) renders a shade larger on that side. That is intended -- it should
match its surroundings, the same argument that justifies this block overriding
colour -- but it is a real second meaning for one class name.

### 1.6 Where the controls are reachable from

Interface size and Editor text size live in **one component**,
`app/src/components/settings/TextSizeControls.tsx`, rendered in two places:

- Settings > Appearance;
- the **Audiobook Converter's own settings dialog**, under a "Text size"
  heading after the narration sections.

The Converter is a full-screen world with its own sidebar and its own settings
dialog and no route back to app Settings. A writer working on narration who
wanted the text bigger had to leave the Converter entirely, change it, and come
back to see whether it helped.

**Extracted, never copied.** A second place to change a setting through a second
component is two vocabularies for one idea, and they drift -- the same rule that
made the Run editor an extraction of `ThreadEditor` rather than a copy of it.
The arithmetic lives in the hook, the markup lives in the one component, and a
test fails the build if either screen grows its own copy of the buttons.

Two details that make the shared rendering work:

- **It names colour roles only**, never shades, so inside `.audiobook-theme` it
  resolves to the charcoal ramp and looks native there with no conditional.
  Do not add styling props; if it looks wrong on that side, fix the theme block.
- **It is outside the audiobook dialog's Save flow.** These persist the moment
  they are clicked, through the same stores as the writing app. Folding them
  into that dialog's dirty/Save cycle would let a writer resize their text, hit
  Cancel, and be surprised twice. The section says out loud that these two are
  app-wide, because everything else in that dialog belongs to one book.

**Line spacing is mirrored there too**, as its own extracted component
(`LineSpacingControl.tsx`), under the same "Text size and spacing" heading. The
narration editor already obeyed the setting -- it takes its line-height from the
same store -- so what was missing was only the knob, on a screen you had to
leave the Converter to reach.

**Paragraph spacing is deliberately NOT mirrored, and that is a fact about the
surface rather than an omission.** It works by padding `.cm-line`, and
CodeMirror gives one such element per source line. The narration editor is a
plain `<textarea>`: one element holding all the text, with no per-paragraph node
to pad. The control would render, accept a value, save it, and change nothing
visible on that side, and a dead knob is worse than an absent one. The
Converter's line-spacing help text says where that setting lives and why it
stops at the boundary. Pinned by a test that fails if the dialog ever imports
the paragraph helpers.

### 1.7 The custom theme

A third Theme option, **Custom -- assign your colors**, alongside Dark and
Light. Choosing it closes Settings and opens the colour editor.

**Storage: `settings.json`, key `custom_theme`, NOT `app.db`.** This was
considered and rejected rather than defaulted: `app.db` is per-PROJECT, is
documented as safe to delete, and must hold only what can be rebuilt from
Markdown. A palette is global, is not derivable from anything, and losing an
evening's work to a cache clear would be a real loss. It is one entry per role
token, e.g. `{"--st-bg-panel": "#23232D"}`.

**There is no `[data-theme="custom"]` block in App.css, and there should not
be.** `:root` matches `<html>` whatever `data-theme` says, and only
`[data-theme="light"]` overrides it, so a custom theme starts from the dark
values for free. The writer's choices are applied as **inline custom
properties** on `<html>` -- inline beats a stylesheet rule, the same mechanism
`useUiScale` uses for `--text-entry-size`. That leaves no second copy of 56
values in the stylesheet to drift, and nothing to update when a token is added.

Consequences worth knowing:

- **Switching away must remove what was applied.** `useTheme` tracks the
  properties it wrote in `appliedProps` and clears them first on every change.
  Without that, picking Dark after Custom leaves the inline values winning over
  the stylesheet: the writer chooses Dark, nothing happens, and there is no way
  back short of a restart.
- **`color-scheme` is set inline, derived from the window colour.** Native
  scrollbars, `<select>` popups and context menus are drawn by the OS outside
  the page, so no CSS variable reaches them. Guessing wrong leaves dark
  scrollbars on a cream custom theme, which is the bug light mode shipped with
  before v2.0.2.
- **The Audiobook Converter is unaffected, and that falls out rather than being
  arranged.** `.audiobook-theme` declares its own `--st-*` on a descendant, and
  an element's own declaration wins over an inherited one. Charcoal in every
  theme, including this one.

**Seeding.** Every one of the 56 tokens is stored, not just the ones changed.
The editor seeds from `readCurrentTokens()`, which reads the *computed* values
off the live stylesheet -- so the defaults are never duplicated in TypeScript
and a new token is picked up with no further work. A sparse palette would fall
back to the shipped *dark* value for anything missing, so a writer building a
light palette would get one or two stubborn dark patches with no control on
screen to explain them.

**Preview is live; saving is not.** "Manual save only" is a locked rule, but
nobody can pick 56 colours blind. So the DOM follows every keystroke via
`previewCustomTheme`, the file follows only Save, and unmounting calls
`revertPreview()`. Cancelling therefore restores the previous theme rather than
leaving the writer looking at a palette that vanishes on restart.

**Contrast is shown, not enforced.** The three ink rows carry their live ratio
against `--st-bg-panel` and turn amber under 4.5:1, and the footer counts how
many are failing. It **warns rather than refuses**: the shipped themes are held
to AA by a build gate because they are the app's defaults, but a writer's own
palette is their decision about their own eyes. This is the one place the
contrast work of section 3 can be undone, which is exactly why the numbers are
on screen.

**Validation.** Values reach a `style` attribute, so a colour must be
`#RGB`, `#RRGGBB`, `#RRGGBBAA` or `rgb(R G B / A)` and a key must look like
`--st-*`. Checked in the backend on the way in and out, and again in the
frontend, which additionally drops tokens the app does not have. The backend
deliberately does **not** hold the list of 56 names -- that would be a second
cross-language list to keep in step, and the frontend already pins its registry
against App.css. Malformed entries are dropped **individually**: this is a
screen with 56 inputs, and one typo must not cost the other 55.

### 1.8 The Audiobook Converter's own theme

The Converter has its own **Dark (charcoal) / Light (paper) / Custom**, set in
Audiobook Settings under "Look and feel". Stored as `audiobook_theme` and
`audiobook_custom_theme`, independent of the writing app's.

**Independent rather than inherited**, on the writer's ruling. Spec 5.0 fixed
it at charcoal in both app themes so the writer would always know which side
they were on; that is still the default, but it is now a choice. Keying it to
`[data-theme="light"]` would have made one switch restyle a feature the writer
was not looking at, and would have forbidden a dark editor beside a paper
Converter.

**Selector:** `.audiobook-theme[data-ab-theme="light"]`, one attribute more
specific than the charcoal block, so it wins for what it declares and inherits
the rest -- including the +1px type ramp, which is a size decision and has
nothing to do with the palette.

**This required converting the Converter off raw shades.** 940 classes across
25 files became role tokens, because a literal `bg-zinc-900` cannot follow any
theme. It was near zero-delta in charcoal: the `.audiobook-theme` block was
built from exactly those shades. `features/audiobook/` is no longer exempt from
the palette gate, which is what stops the next component added there from being
invisible to the light theme.

**Its light ink is stronger than the AA floor on purpose** -- roughly 14 / 9.5
/ 7 rather than the writing app's 14 / 8 / 5 -- because this side is dense with
10 and 11px labels and the instruction was that faded small text is the
problem. Held to the same contrast contract as every other palette, on all four
surfaces (it declares its own warm `bg-raised`, so the charcoal half's
exemption does not apply to it).

**A custom palette reaches it differently from the app's**, and this is the one
place the two mechanisms genuinely diverge. The app's palette is inline on
`<html>`; that cannot work here, because `.audiobook-theme` declares its own
`--st-*` on a descendant and an element's own declaration beats an inherited
one. So the Converter's palette is an inline style on the audiobook **root
element**, rendered through React. Same editor, same validation, same contrast
readout -- see 1.6.

---

## 2. Where a size is allowed to live

CodeMirror makes this a real rule rather than a style note, and the two halves
differ for a reason that is a fact about its base theme:

- **Font size goes on the editor root, `"&"`.** `@codemirror/view`'s baseTheme
  declares no `font-size` anywhere between the root and `.cm-line`, so it
  inherits cleanly.
- **Line height goes on `.cm-content`.** The baseTheme sets
  `.cm-scroller { line-height: 1.4 }`, and `.cm-scroller` sits between the root
  and the text, so a line-height on `"&"` is dead. The editor rendered at 1.4
  for its entire life with `lineHeight: "1.8"` sitting in the source being read
  as the answer.
- **Paragraph spacing goes on `.cm-line`**, as padding rather than margin,
  because CodeMirror measures lines with `getBoundingClientRect`.

Do not "fix" the font-size rule by symmetry with the line-height one. Both
placements are checked against the installed baseTheme and pinned by tests.

**No absolute pixel font size may appear anywhere**, in a Tailwind class
(`text-[11px]`) or in a JavaScript style object (`fontSize: "16px"`). Neither
can be moved by any setting. Editor *chrome* -- the Find panel, issue badges --
uses `rem` so it follows Interface size; the writer's *prose* takes its size
from `useEditorFontSize`. Both forms are gated in `app/src/typeScale.test.ts`.

---

## 3. The colour contract

### 3.1 Three ink levels, and only three

Every theme declares exactly three text tokens plus `--st-on-accent`:

| Token | Role |
|---|---|
| `--st-text-primary` | Body copy, headings, anything being read |
| `--st-text-muted` | Secondary information, labels, help text |
| `--st-faint` | Timestamps, counts, hints -- present but not competing |

**A fourth level is not to be added.** With every level held above the AA floor,
the usable range leaves gaps of roughly .20 and .17 in dark and .16 and .14 in
light. There is no room for a fourth rung a reader could actually distinguish,
and a "secondary" indistinguishable from "muted" invites exactly the dead class
that prompted this section (see 3.4).

### 3.2 The floor: WCAG AA, 4.5:1, on every surface

Every ink token must clear **4.5:1** against every surface body text is painted
on. This is the normal-text threshold; the app's small text is far below the
18.66px large-text exemption, and `--st-faint` in particular is used at 9-11px
at 183 call sites, so the normal-text floor is the only honest one.

Measured values as shipped, across `bg-primary` / `bg-panel` / `bg-surface` /
`bg-raised`:

**Dark** -- white at 92 / 72 / 55%

```
primary   14.24  13.34  14.24  10.83
muted      9.16   8.70   9.16   7.32
faint      5.91   5.69   5.91   4.98
```

**Light** -- `#1A1A1A` at 94 / 78 / 64%

```
primary   13.37  14.13  13.37  12.42
muted      7.99   8.28   7.99   7.60
faint      5.00   5.12   5.00   4.84
```

**Audiobook** -- opaque zinc, three surfaces (see 3.3)

```
primary #f4f4f5   18.10  16.12  13.55
muted   #a1a1aa    7.76   6.91   5.81
faint   #94949c    6.61   5.88   4.95
```

Light `--st-faint` is **0.64 and not 0.62** deliberately: 0.62 clears the floor
on `bg-raised` by 0.05, one part in ninety, which would fail the first time
anyone nudged a surface by a shade.

`app/src/App.css.test.ts` parses these out of the stylesheet, composites the
alpha onto each surface, computes the ratio and fails the build under 4.5. The
numbers above are therefore checked, not recorded.

### 3.3 The one exemption

`.audiobook-theme`'s `--st-bg-raised` (`#3f3f46`, zinc-700) is **excluded from
the contract**, by name, in the test.

It cannot be included. `--st-faint` would have to reach `#b0b0b8` to clear 4.5:1
against it -- lighter than `--st-text-muted`, so the ladder inverts and the
three levels stop meaning anything. Darkening raised to `#2d2d33` only reaches
4.54. It is a hover tint painted behind a row, not a surface body copy rests on,
and this predates the retune: today's muted manages only 4.07 there.

**If a resting surface is ever painted `--st-bg-raised` in that theme, this
exemption becomes wrong.** The ladder must then be redesigned; the floor must
not be lowered.

### 3.4 A colour class must name a role that exists

`text-<role>` is only a colour if `--color-<role>` is declared in App.css's
`@theme inline` block. `DialogueCheck.tsx` carried `text-text-secondary` at
eight call sites, four of them body copy; no such token existed, so Tailwind
emitted no rule and those elements silently inherited their parent's colour. It
rendered as *something*, so it never looked broken -- it simply was not a colour
anyone chose, and no theme or contrast check could reach it. Gated.

### 3.5 A colour may not be chosen twice

An `opacity` utility multiplies whatever colour the token delivered, invisibly
to every check above: `text-faint` at `opacity-40` lands near 0.22 effective
alpha in dark.

The rule, which is the writer's own exception made mechanical:

- **Conditional opacity is a state, and is allowed.** `disabled:opacity-40` is
  correct -- low contrast is the right rendering of a control you cannot use,
  and WCAG 1.4.3 exempts inactive components explicitly. `opacity-0 ...
  group-hover:opacity-100` is a reveal, not a dim; it ends at full.
- **Unprefixed opacity on dim ink is banned.** It is a colour decision made in a
  place no theme can reach. If it marks an unusable control, write it as
  `disabled:opacity-NN` so the class says so. If it marks a *state* -- already
  added, already established -- use a border, a ring or an icon and leave the
  text readable.

Gated in `App.css.test.ts`.

---

## 4. Cross-language contracts

Three appearance values are defined once in TypeScript and once in Python, and
each fails **silently** on drift -- no exception, no 400, no log line.

| Value | TypeScript | Python |
|---|---|---|
| Interface size steps | `UI_SCALE_PX` in `useUiScale.ts` | `_UI_SCALES` in `routers/settings.py` |
| Editor size bounds | `EDITOR_PT_MIN` / `_MAX` | `_EDITOR_PT_MIN` / `_MAX` |
| Editor size default | `EDITOR_PT_DEFAULT` | `settings_store.DEFAULT_SETTINGS` |

`PUT /api/settings` **ignores** an unknown `ui_scale` rather than rejecting it,
so an older backend is not broken by a newer client. The cost of that tolerance
is that a step the frontend offers and the backend omits returns 200 and stores
nothing: the writer picks it, watches it apply, restarts, and it is gone.

`parseUiScale()` is driven by membership in `UI_SCALE_PX` rather than a
hand-written list, so adding a step to the `Record` teaches the parser
automatically. `backend/tests/test_appearance_bounds.py` holds all three pairs
together.

---

## 5. Tests that cite this document

| File | Holds |
|---|---|
| `app/src/App.css.test.ts` | Token parity across themes; the AA contrast contract and its one exemption; every `text-<role>` names a declared role; no unprefixed opacity on dim ink; surfaces alternate rather than climb |
| `app/src/typeScale.test.ts` | No `text-[Npx]` classes; no `fontSize: "Npx"` in style objects |
| `app/src/hooks/useEditorFontSize.test.ts` | `resolveEditorFontPx(12) === 16`; clamping, including Infinity vs NaN; Settings uses the shared helpers |
| `app/src/hooks/useEditorSpacing.test.ts` | Size on `"&"` and not as a literal; line-height on `.cm-content` and not on `"&"` |
| `app/src/components/editorSpacing.test.tsx` | The rules CodeMirror actually injects, at the default size |
| `app/src/features/audiobook/AudiobookSettingsDialog.test.tsx` | The size controls render inside the Converter, offer the real buttons, say they are app-wide, and persist outside the dialog's Save flow |
| `app/src/features/audiobook/WorkspaceView.test.tsx` | The narration editor takes its size from the store, carries no `text-*` class, follows a change, and keeps `font-mono` |
| `backend/tests/test_appearance_bounds.py` | The three cross-language pairs in section 4 |
| `app/src/features/theme/themeTokens.test.ts` | The editor lists exactly the tokens App.css declares, and flags alpha on exactly the ones that carry it |
| `app/src/features/theme/color.test.ts` | Both colour shapes round-trip unchanged; the contrast maths agrees with the figures the build gate enforces |
| `app/src/features/theme/CustomThemeEditor.test.tsx` | Live preview without saving, revert on cancel, the readability warning, and a complete palette on save |
| `backend/tests/test_custom_theme.py` | A stored colour cannot be a CSS injection, and one bad row does not cost the other 55 |
| `app/src/features/audiobook/AudiobookThemeSection.test.tsx` | The Converter's theme is stored under its own key and never writes the app's, opening the editor does not switch the theme first, and the two palette targets cannot point at the same store |
