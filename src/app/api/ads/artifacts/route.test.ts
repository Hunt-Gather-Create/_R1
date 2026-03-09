import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireWorkspaceAccess = vi.fn();
const mockCreateAdArtifact = vi.fn();
const mockGetWorkspaceAdArtifacts = vi.fn();
const mockGetChatAdArtifacts = vi.fn();
const mockUpdateAdArtifactMedia = vi.fn();
vi.mock("@/lib/actions/workspace", () => ({
  requireWorkspaceAccess: (...args: unknown[]) => mockRequireWorkspaceAccess(...args),
}));

vi.mock("@/lib/actions/ad-artifacts", () => ({
  createAdArtifact: (...args: unknown[]) => mockCreateAdArtifact(...args),
  getWorkspaceAdArtifacts: (...args: unknown[]) => mockGetWorkspaceAdArtifacts(...args),
  getChatAdArtifacts: (...args: unknown[]) => mockGetChatAdArtifacts(...args),
  updateAdArtifactMedia: (...args: unknown[]) => mockUpdateAdArtifactMedia(...args),
}));

describe("POST /api/ads/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireWorkspaceAccess.mockResolvedValue(undefined);
    mockCreateAdArtifact.mockResolvedValue({ id: "art-1", name: "Ad", platform: "instagram", templateType: "feed-post" });
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/artifacts", {
        method: "POST",
        body: JSON.stringify({ artifact: { content: "{}", name: "Ad" } }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request");
    expect(mockRequireWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("returns 400 when artifact is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/artifacts", {
        method: "POST",
        body: JSON.stringify({ workspaceId: "w1" }),
      })
    );
    expect(res.status).toBe(400);
    expect(mockRequireWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("returns 403 when requireWorkspaceAccess throws access denied", async () => {
    mockRequireWorkspaceAccess.mockRejectedValue(new Error("Access denied: You are not a member of this workspace"));

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/artifacts", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "w1",
          artifact: { name: "Ad", content: "{}" },
        }),
      })
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Access denied");
  });

  it("returns 200 and artifact on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/artifacts", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "w1",
          artifact: { name: "My Ad", content: "{}", platform: "instagram", templateType: "feed-post" },
        }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifact).toMatchObject({ id: "art-1", name: "Ad" });
    expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("w1", "member");
    expect(mockCreateAdArtifact).toHaveBeenCalled();
  });
});

describe("GET /api/ads/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireWorkspaceAccess.mockResolvedValue(undefined);
    mockGetWorkspaceAdArtifacts.mockResolvedValue([{ id: "art-1" }]);
    mockGetChatAdArtifacts.mockResolvedValue([{ id: "art-2" }]);
  });

  it("returns 400 when neither workspaceId nor chatId provided", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/ads/artifacts"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request");
  });

  it("returns 403 when requireWorkspaceAccess throws (workspaceId path)", async () => {
    mockRequireWorkspaceAccess.mockRejectedValue(new Error("Access denied: You are not a member"));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/ads/artifacts?workspaceId=w1"));
    expect(res.status).toBe(403);
    expect(mockGetWorkspaceAdArtifacts).not.toHaveBeenCalled();
  });

  it("returns 200 and artifacts when workspaceId provided", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/ads/artifacts?workspaceId=w1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifacts).toEqual([{ id: "art-1" }]);
    expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("w1", "member");
    expect(mockGetWorkspaceAdArtifacts).toHaveBeenCalledWith("w1");
  });

  it("returns 200 and artifacts when chatId provided", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/ads/artifacts?chatId=chat-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifacts).toEqual([{ id: "art-2" }]);
    expect(mockGetChatAdArtifacts).toHaveBeenCalledWith("chat-1");
  });
});

describe("PATCH /api/ads/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAdArtifactMedia.mockResolvedValue({ id: "art-1", content: "updated" });
  });

  it("returns 400 when artifactId is missing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/ads/artifacts", {
        method: "PATCH",
        body: JSON.stringify({ mediaUrls: [] }),
      })
    );
    expect(res.status).toBe(400);
    expect(mockUpdateAdArtifactMedia).not.toHaveBeenCalled();
  });

  it("returns 400 when mediaUrls is missing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/ads/artifacts", {
        method: "PATCH",
        body: JSON.stringify({ artifactId: "art-1" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when artifact not found", async () => {
    mockUpdateAdArtifactMedia.mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/ads/artifacts", {
        method: "PATCH",
        body: JSON.stringify({ artifactId: "missing", mediaUrls: [] }),
      })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Artifact not found");
  });

  it("returns 403 when update throws access denied", async () => {
    mockUpdateAdArtifactMedia.mockRejectedValue(new Error("Access denied: You are not a member"));

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/ads/artifacts", {
        method: "PATCH",
        body: JSON.stringify({ artifactId: "art-1", mediaUrls: [{ url: "x" }] }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 and artifact on success", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/ads/artifacts", {
        method: "PATCH",
        body: JSON.stringify({ artifactId: "art-1", mediaUrls: [{ storageKey: "key" }] }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifact).toMatchObject({ id: "art-1", content: "updated" });
    expect(mockUpdateAdArtifactMedia).toHaveBeenCalledWith("art-1", expect.any(String));
  });
});
