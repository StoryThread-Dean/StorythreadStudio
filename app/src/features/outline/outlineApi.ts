// outlineApi.ts -- the two endpoints the Outline toolbar needs
// =============================================================
// Both are free: no model is called, and neither writes anything. The
// worksheet one in particular RETURNS text rather than writing it, so what
// comes back lands in the editor buffer and one Ctrl+Z takes it away again.
// Its predecessor overwrote notes/outline.md on the server with no backup,
// which is why that one needed a two-step confirm and this one does not.
//
// The catalog text lives in Python and is fetched rather than duplicated
// here. codex/scan.py has to subtract those words from planned-name
// candidates, and it runs in the packaged backend where a path into this
// bundle may not exist -- a second copy would be the thing that drifts.

const API_BASE = "http://localhost:8000";

export interface OutlinePreset {
  id:         string;
  group:      string;
  label:      string;
  /** Exactly the H2 written into the file. The greying rule matches this. */
  heading:    string;
  /** The full Markdown appended when chosen: the H2, then the body. */
  markdown:   string;
  /** Per-character sections, which never grey out. */
  repeatable: boolean;
}

export interface OutlinePresetCatalog {
  groups:  string[];
  presets: OutlinePreset[];
}

export async function fetchOutlinePresets(): Promise<OutlinePresetCatalog> {
  const res = await fetch(`${API_BASE}/api/documents/outline/presets`);
  if (!res.ok) throw new Error(`Presets unavailable (${res.status})`);
  return res.json();
}

export async function fetchOutlineWorksheet(
  folderPath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `${API_BASE}/api/documents/outline/worksheet`
    + `?folder_path=${encodeURIComponent(folderPath)}`,
  );
  if (!res.ok) throw new Error(`Worksheet unavailable (${res.status})`);
  return res.json();
}
