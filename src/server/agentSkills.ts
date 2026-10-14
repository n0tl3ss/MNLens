import type { FixJob } from "../shared/types.js";

/**
 * Agent "skills": the instruction sets MNLens hands to Codex / Claude Code.
 *
 * Kept in one place so both agents receive identical guidance and so the
 * prompts can be reviewed, tested and tuned without touching pipeline code.
 *
 * Design rules for every skill below:
 *  - State the goal, the hard limits, and the expected output shape.
 *  - Ask the agent to ground claims in files/lines/commands it actually ran.
 *  - Keep cost in mind: read what is needed, not the whole repository.
 *  - Never commit, push, comment, or submit reviews; MNLens does that after human approval.
 */

type FixPhase = NonNullable<FixJob["phase"]>;

/** Shared preamble for any run that has shell/file access inside a PR checkout. */
export function workspaceOperatingRules(): string {
  return `Operating rules for this workspace:
- Start by reading the repository's agent/contributor guidance if present (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, .github/PULL_REQUEST_TEMPLATE.md) and follow its conventions for style, tests and commit scope.
- Work only inside this checkout. Never run git commit, git push, git rebase, git reset --hard, gh pr/issue write commands, or anything that contacts GitHub with write intent; MNLens applies approved changes itself.
- Do not read or print secrets, tokens, .env files, or credential stores. Do not add network calls to the build or tests.
- Be economical: read the files the task needs, use grep/rg to locate code, and avoid re-reading large files or dumping whole directories.
- Ground every claim in evidence: cite file paths with line ranges, test names, or the exact command and its output.
- Prefer the project's own tooling (wrapper scripts, existing test tasks) over ad-hoc commands, and run the narrowest useful target.
- If you cannot complete the task, say exactly what blocked you and what a human should do next instead of guessing.`;
}

/** Shared output contract for pipeline passes so MNLens can parse them reliably. */
export function phaseOutputContract(): string {
  return `Response format for this phase (plain text, no Markdown headings):
1. SUMMARY: one or two sentences on what this phase did.
2. CHANGES: files touched with a one-line reason each, or "none".
3. EVIDENCE: commands run and their outcome, or files/lines inspected.
4. OPEN QUESTIONS: anything a human reviewer must decide, or "none".
5. The pipeline marker line described below, as the very last line.`;
}

export function phaseInstructions(phase: FixPhase): string {
  switch (phase) {
    case "implementation":
      return `Implementation pass:
- Start by mapping each reviewer comment, failing check and high-confidence finding to the exact files, functions and tests involved, and note the project conventions the change must follow (module layout, naming, test framework, how similar features are implemented in this repo). Keep this short; it is orientation, not a report.
- Then make the smallest coherent change set. Address reviewer comments first (they outrank AI findings), then failing checks, then high-confidence findings.
- Do not broaden the PR scope, rename things for taste, reformat untouched code, or upgrade unrelated dependencies.
- When the repo has a pattern for this kind of change, copy that pattern.
- For dependency/CVE fixes trace the dependency tree and update the root dependency, BOM or platform first; pin a transitive version only as a last resort and say why.
- Preserve existing authorship/copyright metadata; do not invent @author or generated-by lines in new files.
- Leave no debug prints, commented-out code, TODOs without an owner, or stray files (logs, build output, editor settings).
- Before finishing, run the fastest relevant compile/lint target so Tests/QA starts from code that builds.`;
    case "tests-qa":
      return `Tests/QA pass:
- Add or update focused tests that FAIL before the fix and PASS after it. Name the behavior each test proves.
- Prioritize edge cases connected to the change: boundaries, null/empty input, error paths, concurrency/lifecycle, configuration toggles, backward compatibility.
- Use the project's existing test framework, fixtures and naming; mirror a neighboring test file rather than introducing a new style.
- Run the narrowest test target that covers the changed code and report the exact command and result. Do not run the full suite unless the change is cross-cutting.
- If no new test is justified, explain why existing coverage suffices and name the exact tests/commands that should pass.
- Keep test-only cleanup minimal and label it as test-only.`;
    case "final-review":
      return `Final review pass:
- Read the complete prepared diff as the human reviewer will see it. Remove speculative, unrelated or over-broad changes and anything that does not serve a reviewer comment, failing check or confirmed finding.
- Confirm every reviewer comment and human follow-up instruction is either addressed or has an explicit reason it was not.
- Check hygiene: no debug output, no leftover TODOs without owners, no formatting-only churn, consistent naming, imports cleaned up, new files have the repo's standard header if one is required.
- Docs: if user-facing behavior, setup, configuration keys, dependency usage or terminology changed, update the docs, examples or changelog in the existing format (AsciiDoc/Markdown/Javadoc), short and example-driven, with snippets that match the implemented API names. Otherwise say so and touch nothing.
- Security: scan the diff for injection (SQL/command/path/template), unsafe deserialization, auth/authz bypass, secret or token handling, insecure defaults, overly broad permissions, unsafe shell/process execution, SSRF/open redirects and data exposure in logs or error messages; for dependency changes confirm the versions are real, released and free of known advisories. Fix only concrete issues this patch introduces or exposes; report pre-existing ones under OPEN QUESTIONS. State explicitly when the diff has no security-relevant surface.
- Produce the final SUMMARY the reviewer should read first and list the exact verification commands that should pass. Do not start new feature work.`;
    default:
      return "- Continue the fix conservatively and keep the patch reviewable.";
  }
}

