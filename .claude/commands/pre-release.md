---
description: Run the pre-release verification suite — pytest, vitest, GitHub blocker check, manual smoke acknowledgment, final report.
---

# /pre-release

Run the four verification stages below in order. **Stop at the first blocking failure.** Produce the final report in the exact format at the bottom.

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
- **Fail:** exit code non-zero, or pytest reports any failure. Report the failure(s), stop, and skip Stages 2-4. Set Stage 1 to ❌ in the final report.

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
- **Fail:** one or more open issues. List each by number and title (e.g. `#42 — Smart Advisor pass crashes on empty selection`). Stop here; do NOT proceed to manual smoke acknowledgment or the final verdict.

If the `pre-release-blocker` label does not exist on the repo, treat that as zero open issues (the label gets created on demand the first time someone uses it).

## Stage 4 — Manual smoke acknowledgment

Ask the user verbatim:

> Have you walked through every scenario in `tests/manual-smoke.md` against the build you intend to release? Reply **`yes`** to acknowledge, **`no`** to defer, or paste a `qa-automation` issue link if any scenario failed.

- **`yes`** → mark acknowledged, proceed to Stage 5.
- **`no`** → stop. Final verdict is `DO NOT RELEASE` with "manual smoke not acknowledged".
- **An issue link or anything else** → stop. Final verdict is `DO NOT RELEASE`; treat the manual smoke as failed.

Do not try to run `tests/manual-smoke.md` yourself. It is human-only by design — it covers Tauri shell flows (file dialogs, the updater, the sidecar lifecycle) that no automated runner can reach today.

---

## Stage 5 — Final report

Print exactly this block, with real numbers and today's date filled in:

```
PRE-RELEASE REPORT — <YYYY-MM-DD>
Backend  (pytest):              ✅/❌  <passed>/<total>
Frontend (vitest):              ✅/❌  <passed>/<total>
Blockers (pre-release-blocker): ✅/❌  <open count>
Manual smoke:                   ✅/❌  <acknowledged | not acknowledged>
VERDICT: ✅ RELEASE READY   or   ❌ DO NOT RELEASE
```

Rules for VERDICT:
- `✅ RELEASE READY` if and only if all four lines show ✅.
- `❌ DO NOT RELEASE` otherwise. Include a one-line reason ("backend tests failed", "open pre-release-blocker issues: #42, #51", "manual smoke not acknowledged", etc.).

If you stopped early in Stages 1-4, the lines for stages you didn't reach should still appear in the report with a `—` for the count (e.g. `Frontend (vitest): —  not run`), so the user can see at a glance how far the pipeline got.
