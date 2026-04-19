// utils/dateFormat.ts -- Shared date formatting helpers
// =======================================================
// Centralized so every screen that shows a timestamp uses the same format.
// Today the only consumer is the Recent Projects list on the main menu;
// other places (settings, tooltips, etc.) can adopt this helper as they need
// to display dates.

/**
 * Format an ISO datetime string as `MM/DD/YYYY HH:MM am/pm`.
 *
 * Examples:
 *   formatDateTime12h("2026-04-19T15:30:45.123456+00:00") -> "04/19/2026 03:30 pm"
 *   formatDateTime12h("not a date") -> "" (silent fallback)
 *
 * The output is in the user's local timezone (Date parses ISO strings as UTC
 * and toString-style methods convert to local). This matches what writers
 * expect to see on a desktop app.
 *
 * Returns an empty string for missing or malformed input rather than throwing
 * so the caller can use the result directly in JSX without try/catch.
 */
export function formatDateTime12h(iso: string | null | undefined): string {
  if (!iso) return "";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();

  // 12-hour clock with am/pm suffix. Hour 0 -> 12 (midnight), 13 -> 1 (1pm),
  // etc. We compute hour % 12 and substitute 12 when the result is 0.
  const hours24 = d.getHours();
  const ampm    = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const hh      = String(hours12).padStart(2, "0");
  const mins    = String(d.getMinutes()).padStart(2, "0");

  return `${mm}/${dd}/${yyyy} ${hh}:${mins} ${ampm}`;
}
