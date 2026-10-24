/**
 * The login action is the one Runway server action that must stay callable
 * without a password cookie, since it is how a caller gets one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, redirectMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { verifyAndSetRunwayAuth } from "./actions";
import { RUNWAY_AUTH_COOKIE_NAME } from "@/lib/runway/auth-cookie";

const TEST_PASSWORD = "correct-horse-battery-staple";

beforeEach(() => {
  vi.stubEnv("RUNWAY_AUTH_SECRET", "test-secret-do-not-use-in-prod");
  vi.stubEnv("RUNWAY_PASSWORD", TEST_PASSWORD);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyAndSetRunwayAuth without a cookie", () => {
  it("sets the auth cookie and redirects when the caller has no cookie yet", async () => {
    const cookieStore = { get: vi.fn(() => undefined), set: vi.fn() };
    cookiesMock.mockResolvedValue(cookieStore);
    const fd = new FormData();
    fd.set("password", TEST_PASSWORD);
    fd.set("returnTo", "/runway");

    await expect(verifyAndSetRunwayAuth(null, fd)).rejects.toThrow("NEXT_REDIRECT");

    expect(cookieStore.set).toHaveBeenCalledWith(
      RUNWAY_AUTH_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/runway" }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/runway");
  });
});
