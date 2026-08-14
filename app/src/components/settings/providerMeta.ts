// components/settings/providerMeta.ts -- Frontend provider registry
// ===================================================================
// The UI half of the AI provider system. The backend half is
// backend/app/ai/providers.py (ProviderConfig); this file describes how each
// connection PRESENTS itself in Settings: its own card, its own tailored
// "How to connect" instructions, and which generic controls apply to it.
//
// Adding a future provider = one entry here + one ProviderConfig in the
// backend. The ProviderPanel component renders whatever this meta describes,
// so each connection gets a distinct, self-documenting panel without new
// layout code.
//
// Planned future entries (see docs/research-multi-provider.md) -- NOT built:
//   - custom: any OpenAI-compatible URL, deliberately separate from "local".
//     Every local runtime speaks the same API as a hosted one, so without
//     that separation the local entry would quietly become a way to connect
//     any remote service with no key field and no cost warning. The backend
//     enforces the split by refusing non-local addresses -- see
//     backend/app/ai/local_endpoint.py.

export interface ProviderMeta {
  id: string;             // Matches the backend ProviderConfig.key + settings ai_provider
  label: string;          // Card + panel title
  tagline: string;        // One line under the label on the selector card
  docsUrl: string;        // Where keys/accounts live -- shown in instructions
  instructions: string[]; // Tailored "How to connect" steps, one per line
  keyPlaceholder: string; // Input placeholder hinting at the key's shape
  requiresKey: boolean;   // false (future local providers) hides the key field
  supportsTiers: boolean; // false hides the cost-tier slider (no pricing data)
  supportsCaching: boolean; // true renders the Prompt Caching toggle in the panel
  note?: string;          // Optional provider-specific caveat shown in the panel
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    tagline: "One key, hundreds of models -- the recommended default",
    docsUrl: "openrouter.ai",
    instructions: [
      "Create a free account at openrouter.ai and open Keys.",
      "Create an API key and add a few dollars of credit (many models are free).",
      "Paste the key below, then Test Connection to load the model list.",
    ],
    keyPlaceholder: "sk-or-v1-...",
    requiresKey: true,
    supportsTiers: true,
    supportsCaching: true,
  },
  {
    id: "nanogpt",
    label: "NanoGPT",
    tagline: "Pay-per-prompt access with many unmoderated models",
    docsUrl: "nano-gpt.com",
    instructions: [
      "Create an account at nano-gpt.com and add funds (pay-per-prompt, no subscription).",
      "Copy your API key from the account page.",
      "Paste the key below, then Test Connection to load the model list.",
      "Good pairing for Mature/Explicit content modes -- much of the catalog is unmoderated.",
    ],
    keyPlaceholder: "Your NanoGPT API key",
    requiresKey: true,
    supportsTiers: false,
    supportsCaching: false,
    note: "NanoGPT does not publish pricing or moderation data -- the cost-tier "
        + "filter is unavailable and all models are shown.",
  },
  {
    id: "local",
    label: "Local model",
    tagline: "Runs on your own machine -- no key, no cost, nothing leaves the room",
    docsUrl: "ollama.com",
    instructions: [
      "Install Ollama (ollama.com) or LM Studio, then start it.",
      "Pull at least one model -- for example: ollama pull llama3",
      "Enter its address below (usually http://localhost:11434) and pick the API style.",
      "Test Connection to load the list of models you have downloaded.",
    ],
    keyPlaceholder: "",
    requiresKey: false,
    supportsTiers: false,
    supportsCaching: false,
    note: "Only addresses on your own machine or local network are accepted. "
        + "Local reasoning models can be noticeably slower than hosted ones, and "
        + "their quality varies a lot by model -- a good pairing for Prose or "
        + "experimenting, less so for critique.",
  },
];

export function providerMetaById(id: string): ProviderMeta {
  return PROVIDER_META.find(p => p.id === id) ?? PROVIDER_META[0];
}
