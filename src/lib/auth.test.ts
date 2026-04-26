import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers cookies
const mockCookies = vi.fn();
vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

// Mock iron-session unsealData
const mockUnsealData = vi.fn();
vi.mock("iron-session", () => ({
  unsealData: mockUnsealData,
}));

// Helper: build a cookieStore that returns a cookie value
function makeCookieStore(value: string | undefined) {
  return {
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  };
}

describe("getCurrentUser (via getSessionFromCookie)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("re-throws when cookies() throws an error with digest: DYNAMIC_SERVER_USAGE", async () => {
    const sentinel = Object.assign(new Error("DYNAMIC_SERVER_USAGE"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    mockCookies.mockRejectedValue(sentinel);

    const { getCurrentUser } = await import("./auth");
    await expect(getCurrentUser()).rejects.toThrow(sentinel);
  });

  it("re-throws when cookies() throws an error with digest: NEXT_REDIRECT", async () => {
    const sentinel = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT",
    });
    mockCookies.mockRejectedValue(sentinel);

    const { getCurrentUser } = await import("./auth");
    await expect(getCurrentUser()).rejects.toThrow(sentinel);
  });

  it("returns null when cookies() returns a cookieStore with no session cookie", async () => {
    mockCookies.mockResolvedValue(makeCookieStore(undefined));

    const { getCurrentUser } = await import("./auth");
    const result = await getCurrentUser();
    expect(result).toBeNull();
  });

  it("returns null and logs error when unsealData throws a plain Error (no digest)", async () => {
    mockCookies.mockResolvedValue(makeCookieStore("some-sealed-cookie"));
    const plainError = new Error("decryption failed");
    mockUnsealData.mockRejectedValue(plainError);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getCurrentUser } = await import("./auth");
    const result = await getCurrentUser();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to decrypt session:",
      plainError
    );

    consoleSpy.mockRestore();
  });

  it("re-throws when cookies() throws a plain object { digest: 'X' } with no Error inheritance", async () => {
    const plainObj = { digest: "NEXT_NOT_FOUND", message: "not an Error" };
    mockCookies.mockRejectedValue(plainObj);

    const { getCurrentUser } = await import("./auth");
    await expect(getCurrentUser()).rejects.toEqual(plainObj);
  });

  // ---------------------------------------------------------------------
  // Holdout QA corner-case coverage for PR 93
  // ---------------------------------------------------------------------

  describe("React.cache behavior across repeated callers", () => {
    // NOTE: React.cache only memoizes inside a React render scope (RSC).
    // Vitest + happy-dom has no such scope, so cache() is a passthrough
    // here — each call invokes the underlying function. These tests
    // verify the OBSERVABLE behavior in this environment: every caller
    // sees a consistent rejection / null and no caller sees a partial /
    // hung result. The production memoization itself is React-internal
    // and out of scope for unit tests.
    it("each caller in the same tick sees the same sentinel rejection (no partial / hung promises)", async () => {
      const sentinel = Object.assign(new Error("DYNAMIC_SERVER_USAGE"), {
        digest: "DYNAMIC_SERVER_USAGE",
      });
      mockCookies.mockRejectedValue(sentinel);

      const { getCurrentUser } = await import("./auth");
      const results = await Promise.allSettled([
        getCurrentUser(),
        getCurrentUser(),
        getCurrentUser(),
      ]);
      for (const r of results) {
        expect(r.status).toBe("rejected");
        if (r.status === "rejected") expect(r.reason).toBe(sentinel);
      }
    });

    it("each caller in the same tick gets null when no cookie is present (no caller hangs / errors)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore(undefined));

      const { getCurrentUser } = await import("./auth");
      const [a, b, c] = await Promise.all([
        getCurrentUser(),
        getCurrentUser(),
        getCurrentUser(),
      ]);
      expect(a).toBeNull();
      expect(b).toBeNull();
      expect(c).toBeNull();
    });
  });

  describe("Edge .digest values", () => {
    // Spec interpretation: Next.js's own `isRedirectError` requires
    // `typeof error.digest === 'string'`. A truthy non-string digest is NOT
    // a real Next sentinel. The current implementation uses a truthy check
    // which is more permissive — these tests document that behavior.
    it("swallows error with digest: '' (empty string is falsy)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const err = Object.assign(new Error("e"), { digest: "" });
      mockUnsealData.mockRejectedValue(err);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });

    it("swallows error with digest: null (falsy)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const err = Object.assign(new Error("e"), { digest: null });
      mockUnsealData.mockRejectedValue(err);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });

    it("swallows error with digest: 0 (falsy)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const err = Object.assign(new Error("e"), { digest: 0 });
      mockUnsealData.mockRejectedValue(err);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });

    it("re-throws error with digest: { nested: 'obj' } (truthy non-string)", async () => {
      // Edge: implementation re-throws on truthy digest, but Next would NOT
      // recognize a non-string digest as a sentinel. Document current behavior
      // — re-throw. If a real bug surfaces here it'd be a false positive
      // re-throw, not a swallowed sentinel.
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const err = Object.assign(new Error("e"), {
        digest: { nested: "obj" },
      });
      mockUnsealData.mockRejectedValue(err);

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).rejects.toBe(err);
    });

    it("re-throws error with digest containing valid Next redirect format string", async () => {
      // Real Next NEXT_REDIRECT digest: "NEXT_REDIRECT;replace;/login;307;"
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const err = Object.assign(new Error("e"), {
        digest: "NEXT_REDIRECT;replace;/login;307;",
      });
      mockUnsealData.mockRejectedValue(err);

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).rejects.toBe(err);
    });
  });

  describe("Error-shape variants", () => {
    it("re-throws plain object { digest: 'NEXT_REDIRECT' } from unsealData (no Error inheritance)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const plainObj = { digest: "NEXT_REDIRECT" };
      mockUnsealData.mockRejectedValue(plainObj);

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).rejects.toEqual(plainObj);
    });

    it("swallows thrown string", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      mockUnsealData.mockRejectedValue("a bare string error");
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to decrypt session:",
        "a bare string error"
      );
      consoleSpy.mockRestore();
    });

    it("swallows thrown null", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      mockUnsealData.mockRejectedValue(null);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith("Failed to decrypt session:", null);
      consoleSpy.mockRestore();
    });

    it("swallows thrown undefined", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      mockUnsealData.mockRejectedValue(undefined);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });

    it("swallows thrown number", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      mockUnsealData.mockRejectedValue(42);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });

    it("swallows thrown Symbol", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const sym = Symbol("danger");
      mockUnsealData.mockRejectedValue(sym);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("Boundary cookie values", () => {
    it("treats empty-string cookie value as no cookie (returns null without calling unsealData)", async () => {
      // makeCookieStore('') returns undefined (helper treats '' as falsy),
      // but a real cookieStore could return { value: '' }. Simulate that.
      const cookieStore = {
        get: vi.fn().mockReturnValue({ value: "" }),
      };
      mockCookies.mockResolvedValue(cookieStore);

      const { getCurrentUser } = await import("./auth");
      const result = await getCurrentUser();
      expect(result).toBeNull();
      // unsealData should NOT have been called for an empty-string cookie.
      expect(mockUnsealData).not.toHaveBeenCalled();
    });

    it("handles oversized (100KB) cookie value by passing through to unsealData", async () => {
      const huge = "x".repeat(100 * 1024);
      mockCookies.mockResolvedValue(makeCookieStore(huge));
      mockUnsealData.mockResolvedValue({
        accessToken: "a",
        refreshToken: "r",
        user: {
          id: "u1",
          email: "u@e.com",
          firstName: null,
          lastName: null,
          profilePictureUrl: null,
        },
      });

      const { getCurrentUser } = await import("./auth");
      const u = await getCurrentUser();
      expect(u?.id).toBe("u1");
      expect(mockUnsealData).toHaveBeenCalledWith(huge, expect.any(Object));
    });

    it("returns null when unsealData rejects with iron-session 'Bad hmac value' style error (wrong password)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("sealed-cookie"));
      mockUnsealData.mockRejectedValue(new Error("Bad hmac value"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).resolves.toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("State / ordering", () => {
    it("re-throws sentinel from unsealData (not just from cookies()) so post-cookie sentinels also propagate", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      const sentinel = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/login;307;",
      });
      mockUnsealData.mockRejectedValue(sentinel);

      const { getCurrentUser } = await import("./auth");
      await expect(getCurrentUser()).rejects.toBe(sentinel);
    });

    it("returns the user from a successful unsealData (happy path with valid session)", async () => {
      mockCookies.mockResolvedValue(makeCookieStore("c"));
      mockUnsealData.mockResolvedValue({
        accessToken: "a",
        refreshToken: "r",
        user: {
          id: "user_123",
          email: "x@y.com",
          firstName: "X",
          lastName: "Y",
          profilePictureUrl: null,
        },
      });

      const { getCurrentUser, getCurrentUserId } = await import("./auth");
      const u = await getCurrentUser();
      const id = await getCurrentUserId();
      expect(u?.id).toBe("user_123");
      expect(id).toBe("user_123");
    });
  });
});
