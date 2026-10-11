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
    case "research":
      return `Research pass (read-only):
- Build a precise picture of the problem: map each reviewer comment, failing check, and high-confidence analysis finding to the exact files, functions and tests involved.
- Identify the project conventions that later passes must follow: module layout, naming, test framework and style, how similar features are implemented elsewhere in this repo.
- Check whether the linked issue's acceptance criteria are fully covered by the PR; list gaps explicitly.
- Do not edit files in this pass except a tiny metadata/context correction that unblocks later phases.
- Output a numbered work plan for Implementation and Tests/QA: each item names the file(s), the change, and the test that will prove it.`;
    case "implementation":
      return `Implementation pass:
- Execute the research plan with the smallest coherent change set. Address reviewer comments first (they outrank AI findings), then failing checks, then high-confidence findings.
- Do not broaden the PR scope, rename things for taste, reformat untouched code, or upgrade unrelated dependencies.
- Follow the conventions found during research; when the repo has a pattern for this kind of change, copy that pattern.
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
    case "docs":
      return `Docs pass:
- Update documentation, examples, configuration references, migration notes or changelog entries only when user-facing behavior, setup, configuration keys, dependency usage or terminology changed.
- Match the existing docs format (AsciiDoc/Markdown/Javadoc), heading structure and tone; keep additions short and example-driven.
- Verify that code snippets in docs still compile or match the implemented API names exactly.
- If nothing needs updating, say so explicitly and do not edit files.`;
    case "security":
      return `Security pass:
- Review the full prepared diff for: injection (SQL/command/path/template), unsafe deserialization, auth/authz bypass, secret or token handling, insecure defaults, overly broad permissions, unsafe shell/process execution, SSRF/open redirects, and data exposure in logs or error messages.
- For dependency changes, check that new versions are real, released, and free of known advisories; prefer root-level updates over transitive pins.
- Make focused fixes only for concrete issues introduced or exposed by this patch; do not refactor pre-existing code you were not asked to touch, but report pre-existing issues you noticed under OPEN QUESTIONS.
- State explicitly when the diff has no security-relevant surface.`;
    case "final-review":
      return `Final review pass:
- Read the complete prepared diff as the human reviewer will see it. Remove speculative, unrelated or over-broad changes and anything that does not serve a reviewer comment, failing check or confirmed finding.
- Confirm every reviewer comment and human follow-up instruction is either addressed or has an explicit reason it was not.
- Check hygiene: no debug output, no leftover TODOs without owners, no formatting-only churn, consistent naming, imports cleaned up, new files have the repo's standard header if one is required.
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
