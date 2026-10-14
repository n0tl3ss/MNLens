import { expect, test, type Page } from "@playwright/test";

const now = "2026-05-08T00:00:00.000Z";
const prKey = "micronaut-projects__micronaut-tracing__839";

const pr = {
  key: prKey,
  owner: "micronaut-projects",
  repo: "micronaut-tracing",
  number: 839,
  title: "Add Oracle UCP telemetry",
  url: "https://github.com/micronaut-projects/micronaut-tracing/pull/839",
  repository: "micronaut-projects/micronaut-tracing",
  author: "abrenk",
  authorUrl: "https://github.com/abrenk",
  labels: ["feature"],
  queues: ["review-requested"],
  state: "OPEN",
  isDraft: false,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  commentsCount: 2,
  changedFiles: 2,
  reviewDecision: "REVIEW_REQUIRED",
  mergeStateStatus: "UNKNOWN",
  aiType: "feature",
  analysisStatus: "done",
  analysisUpdatedAt: now,
  aiRiskCount: 2,
  aiTestsCount: 2
};

const diff = `diff --git a/tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java b/tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java
@@ -0,0 +1,8 @@
+package io.micronaut.tracing.opentelemetry.instrument.ucp;
+
+final class UniversalConnectionPoolBeanEventListener {
+    void register() {
+    }
+}
diff --git a/tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy b/tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy
@@ -0,0 +1,6 @@
+package io.micronaut.tracing.opentelemetry.instrument.ucp
+
+class OracleUcpTelemetryBeanCreationSpec {
+}
`;

const reviewDraft = {
  prKey: "micronaut-projects__micronaut-tracing__839",
  diffHash: "test-diff",
  generatedAt: "2026-01-01T00:00:00.000Z",
  agent: "claude",
  model: "claude-sonnet-4-5",
  costUsd: 0.012,
  decision: "REQUEST_CHANGES",
  decisionRationale: "The listener never registers anything, so the module is inert.",
  finalComment: "Thanks for the module. The listener is wired but `register()` is empty, so no telemetry is emitted yet.",
  comments: [
    {
      id: "c1",
      path: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java",
      line: 4,
      side: "RIGHT",
      kind: "blocking",
      title: "register() is empty",
      body: "`register()` does nothing, so the pool is never instrumented. Register the OpenTelemetry listener here.",
      rationale: "The only method in the new class has an empty body.",
      suggestion: "    void register() { OracleUcpTelemetry.create(openTelemetry).registerMetrics(pool); }"
    },
    {
      id: "c2",
      path: "tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy",
      line: 3,
      side: "RIGHT",
      kind: "suggestion",
      title: "Spec has no assertions",
      body: "Consider asserting that the bean is created when the UCP data source is present.",
      rationale: "Empty spec class."
    }
  ],
  mustDo: ["Confirm a UCP data source actually triggers the listener (run OracleUcpTelemetryBeanCreationSpec once it has assertions)."],
  shouldDo: ["Check the module is listed in the docs navigation."],
  optional: ["Consider a Testcontainers-based integration test for a follow-up."]
};

const detail = {
  ...pr,
  body: "Adds a Micronaut OpenTelemetry Oracle UCP module.",
  linkedIssues: [
    {
      number: 123,
      title: "Support Oracle UCP metrics",
      url: "https://github.com/micronaut-projects/micronaut-tracing/issues/123",
      state: "OPEN",
      repository: "micronaut-projects/micronaut-tracing",
      body: "Users need pool metrics for Oracle UCP.",
      author: "maintainer",
      labels: ["enhancement"],
      commentsCount: 1,
      createdAt: now,
      updatedAt: now
    }
  ],
  baseRefName: "8.0.x",
  headRefName: "oracle-ucp",
  additions: 120,
  deletions: 0,
  changedFiles: 2,
  files: [
    {
      path: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java",
      additions: 58,
      deletions: 0,
      changeType: "ADDED"
    },
    {
      path: "tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy",
      additions: 42,
      deletions: 0,
      changeType: "ADDED"
    }
  ],
  commits: [
    {
      sha: "abcdef1234567890",
      shortSha: "abcdef1",
      message: "add Oracle UCP telemetry",
      author: "abrenk",
      authorUrl: "https://github.com/abrenk",
      authoredAt: now,
      committer: "abrenk",
      committedAt: now,
      url: "https://github.com/micronaut-projects/micronaut-tracing/commit/abcdef1",
      files: [
        {
          path: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java",
          additions: 58,
          deletions: 0,
          changeType: "ADDED",
          patch: "@@ -0,0 +1,8 @@\n+package io.micronaut.tracing.opentelemetry.instrument.ucp;"
        }
      ]
    }
  ],
  conversationComments: [
    {
      id: 10,
      author: "reviewer",
      authorUrl: "https://github.com/reviewer",
      url: "https://github.com/micronaut-projects/micronaut-tracing/pull/839#issuecomment-10",
      body: "Please prove lifecycle registration with a test.",
      createdAt: now
    }
  ],
  reviewSummaries: [],
  reviewComments: [
    {
      id: 20,
      author: "graemerocher",
      authorUrl: "https://github.com/graemerocher",
      url: "https://github.com/micronaut-projects/micronaut-tracing/pull/839#discussion_r20",
      body: "can this use the existing lifecycle registration helper instead of duplicating listener wiring?",
      createdAt: now,
      path: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java",
      line: 5,
      side: "RIGHT",
      isResolved: false
    },
    {
      id: 21,
      author: "reviewer",
      authorUrl: "https://github.com/reviewer",
      url: "https://github.com/micronaut-projects/micronaut-tracing/pull/839#discussion_r21",
      body: "resolved old comment that should not drive the current review plan",
      createdAt: now,
      path: "tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy",
      originalLine: 3,
      side: "RIGHT",
      isResolved: true
    }
  ],
  diff,
  diffHash: "test-diff"
};

