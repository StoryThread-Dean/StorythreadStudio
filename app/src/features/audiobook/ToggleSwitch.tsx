// features/audiobook/ToggleSwitch.tsx
// ===================================
// A real switch, not a checkbox. Used where a setting reads as a MODE the
// writer turns on rather than a box they tick -- the Draft/Testing pass,
// and borrowing the writing API keys.
//
// The look carries the state on purpose (a live-testing request): OFF is
// faded and quiet, ON is bright, so a glance at the rail answers "am I
// drafting or am I doing this properly?" without reading a word.

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** A quiet second line under the label. */
  hint?: string;
  disabled?: boolean;
  /** The lit color when on. Amber = a testing/degraded mode, violet =
      something premium, emerald = a normal good-path setting. */
  tone?: "amber" | "violet" | "emerald";
}

const TONES = {
  amber:   { track: "bg-warn-fill", text: "text-warn-strong" },
  violet:  { track: "bg-weave-fill", text: "text-weave-strong" },
  emerald: { track: "bg-accent-fill", text: "text-accent-strong" },
} as const;

export function ToggleSwitch({
  checked, onChange, label, hint, disabled = false, tone = "amber",
}: ToggleSwitchProps) {
  const lit = TONES[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={"flex w-full items-start gap-2.5 rounded px-1 py-1 text-left transition-opacity "
        + (disabled ? "cursor-not-allowed opacity-40"
          : checked ? "opacity-100" : "opacity-60 hover:opacity-90")}
    >
      {/* The track. A plain span, not an input: the whole row is the hit
          target, which is kinder than a 12px checkbox. */}
      <span
        aria-hidden
        className={"mt-0.5 flex h-4 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors "
          + (checked ? lit.track : "bg-bg-raised")}
      >
        <span
          className={"h-3 w-3 rounded-full bg-white shadow transition-transform "
            + (checked ? "translate-x-4" : "translate-x-0")}
        />
      </span>
      <span className="min-w-0">
        <span className={"block text-mini font-medium transition-colors "
          + (checked ? lit.text : "text-text-muted")}>
          {label}
        </span>
        {hint && (
          <span className="block text-micro leading-relaxed text-faint">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
