import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock authentication
vi.mock("@/lib/auth", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue("user-1"),
}));

// Mock anthropic - we don't want to make real API calls in tests
const mockAnthropicFn = vi.fn(() => "mocked-model");
mockAnthropicFn.tools = {
  webSearch_20250305: vi.fn(() => ({ type: "webSearch" })),
  webFetch_20250910: vi.fn(() => ({ type: "webFetch" })),
};

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: mockAnthropicFn,
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    steps: [
      {
        toolResults: [
          {
            toolName: "report_results",
            result: {
              needsDisambiguation: false,
              results: [
                {
                  name: "Test Brand",
                  description: "A test brand",
                  websiteUrl: "https://test.com",
                },
              ],
            },
          },
        ],
      },
    ],
  }),
  tool: vi.fn((config) => config),
}));

describe("POST /api/brand/research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("requires authentication", async () => {
      const { getCurrentUserId } = await import("@/lib/auth");
      vi.mocked(getCurrentUserId).mockResolvedValueOnce(null);

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "name", query: "Apple" }),
        })
      );

      expect(response.status).toBe(401);
    });

    it("validates input schema for name type", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "name", query: "" }),
        })
      );

      expect(response.status).toBe(400);
    });

    it("validates input schema for url type", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "url", query: "not-a-url" }),
        })
      );

      expect(response.status).toBe(400);
    });

    it("validates input schema for selection type", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "selection" }), // missing selection object
        })
      );

      expect(response.status).toBe(400);
    });
  });

  describe("type: name", () => {
    it("searches for brand by name", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "name", query: "Nike" }),
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("needsDisambiguation");
      expect(data).toHaveProperty("results");
    });
  });

  describe("type: url", () => {
    it("extracts brand info from URL", async () => {
      const { generateText } = await import("ai");
      vi.mocked(generateText).mockResolvedValueOnce({
        steps: [
          {
            toolResults: [
              {
                toolName: "report_brand",
                result: {
                  name: "Nike",
                  tagline: "Just Do It",
                  websiteUrl: "https://nike.com",
                },
              },
            ],
          },
        ],
      } as never);

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({ type: "url", query: "https://nike.com" }),
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("brand");
    });
  });

  describe("type: selection", () => {
    it("researches selected brand", async () => {
      const { generateText } = await import("ai");
      vi.mocked(generateText).mockResolvedValueOnce({
        steps: [
          {
            toolResults: [
              {
                toolName: "report_brand",
                result: {
                  name: "Nike, Inc.",
                  tagline: "Just Do It",
                  description: "Athletic footwear and apparel company",
                  primaryColor: "#000000",
                },
              },
            ],
          },
        ],
      } as never);

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost/api/brand/research", {
          method: "POST",
          body: JSON.stringify({
            type: "selection",
            selection: {
              name: "Nike, Inc.",
              description: "Athletic footwear",
              websiteUrl: "https://nike.com",
            },
          }),
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("brand");
      expect(data.brand.name).toBe("Nike, Inc.");
    });
  });
});
