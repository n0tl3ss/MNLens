import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyTokenScopes, parseOauthScopes } from "../src/server/gh";
import {
  GithubRateLimitError,
  assertGithubRateLimitAvailable,
  githubRateLimitStatus,
  noteGithubRateLimit,
  noteGithubRateLimitBody,
  noteGithubRateLimitHeaders,
  pickBusiestRateLimitResource,
  resetGithubRateLimitForTests
} from "../src/server/githubRateLimit";

describe("GitHub token scope inspection", () => {
  beforeEach(() => resetGithubRateLimitForTests());
  afterEach(() => resetGithubRateLimitForTests());

  it("parses advertised OAuth scopes from gh response headers", () => {
    expect(
      parseOauthScopes(`HTTP/2 200
x-oauth-scopes: workflow, public_repo, read:org
x-accepted-oauth-scopes: repo
`)
    ).toEqual(["public_repo", "read:org", "workflow"]);
  });

  it("accepts full classic repo scope", () => {
    expect(classifyTokenScopes(["repo", "workflow"])).toMatchObject({
      scopeCheck: "ok",
      tokenScopes: ["repo", "workflow"],
      missingScopes: []
    });
  });

  it("treats public_repo as enough for public repository workflows", () => {
    expect(classifyTokenScopes(["public_repo"])).toMatchObject({
      scopeCheck: "limited",
      tokenScopes: ["public_repo"],
      missingScopes: []
    });
  });

  it("flags classic tokens without repository access", () => {
    expect(classifyTokenScopes(["read:user"])).toMatchObject({
      scopeCheck: "missing",
      tokenScopes: ["read:user"],
      missingScopes: ["repo"]
    });
  });

  it("keeps fine-grained or unadvertised scopes as unknown instead of demanding broad repo", () => {
    expect(classifyTokenScopes([])).toMatchObject({
      scopeCheck: "unknown",
      tokenScopes: [],
      missingScopes: []
    });
  });

  it("records GitHub API rate-limit responses as a local cooldown", () => {
    expect(
      noteGithubRateLimit(
        "gh: API rate limit exceeded for user ID 44323106. If you reach out to GitHub Support for help, please include the request ID D04E:30B7E0:FE18574:F054723:69FDED75"
      )
    ).toBe(true);
    expect(githubRateLimitStatus()).toMatchObject({ limited: true });
    expect(() => assertGithubRateLimitAvailable()).toThrow(GithubRateLimitError);
  });

  it("records primary rate-limit response headers for display", () => {
    noteGithubRateLimitHeaders(`HTTP/2 200
x-ratelimit-limit: 5000
x-ratelimit-remaining: 4321
x-ratelimit-used: 679
x-ratelimit-reset: 1778248800
x-ratelimit-resource: core
`);

    expect(githubRateLimitStatus()).toMatchObject({
      limited: false,
      limit: 5000,
      remaining: 4321,
      used: 679,
      resource: "core"
    });
  });

  it("records primary rate-limit response bodies for display", () => {
    noteGithubRateLimitBody({
      resources: {
        core: {
          limit: 5000,
          remaining: 4999,
          used: 1,
          reset: 1778248800
        }
      }
    });

    expect(githubRateLimitStatus()).toMatchObject({
      limited: false,
      limit: 5000,
      remaining: 4999,
      used: 1,
      resource: "core"
    });
  });

  it("reports the busiest metered resource, not just REST core", () => {
    noteGithubRateLimitBody({
      resources: {
        core: { limit: 5000, remaining: 5000, used: 0, reset: 1778248800 },
        graphql: { limit: 5000, remaining: 3100, used: 1900, reset: 1778248900 },
        search: { limit: 30, remaining: 30, used: 0, reset: 1778248860 },
        integration_manifest: { limit: 5000, remaining: 10, used: 4990, reset: 1778248800 }
      }
    });

    const status = githubRateLimitStatus();
    expect(status).toMatchObject({ limited: false, resource: "graphql", limit: 5000, remaining: 3100, used: 1900 });
    expect(status.resetAt).toBe(new Date(1778248900 * 1000).toISOString());
    expect(status.resources?.core).toMatchObject({ remaining: 5000 });
    expect(status.resources?.search).toMatchObject({ remaining: 30, limit: 30 });
  });

  it("keeps REST core as the headline when every budget is untouched", () => {
    expect(
      pickBusiestRateLimitResource({
        graphql: { limit: 5000, remaining: 5000, used: 0 },
        core: { limit: 5000, remaining: 5000, used: 0 }
      })
    ).toBe("core");
    // Per-minute search budgets do not hijack the headline unless they are fully drained.
    expect(
      pickBusiestRateLimitResource({
        core: { limit: 5000, remaining: 4000, used: 1000 },
        search: { limit: 30, remaining: 2, used: 28 }
      })
    ).toBe("core");
    expect(
      pickBusiestRateLimitResource({
        core: { limit: 5000, remaining: 4000, used: 1000 },
        search: { limit: 30, remaining: 0, used: 30 }
      })
    ).toBe("search");
  });

  it("merges header-derived REST state with the resources already known", () => {
    noteGithubRateLimitBody({ resources: { graphql: { limit: 5000, remaining: 2000, used: 3000, reset: 1778248900 } } });
    noteGithubRateLimitHeaders(`HTTP/2 200
x-ratelimit-limit: 5000
x-ratelimit-remaining: 4990
x-ratelimit-used: 10
x-ratelimit-reset: 1778248800
x-ratelimit-resource: core
`);

    const status = githubRateLimitStatus();
    expect(status.resource).toBe("graphql");
    expect(status.resources?.core).toMatchObject({ remaining: 4990, used: 10 });
  });

  it("pauses GitHub work when the GraphQL budget is exhausted", () => {
    const reset = Math.floor((Date.now() + 60_000) / 1000);
    noteGithubRateLimitBody({
      resources: {
        core: { limit: 5000, remaining: 4800, used: 200, reset },
        graphql: { limit: 5000, remaining: 0, used: 5000, reset }
      }
    });

    expect(githubRateLimitStatus()).toMatchObject({ limited: true, resource: "graphql", remaining: 0 });
    expect(() => assertGithubRateLimitAvailable()).toThrow(GithubRateLimitError);
  });

  it("pauses GitHub work when primary rate-limit headers report zero remaining", () => {
    const reset = Math.floor((Date.now() + 60_000) / 1000);
    noteGithubRateLimitHeaders(`HTTP/2 200
x-ratelimit-limit: 5000
x-ratelimit-remaining: 0
x-ratelimit-used: 5000
x-ratelimit-reset: ${reset}
x-ratelimit-resource: core
`);

    expect(githubRateLimitStatus()).toMatchObject({ limited: true, remaining: 0, resource: "core" });
    expect(() => assertGithubRateLimitAvailable()).toThrow(GithubRateLimitError);
  });
});
