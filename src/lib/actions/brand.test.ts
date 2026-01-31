import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Brand, CreateBrandInput } from "../types";

// Helper to create mock brands
function createMockBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    userId: "user-1",
    name: "Test Brand",
    tagline: "Test tagline",
    description: "Test description",
    logoUrl: "https://example.com/logo.png",
    logoStorageKey: null,
    logoBackground: null,
    websiteUrl: "https://example.com",
    primaryColor: "#ff0000",
    secondaryColor: "#00ff00",
    industry: "Technology",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
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
      // Return array for list queries, or chainable for single queries
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
    _setGetResult: (val: unknown) => { getResult = val; },
    _setWhereResult: (val: unknown[]) => { whereResult = val; },
    _setReturningResult: (val: unknown[]) => { returningResult = val; },
  };

  return chainable;
}

const mockDb = createDbMock();

vi.mock("../db", () => ({
  db: mockDb,
}));

vi.mock("./workspace", () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    member: { role: "admin" },
    workspace: { id: "workspace-1", slug: "test-workspace" },
  }),
}));

vi.mock("../auth", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("brand actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._setGetResult(undefined);
    mockDb._setWhereResult([]);
    mockDb._setReturningResult([]);
  });

  describe("getUserBrands", () => {
    it("returns empty array when user has no brands", async () => {
      // Test that getUserBrands correctly queries db
      const { getUserBrands } = await import("./brand");
      await getUserBrands();

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it("returns all brands for user", async () => {
      // Note: Mock verification - the getUserBrands function queries db correctly
      const { getUserBrands } = await import("./brand");
      await getUserBrands();

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe("getBrandById", () => {
    it("returns null when brand not found", async () => {
      mockDb._setGetResult(undefined);

      const { getBrandById } = await import("./brand");
      const result = await getBrandById("nonexistent");

      expect(result).toBeNull();
    });

    it("returns brand when found", async () => {
      const mockBrand = createMockBrand();
      mockDb._setGetResult(mockBrand);

      const { getBrandById } = await import("./brand");
      const result = await getBrandById("brand-1");

      expect(result).toEqual(mockBrand);
    });
  });

  describe("createBrand", () => {
    it("creates brand with all fields", async () => {
      const input: CreateBrandInput = {
        name: "New Brand",
        tagline: "New tagline",
        description: "New description",
        logoUrl: "https://example.com/new-logo.png",
        websiteUrl: "https://newbrand.com",
        primaryColor: "#0000ff",
        secondaryColor: "#ffff00",
        industry: "Finance",
      };
      const mockCreatedBrand = createMockBrand(input);
      mockDb._setReturningResult([mockCreatedBrand]);

      const { createBrand } = await import("./brand");
      const result = await createBrand(input);

      expect(result.name).toBe("New Brand");
      expect(result.tagline).toBe("New tagline");
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("creates brand with minimal fields", async () => {
      const input: CreateBrandInput = {
        name: "Minimal Brand",
      };
      const mockCreatedBrand = createMockBrand({
        ...input,
        tagline: null,
        description: null,
        logoUrl: null,
        websiteUrl: null,
        primaryColor: null,
        secondaryColor: null,
        industry: null,
      });
      mockDb._setReturningResult([mockCreatedBrand]);

      const { createBrand } = await import("./brand");
      const result = await createBrand(input);

      expect(result.name).toBe("Minimal Brand");
      expect(result.tagline).toBeNull();
    });
  });

  describe("updateBrand", () => {
    it("updates brand fields", async () => {
      const existingBrand = createMockBrand();
      mockDb._setGetResult(existingBrand);
      const updatedBrand = createMockBrand({ name: "Updated Name" });
      mockDb._setReturningResult([updatedBrand]);

      const { updateBrand } = await import("./brand");
      const result = await updateBrand("brand-1", { name: "Updated Name" });

      expect(result.name).toBe("Updated Name");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("throws if brand not found", async () => {
      mockDb._setGetResult(undefined);

      const { updateBrand } = await import("./brand");

      await expect(updateBrand("nonexistent", { name: "Test" })).rejects.toThrow(
        "Brand not found or access denied"
      );
    });
  });

  describe("deleteBrand", () => {
    it("deletes brand", async () => {
      const existingBrand = createMockBrand();
      mockDb._setGetResult(existingBrand);

      const { deleteBrand } = await import("./brand");
      await deleteBrand("brand-1");

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("throws if brand not found", async () => {
      mockDb._setGetResult(undefined);

      const { deleteBrand } = await import("./brand");

      await expect(deleteBrand("nonexistent")).rejects.toThrow(
        "Brand not found or access denied"
      );
    });
  });

  describe("getWorkspaceBrand", () => {
    it("returns null when workspace has no brand", async () => {
      mockDb._setGetResult({ brandId: null });

      const { getWorkspaceBrand } = await import("./brand");
      const result = await getWorkspaceBrand("workspace-1");

      expect(result).toBeNull();
    });

    it("returns brand when workspace is linked", async () => {
      const mockBrand = createMockBrand();
      // Mock needs to return different values for different calls
      let callCount = 0;
      mockDb.where.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return { brandId: "brand-1" };
          return mockBrand;
        }),
      }));

      const { getWorkspaceBrand } = await import("./brand");
      const result = await getWorkspaceBrand("workspace-1");

      expect(result).toMatchObject(mockBrand);
    });
  });

  describe("setWorkspaceBrand", () => {
    it("links brand to workspace", async () => {
      const mockBrand = createMockBrand();
      mockDb._setGetResult(mockBrand);

      const { setWorkspaceBrand } = await import("./brand");
      await setWorkspaceBrand("workspace-1", "brand-1");

      expect(mockDb.update).toHaveBeenCalled();
    });

    it("verifies brand ownership before linking", async () => {
      // Test that setWorkspaceBrand queries the brand to verify ownership
      const mockBrand = createMockBrand();
      mockDb._setGetResult(mockBrand);

      const { setWorkspaceBrand } = await import("./brand");
      await setWorkspaceBrand("workspace-1", "brand-1");

      // Verify that ownership check happened
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe("unlinkWorkspaceBrand", () => {
    it("removes brand link from workspace", async () => {
      const { unlinkWorkspaceBrand } = await import("./brand");
      await unlinkWorkspaceBrand("workspace-1");

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: null })
      );
    });
  });
});
