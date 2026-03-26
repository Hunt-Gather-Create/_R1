import { describe, it, expect, beforeAll } from "vitest";
import { createAccessToken, validateMcpConfig, verifyAccessToken } from "./token";

beforeAll(() => {
  process.env.MCP_JWT_SECRET =
    "test-secret-that-is-at-least-32-characters-long";
});

describe("createAccessToken", () => {
  it("creates a valid JWT for a user with workspace", async () => {
    const token = await createAccessToken("user_1", "ws_abc");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("creates a valid JWT for a user with null workspace", async () => {
    const token = await createAccessToken("user_1", null);
    expect(token).toBeTruthy();
  });
});

describe("verifyAccessToken", () => {
  it("roundtrips userId and workspaceId", async () => {
    const token = await createAccessToken("user_42", "ws_xyz");
    const payload = await verifyAccessToken(token);

    expect(payload.userId).toBe("user_42");
    expect(payload.workspaceId).toBe("ws_xyz");
  });

  it("returns null workspaceId when created with null", async () => {
    const token = await createAccessToken("user_1", null);
    const payload = await verifyAccessToken(token);

    expect(payload.userId).toBe("user_1");
    expect(payload.workspaceId).toBeNull();
  });

  it("throws on an invalid token", async () => {
    await expect(verifyAccessToken("garbage.token.here")).rejects.toThrow();
  });

  it("throws on a tampered token", async () => {
    const token = await createAccessToken("user_1", "ws_abc");
    const tampered = token.slice(0, -5) + "XXXXX";
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe("getSigningKey", () => {
  it("accepts a valid MCP_JWT_SECRET", () => {
    expect(() => validateMcpConfig()).not.toThrow();
  });

  it("throws if MCP_JWT_SECRET is not set", async () => {
    const original = process.env.MCP_JWT_SECRET;
    delete process.env.MCP_JWT_SECRET;

    expect(() => validateMcpConfig()).toThrow(
      "MCP_JWT_SECRET must be set"
    );

    process.env.MCP_JWT_SECRET = original;
  });

  it("throws if MCP_JWT_SECRET is too short", async () => {
    const original = process.env.MCP_JWT_SECRET;
    process.env.MCP_JWT_SECRET = "short";

    expect(() => validateMcpConfig()).toThrow(
      "at least 32 characters"
    );

    process.env.MCP_JWT_SECRET = original;
  });
});
