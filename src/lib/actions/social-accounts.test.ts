import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB with chainable methods
const mockReturning = vi.fn();
const mockLimit = vi.fn();
const mockWhere = vi.fn();

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn(() => ({ limit: mockLimit })),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn(() => ({ returning: mockReturning })),
  update: vi.fn().mockReturnThis(),
  set: vi.fn(() => ({ where: mockWhere })),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("../db", () => ({ db: mockDb }));

vi.mock("./workspace", () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    member: { role: "member" },
    workspace: { id: "ws-1", slug: "test-workspace" },
  }),
}));

const mockEncryptToken = vi.fn().mockResolvedValue("sealed-value");
const mockDecryptToken = vi.fn().mockResolvedValue("decrypted-token");

vi.mock("../social/token-encryption", () => ({
  encryptToken: (...args: unknown[]) => mockEncryptToken(...args),
  decryptToken: (...args: unknown[]) => mockDecryptToken(...args),
}));

const mockRefreshAccessToken = vi.fn();

vi.mock("../social/adapters", () => ({
  getPlatformAdapter: () => ({
    refreshAccessToken: mockRefreshAccessToken,
  }),
}));

// Import after mocks
const {
  getWorkspaceSocialAccounts,
  getWorkspaceSocialAccount,
  createSocialAccount,
  updateSocialAccountTokens,
  disconnectSocialAccount,
  ensureValidToken,
} = await import("./social-accounts");

function createMockAccount(overrides = {}) {
  return {
    id: "account-1",
    workspaceId: "ws-1",
    userId: "user-1",
    platform: "instagram",
    platformUserId: "ig-123",
    platformUsername: "testuser",
    accessTokenSealed: "sealed-access",
    refreshTokenSealed: "sealed-refresh",
    tokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    scopes: JSON.stringify(["read"]),
    connectionStatus: "connected",
    lastRefreshedAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("social-accounts actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWorkspaceSocialAccounts", () => {
    it("queries by workspaceId", async () => {
      // The chain is select().from().where() which returns the results directly
      mockDb.where = vi.fn().mockResolvedValue([createMockAccount()]);

      const result = await getWorkspaceSocialAccounts("ws-1");

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe("instagram");
    });
  });

  describe("getWorkspaceSocialAccount", () => {
    it("returns account when found", async () => {
      const account = createMockAccount();
      mockLimit.mockResolvedValue([account]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));

      const result = await getWorkspaceSocialAccount("ws-1", "instagram");

      expect(result).toEqual(account);
    });

    it("returns null when no account found", async () => {
      mockLimit.mockResolvedValue([]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));

      const result = await getWorkspaceSocialAccount("ws-1", "instagram");

      expect(result).toBeNull();
    });
  });

  describe("createSocialAccount", () => {
    it("encrypts tokens before storing", async () => {
      const newAccount = createMockAccount();
      mockReturning.mockResolvedValue([newAccount]);

      await createSocialAccount({
        workspaceId: "ws-1",
        userId: "user-1",
        platform: "instagram",
        platformUserId: "ig-123",
        platformUsername: "testuser",
        accessToken: "plain-access-token",
        refreshToken: "plain-refresh-token",
        scopes: ["read"],
      });

      expect(mockEncryptToken).toHaveBeenCalledWith("plain-access-token");
      expect(mockEncryptToken).toHaveBeenCalledWith("plain-refresh-token");
    });

    it("handles missing refresh token", async () => {
      mockReturning.mockResolvedValue([createMockAccount()]);

      await createSocialAccount({
        workspaceId: "ws-1",
        userId: "user-1",
        platform: "instagram",
        platformUserId: "ig-123",
        platformUsername: "testuser",
        accessToken: "plain-access-token",
        scopes: ["read"],
      });

      // Should encrypt access token but not call encrypt for refresh
      expect(mockEncryptToken).toHaveBeenCalledTimes(1);
      expect(mockEncryptToken).toHaveBeenCalledWith("plain-access-token");
    });

    it("stores scopes as JSON string", async () => {
      mockReturning.mockResolvedValue([createMockAccount()]);

      await createSocialAccount({
        workspaceId: "ws-1",
        userId: "user-1",
        platform: "instagram",
        platformUserId: "ig-123",
        platformUsername: "testuser",
        accessToken: "token",
        scopes: ["read", "write"],
      });

      // Verify the values call included serialized scopes
      const valuesCall = mockDb.values.mock.calls[0][0];
      expect(valuesCall.scopes).toBe(JSON.stringify(["read", "write"]));
    });
  });

  describe("updateSocialAccountTokens", () => {
    it("encrypts new tokens", async () => {
      mockWhere.mockResolvedValue(undefined);

      await updateSocialAccountTokens("account-1", {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });

      expect(mockEncryptToken).toHaveBeenCalledWith("new-access");
      expect(mockEncryptToken).toHaveBeenCalledWith("new-refresh");
    });

    it("sets connectionStatus to connected", async () => {
      mockWhere.mockResolvedValue(undefined);

      await updateSocialAccountTokens("account-1", {
        accessToken: "new-access",
      });

      const setCall = mockDb.set.mock.calls[0][0];
      expect(setCall.connectionStatus).toBe("connected");
    });
  });

  describe("disconnectSocialAccount", () => {
    it("deletes the account record", async () => {
      mockDb.where = vi.fn().mockResolvedValue(undefined);

      await disconnectSocialAccount("ws-1", "instagram");

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  describe("ensureValidToken", () => {
    it("returns decrypted token when not expired", async () => {
      const account = createMockAccount({
        tokenExpiresAt: new Date(Date.now() + 3600000), // future
      });
      mockLimit.mockResolvedValue([account]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));
      mockDecryptToken.mockResolvedValue("my-access-token");

      const result = await ensureValidToken("account-1");

      expect(result).toBe("my-access-token");
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it("returns null when account not found", async () => {
      mockLimit.mockResolvedValue([]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));

      const result = await ensureValidToken("nonexistent");

      expect(result).toBeNull();
    });

    it("attempts refresh when token is expired", async () => {
      const account = createMockAccount({
        tokenExpiresAt: new Date(Date.now() - 1000), // past
      });
      mockLimit.mockResolvedValue([account]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));
      mockDecryptToken.mockResolvedValue("old-refresh-token");
      mockRefreshAccessToken.mockResolvedValue({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: new Date(Date.now() + 3600000),
      });
      // updateSocialAccountTokens mock
      mockReturning.mockResolvedValue([]);
      mockWhere.mockResolvedValue(undefined);

      const result = await ensureValidToken("account-1");

      expect(result).toBe("new-access");
      expect(mockRefreshAccessToken).toHaveBeenCalled();
    });

    it("returns null and marks expired when refresh fails", async () => {
      const account = createMockAccount({
        tokenExpiresAt: new Date(Date.now() - 1000), // past
      });
      mockLimit.mockResolvedValue([account]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));
      mockDecryptToken.mockResolvedValue("old-token");
      mockRefreshAccessToken.mockRejectedValue(new Error("Refresh denied"));
      // For the status update after failure
      mockWhere.mockResolvedValue(undefined);

      const result = await ensureValidToken("account-1");

      expect(result).toBeNull();
    });

    it("returns token when no expiry is set (token never expires)", async () => {
      const account = createMockAccount({ tokenExpiresAt: null });
      mockLimit.mockResolvedValue([account]);
      mockDb.where = vi.fn(() => ({ limit: mockLimit }));
      mockDecryptToken.mockResolvedValue("permanent-token");

      const result = await ensureValidToken("account-1");

      expect(result).toBe("permanent-token");
    });
  });
});
