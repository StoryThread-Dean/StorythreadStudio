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

  return (
    // The scoped theme root: dark charcoal base, jewel accents inside.
    // The writing app's palette is untouched -- this class is the boundary.
    <div className="audiobook-theme flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Slim top strip: the way home is always visible on the dashboard. */}
      {screen === "dashboard" && (
        <div className="flex shrink-0 items-center border-b border-zinc-800 px-4 py-2">
          <button
            onClick={onExit}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-emerald-300"
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
