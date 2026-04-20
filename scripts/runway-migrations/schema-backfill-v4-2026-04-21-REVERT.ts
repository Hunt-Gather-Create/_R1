/**
 * Reverse Migration: v4 Schema Backfill — 2026-04-21 REVERT
 *
 * Reads the apply-mode snapshot written by `schema-backfill-v4-2026-04-21.ts`
 * and restores each affected row's column values to their pre-backfill state:
 *
 *   week_items: start_date ← previousStartDate
 *   projects:   start_date ← previousStartDate, end_date ← previousEndDate
 *
 * Expects `docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json` (apply-mode
 * snapshot, not the dry-run variant). Aborts loudly if the file is missing or
 * shape is wrong.
 *
 * Dry-run: logs planned reverts. Apply: writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json";

/** Resolve the snapshot path. Tests override via env var so they don't require the real prod artifact. */
function getSnapshotPath(): string {
  return process.env.SCHEMA_BACKFILL_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

export const description =
  "REVERT v4 schema backfill (2026-04-21): restore week_items.start_date and projects.start_date/end_date from apply-mode snapshot.";

interface WeekItemBackfillRecord {
  id: string;
  previousStartDate: string | null;
  newStartDate: string;
}

interface ProjectBackfillRecord {
  id: string;
  previousStartDate: string | null;
  previousEndDate: string | null;
  newStartDate: string | null;
  newEndDate: string | null;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  weekItems: WeekItemBackfillRecord[];
  projects: ProjectBackfillRecord[];
}

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== v4 Schema Backfill REVERT (2026-04-21) ===");

  const snapshot = loadSnapshot(ctx);

  ctx.log(`Snapshot captured ${snapshot.capturedAt} (${snapshot.mode}).`);
  ctx.log(`Planned reverts: ${snapshot.weekItems.length} week_items, ${snapshot.projects.length} projects.`);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed.");
    if (snapshot.weekItems.length > 0) {
      const sample = snapshot.weekItems.slice(0, 3);
      ctx.log("Sample week_item reverts:");
      for (const s of sample) {
        ctx.log(`  ${s.id} start_date: "${s.newStartDate}" → "${s.previousStartDate}"`);
      }
    }
    if (snapshot.projects.length > 0) {
      const sample = snapshot.projects.slice(0, 3);
      ctx.log("Sample project reverts:");
      for (const s of sample) {
        ctx.log(
          `  ${s.id} start: "${s.newStartDate}" → "${s.previousStartDate}" | end: "${s.newEndDate}" → "${s.previousEndDate}"`
        );
      }
    }
    return;
  }

  // Apply week_items reverts
  for (const op of snapshot.weekItems) {
    await ctx.db
      .update(weekItems)
      .set({ startDate: op.previousStartDate, updatedAt: new Date() })
      .where(eq(weekItems.id, op.id));
  }
  ctx.log(`Reverted ${snapshot.weekItems.length} week_items.start_date values.`);

  // Apply project reverts
  for (const op of snapshot.projects) {
    await ctx.db
      .update(projects)
      .set({
        startDate: op.previousStartDate,
        endDate: op.previousEndDate,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, op.id));
  }
  ctx.log(`Reverted ${snapshot.projects.length} projects.start_date/end_date values.`);

  ctx.log("=== v4 Schema Backfill REVERT complete ===");
}

function loadSnapshot(ctx: MigrationContext): Snapshot {
  const path = resolvePath(process.cwd(), getSnapshotPath());
  if (!existsSync(path)) {
    throw new Error(
      `Snapshot not found at ${path}. REVERT requires the apply-mode snapshot from schema-backfill-v4-2026-04-21.ts. Abort.`
    );
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Snapshot at ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const snapshot = parsed as Partial<Snapshot>;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !Array.isArray(snapshot.weekItems) ||
    !Array.isArray(snapshot.projects) ||
    typeof snapshot.capturedAt !== "string"
  ) {
    throw new Error(`Snapshot at ${path} has unexpected shape. Abort.`);
  }
  if (snapshot.mode !== "apply") {
    ctx.log(`WARNING: snapshot mode is "${snapshot.mode}", expected "apply". REVERT may be a no-op.`);
  }
  return snapshot as Snapshot;
}
