# AGENTS.md

This file gives AI coding agents enough context to work on MNLens safely.

## Project Summary

MNLens is a local-first GitHub PR review workstation built with:

- React + Vite client
- Express server
- Electron desktop shell
- GitHub CLI (`gh`) for GitHub operations
- A coding-agent CLI for analysis/fix sessions: Codex CLI or Claude Code, behind `src/server/agent.ts`
- Vitest and Playwright for validation

The app is intentionally human-in-the-loop. Do not add behavior that commits, pushes, rebases, or submits reviews without an explicit user action.

## Repository Layout

- `src/client/src` - React UI and client helpers.
- `src/server` - Express routes, GitHub/agent/verification/rebase/stack/cache services.
  - `agent.ts` builds CLI invocations for Codex or Claude Code and parses their output; `agentSettings.ts` holds the task → tier → model routing; `agentSkills.ts` holds every prompt/instruction set handed to agents.
  - `githubHost.ts` is the only place that knows the GitHub host, builds MNLens's own `gh`/`git` auth env, and defines what agents may NOT inherit (reviewer tokens).
  - `researchProfiles.ts` turns technology-specific research heuristics into data; `secondOpinion.ts` runs the cross-agent audit; `usage.ts` is the per-PR cost ledger.
  - `acceptance.ts` builds the acceptance-criteria contract (criteria → evidence → status, with human overrides); `reviewMemory.ts` stores reviewer verdicts and produces calibration text and rule suggestions; `feedback.ts` renders the author comment; `events.ts` is the SSE bus.
  - `stacks.ts` reconstructs stacked-PR chains from open PRs' base/head branches.
- `src/shared/analysisContext.ts` - discussion-state fingerprint shared by server cache checks and client staleness badges.
- `src/shared` - shared TypeScript types.
- `electron` - Electron shell for packaged desktop app.
- `tests` - Vitest unit/server tests.
- `tests/e2e` - Playwright browser smoke tests.
- `public` - static client assets.
- `build` - Electron app icons.

Generated/local folders must stay out of commits:

- `.pra-cache`
- `.pra-screenshots`
- `shots`
- `dist`
- `release`
- `test-results`
- `playwright-report`
- `node_modules`

## Setup

```sh
npm install
npm run dev
```

Open `http://localhost:4321`.

The app expects local tools for full functionality:

- `git`
- `gh`
- `codex` and/or `claude` (at least one, signed in)
- Java/Gradle/Maven when verifying JVM projects

## Validation

Run these before finishing a meaningful change:

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

For desktop/Electron changes also run:

```sh
npm run dist:mac
```

If E2E tests fail because a stale dev server is running, stop the old server and rerun.

## Development Rules For Agents

- Keep patches focused. Avoid unrelated redesigns or broad refactors.
- Preserve human approval gates for review submission, commit, push, and rebase confirmation.
- Never pass the reviewer's GitHub token to an agent process. Agent runs go through `prepareAgentRun`, which strips `GH_TOKEN`/`GITHUB_TOKEN`; MNLens's own `gh`/`git` calls use `githubCliEnv(token)`. Call `hardenWorktreeCredentials(repoDir)` after every clone an agent will work in.
- Do not hard-code `github.com`; use `githubHost()` / `githubWebUrl()`.
- Prompts for agents belong in `src/server/agentSkills.ts` (or `researchProfiles.ts` for technology-specific guidance), not inline in pipeline code.
- Do not weaken the local session-token guard.
- Do not expose the server remotely unless the existing explicit opt-in remains in place.
- Treat GitHub API rate limits as important. Avoid adding aggressive polling.
- Use structured APIs and existing helpers instead of ad hoc parsing when possible.
- Add or update tests for behavior changes.
- Prefer improving automated verification over adding manual checklist text.
- Do not commit generated cache, screenshots, build output, packaged apps, or worktrees.

## Common Tasks

### Add UI behavior

1. Find the relevant component under `src/client/src/components`.
2. Check for existing helper modules before adding logic to a component.
3. Update CSS in the nearest component CSS file when possible.
4. Add Vitest tests for helpers or Playwright coverage for visible flows.

### Add server behavior

1. Add route logic under `src/server`.
2. Keep command execution behind existing command helpers.
3. Preserve session-token checks.
4. Add server tests under `tests`.

### Change agent/fix behavior

1. Inspect `src/server/agent.ts` (CLI flags per agent), `src/server/agentSettings.ts` (model routing), `src/server/codex.ts` (analysis prompts/schema), `src/server/fix.ts`, and the fix UI in `src/client/src/components/CodexTab.tsx`.
2. Never call `codex` or `claude` directly; go through `prepareAgentRun`/`runAgent` so both agents stay in sync and session ids are recovered the same way.
3. Pick the cheapest tier that can do the job when adding a task (`defaultTaskTiers`); premium is opt-in only.
4. Preserve retry/resume/cancel semantics. Jobs persisted before multi-agent support have no `agent` field and are Codex sessions.
5. Make sure prepared code changes represent uncommitted/unpushed work from the fix session only.

### Change acceptance / memory / feedback behavior

1. Criteria statuses: the agent writes `status`, humans write `humanStatus`; always read through `effectiveStatus`. Regeneration must keep human overrides for unchanged criterion text.
2. Review memory keys findings with `verdictKey(kind, title)`; the client mirrors it in `InsightSection.tsx`. Keep both in sync.
3. The author comment is a preview the human edits and posts; never post it automatically.
4. Job updates must go through the existing `update*` helpers so `publishEvent` fires.

### Change stacked-PR behavior

1. Graph building and chain selection live in `src/server/stacks.ts`; keep it to one GraphQL query per repository and respect the cache TTL.
2. Call `invalidateStackCache(repository)` after any mutation that changes a PR base.
3. "Restack" must keep using the branch-update preview and its human approval gate.

### Change artifact behavior

Artifacts are local files served through token-protected routes in the web app. In Electron, local artifact links are intercepted and opened with the operating system viewer.

Do not replace this with unauthenticated file serving.

## Release Notes For Agents

MNLens is beta software and the README intentionally says it was vibe coded. Keep that disclaimer unless the project owner explicitly removes it.

Desktop builds are currently ad-hoc signed and not notarized. Do not claim production-grade macOS distribution until signing/notarization/auto-update are implemented.
