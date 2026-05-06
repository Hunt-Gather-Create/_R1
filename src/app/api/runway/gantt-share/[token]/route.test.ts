/**
 * Unit tests for GET /api/runway/gantt-share/[token]
 *
 * Mocks: @/lib/storage/r2-client, @/lib/runway/gantt/share-token
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock r2-client
const mockGetContent = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  getContent: mockGetContent,
}));

// Mock share-token
const mockVerifyToken = vi.fn();
vi.mock("@/lib/runway/gantt/share-token", () => ({
  verifyToken: mockVerifyToken,
}));

const VALID_PAYLOAD = {
  v: 1 as const,
  kind: "client" as const,
  clientSlug: "test-client",
  theme: "light-branded" as const,
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  nonce: "abc12345",
};

function makeRequest(token: string) {
  return new Request(`http://localhost/api/runway/gantt-share/${token}`);
}

describe("GET /api/runway/gantt-share/[token]", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetContent.mockReset();
    mockVerifyToken.mockReset();
  });

  it("valid token + R2 hit → 200 with text/html content-type", async () => {
    mockVerifyToken.mockReturnValue({ ok: true, payload: VALID_PAYLOAD });
    mockGetContent.mockResolvedValue("<html>gantt</html>");

    const { GET } = await import("./route");
    const res = await GET(makeRequest("valid-token") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "valid-token" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toBe("<html>gantt</html>");
  });

  it("valid token + R2 miss → 404", async () => {
    mockVerifyToken.mockReturnValue({ ok: true, payload: VALID_PAYLOAD });
    mockGetContent.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(makeRequest("valid-token") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "valid-token" }),
    });

    expect(res.status).toBe(404);
  });

  it("malformed token → 404", async () => {
    mockVerifyToken.mockReturnValue({ ok: false, reason: "malformed" });

    const { GET } = await import("./route");
    const res = await GET(makeRequest("bad") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "bad" }),
    });

    expect(res.status).toBe(404);
  });

  it("expired token → 410 with 'Share link expired' body", async () => {
    mockVerifyToken.mockReturnValue({ ok: false, reason: "expired" });

    const { GET } = await import("./route");
    const res = await GET(makeRequest("expired") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "expired" }),
    });

    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toBe("Share link expired");
  });

  it("R2 throws non-null → 500", async () => {
    mockVerifyToken.mockReturnValue({ ok: true, payload: VALID_PAYLOAD });
    mockGetContent.mockRejectedValue(new Error("NoSuchBucket"));

    const { GET } = await import("./route");
    const res = await GET(makeRequest("valid-token") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "valid-token" }),
    });

    expect(res.status).toBe(500);
  });

  it("response includes X-Robots-Tag and Cache-Control headers on 200", async () => {
    mockVerifyToken.mockReturnValue({ ok: true, payload: VALID_PAYLOAD });
    mockGetContent.mockResolvedValue("<html>ok</html>");

    const { GET } = await import("./route");
    const res = await GET(makeRequest("valid-token") as Parameters<typeof GET>[0], {
      params: Promise.resolve({ token: "valid-token" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });
});
