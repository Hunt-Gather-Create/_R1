import { describe, it, expect } from "vitest";
import { buildContextualSystemPrompt } from "./context-prompt";
import type { WorkspaceSoul, Brand, WorkspaceMemory } from "@/lib/types";

// Factory helper for creating test souls
function createSoul(overrides: Partial<WorkspaceSoul> = {}): WorkspaceSoul {
  return {
    name: "Test Soul",
    personality: "Helpful and friendly",
    primaryGoals: ["Help users"],
    tone: "professional",
    responseLength: "moderate",
    domainExpertise: ["General knowledge"],
    terminology: {},
    doRules: [],
    dontRules: [],
    version: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Factory helper for creating test brands
function createBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    userId: "user-1",
    name: "Test Brand",
    tagline: "Test tagline",
    description: "Test description",
    summary: "A brand summary for testing",
    logoUrl: null,
    logoStorageKey: null,
    logoBackground: null,
    websiteUrl: "https://example.com",
    primaryColor: null,
    secondaryColor: null,
    industry: "Technology",
    guidelines: null,
    guidelinesStatus: null,
    guidelinesUpdatedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

// Factory helper for creating test memories
function createMemory(overrides: Partial<WorkspaceMemory> = {}): WorkspaceMemory {
  return {
    id: "memory-1",
    workspaceId: "workspace-1",
    content: "Test memory content",
    tags: JSON.stringify(["test", "preference"]),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("buildContextualSystemPrompt", () => {
  const basePrompt = "You are a helpful assistant.";

  it("returns base prompt when soul and brand are both null", () => {
    const result = buildContextualSystemPrompt(basePrompt, null, null);
    expect(result).toBe(basePrompt);
  });

  it("returns base prompt when soul has no name", () => {
    const soul = createSoul({ name: "" });
    const result = buildContextualSystemPrompt(basePrompt, soul, null);
    expect(result).toBe(basePrompt);
  });

  it("returns base prompt when brand has no summary", () => {
    const brand = createBrand({ summary: null });
    const result = buildContextualSystemPrompt(basePrompt, null, brand);
    expect(result).toBe(basePrompt);
  });

  it("prepends soul context when soul has name", () => {
    const soul = createSoul({ name: "Aria" });
    const result = buildContextualSystemPrompt(basePrompt, soul, null);

    expect(result).toContain("You are Aria");
    expect(result).toContain("---");
    expect(result).toContain(basePrompt);
    // Soul should come before base prompt
    expect(result.indexOf("Aria")).toBeLessThan(result.indexOf(basePrompt));
  });

  it("prepends brand context when brand has summary", () => {
    const brand = createBrand({ summary: "A tech company making widgets" });
    const result = buildContextualSystemPrompt(basePrompt, null, brand);

    expect(result).toContain("## Brand Context");
    expect(result).toContain("A tech company making widgets");
    expect(result).toContain("---");
    expect(result).toContain(basePrompt);
  });

  it("prepends both soul and brand when both are provided", () => {
    const soul = createSoul({ name: "Aria", personality: "Friendly" });
    const brand = createBrand({
      name: "Acme Corp",
      summary: "A tech company",
      industry: "Technology",
    });

    const result = buildContextualSystemPrompt(basePrompt, soul, brand);

    expect(result).toContain("You are Aria");
    expect(result).toContain("## Brand Context");
    expect(result).toContain("**Brand:** Acme Corp");
    expect(result).toContain("A tech company");
    expect(result).toContain("---");
    expect(result).toContain(basePrompt);

    // Soul should come before brand
    expect(result.indexOf("Aria")).toBeLessThan(result.indexOf("Brand Context"));
    // Brand should come before base prompt
    expect(result.indexOf("Brand Context")).toBeLessThan(result.indexOf(basePrompt));
  });

  it("uses single separator between context and base prompt", () => {
    const soul = createSoul({ name: "Aria" });
    const brand = createBrand({ summary: "A tech company" });

    const result = buildContextualSystemPrompt(basePrompt, soul, brand);

    // Should have exactly one separator between combined context and base prompt
    const separatorCount = (result.match(/---/g) || []).length;
    expect(separatorCount).toBe(1);
  });

  it("prepends memories when memories array is provided", () => {
    const memories = [
      createMemory({ content: "User prefers dark mode" }),
      createMemory({ content: "User's timezone is PST", tags: JSON.stringify(["timezone"]) }),
    ];
    const result = buildContextualSystemPrompt(basePrompt, null, null, memories);

    expect(result).toContain("## Workspace Memories");
    expect(result).toContain("User prefers dark mode");
    expect(result).toContain("User's timezone is PST");
    expect(result).toContain("---");
    expect(result).toContain(basePrompt);
  });

  it("returns base prompt when memories array is empty", () => {
    const result = buildContextualSystemPrompt(basePrompt, null, null, []);
    expect(result).toBe(basePrompt);
  });

  it("includes all context types when soul, brand, and memories are provided", () => {
    const soul = createSoul({ name: "Aria" });
    const brand = createBrand({ summary: "A tech company" });
    const memories = [createMemory({ content: "User likes concise responses" })];

    const result = buildContextualSystemPrompt(basePrompt, soul, brand, memories);

    expect(result).toContain("You are Aria");
    expect(result).toContain("## Brand Context");
    expect(result).toContain("## Workspace Memories");
    expect(result).toContain("User likes concise responses");
    expect(result).toContain(basePrompt);

    // Verify order: soul -> brand -> memories -> base
    const soulIdx = result.indexOf("Aria");
    const brandIdx = result.indexOf("Brand Context");
    const memoriesIdx = result.indexOf("Workspace Memories");
    const baseIdx = result.indexOf(basePrompt);

    expect(soulIdx).toBeLessThan(brandIdx);
    expect(brandIdx).toBeLessThan(memoriesIdx);
    expect(memoriesIdx).toBeLessThan(baseIdx);
  });
});