const analysis = {
  prKey,
  diffHash: "test-diff",
  type: "feature",
  confidence: 0.93,
  summary: "Adds Oracle UCP OpenTelemetry pool metrics support.",
  evidence: ["New UCP module registers pool beans.", "Docs mention the disable flag."],
  evidenceDetails: [
    {
      title: "Lifecycle integration",
      observation: "Registers on bean creation and unregisters on destroy.",
      perspective: "This is the right integration shape.",
      recommendation: "Prove it with a lifecycle test.",
      severity: "high"
    }
  ],
  behaviorBefore: "No Oracle UCP telemetry module existed.",
  behaviorAfter: "UniversalConnectionPool beans are registered for metrics.",
  reviewerFocus: ["Confirm register/unregister is tested."],
  reviewerFocusDetails: [
    {
      title: "Behavioral test requirement",
      observation: "Current tests only check bean presence.",
      perspective: "That is weak for telemetry lifecycle behavior.",
      recommendation: "Add a real lifecycle test.",
      severity: "high"
    }
  ],
  risks: ["Silent telemetry no-op if metrics are not emitted."],
  riskDetails: [
    {
      title: "Silent telemetry failure",
      observation: "No metric reader assertion exists.",
      perspective: "The feature can appear wired while producing no metrics.",
      recommendation: "Add SDK metric-reader evidence.",
      severity: "high"
    }
  ],
  testsToCheck: ["Run `./gradlew :tracing-opentelemetry-ucp:test`.", "Build/render documentation for the new guide page."],
  testAssessment: {
    rating: "weak",
    summary: "Current tests do not prove lifecycle or metric behavior.",
    covered: ["Bean creation."],
    gaps: ["No UCP lifecycle test.", "No metrics assertion."],
    recommendedTests: ["Lifecycle test.", "Metric reader test."]
  },
  caveats: ["No live Oracle UCP database pool is exercised."],
  readingGuide: [
    {
      path: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java",
      lines: "3-6",
      title: "The listener that should register the pool",
      explanation: "A bean event listener whose register() method is still empty.",
      whyItMatters: "This is the only production code; if it does nothing the feature is inert."
    },
    {
      path: "tracing-opentelemetry-ucp/src/test/groovy/io/micronaut/tracing/opentelemetry/instrument/ucp/OracleUcpTelemetryBeanCreationSpec.groovy",
      lines: "",
      title: "The spec that proves nothing yet",
      explanation: "An empty Spock specification.",
      whyItMatters: "Shows that bean creation, let alone metrics, is not asserted."
    }
  ],
  assumptions: [
    {
      title: "UCP pools are created as Micronaut beans",
      observation: "The listener only sees pools that go through the bean context.",
      perspective: "Pools created manually by application code are never instrumented.",
      recommendation: "Check the UCP factory in micronaut-sql registers pools as beans.",
      severity: "high",
      location: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java:4"
    }
  ],
  edgeCases: [
    {
      title: "Pool closed before metrics registered",
      observation: "register() runs on bean creation; a pool closed during startup leaves a dangling registration.",
      perspective: "Expected: unregister on destroy; currently nothing is registered at all.",
      recommendation: "Add a lifecycle test that creates and destroys the pool.",
      severity: "medium",
      location: "tracing-opentelemetry-ucp/src/main/java/io/micronaut/tracing/opentelemetry/instrument/ucp/UniversalConnectionPoolBeanEventListener.java:4",
      covered: "no"
    },
    {
      title: "Bean creation without a data source",
      observation: "The module loads even when no UCP pool exists.",
      perspective: "Expected: no error, no metrics.",
      recommendation: "Covered by OracleUcpTelemetryBeanCreationSpec once it asserts something.",
      severity: "low",
      location: "",
      covered: "partial"
    }
  ],
  draftComment: "Please add lifecycle and metric-reader coverage before approval.",
  generatedAt: now
};

