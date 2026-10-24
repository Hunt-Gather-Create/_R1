/**
 * The view-preferences server actions must refuse a caller without a valid
 * Runway password cookie before they open the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, getRunwayDbMock } = vi.hoisted(() => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [],
    insert: () => ({ values: async () => undefined }),
  };
  return { cookiesMock: vi.fn(), getRunwayDbMock: vi.fn(() => chain) };
});

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/db/runway", () => ({ getRunwayDb: getRunwayDbMock }));
vi.mock("@/lib/db/runway-schema", () => ({
  viewPreferences: { scope: "scope", preferences: "preferences" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a, b) => ({ eq: [a, b] })) }));

import { getViewPreferences, setViewPreferences } from "./view-preferences";
import {
  RUNWAY_AUTH_COOKIE_NAME,
  signRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

const TEST_SECRET = "test-secret-do-not-use-in-prod";
const GATE_ERROR = "Runway gate: not signed in";

function makeCookieStore(cookieValue?: string) {
  return {
    get: vi.fn((name: string) =>
      name === RUNWAY_AUTH_COOKIE_NAME && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
    ),
  };
}

function tamperedCookie(): string {
  const [payload, mac] = signRunwayAuthCookie().split(".");
  const swapped = mac![0] === "A" ? "B" : "A";
  return `${payload}.${swapped}${mac!.slice(1)}`;
}

const cases = [
  { name: "getViewPreferences", call: () => getViewPreferences() },
  {
    name: "setViewPreferences",
    call: () => setViewPreferences({ inFlightToggle: false }),
  },
];

beforeEach(() => {
  vi.stubEnv("RUNWAY_AUTH_SECRET", TEST_SECRET);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(cases)("$name gate", ({ call }) => {
  it("throws before any database call when no cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));
    await expect(call()).rejects.toThrow(GATE_ERROR);
    expect(getRunwayDbMock).not.toHaveBeenCalled();
  });

  it("throws before any database call when the cookie is tampered", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(tamperedCookie()));
    await expect(call()).rejects.toThrow(GATE_ERROR);
    expect(getRunwayDbMock).not.toHaveBeenCalled();
  });

  it("reaches the database with a valid cookie", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));
    await expect(call()).resolves.toMatchObject({ inFlightToggle: expect.any(Boolean) });
    expect(getRunwayDbMock).toHaveBeenCalled();
  });
});
