import { describe, it, expect } from "vitest";
import { verifySlackSignature } from "./verify";
import { makeSlackSignature as makeSignature, nowTimestamp } from "./test-helpers";

const SECRET = "test_signing_secret_12345";

describe("verifySlackSignature", () => {
  it("returns true for a valid signature", () => {
    const ts = nowTimestamp();
    const body = '{"event":"test"}';
    const sig = makeSignature(SECRET, ts, body);

    expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const ts = nowTimestamp();
    const body = '{"event":"test"}';
    const sig = "v0=0000000000000000000000000000000000000000000000000000000000000000";

    expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(false);
  });

  it("returns false when signature is null", () => {
    expect(verifySlackSignature(SECRET, null, nowTimestamp(), "body")).toBe(
      false
    );
  });

  it("returns false when timestamp is null", () => {
    const sig = makeSignature(SECRET, nowTimestamp(), "body");
    expect(verifySlackSignature(SECRET, sig, null, "body")).toBe(false);
  });

  it("returns false when timestamp is not a number", () => {
    expect(verifySlackSignature(SECRET, "v0=abc", "not-a-number", "body")).toBe(
      false
    );
  });

  it("returns false for a stale timestamp (>5 minutes old)", () => {
    const staleTs = (Math.floor(Date.now() / 1000) - 301).toString();
    const body = "body";
    const sig = makeSignature(SECRET, staleTs, body);

    expect(verifySlackSignature(SECRET, sig, staleTs, body)).toBe(false);
  });

  it("accepts a timestamp exactly at the 5-minute boundary", () => {
    const ts = (Math.floor(Date.now() / 1000) - 299).toString();
    const body = "body";
    const sig = makeSignature(SECRET, ts, body);

    expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(true);
  });

  it("returns false when body is tampered with", () => {
    const ts = nowTimestamp();
    const sig = makeSignature(SECRET, ts, "original body");

    expect(verifySlackSignature(SECRET, sig, ts, "tampered body")).toBe(false);
  });

  it("returns false when wrong secret is used", () => {
    const ts = nowTimestamp();
    const body = "body";
    const sig = makeSignature("wrong_secret", ts, body);

    expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(false);
  });

  it("handles empty body", () => {
    const ts = nowTimestamp();
    const sig = makeSignature(SECRET, ts, "");

    expect(verifySlackSignature(SECRET, sig, ts, "")).toBe(true);
  });

  it("rejects future timestamps beyond 5 minutes", () => {
    const futureTs = (Math.floor(Date.now() / 1000) + 301).toString();
    const body = "body";
    const sig = makeSignature(SECRET, futureTs, body);

    expect(verifySlackSignature(SECRET, sig, futureTs, body)).toBe(false);
  });
});
