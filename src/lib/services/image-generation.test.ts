import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateImage,
  generateImages,
  type GenerateImageOptions,
} from "./image-generation";

const mockUploadBuffer = vi.fn();
const mockGenerateAdMediaStorageKey = vi.fn();
const mockGenerateDownloadUrl = vi.fn();

type MockGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> };
  }>;
};

const mockState = vi.hoisted(() => ({
  response: null as MockGenerateContentResponse | null,
  generateContentCalls: vi.fn(),
}));

vi.mock("@/lib/storage/r2-client", () => ({
  uploadBuffer: (...args: unknown[]) => mockUploadBuffer(...args),
  generateAdMediaStorageKey: (...args: unknown[]) => mockGenerateAdMediaStorageKey(...args),
  generateDownloadUrl: (...args: unknown[]) => mockGenerateDownloadUrl(...args),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    get models() {
      return {
        generateContent: (opts: unknown) => {
          mockState.generateContentCalls(opts);
          return Promise.resolve(mockState.response);
        },
      };
    }
  },
}));

describe("image-generation", () => {
  const baseOptions: GenerateImageOptions = {
    prompt: "a sunset",
    workspaceId: "w1",
    artifactId: "art-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    mockState.response = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from("fake-png-bytes").toString("base64"),
                  mimeType: "image/png",
                },
              },
            ],
          },
        },
      ],
    };
    mockGenerateAdMediaStorageKey.mockReturnValue("ads/w1/art-1/image_0_123.png");
    mockGenerateDownloadUrl.mockResolvedValue("https://example.com/signed/image.png");
    mockUploadBuffer.mockResolvedValue(undefined);
  });

  describe("generateImage", () => {
    it("returns storageKey, downloadUrl, prompt, aspectRatio", async () => {
      const result = await generateImage(baseOptions);

      expect(result).toEqual({
        storageKey: "ads/w1/art-1/image_0_123.png",
        downloadUrl: "https://example.com/signed/image.png",
        prompt: "a sunset",
        aspectRatio: "1:1",
      });
      expect(mockUploadBuffer).toHaveBeenCalledWith(
        "ads/w1/art-1/image_0_123.png",
        expect.any(Buffer),
        "image/png"
      );
      expect(mockGenerateDownloadUrl).toHaveBeenCalledWith("ads/w1/art-1/image_0_123.png");
    });

    it("uses default aspectRatio 1:1 when not provided", async () => {
      const result = await generateImage(baseOptions);
      expect(result.aspectRatio).toBe("1:1");
    });

    it("uses provided aspectRatio", async () => {
      const result = await generateImage({ ...baseOptions, aspectRatio: "9:16" });
      expect(result.aspectRatio).toBe("9:16");
    });

    it("uses mediaIndex in storage key filename", async () => {
      mockGenerateAdMediaStorageKey.mockImplementation(
        (_w: string, _a: string, filename: string) => `ads/w1/art-1/${filename}`
      );
      await generateImage({ ...baseOptions, mediaIndex: 2 });
      expect(mockGenerateAdMediaStorageKey).toHaveBeenCalledWith(
        "w1",
        "art-1",
        expect.stringMatching(/^image_2_\d+\.png$/)
      );
    });

    it("throws when GOOGLE_GENERATIVE_AI_API_KEY is not set", async () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      await expect(generateImage(baseOptions)).rejects.toThrow(
        "GOOGLE_GENERATIVE_AI_API_KEY not configured"
      );
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    });

    it("throws when API returns no image data", async () => {
      mockState.response = { candidates: [] };

      await expect(generateImage(baseOptions)).rejects.toThrow("No image data in response");
    });

    it("throws when no inline image part", async () => {
      mockState.response = {
        candidates: [{ content: { parts: [{ text: "no image" }] } }],
      };

      await expect(generateImage(baseOptions)).rejects.toThrow(
        "No inline image data found in response"
      );
    });

    it("calls backend with Gemini model", async () => {
      await generateImage(baseOptions);
      expect(mockState.generateContentCalls).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-2.5-flash-image",
          contents: "a sunset",
          config: { responseModalities: ["IMAGE"] },
        })
      );
    });
  });

  describe("generateImages", () => {
    it("calls generateImage for each option and returns array", async () => {
      const optionsList: GenerateImageOptions[] = [
        { ...baseOptions, prompt: "cat" },
        { ...baseOptions, prompt: "dog", artifactId: "art-2" },
      ];
      mockGenerateAdMediaStorageKey
        .mockReturnValueOnce("ads/w1/art-1/img1.png")
        .mockReturnValueOnce("ads/w1/art-2/img2.png");

      const results = await generateImages(optionsList);

      expect(results).toHaveLength(2);
      expect(results[0].prompt).toBe("cat");
      expect(results[1].prompt).toBe("dog");
      expect(mockState.generateContentCalls).toHaveBeenCalledTimes(2);
    });
  });
});
