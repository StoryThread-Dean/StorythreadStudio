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
//   - local: Ollama / LM Studio / llama.cpp. requiresKey: false (no key
//     field rendered), plus a runtime-preset dropdown and an editable base
//     URL field, and a live-reply connection test ("Reply with exactly this
//     text: ..."). Include a hint that local reasoning models respond slower.
//   - custom: any OpenAI-compatible URL. requiresKey optional.

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
];

export function providerMetaById(id: string): ProviderMeta {
  return PROVIDER_META.find(p => p.id === id) ?? PROVIDER_META[0];
}
