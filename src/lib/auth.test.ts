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
});
