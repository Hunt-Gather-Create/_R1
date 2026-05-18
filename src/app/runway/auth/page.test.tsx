import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, redirectMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./auth-form", () => ({
  default: vi.fn(() => null),
}));

import RunwayAuthPage from "./page";
import {
  RUNWAY_AUTH_COOKIE_NAME,
  signRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

const TEST_SECRET = "test-secret-do-not-use-in-prod";

function makeCookieStore(cookieValue?: string) {
  return {
    get: vi.fn((name: string) => {
      if (name === RUNWAY_AUTH_COOKIE_NAME && cookieValue !== undefined) {
        return { name, value: cookieValue };
      }
      return undefined;
    }),
  };
}

describe("RunwayAuthPage", () => {
  beforeEach(() => {
    vi.stubEnv("RUNWAY_AUTH_SECRET", TEST_SECRET);
    cookiesMock.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to the sanitized returnTo when a valid auth cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));

    await expect(
      RunwayAuthPage({
        searchParams: Promise.resolve({ returnTo: "/runway/foo" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway/foo");
  });

  it("renders <AuthForm> with returnTo=/runway when no cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));

    const result = (await RunwayAuthPage({
      searchParams: Promise.resolve({}),
    })) as { props: { returnTo: string } };

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result.props.returnTo).toBe("/runway");
  });

  it("renders <AuthForm> with returnTo=/runway when cookie is invalid (tampered)", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("bogus.value"));

    const result = (await RunwayAuthPage({
      searchParams: Promise.resolve({ returnTo: "/runway" }),
    })) as { props: { returnTo: string } };

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result.props.returnTo).toBe("/runway");
  });

  it("sanitizes a malicious returnTo before redirecting (valid cookie path)", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));

    await expect(
      RunwayAuthPage({
        searchParams: Promise.resolve({
          returnTo: "https://evil.example.com",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("sanitizes a /runway/auth returnTo to avoid a self-loop redirect", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));

    await expect(
      RunwayAuthPage({
        searchParams: Promise.resolve({ returnTo: "/runway/auth" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/runway");
  });

  it("renders form with sanitized returnTo=/runway when an arbitrary path is supplied", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));

    const result = (await RunwayAuthPage({
      searchParams: Promise.resolve({ returnTo: "/dashboard" }),
    })) as { props: { returnTo: string } };

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result.props.returnTo).toBe("/runway");
  });

  it("renders form with preserved sub-path when a /runway/foo path is supplied (no cookie)", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));

    const result = (await RunwayAuthPage({
      searchParams: Promise.resolve({ returnTo: "/runway/foo" }),
    })) as { props: { returnTo: string } };

    expect(redirectMock).not.toHaveBeenCalled();
    expect(result.props.returnTo).toBe("/runway/foo");
  });
});
