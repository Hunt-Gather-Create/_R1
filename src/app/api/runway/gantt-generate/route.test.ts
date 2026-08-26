import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/runway/gantt/server", () => ({
  generateGanttShare: vi.fn().mockResolvedValue({
    shareUrl: "https://example.com/share/abc",
    expiresAt: "2026-01-01T00:00:00.000Z",
    summary: { items: 0 },
  }),
}));

function makeRequest(options?: { token?: string | null }): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.token !== null && options?.token !== undefined) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  return new Request("http://localhost/api/runway/gantt-generate", {
    method: "POST",
    headers,
    body: JSON.stringify({ clientSlug: "soundly" }),
  });
}

describe("POST /api/runway/gantt-generate auth", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RUNWAY_MCP_API_KEY = "test_api_key";
  });

  it("returns 401 when no Authorization header", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: null }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: "wrong_key" }) as never);
    expect(res.status).toBe(401);
  });

  it("passes the auth gate for the correct token (not 401)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: "test_api_key" }) as never);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("returns 500 when RUNWAY_MCP_API_KEY is not configured", async () => {
    delete process.env.RUNWAY_MCP_API_KEY;
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: "anything" }) as never);
    expect(res.status).toBe(500);
  });
});
