// components/learn/WhatsThis.tsx
// ================================
// A small "What's this?" disclosure. The audiobook side explains itself a
// lot -- what a marker does, why a voice is or is not available, what a
// draft pass actually changes -- and some of those explanations are three
// sentences with real consequences. A native title= tooltip cannot carry
// that (and cannot be tested); this can.
//
// Same shape as the marker toolbar's help affordance: a quiet button that
// toggles a bordered hint box underneath.

import { useState } from "react";
import { HelpCircle } from "lucide-react";

interface WhatsThisProps {
  label?: string;
  children: React.ReactNode;
}

export function WhatsThis({ label = "What's this?", children }: WhatsThisProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="inline-flex shrink-0 items-center gap-1 rounded text-micro text-text-muted transition-colors hover:text-accent"
      >
        <HelpCircle size={11} /> {label}
      </button>
      {open && (
        <div className="mt-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-micro leading-relaxed text-text-primary">
          {children}
        </div>
      )}
    </>
  );
}
