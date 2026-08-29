import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression test for #112: the route compared `x-embed-secret` to
 * RUNWAY_EMBED_SECRET with plain `!==`. Fixed to route through
 * timingSafeTokenMatch, the same helper mcp/runway and gantt-generate use.
 *
 * These calls run the real exported GET handler, not the helper in
 * isolation — timingSafeTokenMatch already has its own unit test
 * (timing-safe-token.test.ts). What was untested is that this handler
 * actually calls it. No clientId is supplied, so a request that clears the
 * auth gate falls through to the 400 "clientId required" branch instead of
 * a 401 — that transition from 401 to non-401 is what proves the gate
 * opened, without needing to mock the DB or the renderer.
 */
function makeRequest(secretHeader?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (secretHeader !== null && secretHeader !== undefined) {
    headers["x-embed-secret"] = secretHeader;
  }
  return new NextRequest("http://localhost/api/runway/gantt-embed", { headers });
}

describe("GET /api/runway/gantt-embed auth (#112)", () => {
  beforeEach(() => {
    process.env.RUNWAY_EMBED_SECRET = "test_embed_secret";
  });

  it("returns 401 when no x-embed-secret header is sent", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the secret is wrong", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("wrong_secret"));
    expect(res.status).toBe(401);
  });

  it("passes the auth gate for the correct secret (not 401)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("test_embed_secret"));
    expect(res.status).not.toBe(401);
    // No clientId query param supplied — falls through to the next
    // validation branch, which is the proof the auth gate actually opened.
    expect(res.status).toBe(400);
  });
});
