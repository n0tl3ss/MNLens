import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server/app.js";

const requests: Array<{
  path: string;
  method: string;
  body?: unknown;
  expectedStatus: number;
}> = [
  { path: "/api/analyze", method: "POST", body: { prs: [] }, expectedStatus: 400 },
  { path: "/api/rebase-default", method: "POST", body: {}, expectedStatus: 400 },
  { path: "/api/reviews", method: "POST", body: { event: "COMMENT", comments: [] }, expectedStatus: 400 },
  { path: "/api/verification", method: "POST", body: { owner: "o", repo: "r", number: 1 }, expectedStatus: 400 },
  { path: "/api/fixes", method: "POST", body: { owner: "o", repo: "r" }, expectedStatus: 400 }
];

describe("server API hardening", () => {
  let server: Server;
  let baseUrl: string;
  let sessionToken: string;

  beforeAll(async () => {
    const app = await createApp({ serveClient: false });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind test server.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    const session = (await (await fetch(`${baseUrl}/api/session`)).json()) as { token: string };
    sessionToken = session.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("requires the local session token for API routes", async () => {
    const response = await fetch(`${baseUrl}/api/prs`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("session token")
    });
  });

  it("rejects non-local browser origins even with a valid session token", async () => {
    const response = await fetch(`${baseUrl}/api/prs`, {
      headers: {
        "x-mnlens-session": sessionToken,
        origin: "https://example.com"
      }
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("local app origin")
    });
  });

  it("returns beta limitations through the unauthenticated session endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/session`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; betaLimitations: string[] };
    expect(body.mode).toBe("local");
    expect(body.betaLimitations).toContain("Codex prepares reviewable code changes. It does not commit or push until a human explicitly approves.");
  });

  for (const item of requests) {
    it(`validates ${item.method} ${item.path}`, async () => {
      const response = await fetch(`${baseUrl}${item.path}`, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          "x-mnlens-session": sessionToken
        },
        body: item.body === undefined ? undefined : JSON.stringify(item.body)
      });
      expect(response.status).toBe(item.expectedStatus);
      await expect(response.json()).resolves.toHaveProperty("error");
    });
  }

  it("keeps artifact access scoped to known artifact routes", async () => {
    const response = await fetch(`${baseUrl}/api/artifacts/not-a-job/missing.png`, {
      headers: { "x-mnlens-session": sessionToken }
    });
    expect(response.status).toBe(404);
  });
});
