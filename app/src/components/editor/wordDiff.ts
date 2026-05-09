// components/editor/wordDiff.ts -- Word-level diff for issue suggestions
// =========================================================================
// Produces an interleaved list of "kept" / "added" / "removed" segments
// describing how a suggestion differs from the original quote. The result
// is rendered inline in the suggestion blockquote so writers can see at a
// glance which words the AI changed -- useful for tiny tweaks (one inserted
// article) and for big rewrites (lots of red strikethrough next to lots of
// green added text).
//
// Algorithm: word-level Longest Common Subsequence (LCS). Tokenize both
// strings into "words" (preserving whitespace and punctuation as their own
// tokens so the rendered output reads like the original text), build the
// LCS DP table, walk it back to produce a sequence of equal/insert/delete
// operations, then merge consecutive same-type operations into one segment.
//
// Why not bring in a dep like `diff` or `jsdiff`? The codebase deliberately
// keeps third-party JS minimal (see CLAUDE.md). This implementation is ~80
// lines and handles every realistic suggestion length without trouble.

export type DiffSegmentType = "kept" | "added" | "removed";

export interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}


// Tokenize a string into "words" while keeping whitespace and punctuation
// as their own tokens. We DON'T merge runs of whitespace because that
// would make the rendered output drift from the source. The split regex
// matches:
//   - any run of letters/digits/underscore + optional apostrophes inside
//   - any single non-alphanumeric character (including each whitespace char)
// This produces tokens like ["The", " ", "departure", " ", "of", " ", "..."]
function tokenize(s: string): string[] {
  // Empty string yields no tokens; the diff handles that case naturally.
  if (!s) return [];
  const tokens: string[] = [];
  // Word characters allow internal apostrophes for contractions: don't, it's.
  const re = /[A-Za-z0-9_]+(?:'[A-Za-z0-9_]+)*|[\s\S]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}


// Build a Longest Common Subsequence table. dp[i][j] = length of the LCS
// of a[0..i) and b[0..j). Standard O(n*m) DP. For our token counts (a few
// dozen to a few hundred per suggestion) this is fine; no need for the
// linear-space variant.
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  // (n+1) x (m+1) zero-initialized.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }
  return dp;
}


// Walk the LCS table backwards to produce per-token operations. The
// returned list is in source order (front to back). Each element is one
// token plus its operation: "equal" (in both), "del" (only in a, removed),
// "ins" (only in b, added).
function buildOps(a: string[], b: string[], dp: number[][]): { op: "equal" | "del" | "ins"; tok: string }[] {
  const ops: { op: "equal" | "del" | "ins"; tok: string }[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ op: "equal", tok: a[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // Token from a is not in the LCS -> it was removed.
      ops.push({ op: "del", tok: a[i - 1] });
      i--;
    } else {
      // Token from b is not in the LCS -> it was added.
      ops.push({ op: "ins", tok: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ op: "del", tok: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ op: "ins", tok: b[j - 1] }); j--; }
  ops.reverse();
  return ops;
}


// Public API: produce a list of inline segments describing the diff.
// Segments interleave in original-rendering order so the consumer can
// concatenate them visually:
//   [kept "The departure of "][removed "Huffington's "][kept "Heroes "]...
// Adjacent ops of the same kind are merged into one segment so spans
// don't get fragmented in the DOM.
export function wordDiff(original: string, modified: string): DiffSegment[] {
  // Cheap fast-path: identical strings produce one "kept" segment.
  if (original === modified) {
    return modified ? [{ type: "kept", text: modified }] : [];
  }

  const a = tokenize(original);
  const b = tokenize(modified);
  const dp = lcsTable(a, b);
  const ops = buildOps(a, b, dp);

  // Merge adjacent ops of the same kind. We map "equal" -> kept,
  // "del" -> removed, "ins" -> added.
  const segments: DiffSegment[] = [];
  for (const { op, tok } of ops) {
    const type: DiffSegmentType =
      op === "equal" ? "kept" : op === "ins" ? "added" : "removed";
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.text += tok;
    } else {
      segments.push({ type, text: tok });
    }
  }
  return segments;
}
