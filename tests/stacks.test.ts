import { describe, expect, it } from "vitest";
import { buildRepoGraph, buildStack, stackPromptContext } from "../src/server/stacks";

const prs = [
  { number: 10, title: "Add schema", url: "u10", baseRefName: "main", headRefName: "feat/schema", isDraft: false, state: "OPEN" },
  { number: 11, title: "Add service", url: "u11", baseRefName: "feat/schema", headRefName: "feat/service", isDraft: false, state: "OPEN", reviewDecision: "APPROVED" },
  { number: 12, title: "Add API", url: "u12", baseRefName: "feat/service", headRefName: "feat/api", isDraft: true, state: "OPEN" },
  { number: 13, title: "Alt API", url: "u13", baseRefName: "feat/service", headRefName: "feat/api-alt", isDraft: false, state: "OPEN" },
  { number: 20, title: "Unrelated", url: "u20", baseRefName: "main", headRefName: "fix/typo", isDraft: false, state: "OPEN" },
  { number: 30, title: "Fork PR", url: "u30", baseRefName: "main", headRefName: "feat/schema", isDraft: false, state: "OPEN", headRepository: { nameWithOwner: "someone/fork" } }
];

describe("stack graph", () => {
  const graph = buildRepoGraph("acme/app", prs);

  it("links children to the open PR that owns their base branch", () => {
    expect(graph.byNumber.get(11)?.parentNumber).toBe(10);
    expect(graph.byNumber.get(10)?.childNumbers).toEqual([11]);
    expect(graph.byNumber.get(11)?.childNumbers).toEqual([12, 13]);
    expect(graph.byNumber.get(20)?.parentNumber).toBeUndefined();
  });

  it("ignores fork heads as stack parents", () => {
    // #30 shares a head branch name with #10 but lives in a fork, so #11 must still point at #10.
    expect(graph.byNumber.get(11)?.parentNumber).toBe(10);
  });

  it("builds the chain root → leaf through the selected PR", () => {
    const stack = buildStack(graph, 11);
    expect(stack.isStacked).toBe(true);
    expect(stack.chain.map((node) => node.number)).toEqual([10, 11, 12]);
    expect(stack.position).toBe(2);
    expect(stack.parent?.number).toBe(10);
    expect(stack.children.map((node) => node.number)).toEqual([12, 13]);
    expect(stack.trunk).toBe("main");
  });

  it("reports root and leaf positions", () => {
    expect(buildStack(graph, 10).position).toBe(1);
    expect(buildStack(graph, 10).parent).toBeUndefined();
    const leaf = buildStack(graph, 13);
    expect(leaf.chain.map((node) => node.number)).toEqual([10, 11, 13]);
    expect(leaf.position).toBe(3);
  });

  it("treats standalone PRs as not stacked", () => {
    const single = buildStack(graph, 20);
    expect(single.isStacked).toBe(false);
    expect(single.chain).toHaveLength(1);
    expect(buildStack(graph, 999).chain).toHaveLength(0);
  });

  it("does not loop on cyclic base/head references", () => {
    const cyclic = buildRepoGraph("acme/app", [
      { number: 1, title: "a", url: "", baseRefName: "b", headRefName: "a", isDraft: false, state: "OPEN" },
      { number: 2, title: "b", url: "", baseRefName: "a", headRefName: "b", isDraft: false, state: "OPEN" }
    ]);
    const stack = buildStack(cyclic, 1);
    expect(stack.chain.length).toBeLessThanOrEqual(2);
  });

  it("produces prompt context only for stacked PRs", () => {
    expect(stackPromptContext(buildStack(graph, 20))).toBeUndefined();
    const context = stackPromptContext(buildStack(graph, 12)) as Record<string, unknown>;
    expect(context.position).toBe("3 of 3");
    expect((context.parent as { number: number }).number).toBe(11);
  });
});

describe("stack merge plan", () => {
  it("only marks the lowest fully-ready PR as next and blocks children on their parent", async () => {
    const { buildRepoGraph, buildStack, stackMergePlan } = await import("../src/server/stacks");
    const graph = buildRepoGraph("acme/app", [
      { number: 1, title: "root", url: "", baseRefName: "main", headRefName: "a", isDraft: false, state: "OPEN", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" },
      { number: 2, title: "child", url: "", baseRefName: "a", headRefName: "b", isDraft: false, state: "OPEN", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" },
      { number: 3, title: "leaf", url: "", baseRefName: "b", headRefName: "c", isDraft: true, state: "OPEN", reviewDecision: null, mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }
    ]);
    const plan = stackMergePlan(buildStack(graph, 2));
    expect(plan.nextNumber).toBe(1);
    expect(plan.steps[0].ready).toBe(true);
    expect(plan.steps[1].ready).toBe(false);
    expect(plan.steps[1].blockers).toEqual(["parent PR must merge first"]);
    expect(plan.steps[2].blockers).toEqual(expect.arrayContaining(["draft", "not approved", "merge conflicts"]));
    expect(plan.steps[1].isCurrent).toBe(true);
  });
});
