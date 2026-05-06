/**
 * Unit tests for share-token.ts — HMAC sign/verify, canonical serialization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Must be declared before importing the module under test so vi.stubEnv
// applies at module init time (tested separately via dynamic import).

describe("share-token", () => {
  const SECRET = "test-secret-32-bytes-0000000000000";

  beforeEach(() => {
    vi.stubEnv("RUNWAY_SHARE_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Helpers imported after env is stubbed.
  async function getModule() {
    const mod = await import("./share-token");
    return mod;
  }

  it("signPayload produces a token with exactly one '.' separator", async () => {
    const { signPayload, makePayload } = await getModule();
    const payload = makePayload({
      kind: "client",
      clientSlug: "test-client",
      theme: "light-branded",
    });
    const token = signPayload(payload);
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
  });

  it("verifyToken round-trips payload exactly", async () => {
    const { signPayload, verifyToken, makePayload } = await getModule();
    const payload = makePayload({
      kind: "client",
      clientSlug: "test-client",
      theme: "light-branded",
    });
    const token = signPayload(payload);
    const result = verifyToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.payload.kind).toBe("client");
    expect(result.payload.clientSlug).toBe("test-client");
    expect(result.payload.theme).toBe("light-branded");
    expect(result.payload.v).toBe(1);
  });

  it("verifyToken returns malformed for a plain string without dot", async () => {
    const { verifyToken } = await getModule();
    const result = verifyToken("not-a-token");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("malformed");
  });

  it("verifyToken returns malformed for 3-part token", async () => {
    const { verifyToken } = await getModule();
    const result = verifyToken("a.b.c");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("malformed");
  });

  it("verifyToken returns malformed for invalid base64url characters", async () => {
    const { verifyToken } = await getModule();
    // Two parts but the payload contains invalid base64 chars
    const result = verifyToken("!invalid!base64!.!sig!");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("malformed");
  });

  it("verifyToken returns bad-signature when payload is tampered", async () => {
    const { signPayload, verifyToken, makePayload } = await getModule();
    const payload = makePayload({
      kind: "client",
      clientSlug: "test-client",
      theme: "light-branded",
    });
    const token = signPayload(payload);
    const [encodedPayload, sig] = token.split(".");
    // Decode, mutate, re-encode
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const mutated = decoded.replace("test-client", "evil-client");
    const tamperedPayload = Buffer.from(mutated).toString("base64url");
    const result = verifyToken(`${tamperedPayload}.${sig}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("bad-signature");
  });

  it("verifyToken returns bad-signature when signature is tampered", async () => {
    const { signPayload, verifyToken, makePayload } = await getModule();
    const payload = makePayload({
      kind: "client",
      clientSlug: "test-client",
      theme: "light-branded",
    });
    const token = signPayload(payload);
    const [encodedPayload] = token.split(".");
    // Replace sig with garbage of the same approximate length
    const tamperedSig = Buffer.alloc(32).fill(0xff).toString("base64url");
    const result = verifyToken(`${encodedPayload}.${tamperedSig}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("bad-signature");
  });

  it("verifyToken returns expired for a token with past expiresAt", async () => {
    const { signPayload, verifyToken, makePayload } = await getModule();
    const payload = makePayload({
      kind: "client",
      clientSlug: "test-client",
      theme: "light-branded",
      ttlDays: -1, // already expired
    });
    const token = signPayload(payload);
    const result = verifyToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("expired");
  });

  it("verifyToken returns bad-version when v !== 1", async () => {
    const { signPayload, verifyToken } = await getModule();
    // Craft a payload with v: 2 directly, bypassing makePayload
    const badPayload = {
      v: 2,
      kind: "client" as const,
      clientSlug: "x",
      theme: "light-branded" as const,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      nonce: "abcdefgh",
    };
    // We need to sign it as a raw payload (cast to any to bypass type guard)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = signPayload(badPayload as any);
    const result = verifyToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("bad-version");
  });

  it("signPayload throws when RUNWAY_SHARE_SECRET is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("RUNWAY_SHARE_SECRET", "");
    // Dynamic import to get a fresh module without cached env
    const { makePayload } = await import("./share-token");
    const payload = makePayload({ kind: "client", clientSlug: "x", theme: "light-branded" });
    // Re-import fresh
    vi.resetModules();
    vi.stubEnv("RUNWAY_SHARE_SECRET", "");
    const freshMod = await import("./share-token");
    expect(() => freshMod.signPayload(payload)).toThrow("RUNWAY_SHARE_SECRET");
  });
});
