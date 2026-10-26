// types/structure.ts -- Acts & Chapter Order (manuscript/structure.json)
// ========================================================================
// Mirrors backend/app/routers/structure.py response shapes.
//
// The manifest is the manuscript's READING ORDER authority: front matter, then
// acts in listed order with each act's chapters in listed order, then the
// unassigned bucket, then back matter.
// Chapters are referenced by filename (the stable identity everything else
// -- summaries, progress, exports -- is keyed on). Titles are display-only
// decorations the backend derives from each chapter's first # heading.

export interface ChapterRef {
  filename: string;
  title:    string;
}

export interface ActInfo {
  id:       string;        // stable "a-xxxxxxxx" id -- collapse state keys on it
  title:    string;
  chapters: ChapterRef[];
}

export interface StructureManifest {
  // false = synthesized view (project has no structure.json yet). The
  // sidebar still renders it the same way; the flag just tells us nothing
  // is stored on disk until the first mutation.
  exists:     boolean;
  /** A prologue. Before every act, outside the act structure, not counted as
   *  a chapter. Read-only from the tree's point of view -- see the note on
   *  PutStructurePayload. */
  front:      ChapterRef[];
  acts:       ActInfo[];
  unassigned: ChapterRef[];
  /** An epilogue. After everything else, on the same terms as `front`. */
  back:       ChapterRef[];
}

// What PUT /api/structure accepts: bare filename lists (titles are derived
// data, never sent back).
//
// NO front OR back. This payload is the acts tree, which is what the writer
// drags things around in, and front matter is not in that tree: a prologue's
// position is the one thing about it that is not up for rearrangement. The
// backend carries them across from what is stored, exactly as it does chapter
// ids -- so a reorder cannot demote the writer's prologue to an unfiled
// chapter, which is what would happen if this payload were the whole truth.
export interface PutStructurePayload {
  folder_path: string;
  acts:        { id?: string; title: string; chapters: string[] }[];
  unassigned:  string[];
}

// Convenience: rebuild a PUT payload from a manifest the UI holds.
export function toPutPayload(folderPath: string, m: StructureManifest): PutStructurePayload {
  return {
    folder_path: folderPath,
    acts: m.acts.map(a => ({
      id: a.id,
      title: a.title,
      chapters: a.chapters.map(c => c.filename),
    })),
    unassigned: m.unassigned.map(c => c.filename),
  };
}
