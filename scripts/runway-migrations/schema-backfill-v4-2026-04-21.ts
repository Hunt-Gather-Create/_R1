/**
 * Migration: v4 Schema Backfill — 2026-04-21
 *
 * Populates the new v4 columns added by PR #86 Chunk 4:
 *
 *   Step 1: week_items.start_date  ← week_items.date  (where start_date IS NULL AND date IS NOT NULL)
 *   Step 2: projects.start_date / end_date  ← derived from children (v4 rule)
 *
 * Untouched (null-only on write): engagement_type, contract_start, contract_end,
 * blocked_by. Those are populated per-client during Wave 1 data work.
 *
 * Writes a pre-state snapshot before applying so the REVERT script can restore
 * exactly. Dry-run prints the op count and a small sample without writing.
 *
 * Reverse script: `schema-backfill-v4-2026-04-21-REVERT.ts` — reads the snapshot
 * this script writes and restores prior column values.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq, isNull, and, isNotNull } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";

// ── Constants ────────────────────────────────────────────

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json";

/** Resolve the snapshot path. Tests override via env var to avoid clobbering the real prod artifact. */
function getSnapshotPath(): string {
  return process.env.SCHEMA_BACKFILL_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

export const description =
  "v4 schema backfill (2026-04-21): copy week_items.date → start_date; derive projects.start_date/end_date from children.";

// ── Types ────────────────────────────────────────────────

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

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== v4 Schema Backfill (2026-04-21) ===");

  // Step 1 — Plan week_items backfill: rows where start_date is null but `date` has a value.
  const candidateWeekItems = await ctx.db
    .select({ id: weekItems.id, date: weekItems.date, startDate: weekItems.startDate })
    .from(weekItems)
    .where(and(isNull(weekItems.startDate), isNotNull(weekItems.date)));

  const weekItemOps: WeekItemBackfillRecord[] = candidateWeekItems
    .filter((r) => r.date !== null)
    .map((r) => ({
      id: r.id,
      previousStartDate: r.startDate,
      newStartDate: r.date as string,
    }));

  ctx.log(`week_items to backfill start_date: ${weekItemOps.length}`);

  // Step 2 — Plan projects derivation. We pull every project plus its children
  // once to compute MIN(start) / MAX(end) without per-project queries.
  const allProjects = await ctx.db
    .select({
      id: projects.id,
      startDate: projects.startDate,
      endDate: projects.endDate,
    })
    .from(projects);

  // Pull all week items once, bucket by projectId. We reflect the week_items
  // backfill in-memory so derivation uses the post-Step-1 state.
  const allItems = await ctx.db
    .select({
      id: weekItems.id,
      projectId: weekItems.projectId,
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      date: weekItems.date,
    })
    .from(weekItems);

  const step1Patch = new Map<string, string>();
  for (const op of weekItemOps) step1Patch.set(op.id, op.newStartDate);

  const childrenByProject = new Map<
    string,
    Array<{ startDate: string | null; endDate: string | null }>
  >();
  for (const item of allItems) {
    if (!item.projectId) continue;
    const effectiveStart = step1Patch.get(item.id) ?? item.startDate ?? item.date ?? null;
    const bucket = childrenByProject.get(item.projectId) ?? [];
    bucket.push({ startDate: effectiveStart, endDate: item.endDate });
    childrenByProject.set(item.projectId, bucket);
  }

  const projectOps: ProjectBackfillRecord[] = [];
  for (const p of allProjects) {
    const children = childrenByProject.get(p.id) ?? [];
    let minStart: string | null = null;
    let maxEnd: string | null = null;
    for (const child of children) {
      const start = child.startDate;
      if (start && (minStart === null || start < minStart)) minStart = start;
      const end = child.endDate ?? start;
      if (end && (maxEnd === null || end > maxEnd)) maxEnd = end;
    }

    if (minStart !== p.startDate || maxEnd !== p.endDate) {
      projectOps.push({
        id: p.id,
        previousStartDate: p.startDate,
        previousEndDate: p.endDate,
        newStartDate: minStart,
        newEndDate: maxEnd,
      });
    }
  }

  ctx.log(`projects to recompute start_date/end_date: ${projectOps.length}`);

  // Step 3 — Write snapshot (in both modes — dry-run writes to a side file).
  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    weekItems: weekItemOps,
    projects: projectOps,
  };
  writeSnapshot(ctx, snapshot);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes applied. Summary:");
    ctx.log(`  - week_items.start_date backfills:      ${weekItemOps.length}`);
    ctx.log(`  - projects.start_date/end_date updates: ${projectOps.length}`);
    if (weekItemOps.length > 0) {
      const sample = weekItemOps.slice(0, 3);
      ctx.log(`  Sample week_item backfills:`);
      for (const s of sample) {
        ctx.log(`    ${s.id} start_date: null → "${s.newStartDate}"`);
      }
    }
    if (projectOps.length > 0) {
      const sample = projectOps.slice(0, 3);
      ctx.log(`  Sample project recomputes:`);
      for (const s of sample) {
        ctx.log(
          `    ${s.id} start: "${s.previousStartDate}" → "${s.newStartDate}" | end: "${s.previousEndDate}" → "${s.newEndDate}"`
        );
      }
    }
    return;
  }

  // Step 4 — Apply week_items backfill.
  for (const op of weekItemOps) {
    await ctx.db
      .update(weekItems)
      .set({ startDate: op.newStartDate, updatedAt: new Date() })
      .where(eq(weekItems.id, op.id));
  }
  ctx.log(`Applied ${weekItemOps.length} week_items.start_date backfills.`);

  // Step 5 — Apply project recomputations.
  for (const op of projectOps) {
    await ctx.db
      .update(projects)
      .set({
        startDate: op.newStartDate,
        endDate: op.newEndDate,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, op.id));
  }
  ctx.log(`Applied ${projectOps.length} projects.start_date/end_date updates.`);

  ctx.log("=== v4 Schema Backfill complete ===");
}

// ── Helpers ──────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, snapshot: Snapshot): void {
  const suffix = ctx.dryRun ? "-dryrun" : "";
  const base = getSnapshotPath();
  const outPath = resolvePath(
    process.cwd(),
    base.replace(".json", `${suffix}.json`)
  );
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote snapshot → ${outPath}`);
}
