import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Audience, AudienceMember } from "../types";

// Helper to create mock audience
function createMockAudience(overrides: Partial<Audience> = {}): Audience {
  return {
    id: "audience-1",
    workspaceId: "workspace-1",
    name: "Test Audience",
    description: "Test description",
    generationStatus: "completed",
    generationPrompt: "Young professionals",
    memberCount: 10,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

// Helper to create mock audience member
function createMockMember(overrides: Partial<AudienceMember> = {}): AudienceMember {
  return {
    id: "member-1",
    audienceId: "audience-1",
    name: "Test Member",
    avatar: null,
    age: 30,
    gender: "female",
    occupation: "Software Engineer",
    location: "California, USA",
    tagline: "Tech enthusiast",
    primaryPainPoint: "Time management",
    primaryGoal: "Work-life balance",
    profileStorageKey: "audiences/workspace-1/audience-1/members/member-1.json",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

// Create chainable mock that properly handles get()
function createDbMock() {
  let getResult: unknown = undefined;
  let whereResult: unknown[] = [];
  let returningResult: unknown[] = [];

  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => {
      return {
        ...chainable,
        get: vi.fn().mockReturnValue(getResult),
        [Symbol.iterator]: function* () {
          yield* whereResult;
        },
        length: whereResult.length,
      };
    }),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn().mockImplementation(() => getResult),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => Promise.resolve(returningResult)),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    // Helper methods for tests
    _setGetResult: (val: unknown) => {
      getResult = val;
    },
    _setWhereResult: (val: unknown[]) => {
      whereResult = val;
    },
    _setReturningResult: (val: unknown[]) => {
      returningResult = val;
    },
    _reset: () => {
      getResult = undefined;
      whereResult = [];
      returningResult = [];
    },
  };

  return chainable;
}

const mockDb = createDbMock();

vi.mock("../db", () => ({
  db: mockDb,
}));

const mockRequireWorkspaceAccess = vi.fn().mockResolvedValue({
  user: { id: "user-1" },
  member: { role: "admin" },
  workspace: { id: "workspace-1", slug: "test-workspace" },
});

vi.mock("./workspace", () => ({
  requireWorkspaceAccess: mockRequireWorkspaceAccess,
}));

vi.mock("../auth", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ["event-1"] }),
  },
}));

const mockGetContent = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock("../storage/r2-client", () => ({
  getContent: mockGetContent,
  deleteObject: mockDeleteObject,
  uploadContent: vi.fn().mockResolvedValue(undefined),
  generateAudienceMemberStorageKey: vi.fn().mockReturnValue("test-key"),
}));

