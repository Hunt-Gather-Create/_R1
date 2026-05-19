import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, redirectMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import RunwayGatedLayout from "./layout";
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

describe("RunwayGatedLayout", () => {
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

  it("redirects to /runway/auth?returnTo=/runway when no auth cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));

    await expect(
      RunwayGatedLayout({
        children: "child-marker" as unknown as React.ReactNode,
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith(
      "/runway/auth?returnTo=/runway",
    );
  });

  it("redirects when the auth cookie is malformed", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore("malformed-no-dot"));

    await expect(
      RunwayGatedLayout({
        children: "child-marker" as unknown as React.ReactNode,
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith(
      "/runway/auth?returnTo=/runway",
    );
  });

  it("redirects when the auth cookie HMAC is tampered", async () => {
    const valid = signRunwayAuthCookie();
    const [payload, mac] = valid.split(".");
    const tamperedChar = mac![0] === "A" ? "B" : "A";
    const tampered = `${payload}.${tamperedChar}${mac!.slice(1)}`;

    cookiesMock.mockResolvedValue(makeCookieStore(tampered));

    await expect(
      RunwayGatedLayout({
        children: "child-marker" as unknown as React.ReactNode,
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledExactlyOnceWith(
      "/runway/auth?returnTo=/runway",
    );
  });

  it("renders children when the auth cookie is valid", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));

    const result = await RunwayGatedLayout({
      children: "child-marker" as unknown as React.ReactNode,
    });

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as { props: { children: string } }).props.children).toBe(
      "child-marker",
    );
  });
});
