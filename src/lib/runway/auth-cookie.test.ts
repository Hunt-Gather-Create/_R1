import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  RUNWAY_AUTH_COOKIE_NAME,
  RUNWAY_AUTH_TTL_MS,
  RUNWAY_AUTH_TTL_SECONDS,
  safeRunwayReturnTo,
  signRunwayAuthCookie,
  verifyRunwayAuthCookie,
  verifyRunwayPassword,
} from "./auth-cookie";

const TEST_SECRET = "test-secret-do-not-use-in-prod";
const TEST_PASSWORD = "correct-horse-battery-staple";

describe("auth-cookie constants", () => {
  it("exposes the cookie name", () => {
    expect(RUNWAY_AUTH_COOKIE_NAME).toBe("runway_auth");
  });

  it("exposes 30-day TTLs in ms + seconds", () => {
    expect(RUNWAY_AUTH_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(RUNWAY_AUTH_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(RUNWAY_AUTH_TTL_MS).toBe(RUNWAY_AUTH_TTL_SECONDS * 1000);
  });
});

describe("signRunwayAuthCookie + verifyRunwayAuthCookie", () => {
  beforeEach(() => {
    vi.stubEnv("RUNWAY_AUTH_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips: a freshly signed cookie verifies as valid", () => {
    const now = Date.UTC(2026, 4, 18);
    const value = signRunwayAuthCookie(now);
    expect(verifyRunwayAuthCookie(value, now)).toBe(true);
  });

  it("the signed value has the <expiresAt>.<base64url-hmac> shape", () => {
    const now = Date.UTC(2026, 4, 18);
    const value = signRunwayAuthCookie(now);
    const [payload, mac, ...rest] = value.split(".");
    expect(rest).toHaveLength(0);
    expect(Number(payload)).toBe(now + RUNWAY_AUTH_TTL_MS);
    // base64url uses [A-Za-z0-9_-]
    expect(mac).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a cookie whose HMAC was tampered with", () => {
    const now = Date.UTC(2026, 4, 18);
    const value = signRunwayAuthCookie(now);
    const [payload, mac] = value.split(".");
    // Flip one character in the MAC.
    const tamperedChar = mac![0] === "A" ? "B" : "A";
    const tampered = `${payload}.${tamperedChar}${mac!.slice(1)}`;
    expect(verifyRunwayAuthCookie(tampered, now)).toBe(false);
  });

  it("rejects a cookie whose payload was tampered with (HMAC won't match)", () => {
    const now = Date.UTC(2026, 4, 18);
    const value = signRunwayAuthCookie(now);
    const mac = value.split(".")[1];
    // New payload (farther-future expiry) signed with the original MAC.
    const fakePayload = String(now + RUNWAY_AUTH_TTL_MS * 100);
    const tampered = `${fakePayload}.${mac}`;
    expect(verifyRunwayAuthCookie(tampered, now)).toBe(false);
  });

  it("rejects an expired cookie even if HMAC is valid", () => {
    const issuedAt = Date.UTC(2026, 0, 1);
    const value = signRunwayAuthCookie(issuedAt);
    const wellPastExpiry = issuedAt + RUNWAY_AUTH_TTL_MS + 1;
    expect(verifyRunwayAuthCookie(value, wellPastExpiry)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const now = Date.UTC(2026, 4, 18);
    const value = signRunwayAuthCookie(now);
    vi.stubEnv("RUNWAY_AUTH_SECRET", "different-secret");
    expect(verifyRunwayAuthCookie(value, now)).toBe(false);
  });

  it("rejects malformed values (no dot)", () => {
    expect(verifyRunwayAuthCookie("nodothere")).toBe(false);
  });

  it("rejects malformed values (empty payload)", () => {
    expect(verifyRunwayAuthCookie(".somehmac")).toBe(false);
  });

  it("rejects malformed values (empty hmac)", () => {
    expect(verifyRunwayAuthCookie("12345.")).toBe(false);
  });

  it("rejects when payload is not a finite number (Number.isFinite branch)", async () => {
    // Build a cookie with a non-numeric payload BUT a valid HMAC over that
    // payload — that way only the Number.isFinite check can reject it.
    const { createHmac } = await import("node:crypto");
    const fakePayload = "not-a-number";
    const mac = createHmac("sha256", Buffer.from(TEST_SECRET, "utf8"))
      .update(fakePayload, "utf8")
      .digest("base64url");
    expect(verifyRunwayAuthCookie(`${fakePayload}.${mac}`)).toBe(false);
  });

  it("throws an operator-facing error when RUNWAY_AUTH_SECRET is unset", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("RUNWAY_AUTH_SECRET", "");
    expect(() => signRunwayAuthCookie()).toThrowError(
      /RUNWAY_AUTH_SECRET not configured/,
    );
    expect(() => verifyRunwayAuthCookie("anything.value")).toThrowError(
      /RUNWAY_AUTH_SECRET not configured/,
    );
  });
});

describe("verifyRunwayPassword", () => {
  beforeEach(() => {
    vi.stubEnv("RUNWAY_PASSWORD", TEST_PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for the correct password", () => {
    expect(verifyRunwayPassword(TEST_PASSWORD)).toBe(true);
  });

  it("returns false for a correct-length wrong-bytes password", () => {
    expect(verifyRunwayPassword("X".repeat(TEST_PASSWORD.length))).toBe(false);
  });

  it("returns false for a wrong-length password (no length leak)", () => {
    expect(verifyRunwayPassword("short")).toBe(false);
    expect(verifyRunwayPassword(TEST_PASSWORD + "extra")).toBe(false);
    expect(verifyRunwayPassword("")).toBe(false);
  });

  it("treats unicode bytes correctly (utf8 hashing, not char-count)", () => {
    const unicodePw = "pässwörd-😀";
    vi.stubEnv("RUNWAY_PASSWORD", unicodePw);
    expect(verifyRunwayPassword(unicodePw)).toBe(true);
    expect(verifyRunwayPassword("password-:)")).toBe(false);
  });

  it("throws an operator-facing error when RUNWAY_PASSWORD is unset", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("RUNWAY_PASSWORD", "");
    expect(() => verifyRunwayPassword("anything")).toThrowError(
      /RUNWAY_PASSWORD not configured/,
    );
  });
});

describe("safeRunwayReturnTo", () => {
  it("returns /runway when input is empty or nullish", () => {
    expect(safeRunwayReturnTo(null)).toBe("/runway");
    expect(safeRunwayReturnTo(undefined)).toBe("/runway");
    expect(safeRunwayReturnTo("")).toBe("/runway");
  });

  it("returns /runway when the path does not start with /runway", () => {
    expect(safeRunwayReturnTo("/")).toBe("/runway");
    expect(safeRunwayReturnTo("/dashboard")).toBe("/runway");
    expect(safeRunwayReturnTo("https://evil.example.com")).toBe("/runway");
    expect(safeRunwayReturnTo("//evil.example.com/runway")).toBe("/runway");
  });

  it("returns /runway when the path is the auth sub-tree (no self-loop)", () => {
    expect(safeRunwayReturnTo("/runway/auth")).toBe("/runway");
    expect(safeRunwayReturnTo("/runway/auth?returnTo=/runway")).toBe("/runway");
  });

  it("preserves /runway and any future /runway/* sub-path that isn't /runway/auth", () => {
    expect(safeRunwayReturnTo("/runway")).toBe("/runway");
    expect(safeRunwayReturnTo("/runway/")).toBe("/runway/");
    expect(safeRunwayReturnTo("/runway/foo")).toBe("/runway/foo");
    expect(safeRunwayReturnTo("/runway/a/b/c")).toBe("/runway/a/b/c");
  });
});