const interruptedFix = {
  id: "fix-interrupted-1",
  status: "failed",
  prKey,
  phase: "implementation",
  statusMessage: "Fix session interrupted.",
  source: "Overview / Risks / Silent telemetry failure",
  instructions: "Address lifecycle registration risk.",
  repoDir: "/tmp/mnlens/fix-worktree",
  codexSessionId: "019dfeba-601c-7d73-a0e5-d2002e49643e",
  pipeline: [
    { phase: "implementation", label: "Implementation", status: "failed", message: "Interrupted when MNLens stopped; retry can continue from this phase.", updatedAt: now },
    { phase: "tests-qa", label: "Tests/QA", status: "pending", updatedAt: now },
    { phase: "final-review", label: "Final review", status: "pending", updatedAt: now }
  ],
  interruptedAt: now,
  resumable: true,
  recoveryMessage: "Codex fix session was interrupted when MNLens stopped. Retry session to continue from the preserved workspace/context.",
  createdAt: now,
  updatedAt: now,
  stdout: "partial Codex output",
  stderr: "",
  error: "Codex fix session was interrupted when MNLens stopped."
};

const interruptedVerification = {
  id: "verification-interrupted-1",
  status: "failed",
  prKey,
  command: "./gradlew :tracing-opentelemetry-ucp:test",
  phase: "completed",
  statusMessage: "Verification interrupted.",
  repoDir: "/tmp/mnlens/verification-worktree",
  interruptedAt: now,
  resumable: true,
  recoveryMessage: "Verification was interrupted when MNLens stopped. Run this check again to continue.",
  createdAt: now,
  updatedAt: now,
  stdout: "partial Gradle output",
  stderr: "",
  error: "Verification was interrupted when MNLens stopped.",
  exitCode: null
};

const runningFix = {
  ...interruptedFix,
  id: "fix-running-activity",
  status: "running",
  phase: "tests-qa",
  statusMessage: "Tests/QA is checking coverage.",
  source: "Tool activity / beta coverage",
  updatedAt: now,
  error: undefined,
  recoveryMessage: undefined,
  resumable: false
};

const runningAnalysisJob = {
  id: "analysis-running-1",
  status: "running",
  prKey,
  mode: "deep",
  createdAt: now,
  updatedAt: now,
  statusMessage: "Codex is analyzing the PR and preparing review guidance.",
  stdout: "analysis started",
  stderr: ""
};

const stackNode = (number: number, title: string, headRefName: string, baseRefName: string, extra: Record<string, unknown> = {}) => ({
  number,
  title,
  url: `https://github.com/micronaut-projects/micronaut-tracing/pull/${number}`,
  author: "abrenk",
  baseRefName,
  headRefName,
  isDraft: false,
  state: "OPEN",
  mergeStateStatus: "CLEAN",
  reviewDecision: "REVIEW_REQUIRED",
  isInMergeQueue: false,
  mergeable: "MERGEABLE",
  childNumbers: [] as number[],
  ...extra
});

const stackRoot = stackNode(838, "Add UCP module skeleton", "ucp-skeleton", "8.0.x", { reviewDecision: "APPROVED", childNumbers: [839] });
const stackCurrent = stackNode(839, pr.title, "oracle-ucp", "ucp-skeleton", { parentNumber: 838, childNumbers: [840] });
const stackLeaf = stackNode(840, "Document UCP telemetry", "ucp-docs", "oracle-ucp", { parentNumber: 839, isDraft: true });

const stackedPr = {
  repository: "micronaut-projects/micronaut-tracing",
  number: 839,
  isStacked: true,
  chain: [stackRoot, stackCurrent, stackLeaf],
  position: 2,
  parent: stackRoot,
  children: [stackLeaf],
  trunk: "8.0.x",
  fetchedAt: now
};

const stackMergePlan = {
  repository: "micronaut-projects/micronaut-tracing",
  trunk: "8.0.x",
  nextNumber: 838,
  mergeQueueActive: false,
  steps: [
    { number: 838, title: stackRoot.title, headRefName: stackRoot.headRefName, ready: true, blockers: [], isCurrent: false, isNext: true },
    { number: 839, title: stackCurrent.title, headRefName: stackCurrent.headRefName, ready: false, blockers: ["not approved", "parent PR must merge first"], isCurrent: true, isNext: false },
    { number: 840, title: stackLeaf.title, headRefName: stackLeaf.headRefName, ready: false, blockers: ["draft", "not approved", "parent PR must merge first"], isCurrent: false, isNext: false }
  ]
};

type MockApiOptions = {
  /** Acceptance contract for the mocked PR; null (default) mocks a PR without one. */
  acceptance?: Record<string, unknown> | null;
  verificationJobs?: Array<Record<string, unknown>>;
  prOverride?: Partial<typeof pr>;
  detailOverride?: Partial<typeof detail>;
  analysisOverride?: typeof analysis | null;
  activeFixes?: Array<typeof interruptedFix>;
  selectedFixes?: Array<typeof interruptedFix>;
  authOverride?: Record<string, unknown>;
  /** Stack returned for the mocked PR; undefined mocks an unstacked PR. */
  stack?: typeof stackedPr;
  mergePlan?: typeof stackMergePlan;
  analyzeJob?: typeof runningAnalysisJob;
  onAnalyze?: (payload: unknown) => void;
  onStartFix?: (payload: unknown) => void;
  onCancel?: (path: string) => void;
};

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("pra-setup-dismissed", "true");
  });
});

