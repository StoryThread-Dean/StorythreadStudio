# 03. Profile Builder Specification

## Purpose

The Profile Builder is a guided refinement workspace used to:

- build structured profiles for story context
- show how AI interprets profile content
- help the writer fine tune traits and descriptions
- generate compact prompt friendly summaries
- improve later AI suggestions throughout the app

It is not only a form editor. It is a **writer and AI alignment tool**.

## Supported Profile Types

### MVP
- Character
- Relationship
- Location
- Lore
- Chapter Summary
- Scene Summary

## Profile Builder Layout

### Left Panel
- profile type selector
- list of profiles
- create new profile
- import character profile from another project

### Center Panel
- structured profile editor
- generated AI content sections
- notes sections
- summary generation controls

### Right Panel
- conversational profile calibration chat
- short, precise responses
- 1 to 4 follow-up questions when needed
- temporary session chat only

## Important Chat Behavior

The chat does **not** auto-write back into human-authored profile fields.

However, the system **may write generated AI content into dedicated Markdown fields** when the writer explicitly invokes generation for that field.

Examples:
- `ai_usage_example`
- `ai_profile_summary`
- `ai_section_summary`
- `chapter_summary`
- `scene_summary`

This means:
- human trait descriptions remain authored and controlled by the writer
- generated AI interpretation fields can be written back into the Markdown file in designated sections
- the writer can edit those generated sections manually afterward

## Structured Editing Approach

The best fit is:

- structured fields
- grouped or single trait blocks
- open notes for clarification
- generated AI usage examples
- generated section summaries
- generated full profile summaries

## Character Profile Sections

Recommended MVP sections:
- Overview
- Physical Traits
- Personality Traits
- Motivations
- Voice Notes
- Hidden and Foreshadowing Traits
- Relationships Overview
- Notes

## Relationship Profile Sections

- Overview
- History
- Current Dynamic
- Hidden Tensions
- Emotional Direction
- Notes

## Location Profile Sections

- Overview
- Physical Description
- Tone and Atmosphere
- Historical Significance
- Cultural Significance
- Scene Use Notes
- Notes

## Lore Profile Sections

- Overview
- Rule or Concept
- What It Affects
- What Characters Know
- Story Relevance
- Notes

## Influence Scale

Used in MVP primarily for:
- Character profiles
- Relationship profiles

### Levels
- Foreshadowing
- Background
- Minor
- Major
- Core

### Meanings

#### Foreshadowing
This exists and affects reactions, decisions, or subtext, but should usually never be mentioned directly unless the current context strongly justifies it.

Examples:
- hidden PTSD trigger
- secret ulterior motive
- undisclosed history with another character

#### Background
Exists in canon but should rarely be surfaced directly.

#### Minor
Subtle but valid, used when context supports it.

#### Major
Regularly relevant, visible, or behaviorally significant.

#### Core
Central to identity, motivation, or narrative role.

## Trait Block Rules

A trait block may be:
- a single trait
- a grouped set of related traits

This avoids over-fragmenting fiction details.

### Trait Block Fields
- `trait`
- `description`
- `influence`
- `ai_usage_example`
- `notes` (optional)

### Example

```md
- trait: observant, punctual, eloquent
  description: She is the textbook example of someone always on time and has her things together.
  influence: core
  ai_usage_example: AI should reflect this through precise dialogue, orderly behavior, and strong situational awareness.
  notes: More behavioral than self-descriptive.
```

## AI Usage Example Rules

### Generation
- always AI-generated from the trait entry
- generated on demand only
- written into the Markdown file field for that trait block
- editable by the writer

### Purpose
This helps the writer understand how AI is likely to use the trait in downstream prompts and suggestions.

## AI Summary Behavior

### Section Summaries
Generated per section on demand only.

### Full Profile Summary
Generated on demand only.

For character profiles, the full summary should:
- use multiple paragraphs
- synthesize all sections
- reflect weighted trait influence
- include relationship context if connected
- read as a seamless AI recap of the character

### Important Summary Rule
AI summaries should be stored in dedicated Markdown sections like:
- `## AI Summary: Personality Traits`
- `# Full AI Summary`

These sections are editable by the writer.

## Notes Behavior

Notes are:
- supporting clarification
- background context
- not influence-weighted in MVP

## Profile Import and Fork

### MVP Rule
- import character only
- fully independent copy
- editable in the new story
- no sync to original
- no relationship auto-import

## Example Character Profile Template

```md
---
type: character
profile_id: uuid
name: Elara Voss
role: protagonist
status: active
tags:
  - strategist
  - guarded
  - grief
created_at: ISO_DATETIME
updated_at: ISO_DATETIME
---

# Overview
Full human-readable overview here.

## AI Summary: Overview
Generated on demand. Editable by user.

# Physical Traits
- trait: freckles
  description: Light freckles across the nose and cheeks.
  influence: minor
  ai_usage_example: AI should treat this as a subtle visual detail, not a repeated headline trait.
  notes: Only noticeable up close.

## AI Summary: Physical Traits
Generated on demand. Editable by user.

# Personality Traits
- trait: observant, punctual, eloquent
  description: She is always on time, composed, and verbally precise.
  influence: core
  ai_usage_example: AI should reflect this through deliberate choices, polished speech, and reliability.

- trait: embarrassed easily, insecure about her looks, trouble talking to men
  description: She becomes flustered around attractive or high-status men and is sensitive about appearance.
  influence: major
  ai_usage_example: AI may show this through hesitation, avoidance, awkward phrasing, or visible discomfort when context supports it.

## AI Summary: Personality Traits
Generated on demand. Editable by user.

# Hidden and Foreshadowing Traits
- trait: unresolved trauma linked to hospitals
  description: She has buried trauma related to a past hospital event.
  influence: foreshadowing
  ai_usage_example: AI may show unease, irritability, withdrawal, or sharp reactions around sterile medical environments without directly explaining the cause.

## AI Summary: Hidden and Foreshadowing Traits
Generated on demand. Editable by user.

# Motivations
- trait: uncover the truth about her brother
  description: Her main emotional and narrative driver.
  influence: core
  ai_usage_example: AI should treat this as a major driver of decisions, conflict, and emotional focus.

## AI Summary: Motivations
Generated on demand. Editable by user.

# Voice Notes
- trait: precise speech, restrained emotion
  description: She speaks carefully and rarely exaggerates.
  influence: major
  ai_usage_example: AI should avoid overly dramatic or rambling dialogue unless she is under unusual emotional pressure.

## AI Summary: Voice Notes
Generated on demand. Editable by user.

# Relationships Overview
Human-readable relationship notes here.

## AI Summary: Relationships Overview
Generated on demand. Editable by user.

# Full AI Summary
Generated on demand. Editable by user.

# Notes
Additional background and clarifying notes here.
```
