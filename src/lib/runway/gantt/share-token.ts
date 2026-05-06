/**
 * Gantt share-token — sign and verify short-lived HMAC tokens.
 *
 * Token format: base64url(canonicalPayloadJSON) + "." + base64url(hmacSha256)
 *
 * The canonical payload is JSON.stringify over an alphabetically-sorted key
 * object (`canonicalStringify`). This ensures the HMAC is computed over a
 * deterministic byte sequence regardless of insertion order.
 *
 * Secret: process.env.RUNWAY_SHARE_SECRET (required at call time; throws if absent).
 * Generate: openssl rand -hex 32
 */

import crypto from "crypto";
import type { Theme } from "./types";

// ── SharePayload ─────────────────────────────────────────

export type SharePayload = {
  v: 1;
  kind: "client" | "project";
  clientSlug: string;
  projectSlug?: string;
  theme: Theme;
  generatedAt: string; // ISO 8601
  expiresAt: string;   // ISO 8601
  nonce: string;       // 8 random base64url chars; R2 key collision avoidance
};

// ── Canonical serialization ───────────────────────────────

/**
 * JSON.stringify with alphabetically sorted keys for deterministic HMAC input.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, typeof v === "object" && v !== null ? JSON.parse(canonicalStringify(v)) : v]),
  );
  return JSON.stringify(sorted);
}

// ── HMAC helpers ──────────────────────────────────────────

function getSecret(): Buffer {
  const secret = process.env.RUNWAY_SHARE_SECRET;
  if (!secret) {
    throw new Error(
      "RUNWAY_SHARE_SECRET not configured. Set it in .env.local. Generate with: openssl rand -hex 32",
    );
  }
  return Buffer.from(secret, "utf8");
}

function computeHmac(canonicalBytes: Buffer, secret: Buffer): Buffer {
  return crypto.createHmac("sha256", secret).update(canonicalBytes).digest();
}

// ── makePayload helper ────────────────────────────────────

/**
 * Build a SharePayload with generated timestamps and nonce.
 */
export function makePayload(opts: {
  kind: "client" | "project";
  clientSlug: string;
  projectSlug?: string;
  theme: Theme;
  ttlDays?: number;
}): SharePayload {
  const ttl = opts.ttlDays ?? 7;
  return {
    v: 1,
    kind: opts.kind,
    clientSlug: opts.clientSlug,
    ...(opts.projectSlug ? { projectSlug: opts.projectSlug } : {}),
    theme: opts.theme,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 86400_000).toISOString(),
    nonce: crypto.randomBytes(6).toString("base64url"),
  };
}

// ── signPayload ───────────────────────────────────────────

/**
 * Sign a SharePayload and return a URL-safe token string.
 * Throws if RUNWAY_SHARE_SECRET is not set.
 */
export function signPayload(payload: SharePayload): string {
  const secret = getSecret();
  const canonical = canonicalStringify(payload);
  const canonicalBytes = Buffer.from(canonical, "utf8");
  const sig = computeHmac(canonicalBytes, secret);

  const encodedPayload = canonicalBytes.toString("base64url");
  const encodedSig = sig.toString("base64url");
  return `${encodedPayload}.${encodedSig}`;
}

// ── verifyToken ───────────────────────────────────────────

export type VerifyOk = { ok: true; payload: SharePayload };
export type VerifyFail = {
  ok: false;
  reason: "malformed" | "bad-signature" | "expired" | "bad-version";
};
export type VerifyResult = VerifyOk | VerifyFail;

const VALID_THEMES: Set<string> = new Set<Theme>(["light-internal", "light-branded", "dark-account-view"]);
const VALID_KINDS: Set<string> = new Set(["client", "project"]);

function isValidPayloadShape(obj: unknown): obj is SharePayload {
  if (typeof obj !== "object" || obj === null) return false;
  const p = obj as Record<string, unknown>;
  if (typeof p.clientSlug !== "string") return false;
  if (typeof p.kind !== "string" || !VALID_KINDS.has(p.kind)) return false;
  if (typeof p.theme !== "string" || !VALID_THEMES.has(p.theme)) return false;
  if (typeof p.generatedAt !== "string" || isNaN(Date.parse(p.generatedAt))) return false;
  if (typeof p.expiresAt !== "string" || isNaN(Date.parse(p.expiresAt))) return false;
  if (typeof p.nonce !== "string") return false;
  return true;
}

/**
 * Verify a Gantt share token. Returns the payload on success or a typed error.
 *
 * Steps:
 * 1. Split on '.'. Exactly 2 parts required.
 * 2. base64url-decode both parts.
 * 3. Recompute HMAC. Use timingSafeEqual (padded to same length) to avoid timing leaks.
 * 4. JSON.parse and validate shape. v !== 1 → bad-version.
 * 5. Check expiry.
 */
export function verifyToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }

  const [encodedPayload, encodedSig] = parts;

  let payloadBytes: Buffer;
  let sigBytes: Buffer;
  try {
    payloadBytes = Buffer.from(encodedPayload, "base64url");
    sigBytes = Buffer.from(encodedSig, "base64url");
    // Validate that re-encoding matches (catches garbage base64 strings)
    if (payloadBytes.toString("base64url") !== encodedPayload) {
      return { ok: false, reason: "malformed" };
    }
    if (sigBytes.toString("base64url") !== encodedSig) {
      return { ok: false, reason: "malformed" };
    }
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Verify HMAC
  let secret: Buffer;
  try {
    secret = getSecret();
  } catch {
    // RUNWAY_SHARE_SECRET not configured — treat as bad-signature at verify time
    return { ok: false, reason: "malformed" };
  }

  const expectedSig = computeHmac(payloadBytes, secret);

  // Timing-safe comparison: pad both to the same length to avoid length leaks
  const maxLen = Math.max(sigBytes.length, expectedSig.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  sigBytes.copy(a);
  expectedSig.copy(b);

  let sigsMatch = false;
  try {
    sigsMatch = crypto.timingSafeEqual(a, b);
  } catch {
    return { ok: false, reason: "bad-signature" };
  }

  if (!sigsMatch) {
    return { ok: false, reason: "bad-signature" };
  }

  // Parse payload
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "malformed" };
  }

  const p = parsed as Record<string, unknown>;

  // Version check
  if (p.v !== 1) {
    return { ok: false, reason: "bad-version" };
  }

  // Shape validation
  if (!isValidPayloadShape(parsed)) {
    return { ok: false, reason: "malformed" };
  }

  // Expiry check
  if (Date.parse(parsed.expiresAt) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: parsed };
}