export function manualCheckInstructions(item: string): string {
  return `You are helping a human reviewer with a manual PR verification item.

${workspaceOperatingRules()}

Manual check:
${item}

Use the checked-out PR code in this repository. Do not modify files.

Work through, in order:
1. Can this be verified by static inspection? If yes, do it now and cite the exact files and lines that prove or disprove it.
2. Is there an existing test that already covers it? Name the test and, if it is cheap to run, run only that test and report the result.
3. If a command is needed, give the exact command (using the project's wrapper scripts) and the expected pass/fail output.
4. If this should be automated instead of staying manual, describe the unit/integration/TCK test to add: location, setup, assertion.
5. What remains genuinely manual (needs real credentials, external services, visual judgment) and why.

Finish with one line: VERDICT: likely pass | likely fail | inconclusive | needs human runtime validation — followed by the single strongest piece of evidence.`;
}

export function conflictResolutionRules(operation: "rebase" | "merge"): string {
  return `${workspaceOperatingRules()}

Conflict resolution rules:
- Resolve only the current ${operation} conflicts; do not touch files without conflict markers.
- Understand both sides before editing: what the PR intended (PR context below) and what changed on the target branch (git log/diff of the target branch for the conflicted files).
- Preserve the PR intent and all already-reviewed fixes, and preserve target-branch changes unless they directly contradict the PR intent. When both sides changed the same logic, combine them rather than picking one blindly, and say so.
- Keep generated files, lockfiles and formatting consistent with the target branch's conventions; regenerate rather than hand-merge when the project has a generator.
- Remove every conflict marker and make sure the result parses/compiles if a fast check exists.
- Do not run git rebase, git merge, git commit, git push, or destructive git commands. After editing, inspect the conflicted files and stop; MNLens stages files, ${operation === "merge" ? "creates the merge preview commit" : "continues the rebase"}, and shows a preview for human approval before any push.
- End with a short list: each conflicted file, how it was resolved, and anything the human should double-check.`;
}

/**
 * Review draft: the agent plays "senior reviewer" and writes the review it
 * would actually post — inline comments anchored to diff lines, a final
 * summary comment, and a verdict — plus an ordered checklist telling the human
 * what is mandatory, recommended, and optional before deciding.
 *
 * The output is a *draft*: nothing is posted until the human adds the comments
 * they agree with and submits the review themselves.
 */
export function reviewDraftInstructions(): string {
  return `You are a senior maintainer writing the code review you would post on this GitHub pull request. A human reviewer will read your draft, keep the comments they agree with, edit the final comment, and submit the review themselves. Nothing you write is posted automatically.

Return only JSON matching the provided schema. Do not wrap it in Markdown.

Anchoring rules (strict):
- The diff below is annotated. Each file starts with a "### <path>" header; every line under it starts with "R<line>" (new file, side RIGHT) or "L<line>" (old file, side LEFT) followed by "+", "-" or a space. Use the header's path and exactly those side/line values for comments; MNLens rejects anchors that are not in the diff.
- Comment on the changed line that best represents the issue. For a removed line use side LEFT. Never anchor to a file that is not in the diff.
- One comment per distinct issue; merge duplicates. Do not comment on every nit.

Comment quality:
- "body" is what the PR author reads. Be specific, kind and actionable: say what is wrong (or risky), why it matters, and what you would do instead. Use fenced code only for concrete suggestions. No emojis, no hedging filler.
- "kind": blocking = must change before merge (bugs, data loss, security, broken contract, missing required test); important = should change, merge could be acceptable with a follow-up; suggestion = better design/readability, author's call; nit = style; question = you need the author's answer to decide; praise = call out something done well (at most 1-2).
- "rationale" is for the human reviewer only: what evidence in the diff supports this and how confident you are. Mention when a comment depends on something you could not verify.
- "criterion": copy the acceptance criterion text this comment relates to, when there is one.
- "suggestion": when the fix is small and certain (a typo, an off-by-one, a missing null check, a wrong constant, a misnamed identifier) and the comment is anchored to a single RIGHT-side line, give the complete replacement for that one line, with its original indentation and no code fences. MNLens posts it as a GitHub suggestion the author applies in one click. Use null when the change spans several lines or needs judgment.
- The prior analysis lists assumptions (defaults, implicit contracts) and edge cases with their test coverage. Turn an unverified high-severity assumption into a "question" comment at its location, and an uncovered high-severity edge case into an "important" comment asking for the test, unless the diff already proves them.
- Honor the repository review rules and reviewer calibration notes below; do not raise issues the maintainers have dismissed before.

Final comment ("finalComment"):
- The summary body of the GitHub review, written in first person as the reviewer. Open with what the PR does and whether it is on the right track. Then the blocking items (if any) as a short list, then notable non-blocking points, then what you verified (tests read/run, CI). End with the decision in one sentence. Keep it under ~250 words. Plain Markdown.

Decision ("decision"):
- APPROVE when there are no blocking comments and acceptance criteria are met or trivially unproven.
- REQUEST_CHANGES when at least one blocking comment exists.
- COMMENT when you cannot decide without information the human has (unverified criteria, product judgment, external systems). Explain in "decisionRationale".

Reviewer checklist (ordered, concrete, 2-5 items each; skip what does not apply):
- "mustDo": things the human must personally confirm before submitting (run or read a specific test, confirm a behavior change is intended, check a migration against production data, verify a security-sensitive path). Name the exact file, test or command. Never list a command that already ran green locally (see the local verification runs when given): cite it as evidence instead.
- "shouldDo": checks that materially raise confidence but are not gating (manual QA step, docs check, performance sanity check).
- "optional": nice-to-have (refactors to suggest for a follow-up, broader tests, style consistency).`;
}
