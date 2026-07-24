// components/settings/ProviderPanel.tsx -- One AI connection's own panel
// ========================================================================
// Renders the dedicated configuration panel for whichever provider card is
// selected in Settings: that provider's tailored "How to connect" steps, its
// key field + Test Connection button, any provider-specific note, and a
// "save to switch" hint when the selection differs from the saved provider.
//
// The panel is meta-driven (see providerMeta.ts): every connection gets a
// distinct panel without new layout code. Anything truly provider-unique
// that isn't describable as meta (like OpenRouter's Prompt Caching toggle)
// is passed in through `children` and rendered at the bottom of the panel.

import { Eye, EyeOff, CheckCircle, XCircle, Loader } from "lucide-react";
import type { ReactNode } from "react";
import type { ProviderMeta } from "./providerMeta";

interface ProviderPanelProps {
  meta: ProviderMeta;
  // True when this provider is the SAVED active provider (requests go here).
  isActive: boolean;
  // Masked saved key ("sk-or-...xyz" or "") + whether one is stored at all.
  savedKeyMasked: string;
  savedKeySet: boolean;
  // Controlled key input owned by Settings (one input state per provider,
  // so switching cards never mixes keys up).
  keyInput: string;
  onKeyInputChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  // Test Connection wiring.
  testing: boolean;
  saving: boolean;
  onTest: () => void;
  testResult: { ok: boolean; message: string } | null;
  // Extra provider-specific controls (e.g. the Prompt Caching toggle).
  children?: ReactNode;
}

export function ProviderPanel({
  meta, isActive, savedKeyMasked, savedKeySet,
  keyInput, onKeyInputChange, showKey, onToggleShowKey,
  testing, saving, onTest, testResult, children,
}: ProviderPanelProps) {
  return (
    <div className="rounded border border-border bg-bg-primary p-4" data-testid={`provider-panel-${meta.id}`}>

      {/* How to connect -- the per-provider tailored instructions */}
      <p className="mb-1 text-xs font-medium text-text-primary">
        How to connect to {meta.label}
      </p>
      <ol className="mb-4 list-decimal space-y-1 pl-4">
        {meta.instructions.map((step, i) => (
          <li key={i} className="text-xs text-text-muted">{step}</li>
        ))}
      </ol>

      {/* Key field -- hidden entirely for future keyless (local) providers */}
      {meta.requiresKey && (
        <div className="mb-2">
          <label className="mb-1 block text-xs font-medium text-text-primary">
            {meta.label} API Key
          </label>
          <p className="mb-2 text-xs text-faint">
            {savedKeySet
              ? `Current key: ${savedKeyMasked} -- enter a new key to replace it`
              : `No key saved. Get one at ${meta.docsUrl}`
            }
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={e => onKeyInputChange(e.target.value)}
                placeholder={meta.keyPlaceholder}
                className="w-full rounded border border-border bg-bg-surface px-3 py-2 pr-8 text-sm text-text-primary placeholder-faint outline-none focus:border-indigo-500"
              />
              <button
                onClick={onToggleShowKey}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-text-muted"
                title={showKey ? "Hide key" : "Show key"}
                type="button"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={onTest}
              disabled={testing || saving}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary disabled:opacity-50"
              title={`Test if the ${meta.label} API key works`}
            >
              {testing ? <Loader size={12} className="animate-spin" /> : null}
              Test
            </button>
          </div>
        </div>
      )}

      {/* Connection test outcome */}
      {testResult && (
        <div className={`mt-2 flex items-center gap-2 text-xs ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
          {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {testResult.message}
        </div>
      )}

      {/* Provider-specific caveat (e.g. NanoGPT's missing pricing data) */}
      {meta.note && (
        <p className="mt-3 text-xs text-faint">{meta.note}</p>
      )}

      {/* Selection differs from the saved provider -- nothing auto-switches;
          the writer saves explicitly and the model list reloads from the
          newly active provider. */}
      {!isActive && (
        <div className="mt-3 rounded border border-indigo-700/50 bg-indigo-950/30 px-3 py-2">
          <p className="text-xs text-indigo-300">
            Save to switch to {meta.label} and load its models.
          </p>
        </div>
      )}

      {/* Extra provider-unique controls (Prompt Caching toggle, etc.) */}
      {children}
    </div>
  );
}
