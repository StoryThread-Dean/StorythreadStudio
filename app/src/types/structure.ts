// types/structure.ts -- Acts & Chapter Order (manuscript/structure.json)
// ========================================================================
// Mirrors backend/app/routers/structure.py response shapes.
//
// The manifest is the manuscript's READING ORDER authority: acts in listed
// order, each act's chapters in listed order, then the unassigned bucket.
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
  acts:       ActInfo[];
  unassigned: ChapterRef[];
}

// What PUT /api/structure accepts: bare filename lists (titles are derived
// data, never sent back).
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
