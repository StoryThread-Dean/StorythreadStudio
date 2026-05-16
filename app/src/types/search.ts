// types/search.ts -- TypeScript types for the Global Search + Replace feature.
// Mirrors the Pydantic models in backend/app/routers/search.py.

export interface MatchHit {
  line:           number;   // 1-based line number in the file
  col:            number;   // 0-based column within that line
  match_length:   number;   // character length of the matched text
  context_before: string;   // line before the match (empty if first line)
  context_match:  string;   // the full line containing the match
  context_after:  string;   // line after the match (empty if last line)
}

export interface FileMatches {
  file_relpath: string;
  count:        number;
  hits:         MatchHit[];
}

export interface FindResponse {
  matches:    FileMatches[];
  total_hits: number;
}

export interface ReplaceSelection {
  file_relpath: string;
  hit_indices:  number[];   // 0-based indices of hits to replace in this file
}

export interface ReplaceResponse {
  snapshot_dir:      string;
  files_modified:    number;
  replacements_made: number;
}

export interface RestoreResponse {
  files_restored: number;
}
