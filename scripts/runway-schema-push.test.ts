import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations
import { shouldRunSchemaPush } from "./runway-schema-push.mjs";

const RUNWAY_URL = "libsql://runway-prod.turso.io";

describe("shouldRunSchemaPush env matrix", () => {
  it("runs on production deploys", () => {
    const d = shouldRunSchemaPush({ VERCEL_ENV: "production", RUNWAY_DATABASE_URL: RUNWAY_URL });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("production deploy");
  });

  it("skips on preview deploys (fork-preview case)", () => {
    const d = shouldRunSchemaPush({ VERCEL_ENV: "preview", RUNWAY_DATABASE_URL: RUNWAY_URL });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("preview");
  });

  it("skips on development deploys", () => {
    const d = shouldRunSchemaPush({ VERCEL_ENV: "development", RUNWAY_DATABASE_URL: RUNWAY_URL });
    expect(d.run).toBe(false);
  });

  it("skips locally when VERCEL_ENV is unset", () => {
    const d = shouldRunSchemaPush({ RUNWAY_DATABASE_URL: RUNWAY_URL });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("unset");
  });

  it("RUN_DB_MIGRATIONS forces the push regardless of environment", () => {
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      const d = shouldRunSchemaPush({
        VERCEL_ENV,
        RUNWAY_DATABASE_URL: RUNWAY_URL,
        RUN_DB_MIGRATIONS: "true",
      });
      expect(d.run).toBe(true);
    }
  });

  it("SKIP_DB_MIGRATIONS beats everything, including force + production", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "production",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
      RUN_DB_MIGRATIONS: "true",
      SKIP_DB_MIGRATIONS: "true",
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("SKIP_DB_MIGRATIONS");
  });

  it("skips when RUNWAY_DATABASE_URL is missing or blank, even in production", () => {
    expect(shouldRunSchemaPush({ VERCEL_ENV: "production" }).run).toBe(false);
    expect(
      shouldRunSchemaPush({ VERCEL_ENV: "production", RUNWAY_DATABASE_URL: "   " }).run
    ).toBe(false);
  });

  it("accepts the documented truthy spellings for the flag overrides", () => {
    for (const value of ["1", "true", "YES", "on"]) {
      expect(
        shouldRunSchemaPush({ RUNWAY_DATABASE_URL: RUNWAY_URL, RUN_DB_MIGRATIONS: value }).run
      ).toBe(true);
    }
    expect(
      shouldRunSchemaPush({ RUNWAY_DATABASE_URL: RUNWAY_URL, RUN_DB_MIGRATIONS: "false" }).run
    ).toBe(false);
  });
});
