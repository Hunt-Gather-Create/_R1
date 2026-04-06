import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm/libsql", () => ({
  drizzle: vi.fn().mockReturnValue({ select: vi.fn(), insert: vi.fn() }),
}));
vi.mock("@libsql/client", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

describe("runway db client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when RUNWAY_DATABASE_URL is not set", async () => {
    delete process.env.RUNWAY_DATABASE_URL;
    const mod = await import("./runway");
    expect(() => mod.getRunwayDb()).toThrow("RUNWAY_DATABASE_URL is not set");
  });

  it("returns a db instance when RUNWAY_DATABASE_URL is set", async () => {
    process.env.RUNWAY_DATABASE_URL = "libsql://test.turso.io";
    process.env.RUNWAY_AUTH_TOKEN = "test-token";
    const mod = await import("./runway");
    const db = mod.getRunwayDb();
    expect(db).toBeDefined();
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    process.env.RUNWAY_DATABASE_URL = "libsql://test.turso.io";
    const mod = await import("./runway");
    const db1 = mod.getRunwayDb();
    const db2 = mod.getRunwayDb();
    expect(db1).toBe(db2);
  });

  it("exports a runwayDb proxy", async () => {
    process.env.RUNWAY_DATABASE_URL = "libsql://test.turso.io";
    const mod = await import("./runway");
    expect(mod.runwayDb).toBeDefined();
  });
});
