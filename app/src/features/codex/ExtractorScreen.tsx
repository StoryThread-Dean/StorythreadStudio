// features/codex/ExtractorScreen.tsx -- Weaving | Profile Extractor
// ==================================================================
// The shell. Two states and one rule for choosing between them: if there is a
// saved extraction, show it; otherwise offer to make one.
//
// It opens on the SAVED RUN rather than the setup screen whenever one exists,
// and that is the whole point of the run being saved. A whole-manuscript pass
// on a long novel is a job rather than a sitting -- the writer's own words were
// that they might "do all in one go, or if its extremely large, might take
// multiple sessions". Landing them on "shall I read your book?" when they have
// forty proposals half-worked-through would invite them to buy the same thing
// twice.

import { useCallback, useEffect, useState } from "react";
import { Loader } from "lucide-react";

import { ExtractorReview } from "./ExtractorReview";
import { ExtractorSetup } from "./ExtractorSetup";
import {
  fetchCurrent,
  type ExtractionProgress, type ExtractionRun,
} from "./extractorApi";

interface Props {
  projectPath: string;
}

export function ExtractorScreen({ projectPath }: Props) {
  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [loading, setLoading] = useState(true);
  // The writer asking for the setup screen back while a run still exists.
  // Separate from "there is no run", because the run must not be discarded
  // just because they went to look at the options.
  const [startingOver, setStartingOver] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await fetchCurrent(projectPath);
      setRun(body.run);
      setProgress(body.progress);
    } catch {
      setRun(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Loader size={12} className="animate-spin" /> Looking for a saved read...
      </p>
    );
  }

  const showSetup = !run || startingOver;

  return (
    <div className="space-y-3">
      {/* The counts, whenever there is something to count. Kept in the shell so
          they survive switching between the two halves. */}
      {run && progress && !startingOver && (
        <p className="text-[11px] text-faint" data-testid="extractor-progress">
          {progress.parts_open} left to look at
          {progress.parts_applied > 0 && `, ${progress.parts_applied} added`}
          {progress.parts_dismissed > 0
            && `, ${progress.parts_dismissed} thrown away`}
          {progress.new_entries > 0
            && ` -- ${progress.new_entries} of these are not in your world yet`}
          .
        </p>
      )}

      {showSetup ? (
        <ExtractorSetup
          projectPath={projectPath}
          onExtracted={next => { setRun(next); setStartingOver(false); void load(); }}
          onOpenCurrent={run ? () => setStartingOver(false) : undefined}
        />
      ) : (
        <ExtractorReview
          projectPath={projectPath}
          run={run}
          onChanged={setProgress}
          onStartOver={() => setStartingOver(true)}
        />
      )}
    </div>
  );
}