test("renders the core review tabs from mocked PR data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.getByText("micronaut-projects/micronaut-tracing #839")).toBeVisible();

  const tabExpectations = [
    ["Overview", "Review Summary"],
    ["Review", "Recommended Review"],
    ["Diff", "Changed Files"],
    ["Commits", "Commit Story"],
    ["Codex", "Codex Fix Session"],
    ["Comment", "Conversation"]
  ] as const;

  for (const [tab, expectedText] of tabExpectations) {
    // Tab labels may carry a small counter badge (e.g. "Review 2").
    await page.getByRole("button", { name: new RegExp(`^${tab}\\s*\\d*$`) }).click();
    await expect(page.getByText(expectedText).first()).toBeVisible();
  }
});

test("Overview explains the change: reading guide opens the diff, assumptions and edge cases are listed", async ({ page }) => {
  if (process.env.MNLENS_E2E_SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();

  const guide = page.locator(".reading-guide-card");
  await expect(guide.getByText("The listener that should register the pool")).toBeVisible();
  await expect(page.locator(".insight-section.assumption").getByText("UCP pools are created as Micronaut beans")).toBeVisible();
  const edge = page.locator(".insight-section.edge");
  await expect(edge.getByText("Pool closed before metrics registered")).toBeVisible();
  await expect(edge.getByText("not covered")).toBeVisible();
  await expect(edge.getByText("partially covered")).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview-assumptions.png`, fullPage: true });

  // The Review tab turns them into the step-2 checklist (edge cases fully covered by tests are left out).
  await page.getByRole("button", { name: /^Review\s*\d*$/ }).click();
  const challenge = page.locator(".review-challenge");
  await expect(challenge.locator("li")).toHaveCount(3);
  await expect(challenge.getByText("UCP pools are created as Micronaut beans")).toBeVisible();

  // Reading-guide steps open the file in the Diff tab.
  await page.getByRole("button", { name: /^Overview/ }).click();
  await guide.getByRole("button", { name: /UniversalConnectionPoolBeanEventListener\.java:3-6/ }).click();
  await expect(page.getByRole("button", { name: "Diff", exact: true })).toHaveClass(/active/);
  await expect(page.locator(".diff-reading-order li.active")).toContainText("The listener that should register the pool");
  await expect(page.getByRole("table", { name: "Pull request patch" })).toBeVisible();
});

test("acceptance criteria show whether their test command actually ran", async ({ page }) => {
  const greenJob = { ...interruptedVerification, id: "verification-green", status: "done", exitCode: 0, resumable: false, interruptedAt: undefined, recoveryMessage: undefined, statusMessage: "Passed.", command: "./gradlew :tracing-opentelemetry-ucp:test --tests '*UcpMetricsSpec'" };
  const redJob = { ...greenJob, id: "verification-red", status: "failed", exitCode: 1, outcome: "test-failed", statusMessage: "1 test failed.", command: "./gradlew :tracing-opentelemetry-ucp:test --tests '*PoolLifecycleSpec'" };
  const blockedJob = { ...redJob, id: "verification-blocked", outcome: "blocked", blockedReason: "the build needs JDK 25 and ran on JDK 21", statusMessage: "Could not run here.", command: "./gradlew :test-suite-kotlin:test" };
  await mockApi(page, {
    verificationJobs: [greenJob, redJob, blockedJob],
    acceptance: {
      prKey,
      diffHash: detail.diffHash,
      generatedAt: now,
      agent: "claude",
      model: "sonnet",
      summary: "Two criteria from the linked issue.",
      limitations: [],
      criteria: [
        { id: "c1", text: "Pool metrics are registered when a UCP bean starts", source: "linked-issue", status: "proven", evidence: [{ kind: "test", ref: "UcpMetricsSpec" }], command: greenJob.command, verification: { jobId: greenJob.id, command: greenJob.command, startedAt: now } },
        { id: "c2", text: "Metrics are unregistered when the pool closes", source: "linked-issue", status: "proven", evidence: [{ kind: "test", ref: "PoolLifecycleSpec" }], command: redJob.command, verification: { jobId: redJob.id, command: redJob.command, startedAt: now } },
        { id: "c3", text: "Configuration key is documented", source: "pr-body", status: "unproven", evidence: [] },
        { id: "c4", text: "Kotlin suspend functions are timed", source: "linked-issue", status: "proven", evidence: [{ kind: "test", ref: "SuspendMetricsTest" }], command: blockedJob.command, verification: { jobId: blockedJob.id, command: blockedJob.command, startedAt: now } }
      ]
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();

  const card = page.locator(".acceptance-card");
  // The agent called both "proven"; a red local run demotes the second one to failed.
  await expect(card.getByText("1 ran green")).toBeVisible();
  await expect(card.locator(".acceptance-item").nth(0).getByText("ran green")).toBeVisible();
  await expect(card.locator(".acceptance-item").nth(1).getByText("run failed")).toBeVisible();
  await expect(card.locator(".acceptance-item").nth(1)).toHaveClass(/failed/);
  await expect(card.locator(".acceptance-item").nth(0).getByRole("button", { name: /Run again/ })).toBeVisible();
  await expect(card.locator(".acceptance-item").nth(2).getByRole("button", { name: /Run/ })).toHaveCount(0);
  // A run that never started (wrong JDK) is reported, not counted against the PR.
  const blocked = card.locator(".acceptance-item").nth(3);
  await expect(blocked.getByText("could not run", { exact: true })).toBeVisible();
  await expect(blocked.getByText(/needs JDK 25/)).toBeVisible();
  await expect(blocked).toHaveClass(/proven/);
  await expect(card.getByText("1 could not run")).toBeVisible();
});

test("Overview shows what changed since the previous analysis and links new findings to their section", async ({ page }) => {
  const delta = {
    previousGeneratedAt: "2026-05-06T00:00:00.000Z",
    previousDiffHash: "0ld-diff-hash",
    resolved: [{ kind: "risk", title: "Pool never unregistered on destroy", observation: "Destroy path left the registration in place.", severity: "high" }],
    persisting: [
      { kind: "risk", title: "Silent telemetry failure", observation: "No metric reader assertion exists.", severity: "high", matchedBy: "title", previousSeverity: "medium" },
      { kind: "focus", title: "Behavioral test requirement", observation: "Current tests only check bean presence.", severity: "high", matchedBy: "observation", previousTitle: "Tests must prove lifecycle behaviour" }
    ],
    added: [{ kind: "edge-case", title: "Bean creation without a data source", observation: "The module loads even when no UCP pool exists.", severity: "low", location: "" }],
    carriedVerdicts: 1
  };
  await mockApi(page, { analysisOverride: { ...analysis, delta } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();

  const card = page.locator(".analysis-delta-card");
  await expect(card.getByRole("heading", { name: "Since the last analysis" })).toBeVisible();
  await expect(card.getByText("1 resolved · 1 new · 2 persisting (1 changed severity) · 1 verdict carried over")).toBeVisible();
  await expect(card.locator("li.resolved s")).toHaveText("Pool never unregistered on destroy");
  await expect(card.locator("li.resolved .badge")).toHaveText("resolved");
  await expect(card.locator("li.added .badge").first()).toHaveText("new");
  await expect(card.getByText("2 findings persist from the previous analysis.")).toBeVisible();
  await expect(card.getByText("Silent telemetry failure (medium → high)")).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) {
    await card.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview-analysis-delta.png` });
    await page.evaluate(() => localStorage.setItem("mnlens-theme", "dark"));
    await page.reload();
    await expect(card.getByRole("heading", { name: "Since the last analysis" })).toBeVisible();
    await card.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview-analysis-delta-dark.png` });
    await page.evaluate(() => localStorage.setItem("mnlens-theme", "light"));
    await page.reload();
    await expect(card.getByRole("heading", { name: "Since the last analysis" })).toBeVisible();
  }

  // The card sits above the insight columns and a new item jumps to its section.
  const cardBox = await card.boundingBox();
  const edgeBox = await page.locator("#insight-section-edge").boundingBox();
  expect(cardBox && edgeBox && cardBox.y < edgeBox.y).toBe(true);
  await card.getByRole("button", { name: "Bean creation without a data source" }).click();
  await expect(page.locator("#insight-section-edge")).toBeInViewport();
});

test("switches to self-review for the reviewer's own PR", async ({ page }) => {
  await mockApi(page, { authOverride: { username: pr.author } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.locator(".status-strip").getByText("your PR · self-review")).toBeVisible();

  await page.getByRole("button", { name: /^Review\s*\d*$/ }).click();
  await expect(page.getByRole("heading", { name: "Self-review" })).toBeVisible();
  await expect(page.getByText("Needs work before review").first()).toBeVisible();
  await page.getByRole("button", { name: "Post as self-review notes" }).click();

  const dialog = page.getByRole("dialog", { name: "Post self-review notes" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/GitHub does not allow approving or requesting changes/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Post self-review comment" })).toBeEnabled();
});

test("hides the Stack tab for unstacked PRs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Stack/ })).toHaveCount(0);
  await expect(page.locator(".status-strip").getByText(/^stack \d/)).toHaveCount(0);
});

test("shows a Stack tab with the chain, merge plan and header chip for stacked PRs", async ({ page }) => {
  if (process.env.MNLENS_E2E_SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, { stack: stackedPr });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();

  // The queue row and the header both announce the position; the header chip opens the tab.
  await expect(page.locator(".pr-row.selected").getByText("2/3")).toBeVisible();
  await page.locator(".status-strip").getByRole("button", { name: /stack 2\/3 on #838/ }).click();
  await expect(page.getByRole("button", { name: /^Stack\s*2\/3$/ })).toHaveClass(/active/);

  const stackTab = page.getByRole("region", { name: "Pull request stack" });
  await expect(stackTab.getByText("Stacked pull request")).toBeVisible();
  await expect(stackTab.getByText(/This diff is relative to #838 \(ucp-skeleton\), which is approved/)).toBeVisible();
  await expect(stackTab.locator(".stack-node")).toHaveCount(3);
  await expect(stackTab.locator(".stack-node.current")).toContainText("#839");
  await expect(stackTab.locator(".stack-node").nth(2)).toContainText("draft");
  await expect(stackTab.getByRole("button", { name: "Restack onto #838" })).toBeVisible();
  await expect(stackTab.locator(".stack-merge-steps li.current")).toContainText("not approved");
  await expect(stackTab.getByRole("button", { name: "Merge #838" })).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/stack-tab.png`, fullPage: true });

  // Selecting another PR of the chain opens it in MNLens.
  await stackTab.getByRole("button", { name: /#840 Document UCP telemetry/ }).click();
  await expect(page.getByRole("button", { name: /^Overview/ })).toHaveClass(/active/);
});

