import { describe, expect, it } from "vitest";
import { keychainHint } from "../src/server/keychain";

describe("keychain hint", () => {
  it("documents the configured GitHub token location", () => {
    expect(keychainHint()).toContain("-a github-mcp-token");
    expect(keychainHint()).toContain("-s multicode.github");
  });
});
