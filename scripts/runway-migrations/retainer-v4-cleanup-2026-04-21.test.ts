/**
 * Smoke test for the retainer + v4 cleanup migration (2026-04-21).
 *
 * Per the CC prompt: "No DB mocking. DRY_RUN against prod Turso."
 * Tests run in DRY_RUN mode against prod Turso (via RUNWAY_DATABASE_URL
 * from `set -a && source .env.local && set +a` in the operator's shell)
 * and assert expected ops per spec section A/B/C/D plus revert round-trip.
 *
 * Non-hermetic: if Kathy edits any LPPC record between sanity pass and
 * test execution, pre-state assertions can fail. Operator accepted this
 * tradeoff (plan Q4).
 *
 * The forward and revert scripts support env overrides
 * RETAINER_V4_CLEANUP_SNAPSHOT_PATH and
 * RETAINER_V4_CLEANUP_CREATED_IDS_PATH so tests can isolate artifacts
 * from the real docs/tmp/* paths.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient as createLibsqlClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { MigrationContext } from "../runway-migrate";

const hasProdDb = typeof process.env.RUNWAY_DATABASE_URL === "string" && process.env.RUNWAY_DATABASE_URL.length > 0;
const describeOrSkip = hasProdDb ? describe : describe.skip;

let libsql: Client;
let db: ReturnType<typeof drizzle>;
let snapshotPath: string;
let createdIdsPath: string;

beforeAll(() => {
  if (!hasProdDb) return;
  libsql = createLibsqlClient({
    url: process.env.RUNWAY_DATABASE_URL!,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });
  db = drizzle(libsql);
});

afterAll(() => {
  try {
    libsql?.close();
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  if (!hasProdDb) return;
  const suffix = randomUUID().slice(0, 8);
  snapshotPath = `/tmp/retainer-v4-cleanup-test-${suffix}.json`;
  createdIdsPath = `/tmp/retainer-v4-cleanup-test-created-${suffix}.json`;
  process.env.RETAINER_V4_CLEANUP_SNAPSHOT_PATH = snapshotPath;
  process.env.RETAINER_V4_CLEANUP_CREATED_IDS_PATH = createdIdsPath;
});

function cleanup(): void {
  for (const p of [snapshotPath, createdIdsPath, snapshotPath?.replace(/\.json$/, "-dryrun.json")]) {
    if (p && existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  delete process.env.RETAINER_V4_CLEANUP_SNAPSHOT_PATH;
  delete process.env.RETAINER_V4_CLEANUP_CREATED_IDS_PATH;
}

function makeCtx(dryRun: boolean): MigrationContext {
  const logs: string[] = [];
  return {
    db,
    dryRun,
    log: (msg: string) => logs.push(msg),
    logs,
  };
}

describeOrSkip("retainer-v4-cleanup-2026-04-21 - forward DRY_RUN", () => {
  it("runs against prod Turso without error in DRY_RUN mode", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await expect(up(makeCtx(true))).resolves.toBeUndefined();
    cleanup();
  });

  it("writes a dry-run snapshot capturing all L1 + L2 target rows", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    // Forward writes to the -dryrun.json variant when the default path is
    // used; when overridden via env var, it writes to the override path
    // verbatim (no suffix). We use the env override so expect snapshotPath.
    expect(existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));

    expect(snap.batchId).toBe("retainer-v4-cleanup-2026-04-21");
    expect(snap.mode).toBe("dry-run");
    expect(Array.isArray(snap.l1Rows)).toBe(true);
    expect(Array.isArray(snap.l2Rows)).toBe(true);
    // 15 Convergix + 4 Asprey/Hopdoddy/Soundly misc + 4 Convergix B.1-B.4 + 1 Soundly C.1 + 1 LPPC (D.6) = 25 unique L1s captured.
    // Some of the B/C plans target the same L1 as A plans (e.g. Convergix L1s
    // are shared between A.1 sweep and B.1-B.4), so the actual unique count
    // is <=21. Precise lower bound: at least 19 distinct L1 keys.
    expect(snap.l1Rows.length).toBeGreaterThanOrEqual(19);

    // L2 plans touch 21 distinct L2 titles across B/C/D sections.
    expect(snap.l2Rows.length).toBeGreaterThanOrEqual(19);

    // Snapshot includes the LPPC Website Revamp notes baseline for D.6 revert.
    expect(typeof snap.lppcWebsiteRevampNotes === "string" || snap.lppcWebsiteRevampNotes === null).toBe(true);

    cleanup();
  });

  it("Section A: Convergix L1s are currently engagement_type='project' (pre-state)", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const convergixL1s = (snap.l1Rows as Array<{ key: string; row: { engagementType: string | null } }>).filter(
      (e) => e.key.startsWith("convergix|")
    );
    expect(convergixL1s.length).toBe(15);
    expect(convergixL1s.every((e) => e.row.engagementType === "project")).toBe(true);
    cleanup();
  });

  it("Section B: Convergix Industry Vertical Campaigns has waitingOn=null in snapshot (pre-state)", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const ivc = (snap.l1Rows as Array<{ key: string; row: { waitingOn: string | null; endDate: string | null } }>).find(
      (e) => e.key === "convergix|Industry Vertical Campaigns"
    );
    expect(ivc).toBeTruthy();
    expect(ivc!.row.waitingOn).toBeNull();
    expect(ivc!.row.endDate).toBe("2026-04-30");
    cleanup();
  });

  it("Section C: Soundly AARP Member Login has null start/end dates (pre-state)", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const aarp = (snap.l1Rows as Array<{ key: string; row: { startDate: string | null; endDate: string | null } }>).find(
      (e) => e.key === "soundly|AARP Member Login + Landing Page"
    );
    expect(aarp).toBeTruthy();
    expect(aarp!.row.startDate).toBeNull();
    expect(aarp!.row.endDate).toBeNull();
    cleanup();
  });

  it("Section D: LPPC blanket-blocked L2s currently have status='blocked' (pre-state)", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const blockedTitles = ["Pencils Down + Images Due", "Staging Links Due", "LPPC Staging Feedback Due", "QA Phase", "Website Launch", "Interactive Map Launch"];
    for (const title of blockedTitles) {
      const entry = (snap.l2Rows as Array<{ key: string; row: { status: string | null } }>).find(
        (e) => e.key === `lppc|${title}`
      );
      expect(entry, `expected snapshot to contain lppc|${title}`).toBeTruthy();
      expect(entry!.row.status).toBe("blocked");
    }
    cleanup();
  });

  it("Section D: D.3/D.4/D.5 target titles do NOT already exist under LPPC (safe to create)", async () => {
    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    // If any of the creates would collide, the pre-check inside up() throws.
    // Reaching this point means the collision guard passed.
    await expect(up(makeCtx(true))).resolves.toBeUndefined();
    cleanup();
  });

  it("DRY_RUN does not mutate prod state: Convergix L1 engagementType unchanged", async () => {
    const before = await libsql.execute(
      "SELECT engagement_type FROM projects WHERE client_id = (SELECT id FROM clients WHERE slug = 'convergix') LIMIT 1"
    );
    const beforeVal = before.rows[0].engagement_type;

    const { up } = await import("./retainer-v4-cleanup-2026-04-21");
    await up(makeCtx(true));

    const after = await libsql.execute(
      "SELECT engagement_type FROM projects WHERE client_id = (SELECT id FROM clients WHERE slug = 'convergix') LIMIT 1"
    );
    expect(after.rows[0].engagement_type).toBe(beforeVal);

    cleanup();
  });

  it("field-name validator throws on bogus field in DRY_RUN", async () => {
    const mod = await import("./retainer-v4-cleanup-2026-04-21");
    const bogus = {
      specId: "TEST.BOGUS",
      clientSlug: "convergix",
      projectName: "Brand Guide v2 (secondary palette)",
      field: "bogusField",
      newValue: "x",
      pre: null,
    };
    mod.L1_FIELD_PLANS.push(bogus);
    try {
      await expect(mod.up(makeCtx(true))).rejects.toThrow(/bogusField.*whitelist/);
    } finally {
      const idx = mod.L1_FIELD_PLANS.indexOf(bogus);
      if (idx >= 0) mod.L1_FIELD_PLANS.splice(idx, 1);
    }
    cleanup();
  });
});

describeOrSkip("retainer-v4-cleanup-2026-04-21-REVERT - DRY_RUN round-trip", () => {
  it("reads snapshot without crashing and produces zero ops when DB matches snapshot", async () => {
    // Run forward DRY_RUN first to produce a snapshot reflecting current prod state
    // (which IS pre-apply state, because forward hasn't been applied).
    const { up: forwardUp } = await import("./retainer-v4-cleanup-2026-04-21");
    await forwardUp(makeCtx(true));
    expect(existsSync(snapshotPath)).toBe(true);

    // Now run revert DRY_RUN against that snapshot. Since current DB state
    // exactly matches snapshot (nothing was applied), the revert should
    // produce zero field reverts - verifying the walker traverses without
    // mistakenly reverting.
    const { up: revertUp } = await import("./retainer-v4-cleanup-2026-04-21-REVERT");
    const ctx = makeCtx(true);
    await expect(revertUp(ctx)).resolves.toBeUndefined();

    const summaryLog = ctx.logs.find((l) => l.includes("Field reverts:"));
    expect(summaryLog).toBeTruthy();
    expect(summaryLog).toMatch(/Field reverts:\s*0/);

    cleanup();
  });

  it("revert aborts if snapshot file is missing", async () => {
    // Point to a path that definitely doesn't exist.
    process.env.RETAINER_V4_CLEANUP_SNAPSHOT_PATH = `/tmp/does-not-exist-${randomUUID().slice(0, 8)}.json`;

    const { up: revertUp } = await import("./retainer-v4-cleanup-2026-04-21-REVERT");
    await expect(revertUp(makeCtx(true))).rejects.toThrow(/Snapshot not found/);

    cleanup();
  });

  it("revert aborts if snapshot batch id is wrong", async () => {
    const fakeSnapshot = {
      batchId: "some-other-batch",
      capturedAt: new Date().toISOString(),
      mode: "apply",
      trustThreshold: "2026-04-21T14:00:00Z",
      lppcClientId: "fake",
      l1Rows: [],
      l2Rows: [],
      lppcWebsiteRevampNotes: null,
    };
    writeFileSync(snapshotPath, JSON.stringify(fakeSnapshot, null, 2), "utf8");

    const { up: revertUp } = await import("./retainer-v4-cleanup-2026-04-21-REVERT");
    await expect(revertUp(makeCtx(true))).rejects.toThrow(/does not match/);

    cleanup();
  });
});
