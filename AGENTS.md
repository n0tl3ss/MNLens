# AGENTS.md

This file gives AI coding agents enough context to work on MNLens safely.

## Project Summary

MNLens is a local-first GitHub PR review workstation built with:

- React + Vite client
- Express server
- Electron desktop shell
- GitHub CLI (`gh`) for GitHub operations
- Codex CLI for analysis/fix sessions
- Vitest and Playwright for validation

The app is intentionally human-in-the-loop. Do not add behavior that commits, pushes, rebases, or submits reviews without an explicit user action.

## Repository Layout

- `src/client/src` - React UI and client helpers.
- `src/server` - Express routes, GitHub/Codex/verification/rebase/cache services.
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
- `codex`
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

### Change Codex/fix behavior

1. Inspect `src/server/codex.ts`, `src/server/fixService.ts`, and Codex UI in `src/client/src/components/CodexTab.tsx`.
2. Preserve retry/resume/cancel semantics.
3. Make sure prepared code changes represent uncommitted/unpushed work from the fix session only.

### Change artifact behavior

Artifacts are local files served through token-protected routes in the web app. In Electron, local artifact links are intercepted and opened with the operating system viewer.

Do not replace this with unauthenticated file serving.

## Release Notes For Agents

MNLens is beta software and the README intentionally says it was vibe coded. Keep that disclaimer unless the project owner explicitly removes it.

Desktop builds are currently ad-hoc signed and not notarized. Do not claim production-grade macOS distribution until signing/notarization/auto-update are implemented.
