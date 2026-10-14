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
  - `codex.ts` runs Deep Analyze as two agent runs (reading pass → extraction pass, see below) and owns the analysis schema; `readingPass.ts` recovers the files the reading pass opened from its transcript and its `FILES READ:` list.
  - `githubHost.ts` is the only place that knows the GitHub host, builds MNLens's own `gh`/`git` auth env, and defines what agents may NOT inherit (reviewer tokens).
  - `secondOpinion.ts` runs the cross-agent audit (same-vendor fallback when the other CLI is unavailable); `usage.ts` is the per-PR cost ledger.
  - `acceptance.ts` builds the acceptance-criteria contract (criteria → evidence → status, with human overrides); `reviewMemory.ts` stores reviewer verdicts and produces calibration text and rule suggestions; `feedback.ts` renders the author comment; `events.ts` is the SSE bus.
  - `analysisDelta.ts` compares a Deep Analyze re-run with the last analysis of a different diff (resolved / persisting / added, matched by `verdictKey` then observation text) and carries reviewer verdicts onto retitled findings; `cache.ts` keeps the last five analyses per PR in `.pra-cache/analysis-history/` for it. The Overview's "Since the last analysis" card reads `AnalysisResult.delta`.
  - `teamStore.ts` is the optional shared folder (`MNLENS_TEAM_DIR` / `team-settings.json`); `repoRules.ts` merges rules from the repo file (`.mnlens/review-rules.json`), the team folder and the local cache — always read rules through `listRepoRules`, never `cache.readRepoRules` directly.
  - `reviewDraft.ts` produces the Review tab's draft (line-anchored comments, final comment, verdict, must/should/optional checklist); anchors are validated with `src/shared/diffLines.ts`.
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
- Colours come only from the tokens in `src/client/src/styles.css` (`--mn-*`); light is the default and `[data-theme="dark"]` swaps the same tokens. Never hard-code a colour or add a `[data-theme="dark"]` override in component CSS; add or reuse a token instead. Status tones are fixed: `added`/ok = teal, `queue`/pending = amber, `danger` = red, `accent`/`stack`/`label` = violet, `improvement` = primary.
- Preserve human approval gates for review submission, commit, push, and rebase confirmation.
- Never pass the reviewer's GitHub token to an agent process. Agent runs go through `prepareAgentRun`, which strips `GH_TOKEN`/`GITHUB_TOKEN`; MNLens's own `gh`/`git` calls use `githubCliEnv(token)`. Call `hardenWorktreeCredentials(repoDir)` after every clone an agent will work in.
- Do not hard-code `github.com`; use `githubHost()` / `githubWebUrl()`.
- Prompts for agents belong in `src/server/agentSkills.ts`, not inline in pipeline code.
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
   - Deep Analyze runs inside the read-only PR checkout from `ensureAnalysisWorktree` (shared with the acceptance contract; it fetches `refs/pull/N/head`, so merged and fork PRs work). Keep it there: without the checkout the agent only sees the diff and loses to a plain `claude` session in the repo.
   - Deep Analyze is **two agent runs** (`analyzeInTwoPasses` in `codex.ts`). Pass 1, task `analysis-reading` (standard tier): a short colleague-style brief (`readingPassInstructions`), no output schema, `streamTranscript: true`, the diff budgeted to 60K chars with **added files stubbed** (`budgetDiff(..., { stubAddedFiles: true })`: a new file's diff is the file, and withholding it is what makes the agent open it), so the turns go into Read/Grep in the checkout; MNLens recovers the files it opened from the NDJSON tool calls plus the `FILES READ:` list it ends with (`readingPass.ts`; only files that exist in the checkout count) and keeps its notes as `AnalysisResult.readingNotes`. Pass 2, task `deep-analysis` (standard tier): `analysisExtractionInstructions` + `analysisFieldRules` turn the notes and a one-line-per-file `diffOutline` (not the hunks) into the schema in the scratch dir; it may not add findings and `inspectedFiles` is overwritten with pass 1's list (changed files excluded), never taken from the model. Both runs land in the usage ledger and in `AnalysisResult.passes`; `costUsd` is their sum and `model` is the reading model. Without a checkout `buildPrompt` still does the old single schema-constrained call, at the reading pass's tier. Why: on micronaut-micrometer#1259 (2026-10-14) the single schema-constrained call read 3 files in 7 turns for $0.43 and produced thinner findings than a plain `claude -p` with a six-line prompt (10 files, 14 turns, $0.44); the schema ate the turns. Measured again on 2026-10-14 after the split (same PR, Claude sonnet on both passes): the reading pass opened 19 files (5 beyond the diff: MetricOptionsUtil, breaks.adoc, accepted-api-changes.json, libs.versions.toml, TimeAnnotationSpec) in 158s for $0.63, the extraction took 65s for $0.28, $0.91 in all against the $0.60 target; the structured result carries about twice the single call's findings (8 risks, 5 focus items, 6 assumptions, 8 edge cases with coverage, 8 test gaps vs 3/4/2/3/4). Tier and input choices were measured on replays of the same notes: extraction with the full annotated diff cost $0.44 on sonnet (73s) and $0.37 on haiku (349s, half the findings); on the diff outline sonnet took 57s for $0.19 with no thinking tokens and haiku 248s for $0.19 (three structured-output turns, 23K output tokens, line numbers the notes never gave), so the extraction stays on standard and gets the outline, not the hunks. The remaining cost is the reading pass itself (file contents entering the cache plus the notes); the 60K reading budget, the schema's duplicated string/details arrays and the effort level are the levers left. Per-run numbers: the side-session note `deep-analyze-two-pass.md`.
   - The analysis schema has `readingGuide`, `assumptions` and `edgeCases` (with `covered`). New fields must get zod defaults so analyses cached before them still parse; the Review tab's step 2 and the author comment read them.
   - Deep Analyze (deep mode) builds the acceptance contract in the same job and `scheduleAcceptanceVerification` runs up to three criterion commands through the verification queue. Criterion status is computed by `src/shared/acceptance.ts` (`effectiveCriterionStatus`: override > failed run > agent verdict) on both server and client; never reimplement it locally. A run speaks for a criterion by job id or by command (newest wins), and `verificationEnvironment.ts` classifies finished runs as passed / test-failed / blocked so an environment failure never demotes a criterion; it also finds an installed JDK when Gradle or Maven name the version they need.
   - Large diffs go through `diffBudget.ts`: whole files in order, omitted files listed by path for the agent to read from the checkout. Never `slice()` a diff for a prompt.
   - The fix pipeline is three passes (implementation, tests/QA, final review) in one agent session; docs and security live in the final-review instructions, not in extra passes. Keep it that way: every extra pass re-reads the session context and roughly adds a third to the cost.
   - `claudeMcpConfig` (agent settings) is handed to every Claude run as `--mcp-config` and its servers are pre-approved in read-only runs; CLAUDE.md and skills need no plumbing because the runs happen inside the PR checkout.
2. Never call `codex` or `claude` directly; go through `prepareAgentRun`/`runAgent` so both agents stay in sync and session ids are recovered the same way.
3. Pick the cheapest tier that can do the job when adding a task (`defaultTaskTiers`); premium is opt-in only.
4. Preserve retry/resume/cancel semantics. Jobs persisted before multi-agent support have no `agent` field and are Codex sessions.
5. Make sure prepared code changes represent uncommitted/unpushed work from the fix session only.

### Change acceptance / memory / feedback behavior

1. Criteria statuses: the agent writes `status`, humans write `humanStatus`; always read through `effectiveStatus`. Regeneration must keep human overrides for unchanged criterion text.
2. Review memory keys findings with `verdictKey(kind, title)`; the client mirrors it in `InsightSection.tsx`. Keep both in sync.
3. The author comment is a preview the human edits and posts; never post it automatically.
4. Job updates must go through the existing `update*` helpers so `publishEvent` fires.
5. Review memory writes go to this machine's own file (`writeOwnMemory`); reads merge every member's file and drop malformed entries. Never write a merged list back to a shared file.
6. Draft-comment verdicts carry `commentKind`; `draftCommentAccuracy` and the calibration block depend on it.
7. Review-draft comments must keep passing through `normalizeComments` (anchor validation + `unanchored` flag); the client only offers "Add to my review" for anchored comments so GitHub never rejects a submitted review.

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