test("Overview keeps secondary sections collapsed and opens them on demand", async ({ page }) => {
  if (process.env.MNLENS_E2E_SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.getByText("Review Summary")).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview-top.png` });
    await page.evaluate(() => localStorage.setItem("mnlens-theme", "dark"));
    await page.reload();
    await expect(page.getByText("Review Summary")).toBeVisible();
    await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview-dark.png` });
    await page.evaluate(() => localStorage.setItem("mnlens-theme", "light"));
    await page.reload();
    await expect(page.getByText("Review Summary")).toBeVisible();
  }
  const rulesGroup = page.getByRole("button", { name: /Repository rules & review memory/ });
  await expect(rulesGroup).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Repo Review Memory")).toHaveCount(0);
  await rulesGroup.click();
  await expect(page.getByText("Repo Review Memory")).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy as \.mnlens\/review-rules\.json/ })).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/overview.png`, fullPage: true });
  await page.getByRole("button", { name: /Settings: agent & models/ }).click();
  await page.getByRole("menuitem", { name: "Team sharing" }).click();
  await expect(page.getByRole("dialog", { name: "Team sharing" })).toBeVisible();
  await expect(page.getByText("local only")).toBeVisible();
});

test("Review tab turns the agent's draft into the reviewer's own comments", async ({ page }) => {
  if (process.env.MNLENS_E2E_SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();

  await page.getByRole("button", { name: /^Review\s*2$/ }).click();
  await expect(page.getByText("Recommended Review")).toBeVisible();
  await expect(page.getByText("Request changes").first()).toBeVisible();
  await expect(page.getByText("register() is empty")).toBeVisible();
  await expect(page.locator(".review-tier-must").first()).toBeVisible();
  await expect(page.getByText("75% kept")).toBeVisible();
  if (process.env.MNLENS_E2E_SHOTS) await page.screenshot({ path: `${process.env.MNLENS_E2E_SHOTS}/review-tab.png`, fullPage: true });

  const blocking = page.locator(".review-comment.kind-blocking");
  await expect(blocking.locator(".review-comment-suggestion pre")).toContainText("registerMetrics(pool)");
  await blocking.getByRole("button", { name: "Add to my review" }).click();
  await expect(blocking.getByRole("button", { name: "In my review" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Comment\s*1$/ })).toBeVisible();

  await page.getByRole("button", { name: "Use as review comment" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator("textarea")).toHaveValue(/register\(\)` is empty/);
});

