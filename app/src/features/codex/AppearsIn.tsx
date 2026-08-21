// features/codex/AppearsIn.tsx -- which chapters this one is in
// ==============================================================
// Declared presence, edited from the entry itself.
//
// Reported after the map started greying absent entries: "I believe the only
// current way to add to and make changes to when a Profile ... pops up in Weave
// a Chapter. There needs to be a way to do this from the Profiles themselves."
//
// Right, and the omission was mine. The Weaving stop was built as the way to
// answer the question at scale, and a walk is a good place to ANSWER a question
// once. It is a bad place to CHANGE an answer later, because getting back to
// one stop means starting a pass and walking to it -- and the writer who wants
// to fix Serena's chapters is not doing a pass, they are looking at Serena.
//
// ONE COMPONENT, TWO HOMES, deliberately. This is mounted on the profile and on
// the map's entry panel. The writer's own framing of why: "the writer has
// access to features and functionality in more than one location. More than one
// way to do something." A second IMPLEMENTATION would be two vocabularies for
// one idea, which this app has been bitten by; a second MOUNT of one component
// is the thing they are asking for.

import { useEffect, useMemo, useState } from "react";
import { Loader, MapPin } from "lucide-react";

import { placeThread, type ChapterAnchor } from "./api";

interface Props {
  projectPath: string;
  entityId: string;
  /** What is recorded now. */
  appearsIn: string[];
  chapters: ChapterAnchor[];
  /** The entry's own name, for the sentence when nothing is recorded. */
  name?: string;
  onChanged?: (appearsIn: string[]) => void;
  /** Why this cannot be edited here, when it cannot. */
  unavailable?: string;
}

export function AppearsIn({
  projectPath, entityId, appearsIn, chapters, name, onChanged, unavailable,
}: Props) {
  const [ticked, setTicked] = useState<Set<string>>(new Set(appearsIn));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Reset when the entry changes underneath -- the map panel keeps this mounted
  // and swaps which entry it is showing.
  useEffect(() => { setTicked(new Set(appearsIn)); setSaved(false); },
            [entityId, appearsIn.join("|")]);

  const dirty = useMemo(() => {
    const before = new Set(appearsIn);
    return ticked.size !== before.size
      || [...ticked].some(a => !before.has(a));
  }, [ticked, appearsIn]);

  if (unavailable) {
    return (
      <p className="text-mini text-faint" data-testid="appears-in-unavailable">
        {unavailable}
      </p>
    );
  }

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = await placeThread(projectPath, entityId, [...ticked]);
      onChanged?.(body.appears_in);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="appears-in">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
        <MapPin size={12} className="text-accent" /> Where this appears
      </h4>

      <p className="mt-0.5 max-w-xl text-mini text-faint">
        {ticked.size === 0
          ? `Nothing recorded, so ${name ?? "this entry"} is treated as being `
            + "everywhere: it can go into any chapter's AI context and stays "
            + "lit on the map at every point in the story."
          : "Only these chapters. Elsewhere it is greyed on the map and left "
            + "out of what the app sends your AI -- unless you pin it, or your "
            + "writing names it."}
      </p>

      <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto"
          data-testid="appears-in-chapters">
        {chapters.map(chapter => (
          <li key={chapter.anchor}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-mini hover:bg-white/5">
              <input
                type="checkbox"
                checked={ticked.has(chapter.anchor)}
                onChange={() => setTicked(prev => {
                  const next = new Set(prev);
                  if (next.has(chapter.anchor)) next.delete(chapter.anchor);
                  else next.add(chapter.anchor);
                  return next;
                })}
              />
              <span className="truncate text-text-primary">{chapter.title}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {/* SAVED ON ITS OWN BUTTON, not with the profile.
            The rest of a profile is manual-save and this is not part of that
            buffer -- it goes through POST /place, which writes immediately.
            Hiding it behind the page's Save would mean one button doing two
            different things to two different files, and a writer who pressed
            Escape would lose one and keep the other. */}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !dirty}
          data-testid="appears-in-save"
          className="rounded bg-accent-fill px-2.5 py-1 text-mini font-semibold text-white hover:bg-accent-fill disabled:opacity-40"
        >
          {busy ? <Loader size={11} className="inline animate-spin" /> : null}
          {" "}Record {ticked.size} {ticked.size === 1 ? "chapter" : "chapters"}
        </button>
        {dirty && (
          <button type="button" onClick={() => setTicked(new Set(appearsIn))}
                  className="text-mini text-faint hover:text-text-muted">
            Undo
          </button>
        )}
        {!dirty && saved && (
          <span className="text-mini text-success"
                data-testid="appears-in-saved">
            Saved.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1 text-mini text-danger">{error}</p>
      )}
    </section>
  );
}
