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

  it("missing URL beats RUN_DB_MIGRATIONS force", () => {
    const d = shouldRunSchemaPush({ VERCEL_ENV: "production", RUN_DB_MIGRATIONS: "true" });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("RUNWAY_DATABASE_URL");
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

// RW-INC-2026-07-27-01 path (I): Hunt-Gather-Create's Vercel classifies the
// `runway` branch as preview, so the production-only gate skipped the push and
// PR #118 shipped code querying tables prod never got. The runway-branch
// trigger closes that gap. All rows explicit — no matrix loops.
describe("shouldRunSchemaPush runway-branch trigger", () => {
  it("pushes on runway-branch preview deploys (the incident shape)", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("runway-branch deploy (schema-push contract)");
  });

  it("pushes on runway-branch deploys even when VERCEL_ENV is unset", () => {
    const d = shouldRunSchemaPush({
      VERCEL_GIT_COMMIT_REF: "runway",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("runway-branch deploy (schema-push contract)");
  });

  it("skips main-branch preview deploys", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "main",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("preview");
  });

  it("skips feature-branch preview deploys", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feat/xyz",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  // VERCEL_GIT_COMMIT_REF is the HEAD branch name, so a fork PR's ref is the
  // fork's own branch name — usually a feature branch, but nothing stops a
  // fork branch from being named `runway` (e.g. an accidental sync-PR from
  // jasonburks23:runway). PR-linked deploys always carry
  // VERCEL_GIT_PULL_REQUEST_ID; the prod-serving push-triggered branch deploy
  // never does. That id is the fork-PR guard (the PR #116 protection).
  it("skips fork-PR preview deploys (fork feature branch)", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature-x",
      VERCEL_GIT_PULL_REQUEST_ID: "120",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  it("skips a fork PR whose branch is literally named 'runway'", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
      VERCEL_GIT_PULL_REQUEST_ID: "121",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("PR #121");
  });

  it("still pushes when the PR id is an empty string (Vercel's no-PR value)", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
      VERCEL_GIT_PULL_REQUEST_ID: "",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("runway-branch deploy (schema-push contract)");
  });

  it("treats a whitespace-only PR id as no PR", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
      VERCEL_GIT_PULL_REQUEST_ID: "   ",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(true);
  });

  it("skips preview deploys with no commit ref at all", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("ref=unset");
  });

  it("does not match branch names that merely contain 'runway'", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feat/runway-schema-push-runway-branch-trigger",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  // Pin the exact-match semantics: the ref comes from Vercel verbatim and the
  // gate must never "helpfully" trim or case-fold it.
  it("skips an empty-string ref", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  it("skips a ref with trailing whitespace ('runway ')", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway ",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  it("skips a case-variant ref ('Runway')", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "Runway",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(false);
  });

  // Edge: `vercel dev` on the runway branch. Shouldn't happen, but the trigger
  // is deliberately env-agnostic (per the ENV-unset case above), so it pushes
  // with an unambiguous reason — the push itself is idempotent.
  it("VERCEL_ENV=development on the runway branch pushes with a clear reason", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "development",
      VERCEL_GIT_COMMIT_REF: "runway",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
    });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("runway-branch deploy (schema-push contract)");
  });

  it("SKIP_DB_MIGRATIONS beats the runway-branch trigger", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
      RUNWAY_DATABASE_URL: RUNWAY_URL,
      SKIP_DB_MIGRATIONS: "true",
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("SKIP_DB_MIGRATIONS");
  });

  it("missing RUNWAY_DATABASE_URL beats the runway-branch trigger", () => {
    const d = shouldRunSchemaPush({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "runway",
    });
    expect(d.run).toBe(false);
    expect(d.reason).toContain("RUNWAY_DATABASE_URL");
  });
});
