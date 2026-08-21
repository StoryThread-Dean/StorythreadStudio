// features/audiobook/NarrationKeysSection.tsx
// ===========================================
// Which account narration is allowed to spend from.
//
// The default is to BORROW the writing side's key: one key, nothing extra
// to set up, and usually the same account anyway. A writer who wants them
// apart -- a top-tier drafting model on one account, cheap narration on
// another -- turns borrowing off and fills these in. When they do, the
// writing key is deliberately NOT used as a fallback: quietly billing the
// wrong account is worse than refusing to narrate.
//
// Key handling follows the writing app's rules exactly: the stored key is
// only ever shown masked, the input starts blank, and a masked value is
// never sent back (it would be stored verbatim as the key).

import { Eye, EyeOff } from "lucide-react";

import { ToggleSwitch } from "./ToggleSwitch";
import type { AudiobookSettings } from "./api";

interface NarrationKeysSectionProps {
  settings: AudiobookSettings;
  keyInputs: { openrouter: string; nanogpt: string };
  showKey: boolean;
  onKeyInput: (provider: "openrouter" | "nanogpt", value: string) => void;
  onToggleShowKey: () => void;
  onUseWritingKeysChange: (next: boolean) => void;
  onClearKey: (provider: "openrouter" | "nanogpt") => void;
}

const PROVIDERS = [
  { id: "openrouter" as const, label: "OpenRouter", hint: "openrouter.ai" },
  { id: "nanogpt" as const, label: "NanoGPT", hint: "nano-gpt.com" },
];

export function NarrationKeysSection({
  settings, keyInputs, showKey, onKeyInput, onToggleShowKey,
  onUseWritingKeysChange, onClearKey,
}: NarrationKeysSectionProps) {
  return (
    <section>
      <h3 className="mb-1 border-b border-zinc-800 pb-2 text-mini font-semibold uppercase tracking-wider text-zinc-500">
        Narration API Keys
      </h3>

      <div className="mt-2">
        <ToggleSwitch
          checked={settings.use_writing_keys}
          onChange={onUseWritingKeysChange}
          tone="emerald"
          label="Use my writing API keys for narration"
          hint="One key for everything. Turn this off to give the audiobook its own account."
        />
      </div>

      {settings.use_writing_keys ? (
        <div className="mt-2 space-y-1 rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
          <p className="text-micro leading-relaxed text-zinc-400">
            Narration borrows whichever key the engine needs from your
            writing settings.
          </p>
          {PROVIDERS.map(provider => {
            const connected = provider.id === "openrouter"
              ? settings.writing_openrouter_key_set
              : settings.writing_nanogpt_key_set;
            return (
              <p key={provider.id} className="text-micro">
                <span className="text-zinc-300">{provider.label}: </span>
                {connected
                  ? <span className="text-emerald-400">writing key connected</span>
                  : <span className="text-amber-400">
                      no writing key saved yet -- add one in the main Settings,
                      or give narration its own below
                    </span>}
              </p>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-micro leading-relaxed text-zinc-400">
            Narration will use only the keys below. Your writing key is
            deliberately not a fallback, so a narration run can never
            spend from the wrong account.
          </p>
          {PROVIDERS.map(provider => {
            const masked = provider.id === "openrouter"
              ? settings.openrouter_api_key : settings.nanogpt_api_key;
            const isSet = provider.id === "openrouter"
              ? settings.openrouter_api_key_set : settings.nanogpt_api_key_set;
            return (
              <div key={provider.id}>
                <label
                  className="mb-1 block text-micro font-medium text-zinc-300"
                  htmlFor={`audiobook-key-${provider.id}`}
                >
                  {provider.label} key for narration
                </label>
                <p className="mb-1 text-micro text-zinc-500">
                  {isSet
                    ? `Current key: ${masked} -- enter a new key to replace it`
                    : `No key saved. Get one at ${provider.hint}`}
                </p>
                <div className="relative">
                  <input
                    id={`audiobook-key-${provider.id}`}
                    type={showKey ? "text" : "password"}
                    value={keyInputs[provider.id]}
                    onChange={e => onKeyInput(provider.id, e.target.value)}
                    placeholder={`Paste your ${provider.label} key`}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 pr-8 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={onToggleShowKey}
                    aria-label={showKey ? "Hide keys" : "Show keys"}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
                  >
                    {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                {isSet && (
                  <button
                    type="button"
                    onClick={() => onClearKey(provider.id)}
                    className="mt-1 text-micro text-rose-400 hover:text-rose-300 hover:underline"
                  >
                    Remove this key
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
