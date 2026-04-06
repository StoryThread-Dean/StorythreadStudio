# 04. AI Assistants and Routing

## AI Philosophy

AI should act as:
- reviewer
- editor
- analyzer
- context-aware brainstorming partner

AI should not become the primary story writer unless explicitly asked.

## Core AI Rules

- preserve author intent and voice
- prefer targeted suggestions over wholesale rewrites
- do not invent unsupported facts
- do not auto-save prose changes
- generated AI fields may be written to designated Markdown summary/example sections
- never use em dashes

## Assistant Categories

### Readability
- Logical
- Clarity and Consistency
- Eliminate Redundancy
- Grammar and Punctuation

### Structure and Content
- Project Fact and Accuracy Check
- Logical Flow
- Strengthen Conclusions
- Dialogue Authenticity
- Pacing Improvement
- POV Consistency
- Tone and Voice Consistency

### Advanced
- Character Development
- Descriptive Enhancement
- Theme and Message Enhancement
- Transitional Coherence

### Context and Continuity
- Character Consistency
- Relationship Continuity
- Location Consistency
- Lore Consistency
- Timeline Continuity
- Scene Goal Alignment

### Style Controls
- Readability Level Shift
- Formality Shift
- Descriptive Intensity
- Dialogue Compression
- Narrative Distance

## Scope Rules

Each assistant should declare its working scope:
- sentence
- paragraph
- selected text
- scene
- chapter
- attached context only

## Output Rules

### Default in the Writing Editor
- results shown in side panel
- copy only by default
- user manually applies changes

### Allowed Direct Markdown Writes
Only for explicit generation actions targeting designated AI fields:
- trait `ai_usage_example`
- profile section AI summary
- full profile AI summary
- chapter summary
- scene summary

## Content Modes

### Supported Modes
- general
- mature
- explicit

Project has a default content mode and requests may override it.

## Routing Architecture

### MVP Behavior
- one active user-selected model
- app built to support future multi-model routing

### Local Request Classification
Before sending a request, classify:
- assistant type
- content mode
- context size
- structured output requirement
- cost tier preference

### Candidate Model Filtering
Future routing should filter by:
- content compatibility
- structured output support
- context size
- allowlist and blocklist
- cost tier
- user settings

### Fallback Rule
If no eligible model exists for a request, do not silently degrade. Show a clear message instead.

## Adult Content Requirement

This is a first-class feature requirement.

The app must be built to support:
- different models for different content constraints
- explicit content aware routing
- user controlled model allowlists and blocklists
- future optimal model auto-selection by task and content type

## OpenRouter Integration Requirements

Use OpenRouter for:
- API key-based model access
- listing models
- task routing groundwork
- future task-specific model selection

## No Em Dash Enforcement

This rule must be enforced at three layers:

### 1. Prompt Layer
Every writing-related prompt must instruct the model never to use em dashes.

### 2. Output Sanitizer Layer
Post-process model output to detect and replace or reject em dashes.

### 3. Style Guide Layer
The project style guide should record that em dashes are never allowed.

## Standard Output Schemas

### Revision Response
```json
{
  "summary": "Brief explanation.",
  "suggestions": [
    {
      "label": "Option 1",
      "content": "Suggested text here"
    }
  ],
  "notes": [
    "Optional rationale"
  ]
}
```

### Analysis Response
```json
{
  "summary": "Brief findings summary.",
  "issues_found": [
    {
      "label": "POV drift",
      "severity": "medium",
      "excerpt": "..."
    }
  ],
  "suggestions": [
    {
      "label": "Fix",
      "content": "..."
    }
  ]
}
```

### Trait Example Response
```json
{
  "ai_usage_example": "Short example of how AI should use this trait in context."
}
```

### Summary Response
```json
{
  "section_summary": "Prompt-efficient section summary.",
  "full_summary": "Longer weighted synthesis for the whole profile."
}
```

## Suggested MVP Assistant Set

### First Wave
- Grammar and Punctuation
- Clarity and Consistency
- Eliminate Redundancy
- Descriptive Enhancement

### Second Wave
- Dialogue Authenticity
- POV Consistency
- Tone and Voice Consistency
- Character Development
- Character Consistency

### Later Wave
- Relationship Continuity
- Lore Consistency
- Timeline Continuity
- Scene Goal Alignment
- Readability Level Shift
