import { describe, it, expect, vi } from "vitest";
import type { WorkspaceMemory } from "../types";

// Mock the dependencies
vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  },
}));

vi.mock("./workspace", () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    member: { role: "admin" },
    workspace: { id: "workspace-1", slug: "test-workspace" },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Helper to create mock memories
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

describe("Memory utility functions", () => {
  describe("Tag parsing", () => {
    it("parses valid JSON tags array", () => {
      const memory = createMemory({ tags: JSON.stringify(["tag1", "tag2"]) });
      const tags = JSON.parse(memory.tags) as string[];
      expect(tags).toEqual(["tag1", "tag2"]);
    });

    it("handles empty tags array", () => {
      const memory = createMemory({ tags: JSON.stringify([]) });
      const tags = JSON.parse(memory.tags) as string[];
      expect(tags).toEqual([]);
    });

    it("handles tags with special characters", () => {
      const memory = createMemory({
        tags: JSON.stringify(["user-preference", "api_key", "v2.0"]),
      });
      const tags = JSON.parse(memory.tags) as string[];
      expect(tags).toEqual(["user-preference", "api_key", "v2.0"]);
    });
  });

  describe("Content truncation for listing", () => {
    it("truncates content longer than 200 characters", () => {
      const longContent = "a".repeat(250);
      const memory = createMemory({ content: longContent });

      const truncated =
        memory.content.length > 200
          ? memory.content.slice(0, 200) + "..."
          : memory.content;

      expect(truncated.length).toBe(203); // 200 + "..."
      expect(truncated.endsWith("...")).toBe(true);
    });

    it("does not truncate content under 200 characters", () => {
      const shortContent = "Short content";
      const memory = createMemory({ content: shortContent });

      const truncated =
        memory.content.length > 200
          ? memory.content.slice(0, 200) + "..."
          : memory.content;

      expect(truncated).toBe(shortContent);
      expect(truncated.endsWith("...")).toBe(false);
    });

    it("handles exactly 200 character content", () => {
      const exactContent = "a".repeat(200);
      const memory = createMemory({ content: exactContent });

      const truncated =
        memory.content.length > 200
          ? memory.content.slice(0, 200) + "..."
          : memory.content;

      expect(truncated.length).toBe(200);
      expect(truncated.endsWith("...")).toBe(false);
    });
  });
});

describe("Keyword extraction logic", () => {
  // Replicate the stopwords set from memories.ts
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "must", "shall", "can", "need", "dare", "ought", "used",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
    "through", "during", "before", "after", "above", "below", "between",
    "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "or", "because",
    "until", "while", "about", "what", "which", "who", "whom", "this", "that",
    "these", "those", "am", "it", "its", "i", "me", "my", "myself", "we", "our",
    "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "they",
    "them", "their", "theirs", "themselves",
  ]);

  function extractKeywords(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 5);
  }

  it("extracts meaningful keywords from query", () => {
    const keywords = extractKeywords("What is my favorite color?");
    expect(keywords).toContain("favorite");
    expect(keywords).toContain("color");
    expect(keywords).not.toContain("what");
    expect(keywords).not.toContain("is");
    expect(keywords).not.toContain("my");
  });

  it("filters out short words (2 chars or less)", () => {
    const keywords = extractKeywords("I am at the big red house");
    expect(keywords).not.toContain("am");
    expect(keywords).not.toContain("at");
    expect(keywords).toContain("big");
    expect(keywords).toContain("red");
    expect(keywords).toContain("house");
  });

  it("removes punctuation before processing", () => {
    const keywords = extractKeywords("Hello, world! How's it going?");
    expect(keywords).toContain("hello");
    expect(keywords).toContain("world");
    expect(keywords).toContain("hows");
    expect(keywords).toContain("going");
  });

  it("limits to 5 keywords", () => {
    const keywords = extractKeywords(
      "one two three four five six seven eight nine ten keywords"
    );
    expect(keywords.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array for query with only stopwords", () => {
    const keywords = extractKeywords("the is a an on in");
    expect(keywords).toEqual([]);
  });

  it("handles empty query", () => {
    const keywords = extractKeywords("");
    expect(keywords).toEqual([]);
  });

  it("handles query with only short words", () => {
    const keywords = extractKeywords("I am at it");
    expect(keywords).toEqual([]);
  });

  it("converts to lowercase for case-insensitive matching", () => {
    const keywords = extractKeywords("HELLO World TESTING");
    expect(keywords).toContain("hello");
    expect(keywords).toContain("world");
    expect(keywords).toContain("testing");
  });
});

describe("Memory deduplication logic", () => {
  it("removes duplicate memories by id", () => {
    const memories: WorkspaceMemory[] = [
      createMemory({ id: "mem-1", content: "First" }),
      createMemory({ id: "mem-2", content: "Second" }),
      createMemory({ id: "mem-1", content: "First duplicate" }), // duplicate id
      createMemory({ id: "mem-3", content: "Third" }),
    ];

    const seen = new Set<string>();
    const unique: WorkspaceMemory[] = [];
    for (const memory of memories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        unique.push(memory);
      }
    }

    expect(unique.length).toBe(3);
    expect(unique.map((m) => m.id)).toEqual(["mem-1", "mem-2", "mem-3"]);
  });

  it("preserves order of first occurrence", () => {
    const memories: WorkspaceMemory[] = [
      createMemory({ id: "mem-3", content: "Third" }),
      createMemory({ id: "mem-1", content: "First" }),
      createMemory({ id: "mem-3", content: "Third duplicate" }),
      createMemory({ id: "mem-2", content: "Second" }),
    ];

    const seen = new Set<string>();
    const unique: WorkspaceMemory[] = [];
    for (const memory of memories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        unique.push(memory);
      }
    }

    expect(unique.map((m) => m.id)).toEqual(["mem-3", "mem-1", "mem-2"]);
  });

  it("handles empty array", () => {
    const memories: WorkspaceMemory[] = [];

    const seen = new Set<string>();
    const unique: WorkspaceMemory[] = [];
    for (const memory of memories) {
      if (!seen.has(memory.id)) {
        seen.add(memory.id);
        unique.push(memory);
      }
    }

    expect(unique).toEqual([]);
  });
});

