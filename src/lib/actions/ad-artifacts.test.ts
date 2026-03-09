import { describe, it, expect } from "vitest";
import {
  parseMediaAssetsToSlots,
  allCurrentMediaReady,
  getPromptsFromContent,
  mergeClientMediaIntoSlots,
  isClientMediaShape,
} from "./ad-artifacts-utils";

describe("parseMediaAssetsToSlots", () => {
  it("returns empty array for null or empty string", () => {
    expect(parseMediaAssetsToSlots(null)).toEqual([]);
    expect(parseMediaAssetsToSlots("")).toEqual([]);
    expect(parseMediaAssetsToSlots("   ")).toEqual([]);
  });

  it("migrates legacy format (storageKey, imageUrls) to single-version slot", () => {
    const json = JSON.stringify([
      { storageKey: "key1", imageUrls: ["https://a.com/1.png"] },
      { imageUrls: ["https://b.com/2.png"] },
    ]);
    const slots = parseMediaAssetsToSlots(json);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      currentIndex: 0,
      versions: [{ storageKey: "key1", imageUrl: "https://a.com/1.png" }],
    });
    expect(slots[1]).toEqual({
      currentIndex: 0,
      versions: [{ imageUrl: "https://b.com/2.png" }],
    });
  });

  it("parses versioned format with currentIndex and versions", () => {
    const json = JSON.stringify([
      {
        currentIndex: 1,
        versions: [
          { prompt: "p1", storageKey: "k1" },
          { prompt: "p2", imageUrl: "https://x.com/2.png" },
        ],
      },
    ]);
    const slots = parseMediaAssetsToSlots(json);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.currentIndex).toBe(1);
    expect(slots[0]?.versions).toHaveLength(2);
    expect(slots[0]?.versions[1]).toEqual({ prompt: "p2", imageUrl: "https://x.com/2.png" });
  });

  it("parses client save shape (imageUrls array + currentIndex)", () => {
    const json = JSON.stringify([
      { imageUrls: ["url1", "url2"], currentIndex: 1 },
    ]);
    const slots = parseMediaAssetsToSlots(json);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.currentIndex).toBe(1);
    expect(slots[0]?.versions).toEqual([{ imageUrl: "url1" }, { imageUrl: "url2" }]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseMediaAssetsToSlots("not json")).toEqual([]);
    expect(parseMediaAssetsToSlots("{}")).toEqual([]);
  });
});

describe("allCurrentMediaReady", () => {
  it("returns true for empty slots", () => {
    expect(allCurrentMediaReady([])).toBe(true);
  });

  it("returns true when every slot has storageKey or imageUrl at currentIndex", () => {
    expect(
      allCurrentMediaReady([
        { currentIndex: 0, versions: [{ storageKey: "k1" }] },
        { currentIndex: 0, versions: [{ imageUrl: "https://x.com/i.png" }] },
      ])
    ).toBe(true);
  });

  it("returns false when any slot has no media at currentIndex", () => {
    expect(
      allCurrentMediaReady([
        { currentIndex: 0, versions: [{ storageKey: "k1" }] },
        { currentIndex: 0, versions: [{}] },
      ])
    ).toBe(false);
    expect(
      allCurrentMediaReady([
        { currentIndex: 1, versions: [{ prompt: "p1" }, { prompt: "p2" }] },
      ])
    ).toBe(false);
  });
});

describe("getPromptsFromContent", () => {
  it("returns profile prompt and content prompt for instagram feed-post", () => {
    const content = {
      profile: { imagePrompt: "profile prompt" },
      content: { prompt: "main image prompt" },
    };
    expect(getPromptsFromContent("instagram", "feed-post", content)).toEqual([
      "profile prompt",
      "main image prompt",
    ]);
  });

  it("returns prompts for carousel slides", () => {
    const content = {
      profile: { imagePrompt: "profile" },
      content: [
        { prompt: "slide 1" },
        { prompt: "slide 2" },
      ],
    };
    expect(getPromptsFromContent("instagram", "carousel", content)).toEqual([
      "profile",
      "slide 1",
      "slide 2",
    ]);
  });

  it("returns secondary then primary image prompts for Facebook in-stream (no profile slot)", () => {
    const content = {
      image: "primary image prompt",
      secondaryAd: { title: "Secondary", description: "Desc", image: "secondary image prompt" },
    };
    expect(getPromptsFromContent("facebook", "in-stream-video", content)).toEqual([
      "secondary image prompt",
      "primary image prompt",
    ]);
  });
});

describe("mergeClientMediaIntoSlots", () => {
  it("preserves storageKey when client sends imageUrls (profile URL stays saved)", () => {
    const existingSlots = [
      {
        currentIndex: 0,
        versions: [
          { prompt: "logo", storageKey: "r2-key-123", imageUrl: "https://old-signed.expires" },
        ],
      },
    ];
    const clientMedia = [
      { imageUrls: ["https://new-signed.url"], currentIndex: 0 },
    ];
    const merged = mergeClientMediaIntoSlots(existingSlots, clientMedia);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.currentIndex).toBe(0);
    expect(merged[0]?.versions[0]).toMatchObject({
      prompt: "logo",
      storageKey: "r2-key-123",
      imageUrl: "https://new-signed.url",
    });
  });

  it("keeps all existing slots when client sends fewer", () => {
    const existingSlots = [
      { currentIndex: 0, versions: [{ storageKey: "k1" }] },
      { currentIndex: 0, versions: [{ storageKey: "k2" }] },
    ];
    const clientMedia = [{ imageUrls: ["https://u1"], currentIndex: 0 }];
    const merged = mergeClientMediaIntoSlots(existingSlots, clientMedia);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.versions[0]?.storageKey).toBe("k1");
    expect(merged[1]?.versions[0]?.storageKey).toBe("k2");
  });
});

describe("isClientMediaShape", () => {
  it("returns true for client save shape (imageUrls, no versions)", () => {
    expect(isClientMediaShape(JSON.stringify([{ imageUrls: ["u1"], currentIndex: 0 }]))).toBe(true);
  });
  it("returns false for versioned shape", () => {
    expect(
      isClientMediaShape(
        JSON.stringify([{ currentIndex: 0, versions: [{ storageKey: "k" }] }])
      )
    ).toBe(false);
  });
  it("returns false for null or empty", () => {
    expect(isClientMediaShape(null)).toBe(false);
    expect(isClientMediaShape("")).toBe(false);
  });
});
