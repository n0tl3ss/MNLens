import { afterEach, describe, expect, it } from "vitest";
import { agentGithubEnv, agentOmitEnv, githubHost, githubWebUrl } from "../src/server/githubHost.js";
import { mergeEnv } from "../src/server/command.js";

describe("github host and agent environment", () => {
  afterEach(() => {
    delete process.env.MNLENS_GITHUB_HOST;
    delete process.env.MNLENS_AGENT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  it("defaults to github.com and honours an enterprise host", () => {
    expect(githubHost()).toBe("github.com");
    process.env.MNLENS_GITHUB_HOST = "https://github.example.com/";
    expect(githubHost()).toBe("github.example.com");
    expect(githubWebUrl("acme/app/pull/1")).toBe("https://github.example.com/acme/app/pull/1");
  });

  it("never hands the reviewer token to agents, but allows an explicit read-only token", () => {
    process.env.GH_TOKEN = "reviewer-secret";
    const env = mergeEnv(agentGithubEnv(), agentOmitEnv);
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GH_HOST).toBe("github.com");
    process.env.MNLENS_AGENT_GITHUB_TOKEN = "read-only";
    expect(mergeEnv(agentGithubEnv(), agentOmitEnv).GH_TOKEN).toBe("read-only");
  });
});