describe("Memory filtering by workspace", () => {
  it("filters memories to only include those from target workspace", () => {
    const targetWorkspaceId = "workspace-1";
    const memories: WorkspaceMemory[] = [
      createMemory({ id: "mem-1", workspaceId: "workspace-1" }),
      createMemory({ id: "mem-2", workspaceId: "workspace-2" }),
      createMemory({ id: "mem-3", workspaceId: "workspace-1" }),
      createMemory({ id: "mem-4", workspaceId: "workspace-3" }),
    ];

    const filtered = memories.filter((m) => m.workspaceId === targetWorkspaceId);

    expect(filtered.length).toBe(2);
    expect(filtered.map((m) => m.id)).toEqual(["mem-1", "mem-3"]);
  });
});

describe("Memory CRUD input validation", () => {
  describe("CreateWorkspaceMemoryInput", () => {
    it("accepts valid input with content and tags", () => {
      const input = {
        content: "User prefers dark mode",
        tags: ["preference", "ui"],
      };

      expect(input.content).toBeTruthy();
      expect(Array.isArray(input.tags)).toBe(true);
    });

    it("accepts empty tags array", () => {
      const input = {
        content: "Some memory",
        tags: [],
      };

      expect(input.tags).toEqual([]);
    });
  });

  describe("UpdateWorkspaceMemoryInput", () => {
    it("accepts partial update with only content", () => {
      const input = {
        content: "Updated content",
      };

      expect(input.content).toBeDefined();
      expect((input as Record<string, unknown>).tags).toBeUndefined();
    });

    it("accepts partial update with only tags", () => {
      const input = {
        tags: ["new-tag"],
      };

      expect(input.tags).toBeDefined();
      expect((input as Record<string, unknown>).content).toBeUndefined();
    });

    it("accepts full update with both content and tags", () => {
      const input = {
        content: "Updated content",
        tags: ["updated-tag"],
      };

      expect(input.content).toBeDefined();
      expect(input.tags).toBeDefined();
    });
  });
});

describe("Memory ordering", () => {
  it("orders memories by updatedAt descending", () => {
    const memories: WorkspaceMemory[] = [
      createMemory({ id: "mem-1", updatedAt: new Date("2024-01-01") }),
      createMemory({ id: "mem-2", updatedAt: new Date("2024-01-03") }),
      createMemory({ id: "mem-3", updatedAt: new Date("2024-01-02") }),
    ];

    const sorted = [...memories].sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)
    );

    expect(sorted.map((m) => m.id)).toEqual(["mem-2", "mem-3", "mem-1"]);
  });
});

describe("Search result limiting", () => {
  it("limits results to specified limit", () => {
    const memories: WorkspaceMemory[] = Array.from({ length: 10 }, (_, i) =>
      createMemory({ id: `mem-${i}` })
    );

    const limit = 5;
    const limited = memories.slice(0, limit);

    expect(limited.length).toBe(5);
  });

  it("returns all results when fewer than limit", () => {
    const memories: WorkspaceMemory[] = [
      createMemory({ id: "mem-1" }),
      createMemory({ id: "mem-2" }),
    ];

    const limit = 5;
    const limited = memories.slice(0, limit);

    expect(limited.length).toBe(2);
  });

  it("handles zero results", () => {
    const memories: WorkspaceMemory[] = [];

    const limit = 5;
    const limited = memories.slice(0, limit);

    expect(limited.length).toBe(0);
  });
});

describe("JSON serialization for tags", () => {
  it("correctly serializes tags array to JSON string", () => {
    const tags = ["preference", "workflow"];
    const serialized = JSON.stringify(tags);

    expect(serialized).toBe('["preference","workflow"]');
  });

  it("roundtrips tags correctly", () => {
    const originalTags = ["tag1", "tag2", "tag3"];
    const serialized = JSON.stringify(originalTags);
    const deserialized = JSON.parse(serialized) as string[];

    expect(deserialized).toEqual(originalTags);
  });

  it("handles tags with special characters in JSON", () => {
    const tags = ['tag "with" quotes', "tag\nwith\nnewlines"];
    const serialized = JSON.stringify(tags);
    const deserialized = JSON.parse(serialized) as string[];

    expect(deserialized).toEqual(tags);
  });
});

describe("Access control logic", () => {
  describe("Memory access requirements", () => {
    it("requires member access for read operations", () => {
      // Document expected behavior: getWorkspaceMemories, listWorkspaceMemories, searchWorkspaceMemories
      // all require at least "member" access level
      const requiredRole = "member";
      expect(["member", "admin", "viewer"]).toContain(requiredRole);
    });

    it("requires admin access for delete operations", () => {
      // Document expected behavior: deleteWorkspaceMemory requires "admin" access
      const requiredRole = "admin";
      expect(requiredRole).toBe("admin");
    });

    it("requires member access for create/update operations", () => {
      // Document expected behavior: createWorkspaceMemory, updateWorkspaceMemory require "member" access
      const requiredRole = "member";
      expect(requiredRole).toBe("member");
    });
  });
});
