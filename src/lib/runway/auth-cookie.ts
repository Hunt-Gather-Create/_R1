import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const RUNWAY_AUTH_COOKIE_NAME = "runway_auth";
export const RUNWAY_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RUNWAY_AUTH_TTL_SECONDS = 30 * 24 * 60 * 60;

function readSecret(): Buffer {
  const value = process.env.RUNWAY_AUTH_SECRET;
  if (!value) {
    throw new Error(
      "RUNWAY_AUTH_SECRET not configured. Set in Vercel project env vars.",
    );
  }
  return Buffer.from(value, "utf8");
}

function readPassword(): string {
  const value = process.env.RUNWAY_PASSWORD;
  if (!value) {
    throw new Error(
      "RUNWAY_PASSWORD not configured. Set in Vercel project env vars.",
    );
  }
  return value;
}

function computeHmac(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function signRunwayAuthCookie(now: number = Date.now()): string {
  const expiresAt = now + RUNWAY_AUTH_TTL_MS;
  const payload = String(expiresAt);
  const mac = computeHmac(payload, readSecret());
  return `${payload}.${mac}`;
}

export function verifyRunwayAuthCookie(
  value: string,
  now: number = Date.now(),
): boolean {
  const idx = value.lastIndexOf(".");
  if (idx <= 0 || idx === value.length - 1) return false;

  const payload = value.slice(0, idx);
  const providedMac = value.slice(idx + 1);

  const expectedMac = computeHmac(payload, readSecret());
  const a = Buffer.from(providedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return now < expiresAt;
}

export function verifyRunwayPassword(input: string): boolean {
  const expected = readPassword();
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function safeRunwayReturnTo(
  raw: string | null | undefined,
): string {
  if (!raw) return "/runway";
  if (!raw.startsWith("/runway")) return "/runway";
  const pathOnly = raw.split(/[?#]/, 1)[0]!;
  if (pathOnly === "/runway/auth" || pathOnly.startsWith("/runway/auth/")) {
    return "/runway";
  }
  return raw;
}
