import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyTokenScopes, parseOauthScopes } from "../src/server/gh";
import {
  GithubRateLimitError,
  assertGithubRateLimitAvailable,
  githubRateLimitStatus,
  noteGithubRateLimit,
  noteGithubRateLimitBody,
  noteGithubRateLimitHeaders,
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
