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
  docs: [
    {
      title: "OpenTelemetry Oracle UCP library instrumentation",
      url: "https://github.com/open-telemetry/opentelemetry-java-instrumentation",
      reason: "Direct upstream API.",
      framework: "OpenTelemetry",
      repository: "open-telemetry/opentelemetry-java-instrumentation",
      filePath: "instrumentation/oracle-ucp-11.2/library/README.md",
      codeSnippet: "OracleUcpTelemetry.create(openTelemetry).registerMetrics(pool);",
      comparison: "The PR automates this lifecycle through Micronaut.",
      caveat: "Metric names still need tests."
    }
  ],
  similarImplementations: [
    {
      title: "Oracle cloudbank UCPTelemetry",
      url: "https://github.com/oracle/microservices-backend",
      reason: "Shows direct OracleUcpTelemetry usage.",
      framework: "Oracle sample",
      repository: "oracle/microservices-backend",
      filePath: "cloudbank-v5/common/src/main/java/com/example/common/ucp/UCPTelemetry.java",
      codeSnippet: "this.ucpTelemetry = OracleUcpTelemetry.create(openTelemetry);",
      comparison: "Comparable manual wiring.",
      caveat: "Sample app, not Micronaut autoconfiguration."
    }
  ],
  caveats: ["No live Oracle UCP database pool is exercised."],
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
    { phase: "research", label: "Research", status: "done", updatedAt: now },
    { phase: "implementation", label: "Implementation", status: "failed", message: "Interrupted when MNLens stopped; retry can continue from this phase.", updatedAt: now },
    { phase: "tests-qa", label: "Tests/QA", status: "pending", updatedAt: now },
    { phase: "docs", label: "Docs", status: "pending", updatedAt: now },
    { phase: "security", label: "Security", status: "pending", updatedAt: now },
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

type MockApiOptions = {
  prOverride?: Partial<typeof pr>;
  detailOverride?: Partial<typeof detail>;
  analysisOverride?: typeof analysis | null;
  activeFixes?: Array<typeof interruptedFix>;
  selectedFixes?: Array<typeof interruptedFix>;
  authOverride?: Record<string, unknown>;
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
    ["Plan", "Changed Files"],
    ["Diff", "Changed Files"],
    ["Commits", "Commit Story"],
    ["Research", "Similar Implementations"],
    ["Codex", "Codex Fix Session"],
    ["Comment", "Conversation"],
    ["Handoff", "Review Trace"]
  ] as const;

  for (const [tab, expectedText] of tabExpectations) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByText(expectedText).first()).toBeVisible();
  }
});

test("supports dark theme and the mobile review queue layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.addInitScript(() => {
    localStorage.setItem("pra-theme", "dark");
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Add Oracle UCP telemetry" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /Review queue/i })).toBeVisible();

  await page.getByRole("button", { name: /Review queue/i }).click();
  await expect(page.getByRole("heading", { name: "MNLens" })).toBeVisible();
  const selectedQueueRow = page.locator(".pr-row.selected.queue").first();
  await expect(selectedQueueRow).toBeVisible();
  await expect(selectedQueueRow).toHaveCSS("border-left-color", "rgb(118, 104, 255)");

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
  await page.getByRole("button", { name: "Deep Analyze recommended" }).click();

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

  await focus.getByRole("button", { name: "Address with Codex" }).click();

  await expect.poll(() => fixRequests.length).toBe(1);
  expect(fixRequests[0]).toMatchObject({
    source: expect.stringMatching(/^Overview \/ Reviewer Focus \/ Focus \d+$/)
  });
  await expect(page.getByRole("button", { name: "Codex", exact: true })).toHaveClass(/active/);
  await expect(page.getByText(/Overview \/ Reviewer Focus \/ Focus \d+/).first()).toBeVisible();
});

test("supports find inside code diff views", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Diff", exact: true }).click();
  await page.getByRole("button", { name: /UniversalConnectionPoolBeanEventListener\.java/ }).click();
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
    if (path === "/api/github-projects/micronaut-projects") return json([]);
    if (path === "/api/verification") return json([interruptedVerification]);
    if (path === "/api/fixes") return json(url.searchParams.get("active") === "true" ? activeFixes : selectedFixes);
    if (path === "/api/ci/micronaut-projects/micronaut-tracing/839") {
      return json([{ name: "build", state: "SUCCESS", link: "https://github.com/checks/1", workflow: "CI", bucket: "pass" }]);
    }
    if (path === "/api/repo-rules/micronaut-projects/micronaut-tracing") return json([]);
    if (path === "/api/cache") return json({ prCount: 1, analysisCount: 1, cacheDir: "/tmp/mnlens" });

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unhandled ${path}` }) });
  });
}
