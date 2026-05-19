import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, redirectMock, delayMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  delayMock: vi.fn(async () => undefined),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("node:timers/promises", () => {
  const mod = { setTimeout: delayMock };
  return { ...mod, default: mod };
});

import { verifyAndSetRunwayAuth } from "./actions";
import { RUNWAY_AUTH_COOKIE_NAME } from "@/lib/runway/auth-cookie";

const TEST_SECRET = "test-secret-do-not-use-in-prod";
const TEST_PASSWORD = "correct-horse-battery-staple";

function makeCookieStore() {
  return { set: vi.fn() };
}

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("verifyAndSetRunwayAuth", () => {
  beforeEach(() => {
    vi.stubEnv("RUNWAY_AUTH_SECRET", TEST_SECRET);
    vi.stubEnv("RUNWAY_PASSWORD", TEST_PASSWORD);
    cookiesMock.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    delayMock.mockReset();
    delayMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns { error } and waits 500ms when password is wrong", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    const result = await verifyAndSetRunwayAuth(
      null,
      makeFormData({ password: "wrong", returnTo: "/runway" }),
    );

    expect(result).toEqual({ error: "Incorrect password." });
    expect(delayMock).toHaveBeenCalledExactlyOnceWith(500);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns { error } when password field is missing", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    const result = await verifyAndSetRunwayAuth(
      null,
      makeFormData({ returnTo: "/runway" }),
    );

    expect(result).toEqual({ error: "Incorrect password." });
    expect(delayMock).toHaveBeenCalledExactlyOnceWith(500);
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sets the cookie and redirects to returnTo on correct password", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD, returnTo: "/runway" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(delayMock).not.toHaveBeenCalled();
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(
      RUNWAY_AUTH_COOKIE_NAME,
      expect.stringMatching(/^\d+\.[A-Za-z0-9_-]+$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/runway",
        maxAge: 30 * 24 * 60 * 60,
      }),
    );
    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("rejects returnTo outside /runway/*", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD, returnTo: "/dashboard" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("rejects returnTo of /runway/auth (no self-loop)", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD, returnTo: "/runway/auth" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("preserves a future /runway/foo sub-path returnTo", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD, returnTo: "/runway/foo" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway/foo");
  });

  it("falls back to /runway when returnTo is omitted", async () => {
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("sets secure: true when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookieStore = makeCookieStore();
    cookiesMock.mockResolvedValue(cookieStore);

    await expect(
      verifyAndSetRunwayAuth(
        null,
        makeFormData({ password: TEST_PASSWORD, returnTo: "/runway" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(cookieStore.set).toHaveBeenCalledWith(
      RUNWAY_AUTH_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });
});