test("supports dark theme and the mobile review queue layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.addInitScript(() => {
    localStorage.setItem("mnlens-theme", "dark");
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /Review queue/i })).toBeVisible();

  await page.getByRole("button", { name: /Review queue/i }).click();
  await expect(page.getByRole("heading", { name: "MNLens" })).toBeVisible();
  const selectedQueueRow = page.locator(".pr-row.selected.queue").first();
  await expect(selectedQueueRow).toBeVisible();
  // "queue" tone = amber (--mn-warn) in the dark palette.
  await expect(selectedQueueRow).toHaveCSS("border-left-color", "rgb(201, 160, 74)");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("shows interrupted verification and Codex sessions as resumable review state", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Verification interrupted.").first()).toBeVisible();
  await expect(page.getByText("Run this check again to continue.").first()).toBeVisible();

  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(page.getByText("Fix session interrupted").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry session" })).toBeVisible();
  await expect(page.locator("#fix-session-fix-interrupted-1").getByText("Overview / Risks / Silent telemetry failure")).toBeVisible();
});

test("surfaces GitHub rate-limit state and starts an explicit deep analysis", async ({ page }) => {
  const analyzeRequests: unknown[] = [];
  await mockApi(page, {
    analysisOverride: null,
    prOverride: {
      aiType: undefined,
      analysisStatus: undefined,
      analysisMode: undefined,
      analysisUpdatedAt: undefined,
      aiRiskCount: undefined,
      aiTestsCount: undefined,
      fastScore: 61,
      fastScoreLabel: "needs review",
      fastScoreTone: "queue",
      fastScoreConfidence: "medium"
    },
    authOverride: {
      githubRateLimit: {
        limited: false,
        limit: 5000,
        remaining: 4230,
        used: 770,
        resetAt: "2026-05-08T16:56:54.000Z",
        resource: "core"
      }
    },
    analyzeJob: runningAnalysisJob,
    onAnalyze: (payload) => analyzeRequests.push(payload)
  });

  await page.goto("/");

  await expect(page.getByText(/GitHub API 4230\/5000 left/)).toBeVisible();
  await expect(page.locator(".bulk-actions").getByRole("button", { name: /Fast Analyze visible/i })).toBeVisible();
  // Both the header and the "Start here" card offer Deep Analyze; use the header one.
  await page.getByRole("button", { name: "Deep Analyze — start here" }).click();

  await expect.poll(() => analyzeRequests.length).toBe(1);
  expect(analyzeRequests[0]).toMatchObject({ mode: "deep", force: false });
  await expect(page.getByText("Codex analysis is running.")).toBeVisible();
});

