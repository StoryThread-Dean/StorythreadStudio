// types/progress.ts -- Writing Progress API contracts
// =====================================================
// Mirrors the Pydantic models in backend/app/routers/progress.py.
// Two endpoints feed the v1.0.2 Writing Progress feature:
//   GET /api/progress/summary  -> the project-completion gauge
//   GET /api/progress/daily    -> today's words/tasks + 7-day sparkline

export interface ManuscriptSummary {
  actual_words:   number;
  target_words:   number | null;
  chapter_count:  number;
  weight:         number;          // 0-100 contribution to overall gauge
}

export interface OutlineSummary {
  present:         boolean;
  has_frontmatter: boolean;
  weight:          number;
}

export interface ProfileSubsegment {
  name:            string;         // "characters" | "locations" | "lore" | "relationships"
  expected:        number;         // count from outline's expected_* list
  actual:          number;         // count of profile files in the subfolder
  matched_names:   string[];       // outline names that resolved to a profile
  unmatched_names: string[];       // outline names with no match in profile files
}

export interface ProfilesSummary {
  weight:      number;
  subsegments: ProfileSubsegment[];
}

export interface NotesSummary {
  present:    boolean;
  file_count: number;
  weight:     number;
}

export interface ProgressSummary {
  story_type:  string;
  is_serial:   boolean;            // serial_fiction projects render placeholder card
  percent:     number;             // overall computed gauge percentage (0-100)
  manuscript:  ManuscriptSummary;
  outline:     OutlineSummary;
  profiles:    ProfilesSummary;
  notes:       NotesSummary;
}

export interface TaskCreditEntry {
  file_relpath: string;
  reason:       "save" | "advisor_default" | "advisor_full_set";
}

export interface DailySparklineCell {
  local_date: string;              // YYYY-MM-DD
  words:      number;
  tasks:      number;
  hit:        boolean;             // both word_target AND task_target met
}

export interface ProgressDaily {
  skill_level:      string;
  word_target:      number;
  task_target:      number;
  rollover_hour:    number;        // 0 = midnight, 4 = night owl
  today_local_date: string;
  today_words:      number;
  today_tasks:      TaskCreditEntry[];
  sparkline_7day:   DailySparklineCell[];   // oldest first, ending today
}
