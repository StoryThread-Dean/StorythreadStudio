## Project Plan: Custom Creative Fiction Writing App (OpenRouter API)## 
## Phase 7: UI & Advanced Filtering Logic ##
This phase focuses on the "Smart Settings" menu to curate a professional writing environment and manage costs.
## 7.1 Model Visibility & Price Tiering (Slider)
Implement a 4-step logic for the Model Selection Slider:

* Step 1: Free -> Only models with 0.00 price are active. All others are greyed out (opacity: 0.5; pointer-events: none;).
* Step 2: Lowest (Free > Floor) -> Models with :floor suffix or 0.00 price are active.
* Step 3: Include Pricier -> All writing-capable models are active.
* Step 4: Priority Best -> Auto-selects and highlights "Flagship" models (Claude 3.5 Sonnet, GPT-4o) for maximum prose quality.

## 7.2 Media & Capability Suppression (Initial Filter)
Hardcode filters to ensure the app stays strictly text-focused:

* Filter 1: No Visuals -> Programmatically exclude any Model ID that supports image or video output modalities.
* Filter 2: Writing Categories -> Automatically fetch and display only models tagged with creative-writing or roleplay.

## 7.3 Content & Writing Specific Toggles

* Checkbox [Explicit Material Included]: When checked, the API logic whitelists unfiltered models (e.g., Trinity, Airoboros) in the selection list.
* Recommended Writing Models Section: A pinned UI block at the top of the selection menu featuring:
* Qwen3-235B: Best for world-building.
   * DeepSeek-V3: Best for reasoning/logic + low cost.
   * Claude 3.5 Sonnet: Best for human-tier prose.

## Phase 8: Context & Performance Optimization
Optimizing the app for 20K–60K word short stories and novel drafting.
## 8.1 Advanced API Communication

* Toggle: Prompt Caching: Enable headers for OpenRouter's Caching. This targets your .md files (Profiles, Lore, Style Guides) to prevent re-paying for static context in every prompt.
* Toggle: Reasoning Control: Specifically for DeepSeek-V3; includes include_reasoning: true to reveal the AI's "Plot Logic" before the prose.
* Toggle: Streaming: Implements SSE (Server-Sent Events) for real-time, character-by-character generation.

## 8.2 The "Story Bible" Context Strategy
Since the user utilizes modular .md files:

* Context Truncation Logic: If the token limit is reached, the app will prioritize keeping Outline.md and Style Guide.md pinned, while truncating older scene text.
* Summary Injection: Automatically swap full chapter text for the contents of Summaries(Chapter).md as the story grows beyond the model's 128k context window.




