import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP server
vi.mock("@/lib/mcp/runway-server", () => ({
  createRunwayMcpServer: () => ({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => {
  class MockTransport {
    handleRequest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  }
  return { WebStandardStreamableHTTPServerTransport: MockTransport };
});

function makeRequest(
  options?: { token?: string | null; method?: string }
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.token !== null && options?.token !== undefined) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  return new Request("http://localhost/api/mcp/runway", {
    method: options?.method ?? "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
  });
}

describe("POST /api/mcp/runway", () => {
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

  it("returns 500 when RUNWAY_MCP_API_KEY is not configured", async () => {
    delete process.env.RUNWAY_MCP_API_KEY;
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: "anything" }) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Server misconfigured");
  });

  it("processes request with valid token", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ token: "test_api_key" }) as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/mcp/runway", () => {
  it("returns 405 Method Not Allowed", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe("DELETE /api/mcp/runway", () => {
  it("returns 405 Method Not Allowed", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE();
    expect(res.status).toBe(405);
  });
});