describe("audience actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._reset();
    mockRequireWorkspaceAccess.mockResolvedValue({
      user: { id: "user-1" },
      member: { role: "admin" },
      workspace: { id: "workspace-1", slug: "test-workspace" },
    });
  });

  describe("getWorkspaceAudiences", () => {
    it("calls requireWorkspaceAccess with workspaceId", async () => {
      mockDb._setWhereResult([]);

      const { getWorkspaceAudiences } = await import("./audience");
      await getWorkspaceAudiences("workspace-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("workspace-1");
    });

    it("returns audiences for the workspace", async () => {
      const mockAudiences = [
        createMockAudience({ id: "aud-1" }),
        createMockAudience({ id: "aud-2" }),
      ];
      mockDb._setWhereResult(mockAudiences);

      const { getWorkspaceAudiences } = await import("./audience");
      await getWorkspaceAudiences("workspace-1");

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe("getAudienceWithMembers", () => {
    it("returns null when audience not found", async () => {
      mockDb._setGetResult(undefined);

      const { getAudienceWithMembers } = await import("./audience");
      const result = await getAudienceWithMembers("nonexistent");

      expect(result).toBeNull();
    });

    it("verifies workspace access before returning audience", async () => {
      const mockAudience = createMockAudience();
      mockDb._setGetResult(mockAudience);
      mockDb._setWhereResult([]);

      const { getAudienceWithMembers } = await import("./audience");
      await getAudienceWithMembers("audience-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("workspace-1");
    });
  });

  describe("getAudienceMember", () => {
    it("returns null when member not found", async () => {
      mockDb._setGetResult(undefined);

      const { getAudienceMember } = await import("./audience");
      const result = await getAudienceMember("nonexistent");

      expect(result).toBeNull();
    });

    it("verifies workspace access through audience", async () => {
      // Set up sequence: first call returns member, second returns audience
      const mockMember = createMockMember();
      const mockAudience = createMockAudience();

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMember } = await import("./audience");
      await getAudienceMember("member-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("workspace-1");
    });
  });

  describe("getAudienceMemberForWorkspace - SECURITY CRITICAL", () => {
    it("returns null when member not found", async () => {
      // Reset mock to return undefined for the member query
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMemberForWorkspace } = await import("./audience");
      const result = await getAudienceMemberForWorkspace(
        "nonexistent",
        "workspace-1"
      );

      expect(result).toBeNull();
    });

    it("verifies workspace access first", async () => {
      mockDb._setGetResult(undefined);

      const { getAudienceMemberForWorkspace } = await import("./audience");
      await getAudienceMemberForWorkspace("member-1", "workspace-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("workspace-1");
    });

    it("returns null when member belongs to different workspace", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });
      const mockAudience = createMockAudience({
        id: "audience-1",
        workspaceId: "workspace-2", // Different workspace!
      });

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMemberForWorkspace } = await import("./audience");
      const result = await getAudienceMemberForWorkspace(
        "member-1",
        "workspace-1" // Requesting for workspace-1
      );

      // Should return null because member belongs to workspace-2
      expect(result).toBeNull();
    });

    it("returns member when workspace matches", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });
      const mockAudience = createMockAudience({
        id: "audience-1",
        workspaceId: "workspace-1", // Same workspace
      });

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMemberForWorkspace } = await import("./audience");
      const result = await getAudienceMemberForWorkspace(
        "member-1",
        "workspace-1"
      );

      expect(result).toEqual(mockMember);
    });

    it("returns null when audience not found for member", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return undefined; // Audience not found
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMemberForWorkspace } = await import("./audience");
      const result = await getAudienceMemberForWorkspace(
        "member-1",
        "workspace-1"
      );

      expect(result).toBeNull();
    });
  });

  describe("getAudienceMemberProfileForWorkspace - SECURITY CRITICAL", () => {
    it("returns null when member not found", async () => {
      mockDb._setGetResult(undefined);

      const { getAudienceMemberProfileForWorkspace } = await import("./audience");
      const result = await getAudienceMemberProfileForWorkspace(
        "nonexistent",
        "workspace-1"
      );

      expect(result).toBeNull();
    });

    it("verifies workspace access first", async () => {
      mockDb._setGetResult(undefined);

      const { getAudienceMemberProfileForWorkspace } = await import("./audience");
      await getAudienceMemberProfileForWorkspace("member-1", "workspace-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith("workspace-1");
    });

    it("returns null when member belongs to different workspace", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });
      const mockAudience = createMockAudience({
        id: "audience-1",
        workspaceId: "workspace-2", // Different workspace!
      });

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { getAudienceMemberProfileForWorkspace } = await import("./audience");
      const result = await getAudienceMemberProfileForWorkspace(
        "member-1",
        "workspace-1"
      );

      // Should return null because member belongs to workspace-2
      expect(result).toBeNull();
      // R2 should NOT be called when workspace doesn't match
      expect(mockGetContent).not.toHaveBeenCalled();
    });

    it("fetches profile from R2 when workspace matches", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });
      const mockAudience = createMockAudience({
        id: "audience-1",
        workspaceId: "workspace-1",
      });
      const mockProfile = {
        id: "member-1",
        name: "Test Member",
        demographics: { age: 30 },
      };

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));
      mockGetContent.mockResolvedValue(JSON.stringify(mockProfile));

      const { getAudienceMemberProfileForWorkspace } = await import("./audience");
      const result = await getAudienceMemberProfileForWorkspace(
        "member-1",
        "workspace-1"
      );

      expect(mockGetContent).toHaveBeenCalledWith(mockMember.profileStorageKey);
      expect(result).toEqual(mockProfile);
    });

    it("returns null when R2 content not found", async () => {
      const mockMember = createMockMember({ audienceId: "audience-1" });
      const mockAudience = createMockAudience({
        id: "audience-1",
        workspaceId: "workspace-1",
      });

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockMember;
          return mockAudience;
        }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));
      mockGetContent.mockResolvedValue(null);

      const { getAudienceMemberProfileForWorkspace } = await import("./audience");
      const result = await getAudienceMemberProfileForWorkspace(
        "member-1",
        "workspace-1"
      );

      expect(result).toBeNull();
    });
  });

  describe("deleteAudience", () => {
    it("requires admin access to workspace", async () => {
      const mockAudience = createMockAudience();
      mockDb._setGetResult(mockAudience);
      mockDb._setWhereResult([]);

      const { deleteAudience } = await import("./audience");
      await deleteAudience("audience-1");

      expect(mockRequireWorkspaceAccess).toHaveBeenCalledWith(
        "workspace-1",
        "admin"
      );
    });

    it("throws when audience not found", async () => {
      // Reset mock to return undefined for the audience query
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      }));

      const { deleteAudience } = await import("./audience");

      await expect(deleteAudience("nonexistent")).rejects.toThrow(
        "Audience not found"
      );
    });

    it("deletes R2 profiles for all members", async () => {
      const mockAudience = createMockAudience();
      const mockMembers = [
        createMockMember({
          id: "m1",
          profileStorageKey: "key1",
        }),
        createMockMember({
          id: "m2",
          profileStorageKey: "key2",
        }),
      ];

      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return mockAudience;
          return undefined;
        }),
        [Symbol.iterator]: function* () {
          yield* mockMembers;
        },
      }));
      mockDeleteObject.mockResolvedValue(undefined);

      const { deleteAudience } = await import("./audience");
      await deleteAudience("audience-1");

      expect(mockDeleteObject).toHaveBeenCalledWith("key1");
      expect(mockDeleteObject).toHaveBeenCalledWith("key2");
    });
  });
});
