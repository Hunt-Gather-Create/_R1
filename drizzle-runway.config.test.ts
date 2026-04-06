import { describe, it, expect, vi, beforeEach } from "vitest";

describe("drizzle-runway config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses sqlite dialect when RUNWAY_DATABASE_URL is not set", async () => {
    delete process.env.RUNWAY_DATABASE_URL;
    const mod = await import("./drizzle-runway.config");
    expect(mod.default.dialect).toBe("sqlite");
    expect(mod.default.dbCredentials).toEqual({ url: "file:runway-local.db" });
  });

  it("uses turso dialect when RUNWAY_DATABASE_URL is set", async () => {
    process.env.RUNWAY_DATABASE_URL = "libsql://test.turso.io";
    process.env.RUNWAY_AUTH_TOKEN = "test-token";
    const mod = await import("./drizzle-runway.config");
    expect(mod.default.dialect).toBe("turso");
    expect(mod.default.dbCredentials).toEqual({
      url: "libsql://test.turso.io",
      authToken: "test-token",
    });
  });

  it("points to the correct schema file", async () => {
    const mod = await import("./drizzle-runway.config");
    expect(mod.default.schema).toBe("./src/lib/db/runway-schema.ts");
  });

  it("outputs to drizzle-runway directory", async () => {
    const mod = await import("./drizzle-runway.config");
    expect(mod.default.out).toBe("./drizzle-runway");
  });
});