test("promotes unresolved line comments into Reviewer Focus and sends them to Codex with context", async ({ page }) => {
  const fixRequests: unknown[] = [];
  await mockApi(page, {
    onStartFix: (payload) => fixRequests.push(payload)
  });
  await page.goto("/");

  const focus = page.locator(".insight-list article").filter({ hasText: "UniversalConnectionPoolBeanEventListener.java:5" }).first();
  await expect(focus).toContainText("can this use the existing lifecycle registration helper");
  await expect(page.locator(".insight-section.focus").getByText("resolved old comment that should not drive the current review plan")).toHaveCount(0);

  await focus.getByRole("button", { name: "Ask the agent about this" }).click();
  await focus.getByRole("button", { name: "Fix with the agent" }).click();

  await expect.poll(() => fixRequests.length).toBe(1);
  expect(fixRequests[0]).toMatchObject({
    source: expect.stringMatching(/^Overview \/ Reviewer Focus \/ (Review focus|Focus) \d+$/)
  });
  await expect(page.getByRole("button", { name: "Codex", exact: true })).toHaveClass(/active/);
  await expect(page.getByText(/Overview \/ Reviewer Focus \/ (Review focus|Focus) \d+/).first()).toBeVisible();
});

test("supports find inside code diff views", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.locator(".file-toggle").filter({ hasText: /UniversalConnectionPoolBeanEventListener\.java/ }).click();
  const diffViewer = page.getByRole("table", { name: "Pull request patch" });
  await diffViewer.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+F" : "Control+F");

  const search = page.getByRole("search").getByPlaceholder("Find in diff");
  await expect(search).toBeFocused();
  await search.fill("register()");

  await expect(page.locator(".code-find-match").filter({ hasText: "register()" }).first()).toBeVisible();
  await expect(page.getByRole("search")).toContainText("1/1");
});

test("shows active Tool activity, opens the related Codex session, and can cancel it", async ({ page }) => {
  const cancelled: string[] = [];
  await mockApi(page, {
    activeFixes: [runningFix],
    selectedFixes: [runningFix, interruptedFix],
    onCancel: (path) => cancelled.push(path)
  });
  await page.goto("/");

  const activity = page.locator(".work-activity-row").filter({ hasText: "Codex fix" }).first();
  await expect(activity).toContainText("Tests/QA is checking coverage.");

  await activity.locator(".work-activity-open").click();
  await expect(page.getByRole("button", { name: "Codex", exact: true })).toHaveClass(/active/);
  await expect(page.locator("#fix-session-fix-running-activity").getByText("Tool activity / beta coverage")).toBeVisible();

  await activity.locator(".work-activity-cancel").click();
  await expect.poll(() => cancelled.some((path) => path.includes("/api/fixes/fix-running-activity/cancel"))).toBe(true);
  await expect(page.getByText("Codex Fix session cancellation requested.")).toBeVisible();
});

