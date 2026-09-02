// features/audiobook/AudiobookConverter.tsx
// ==========================================
// Top-level screen for the Audiobook Converter: owns which sub-screen is
// showing (dashboard -> import wizard -> workspace) and carries the jewel-
// tone charcoal theme wrapper (spec 5.0). Entirely separate from writing
// projects -- reached from the main Project Home, never from inside a
// writing project.

import { useCallback, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AudiobookDashboard } from "./AudiobookDashboard";
import { ImportPanel } from "./ImportPanel";
import { WorkspaceView } from "./WorkspaceView";
import type { AudiobookProjectPayload } from "./types";
import { useAudiobookTheme } from "../theme/useAudiobookTheme";

interface AudiobookConverterProps {
  /** Leave the converter, back to the Storythread Project Home. */
  onExit: () => void;
}

type ConverterScreen = "dashboard" | "import" | "workspace";

export function AudiobookConverter({ onExit }: AudiobookConverterProps) {
  const [screen, setScreen] = useState<ConverterScreen>("dashboard");
  const [workspacePayload, setWorkspacePayload] = useState<AudiobookProjectPayload | null>(null);

  const openWorkspace = useCallback((payload: AudiobookProjectPayload) => {
    setWorkspacePayload(payload);
    setScreen("workspace");
  }, []);

  const backToDashboard = useCallback(() => {
    setWorkspacePayload(null);
    setScreen("dashboard");
  }, []);

  // The Converter's own Dark / Light / Custom. Independent of the writing
  // app's theme on purpose -- see useAudiobookTheme.ts.
  const { attr: abTheme, style: abStyle } = useAudiobookTheme();

  return (
    // The scoped theme root, and the boundary the writing app's palette stops
    // at. `data-ab-theme` selects the paper half in App.css; the inline style
    // carries a custom palette, which has to be applied HERE rather than on
    // <html> because this element declares its own --st-* and an element's own
    // declaration beats an inherited one. That is the same mechanism that
    // keeps the Converter charcoal while the writing app goes light.
    <div
      className="audiobook-theme flex h-screen flex-col overflow-hidden bg-bg-primary text-text-primary"
      data-ab-theme={abTheme}
      style={abStyle}
    >
      {/* Slim top strip: the way home is always visible on the dashboard. */}
      {screen === "dashboard" && (
        <div className="flex shrink-0 items-center border-b border-border px-4 py-2">
          <button
            onClick={onExit}
            className="inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-accent"
          >
            <ArrowLeft size={12} /> Storythread Studio
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {screen === "dashboard" && (
          <AudiobookDashboard
            onNewAudiobook={() => setScreen("import")}
            onOpenWorkspace={openWorkspace}
          />
        )}
        {screen === "import" && (
          <ImportPanel
            onBack={backToDashboard}
            onImported={openWorkspace}
          />
        )}
        {screen === "workspace" && workspacePayload && (
          <WorkspaceView
            payload={workspacePayload}
            onBack={backToDashboard}
          />
        )}
      </div>
    </div>
  );
}
