import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireWorkspaceAccess = vi.fn();
const mockGenerateImage = vi.fn();
const mockUpdateAdArtifactMedia = vi.fn();
const mockRefreshAdAttachmentIfMediaReady = vi.fn();

let mockDbGetResult: { workspaceId: string; mediaAssets: string | null } | undefined;

vi.mock("@/lib/actions/workspace", () => ({
  requireWorkspaceAccess: (...args: unknown[]) => mockRequireWorkspaceAccess(...args),
}));

vi.mock("@/lib/services/image-generation", () => ({
  generateImage: (opts: unknown) => mockGenerateImage(opts),
}));

vi.mock("@/lib/actions/ad-artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/ad-artifacts")>();
  return {
    ...actual,
    updateAdArtifactMedia: (...args: unknown[]) => mockUpdateAdArtifactMedia(...args),
    refreshAdAttachmentIfMediaReady: (...args: unknown[]) => {
      mockRefreshAdAttachmentIfMediaReady(...args);
      return Promise.resolve();
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => mockDbGetResult),
    })),
  },
}));

describe("POST /api/ads/generate-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireWorkspaceAccess.mockResolvedValue(undefined);
    mockGenerateImage.mockResolvedValue({
      downloadUrl: "https://example.com/img",
      storageKey: "key",
      prompt: "a cat",
      aspectRatio: "1:1",
    });
    mockDbGetResult = undefined;
  });

  it("returns 400 when body is invalid (missing prompt)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ workspaceId: "w1" }),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request");
    expect(mockRequireWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("returns 400 when neither workspaceId nor artifactId provided", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when artifactId provided but artifact not found", async () => {
    mockDbGetResult = undefined;

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat", artifactId: "missing-id" }),
      })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Artifact not found");
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("returns 403 when requireWorkspaceAccess throws (workspaceId path)", async () => {
    mockRequireWorkspaceAccess.mockRejectedValue(new Error("Access denied: You are not a member"));

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat", workspaceId: "w1" }),
      })
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Access denied");
  });

  it("returns 403 when requireWorkspaceAccess throws (artifactId path)", async () => {
    mockDbGetResult = { workspaceId: "w1", mediaAssets: null };
    mockRequireWorkspaceAccess.mockRejectedValue(new Error("not a member"));

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat", artifactId: "art-1" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 and image result when workspaceId provided", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat", workspaceId: "w1" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toBe("https://example.com/img");
    expect(data.storageKey).toBe("key");
    expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("w1", "member");
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "a cat",
        workspaceId: "w1",
        aspectRatio: "1:1",
        mediaIndex: 0,
      })
    );
  });

  it("returns 200 and persists to artifact when artifactId provided", async () => {
    mockDbGetResult = { workspaceId: "w1", mediaAssets: "[]" };

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/ads/generate-image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a cat", artifactId: "art-1", mediaIndex: 0 }),
      })
    );
    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("w1", "member");
    expect(mockUpdateAdArtifactMedia).toHaveBeenCalledWith("art-1", expect.any(String));
    expect(mockRefreshAdAttachmentIfMediaReady).toHaveBeenCalledWith("art-1");
  });
});