async function mockApi(page: Page, options: MockApiOptions = {}) {
  const prResponse = { ...pr, ...options.prOverride };
  const detailResponse = { ...detail, ...options.detailOverride };
  const selectedFixes = options.selectedFixes ?? [interruptedFix];
  const activeFixes = options.activeFixes ?? [];
  const defaultStartedFix = {
    ...interruptedFix,
    id: "fix-started-from-reviewer-focus",
    status: "running",
    phase: "implementation",
    statusMessage: "Codex is addressing the selected review point.",
    source: "Overview / Reviewer Focus / Focus 1",
    error: undefined,
    recoveryMessage: undefined,
    resumable: false,
    updatedAt: now
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/cancel")) {
      options.onCancel?.(path);
      const id = path.split("/").at(-2) ?? "cancelled";
      if (path.startsWith("/api/fixes/")) return json({ ...runningFix, id, status: "failed", statusMessage: "Cancellation requested." });
      if (path.startsWith("/api/jobs/")) return json({ ...runningAnalysisJob, id, status: "failed", statusMessage: "Cancellation requested." });
      if (path.startsWith("/api/verification/")) return json({ ...interruptedVerification, id, status: "failed", statusMessage: "Cancellation requested." });
    }
    if (path.startsWith("/api/jobs/")) {
      return json(options.analyzeJob ?? runningAnalysisJob);
    }
    if (path === "/api/session") {
      return json({
        token: "test-session",
        mode: "local",
        betaLimitations: [
          "MNLens is local-only.",
          "Queued or running jobs do not survive restart.",
          "Codex pushes only after human approval."
        ]
      });
    }
    if (path === "/api/setup/status") {
      return json({
        checkedAt: now,
        platform: "darwin",
        ready: true,
        dependencies: [
          { id: "git", name: "Git", required: true, installed: true, version: "git version 2.0", installHint: "" },
          { id: "gh", name: "GitHub CLI", required: true, installed: true, version: "gh version 2.0", installHint: "" },
          { id: "codex", name: "Codex CLI", required: true, installed: true, version: "codex 1.0", installHint: "" },
          { id: "codex-auth", name: "Codex authentication", required: true, installed: true, version: "OK", installHint: "" },
          { id: "secure-store", name: "macOS Keychain", required: true, installed: true, version: "available", installHint: "" }
        ]
      });
    }
    if (path === "/api/auth/status") {
      return json({
        hasKeychainToken: true,
        ghAvailable: true,
        ghAuthenticated: true,
        tokenStore: "macos-keychain",
        setupSupported: true,
        setupHint: "gh auth login",
        scopeCheck: "ok",
        tokenScopes: ["repo"],
        missingScopes: [],
        username: "reviewer",
        githubRateLimit: {
          limited: false,
          limit: 5000,
          remaining: 4859,
          used: 141,
          resetAt: "2026-05-08T16:56:54.000Z",
          resource: "core"
        },
        ...options.authOverride
      });
    }
    if (path === "/api/analyze") {
      const payload = route.request().postDataJSON();
      options.onAnalyze?.(payload);
      return json({ jobs: [options.analyzeJob ?? runningAnalysisJob] });
    }
    if (path === "/api/fixes" && route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      options.onStartFix?.(payload);
      return json({ ...defaultStartedFix, instructions: payload.instructions, source: payload.source });
    }
    if (path === "/api/prs") return json([prResponse]);
    if (path === "/api/prs/micronaut-projects/micronaut-tracing/839") return json(detailResponse);
    if (path === `/api/analysis/${prKey}`) return json(options.analysisOverride === undefined ? analysis : options.analysisOverride);
    if (path === `/api/progress/${prKey}`) {
      return json({
        prKey,
        checkedItems: [],
        reviewedFiles: [],
        ignoredRuleIds: [],
        manualChecks: {},
        notes: "",
        updatedAt: now
      });
    }
    if (path === "/api/github/rate-limit") {
      return json(options.authOverride?.githubRateLimit ?? { limited: false, limit: 5000, remaining: 4859, used: 141, resetAt: "2026-05-08T16:56:54.000Z", resource: "core" });
    }
    if (path === "/api/repos/micronaut-projects/micronaut-tracing/branches") return json([{ name: "8.0.x", protected: true }, { name: "ucp-skeleton", protected: false }]);
    if (path === "/api/stacks/summary") {
      return json(options.stack ? { [prKey]: { size: options.stack.chain.length, position: options.stack.position, parentNumber: options.stack.parent?.number, childNumbers: options.stack.children.map((child) => child.number) } } : {});
    }
    if (path === "/api/stacks/micronaut-projects/micronaut-tracing/839/merge-plan") return json(options.mergePlan ?? stackMergePlan);
    if (path === "/api/stacks/micronaut-projects/micronaut-tracing/839") {
      return json(options.stack ?? { repository: "micronaut-projects/micronaut-tracing", number: 839, isStacked: false, chain: [], position: 0, children: [], trunk: "", fetchedAt: now });
    }
    if (path === "/api/verification") return json(options.verificationJobs ?? [interruptedVerification]);
    if (path === "/api/fixes") return json(url.searchParams.get("active") === "true" ? activeFixes : selectedFixes);
    if (path === "/api/ci/micronaut-projects/micronaut-tracing/839") {
      return json([{ name: "build", state: "SUCCESS", link: "https://github.com/checks/1", workflow: "CI", bucket: "pass" }]);
    }
    if (path === "/api/repo-rules/micronaut-projects/micronaut-tracing") return json([]);
    if (path === "/api/cache") return json({ prCount: 1, analysisCount: 1, cacheDir: "/tmp/mnlens" });
    if (path === `/api/review-draft/${prKey}`) return json(reviewDraft);
    if (path === "/api/review-draft" && route.request().method() === "POST") return json(reviewDraft);
    if (path === `/api/acceptance/${prKey}`) return json(options.acceptance ?? null);
    if (path.startsWith("/api/review-memory/") || (path === "/api/review-memory" && route.request().method() === "POST")) {
      return json({ repository: "micronaut-projects/micronaut-tracing", total: 4, kept: 3, dismissed: 1, patterns: [], prVerdicts: {}, draftComments: { kept: 3, dismissed: 1, byKind: { blocking: { kept: 2, dismissed: 0 }, nit: { kept: 1, dismissed: 1 } } }, members: 2, shared: true });
    }
    if (path === "/api/team") return json({ source: "none", exists: false, writable: false, memberId: "me@laptop", repositories: [] });
    if (path.startsWith("/api/usage/")) return json({ prKey, totalCostUsd: 0, runs: [] });

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unhandled ${path}` }) });
  });
}
