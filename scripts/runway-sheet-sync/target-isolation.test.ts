/**
 * #103 gate: the target guard must validate the connection the WRITES use.
 *
 * The defect this pins: the CLI resolved one connection for `assertTarget`
 * (staging) while every operation in `operations-writes-*` called
 * `getRunwayDb()` and resolved its own from RUNWAY_DATABASE_URL (prod). So
 * `--apply --target staging` passed its guard and wrote rows to production,
 * and then the post-write verification read staging, saw no change, and
 * reported a clean diff. A silent success on top of a wrong write.
 *
 * These tests use two REAL migrated sqlite databases and assert on where rows
 * actually landed, not on whether the guard threw. A guard that throws is not
 * the property being protected; an empty prod database is.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import { clients } from "../../src/lib/db/runway-schema";
import {
  resetRunwayConnectionForTests,
  resolvedRunwayUrl,
  getRunwayDb,
  pinRunwayConnection,
} from "../../src/lib/db/runway";
import { createRunwayDb } from "../lib/run-script";
import { assertTarget } from "./target-guard";
import { applyPayloads } from "./apply";
import type { SyncPayload } from "./types";

const MIGRATIONS = "drizzle-runway";

let dir: string;
let prodUrl: string;
let stagingUrl: string;
const savedEnv: Record<string, string | undefined> = {};

async function migrated(url: string) {
  const db = drizzle(createClient({ url }));
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

async function countRows(url: string, table: string): Promise<number> {
  const c = createClient({ url });
  try {
    const r = await c.execute(`select count(*) as n from ${table}`);
    return Number(r.rows[0].n);
  } finally {
    c.close();
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rw-target-"));
  prodUrl = `file:${join(dir, "prod.db")}`;
  // The url must contain "staging" — assertTarget's own heuristic.
  stagingUrl = `file:${join(dir, "runway-staging.db")}`;

  for (const k of [
    "RUNWAY_DATABASE_URL",
    "RUNWAY_AUTH_TOKEN",
    "RUNWAY_STAGING_DATABASE_URL",
    "RUNWAY_STAGING_AUTH_TOKEN",
  ]) {
    savedEnv[k] = process.env[k];
  }

  await migrated(prodUrl);
  const staging = await migrated(stagingUrl);
  // The client exists in STAGING ONLY. An op that finds it therefore proves
  // it read the staging connection, not merely that it wrote nothing.
  await staging.insert(clients).values({
    id: "iso-client",
    name: "Isolation Probe",
    slug: "iso-probe",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  process.env.RUNWAY_DATABASE_URL = prodUrl;
  process.env.RUNWAY_STAGING_DATABASE_URL = stagingUrl;
  delete process.env.RUNWAY_AUTH_TOKEN;
  delete process.env.RUNWAY_STAGING_AUTH_TOKEN;
  resetRunwayConnectionForTests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetRunwayConnectionForTests();
  rmSync(dir, { recursive: true, force: true });
});

const addProjectPayload: SyncPayload = {
  op: "addProject",
  applyOrder: 1,
  requiresReview: false,
  params: {
    clientSlug: "iso-probe",
    name: "Isolation Probe Project",
    updatedBy: "target-isolation-test",
  },
} as unknown as SyncPayload;

describe("#103 target isolation: the guard must validate the write connection", () => {
  it("the guarded url and the write-path url are the same connection", () => {
    const { db, url } = createRunwayDb({ staging: true });
    expect(url).toBe(stagingUrl);
    expect(resolvedRunwayUrl()).toBe(url);
    expect(db).toBe(getRunwayDb());
  });

  it("--target staging lands ZERO rows in the prod database", async () => {
    const { db, url } = createRunwayDb({ staging: true });
    expect(() => assertTarget("staging", url, process.env)).not.toThrow();

    const result = await applyPayloads(db, [addProjectPayload], {
      runId: "iso-run",
      apply: true,
      force: true,
    });

    // The op succeeded, which means it RESOLVED STAGING: the client row it
    // needed exists only there.
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].response).toMatchObject({ ok: true });

    expect(await countRows(stagingUrl, "projects")).toBe(1);
    // The property under test. Not "the guard threw" — nothing arrived.
    expect(await countRows(prodUrl, "projects")).toBe(0);
  });

  it("the review queue writes to the same database as the operations", async () => {
    const { db, url } = createRunwayDb({ staging: true });
    assertTarget("staging", url, process.env);

    await applyPayloads(
      db,
      [{ ...addProjectPayload, op: "flag-for-review" } as unknown as SyncPayload],
      { runId: "iso-run-2", apply: true },
    );

    // apply.ts inserts the review row through the passed db while the ops
    // resolve their own. Before the fix those were two databases inside one
    // function call.
    expect(await countRows(stagingUrl, "apply_review_queue")).toBe(1);
    expect(await countRows(prodUrl, "apply_review_queue")).toBe(0);
  });

  it("a post-write read through the passed db sees the write", async () => {
    const { db, url } = createRunwayDb({ staging: true });
    assertTarget("staging", url, process.env);

    await applyPayloads(db, [addProjectPayload], {
      runId: "iso-run-3",
      apply: true,
      force: true,
    });

    // postVerifyDiff reads through this db. If it ever diverges from the write
    // connection again, this read comes back empty and the verifier reports a
    // clean diff over a wrong write — the failure mode that made #103
    // dangerous rather than merely wrong.
    const rows = await db.all<{ n: number }>(sql`select count(*) as n from projects`);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("pinning after a connection is already open throws instead of being ignored", () => {
    getRunwayDb(); // opens on the prod env url
    expect(() => pinRunwayConnection(stagingUrl)).toThrow(/already open/);
  });
});
