# HANDOFF — Test System Setup (paused 2026-05-15)

This is a temporary handoff note. Delete it once Step 6 is done and the
pre-release test system is fully operational.

## Context: what session-1 (work computer) accomplished

Two large pieces of work shipped this session:

### A. v1.0.2 Writing Progress feature — DONE
Three commits, in order:
1. `4605f2b` — backend foundation (outline frontmatter, SQLite store, save hooks)
2. `63dd0cc` — Smart Advisor logging + aggregation endpoints
3. `db8674b` — frontend gauge + Settings UI + CHANGELOG catchup

Full spec lives in `docs/roadmap.md` under **"Writing Progress Tracking — Detailed Spec (locked 2026-05-15)"**. If anything about this feature is unclear, that's the canonical reference — read it before touching the feature.

### B. Pre-release test system — STEPS 1-5 DONE, STEP 6 BLOCKED
This is the work that needs to continue on personal PC.

The user asked for a complete pre-release testing system following a 6-step plan. We **redirected** away from the original Playwright-driven E2E approach because Storythread Studio is a Tauri desktop app — Playwright can't drive the Tauri shell, and `localhost:1420` gives false coverage. The replacement design:

- **`/pre-release` gate = pytest + vitest + GitHub blocker check + manual smoke acknowledgment.**
- **Playwright MCP remains installed** for ad-hoc browser tasks, but is NOT part of the pre-release gate.
- **No "staging URL"** — this app has no remote deployment.

Full rationale lives in `CLAUDE.md` under **"## Testing"** and **"## Available MCP servers"**. Read both before doing anything testing-related.

## Test-system step status

| Step | Status | Where it lives |
|---|---|---|
| 1. Survey | ✅ Done | (session-1 conversation, summarized in CLAUDE.md `## Testing`) |
| 2. Add GitHub MCP | ✅ Installed at user scope | `~/.claude.json`. **Note:** registration succeeded on work PC but the MCP failed to connect because `GITHUB_PERSONAL_ACCESS_TOKEN` wasn't visible to the already-running Claude process. Restart fixes it. |
| 3. CLAUDE.md additions | ✅ Done | Two new sections in `CLAUDE.md`: `## Testing` and `## Available MCP servers`. Committed. |
| 4. Manual smoke checklist | ✅ Done | `tests/manual-smoke.md`. Six scenarios, all non-AI. Committed. |
| 5. `/pre-release` slash command | ✅ Done | `.claude/commands/pre-release.md`. Stops at first blocking failure; treats "no tests collected" as a hard failure to prevent vacuous green gates. Committed. |
| 6. Smoke-test the MCP setup | ⏳ BLOCKED — needs personal-PC restart | See "What's left" below. |

## What's left to do — pick up here on personal PC

### 1. Personal-PC environment setup (one-time)

a. **Install the MCPs on personal PC** — these are user-scoped, not in the repo:
   ```powershell
   claude mcp add playwright -- npx @playwright/mcp@latest
   claude mcp add github -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
   ```

b. **Set `GITHUB_PERSONAL_ACCESS_TOKEN` at User scope on personal PC**:
   ```powershell
   [Environment]::SetEnvironmentVariable("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_yourTokenHere", "User")
   ```
   Use the same classic PAT (`repo` scope) from work PC, or generate a fresh one at https://github.com/settings/tokens/new.

c. **Restart Claude Code fully** (quit + relaunch from a new shell so it inherits the new env var). Then `claude mcp list` should show both `playwright` and `github` as `✓ Connected`.

### 2. Step 6 — connectivity check

Once both MCPs are connected, the next Claude session should:
- Verify with `claude mcp list` and a `ToolSearch` for `browser_navigate` / `list_issues` that the tools are actually loaded into the session.
- Use the github MCP to fetch the 3 most recent issues from `StoryThread-Dean/StorythreadStudio` as a connectivity check.
- Use the playwright MCP to capture an accessibility snapshot of the repo's GitHub page (or any benign external URL — there is NO staging URL).
- Report results. Do NOT run the full `/pre-release` yet — user wants to review first.

### 3. Create the GitHub labels (after Step 6)

The `/pre-release` command references two labels that may not exist yet on the repo:
- `pre-release-blocker` — Stage 3 of `/pre-release` queries for open issues with this label.
- `qa-automation` — applied to regression issues filed via the github MCP.

Create both via the github MCP once it's connected, with a brief description each. Colors are user preference.

### 4. Stand up the actual test infrastructure ✅ DONE (2026-05-15)

- `backend/tests/` created with `conftest.py`, `test_outline_frontmatter.py` (11 tests),
  `test_progress_store.py` (14 tests), `test_progress_routes.py` (11 tests). 40 tests, all green.
  `pytest-asyncio>=0.24` added to dev deps; `asyncio_mode = "auto"` configured in `pyproject.toml`.
- `npm run test` registered in `app/package.json`. vitest + @testing-library/react + jsdom installed.
  `ProjectCompletionGauge.test.tsx` written (7 tests, all green).
  `/// <reference types="vitest" />` + test config block added to `vite.config.ts`.
- Both `/pre-release` stage commands now pass: `uv run pytest --no-header -q` (40/40) and
  `npm run test -- --run` (7/7).

### 5. First real `/pre-release` dry run

Once steps 1-4 are done, invoke `/pre-release` and watch it execute. Expect to find friction in the first run — fix the friction, not the test results. Never skip a failing test to make the suite pass (see CLAUDE.md `## Testing` → "Testing guardrails").

## Other items the next Claude should know

- **Line-ending churn.** There are ~17 modified files in the working tree from CRLF/LF differences between work PC and personal PC (all in the `.github`, `app/`, `backend/`, `docs/`, `scripts/`, and root README/CHANGELOG areas — none of them touched by either feature in this session). The next Claude should NOT include these in feature commits. The user is aware and will normalize when convenient.
- **Memory.** I added no auto-memories during this session (no user-level facts came up that warranted persistence). The handoff context is in this file plus `CLAUDE.md` plus `docs/roadmap.md`. No `.claude/memory/` writes.
- **Branch.** All work was on `main`. No feature branches were created.

## Pointers — read before doing anything

1. `CLAUDE.md` — the two new sections (`## Testing`, `## Available MCP servers`) explain the design choices and guardrails. Especially the "Why no automated end-to-end suite" note under `## Testing`.
2. `.claude/commands/pre-release.md` — the slash command itself. Read this top to bottom; it's the canonical description of how `/pre-release` should behave.
3. `tests/manual-smoke.md` — the human checklist. Scenario 1 (port 8000 check) and Scenario 6 (Writing Progress round-trip) are the most opinionated; they encode session-1 decisions worth preserving.
4. `docs/roadmap.md` — the Writing Progress detailed spec is here. If session-2 ends up touching that feature, this is the canonical reference.

---

When Step 6 is done and the test infrastructure is in place, **delete this file** in the same commit that closes out the work. It exists to bridge a session boundary, nothing more.
