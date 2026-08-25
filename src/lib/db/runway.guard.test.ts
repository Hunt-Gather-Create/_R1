import { describe, it, expect, beforeEach, afterEach } from "vitest";

const SAVE = { ...process.env };
function resetEnv() {
  for (const k of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_PULL_REQUEST_ID", "RUNWAY_DATABASE_URL"]) {
    delete process.env[k];
  }
}

describe("getRunwayDb prod-write guard wiring", () => {
  beforeEach(() => resetEnv());
  afterEach(() => { resetEnv(); Object.assign(process.env, SAVE); });

  it("throws on a non-prod deploy resolving a prod url", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "fix/x";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_x";
    process.env.RUNWAY_DATABASE_URL = "libsql://runway-prod.turso.io";
    const { getRunwayDb } = await import("./runway");
    expect(() => getRunwayDb()).toThrow(/non-prod deploy/i);
  });

  it("does NOT throw for a prod-serving runway-branch cloud deploy (outage guard)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "runway";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_abc";
    process.env.RUNWAY_DATABASE_URL = "libsql://runway-prod.turso.io";
    const { getRunwayDb } = await import("./runway");
    // Assert the guard specifically does not fire — createClient may throw on a
    // fake URL, so we only check that the error is NOT the guard's message.
    let threw: unknown = null;
    try {
      getRunwayDb();
    } catch (e) {
      threw = e;
    }
    if (threw !== null) {
      expect(threw).not.toMatchObject({ message: expect.stringMatching(/non-prod deploy/i) });
    }
  });
});
