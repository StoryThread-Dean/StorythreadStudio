---
description: Run the pre-release verification suite — pytest, vitest, GitHub blocker check, documentation check, manual smoke acknowledgment, final report.
---

# /pre-release

Run the five verification stages below in order. **Stop at the first blocking failure.** Produce the final report in the exact format at the bottom.

## Behavioral rules

- **Read-only.** Do not edit code, do not commit, do not "fix" failures during the run. If something breaks, you stop and report; the user decides what to do next.
- **No auto-retry on unit tests.** A flaky unit test is a bug to file, not a thing to retry through. If pytest or vitest fails, do not re-run.
- **No automatic issue filing during the run.** If a stage fails, report it and stop. The user decides whether to invoke the "When you find a regression" workflow (see CLAUDE.md) to file a `qa-automation` issue afterwards.
- **Guardrails still apply.** Never run tests against a non-local environment. Never skip a failing test to make the suite pass. Never auto-merge.

---

## Stage 1 — Backend tests (pytest)

Run the backend test suite:

```bash
cd backend && uv run pytest --no-header -q
```

- **Pass:** exit code 0, all collected tests passed.
- **Fail:** exit code non-zero, or pytest reports any failure. Report the failure(s), stop, and skip Stages 2-5. Set Stage 1 to ❌ in the final report.

If `pytest` reports "no tests collected" or the `backend/tests/` directory does not exist yet, treat this as a hard failure with a clear message ("Backend test infrastructure not in place — see CLAUDE.md `## Testing`"). Test infrastructure is a prerequisite; the pre-release gate cannot pass with no tests.

## Stage 2 — Frontend tests (vitest)

Run the frontend test suite in single-run mode:

```bash
cd app && npm run test -- --run
```

The `--run` flag tells vitest to execute once and exit. Without it, vitest defaults to watch mode and would hang this command indefinitely.

- **Pass:** exit code 0, all tests passed.
- **Fail:** exit code non-zero, or vitest reports any failure. Report and stop.

If `npm run test` is not registered in `app/package.json` or vitest is not installed, treat as a hard failure with the same message pattern ("Frontend test infrastructure not in place — see CLAUDE.md `## Testing`").

## Stage 3 — GitHub blocker check

Use the `github` MCP to list **open** issues in `StoryThread-Dean/StorythreadStudio` labelled `pre-release-blocker`.

- **Pass:** zero open issues with that label.
- **Fail:** one or more open issues. List each by number and title (e.g. `#42 — Smart Advisor pass crashes on empty selection`). Stop here; do NOT proceed to the documentation check, the manual smoke acknowledgment, or the final verdict.

If the `pre-release-blocker` label does not exist on the repo, treat that as zero open issues (the label gets created on demand the first time someone uses it).

## Stage 4 — Documentation check

**Read-only like every other stage: report, do not fix.** If docs need work, that is a finding, and the user decides whether to write them before cutting.

Work out what has shipped since the last release tag:

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

Then check each document below against that list. For each, report either the update it needs or `no change needed`:

| File | The question |
|---|---|
| `README.md` | Would a stranger learn these features exist? Are Requirements still true — providers, keys, disk space? |
| `docs/features.md` | Is the new behaviour described, and is anything it CHANGED still described the old way? |
| `docs/architecture.md` | New routes, folders, on-disk files, or changed resolution order? |
| `docs/product-scope.md` | Does anything here change what the product IS, or touch a locked rule? |
| `docs/roadmap.md` | Has what shipped been moved out of Scheduled? |
| The feature's own spec | Behaviour changes belong in the same commit as the spec change. Did they land there? |
| `CHANGELOG.md` | Is there an entry for every user-visible change? |
| `release-artifacts/vX.Y.Z-notes.md` | Does it exist, and is it short and plain-language? See the style rules in `docs/RELEASING.md`. |

- **Pass:** every row is either updated or a defensible `no change needed`.
- **Fail:** one or more documents describe behaviour the code no longer has, or a shipped feature appears in none of them. Report the specific gaps and stop.

**Why this is a gate and not a reminder.** Documentation drift raises no error and fails no test. By v2.0.1 the README did not mention the Weave at all — the headline feature of the previous major release — and `architecture.md` documented a model-roles level that had been deleted. Both had been wrong for weeks with a fully green suite. The writer had to ask for a doc update on every single release before this stage existed.

## Stage 5 — Manual smoke acknowledgment

Ask the user verbatim:

> Have you walked through every scenario in `tests/manual-smoke.md` against the build you intend to release? Reply **`yes`** to acknowledge, **`no`** to defer, or paste a `qa-automation` issue link if any scenario failed.

- **`yes`** → mark acknowledged, proceed to Stage 6.
- **`no`** → stop. Final verdict is `DO NOT RELEASE` with "manual smoke not acknowledged".
- **An issue link or anything else** → stop. Final verdict is `DO NOT RELEASE`; treat the manual smoke as failed.

Do not try to run `tests/manual-smoke.md` yourself. It is human-only by design — it covers Tauri shell flows (file dialogs, the updater, the sidecar lifecycle) that no automated runner can reach today.

---

## Stage 6 — Final report

Print exactly this block, with real numbers and today's date filled in:

```
PRE-RELEASE REPORT — <YYYY-MM-DD>
Backend  (pytest):              ✅/❌  <passed>/<total>
Frontend (vitest):              ✅/❌  <passed>/<total>
Blockers (pre-release-blocker): ✅/❌  <open count>
Documentation:                  ✅/❌  <up to date | gaps: ...>
Manual smoke:                   ✅/❌  <acknowledged | not acknowledged>
VERDICT: ✅ RELEASE READY   or   ❌ DO NOT RELEASE
```

Rules for VERDICT:
- `✅ RELEASE READY` if and only if all five lines show ✅.
- `❌ DO NOT RELEASE` otherwise. Include a one-line reason ("backend tests failed", "open pre-release-blocker issues: #42, #51", "README does not mention the Weave", "manual smoke not acknowledged", etc.).

If you stopped early in Stages 1-5, the lines for stages you didn't reach should still appear in the report with a `—` for the count (e.g. `Frontend (vitest): —  not run`), so the user can see at a glance how far the pipeline got.
