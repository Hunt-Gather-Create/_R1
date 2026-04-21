/**
 * Reverse Migration: Bonterra v4 Convention Touchup — 2026-04-21 REVERT
 *
 * Reads the apply-mode pre-snapshot written by `bonterra-v4-touchup-2026-04-21.ts`
 * and restores every captured field on:
 *
 *   - the Bonterra client row
 *   - the Impact Report L1 project row
 *   - every Bonterra L2 week item captured at pre-snapshot time
 *
 * Expects `docs/tmp/bonterra-v4-pre-snapshot-2026-04-21.json` (apply-mode
 * snapshot). Aborts if the file is missing, shape is wrong, or if a captured
 * row's id no longer exists in prod (surfacing post-apply drift rather than
 * silently creating new rows).
 *
 * Audit trail: does NOT insert revert audit records. The forward migration's
 * audit rows carry the `bonterra-v4-touchup-2026-04-21` batchId; operator
 * can correlate via that.
 *
 * Dry-run: logs planned reverts. Apply: writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";

// ── Constants ────────────────────────────────────────────

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/bonterra-v4-pre-snapshot-2026-04-21.json";

/** Tests override via env var so they don't require the real prod artifact. */
function getSnapshotPath(): string {
  return process.env.BONTERRA_V4_TOUCHUP_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

export const description =
  "REVERT Bonterra v4 touchup (2026-04-21): restore client + Impact Report L1 + all Bonterra L2 fields from apply-mode pre-snapshot.";

// ── Types (mirror forward script's PreSnapshot shape) ───

type ClientRow = typeof clients.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type WeekItemRow = typeof weekItems.$inferSelect;

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  batchId: string | null;
  client: ClientRow | undefined;
  project: ProjectRow | undefined;
  weekItems: WeekItemRow[];
}

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Bonterra v4 Touchup REVERT (2026-04-21) ===");

  const snapshot = loadSnapshot(ctx);

  ctx.log(
    `Snapshot captured ${snapshot.capturedAt} (${snapshot.mode}, batchId=${snapshot.batchId ?? "null"}).`
  );

  if (!snapshot.client) {
    throw new Error("REVERT aborted: snapshot has no client row.");
  }
  if (!snapshot.project) {
    throw new Error("REVERT aborted: snapshot has no Impact Report L1 row.");
  }

  // Guard against drift since apply: require every captured row id still exists.
  await assertCapturedRowsStillExist(ctx, snapshot);

  const clientFields = extractClientRevertFields(snapshot.client);
  const projectFields = extractProjectRevertFields(snapshot.project);
  const weekItemFields = snapshot.weekItems.map((w) => ({
    id: w.id,
    title: w.title,
    fields: extractWeekItemRevertFields(w),
  }));

  ctx.log(
    `Planned reverts: 1 client (${snapshot.client.name}), 1 L1 (${snapshot.project.name}), ${snapshot.weekItems.length} L2(s).`
  );

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed.");
    ctx.log(
      `Client '${snapshot.client.name}' restore: ${JSON.stringify(clientFields)}`
    );
    ctx.log(
      `L1 '${snapshot.project.name}' restore: ${JSON.stringify(projectFields)}`
    );
    for (const w of weekItemFields) {
      ctx.log(`L2 '${w.title}' restore: ${JSON.stringify(w.fields)}`);
    }
    return;
  }

  // Apply client revert
  await ctx.db
    .update(clients)
    .set({ ...clientFields, updatedAt: new Date() })
    .where(eq(clients.id, snapshot.client.id));
  ctx.log(`Reverted client '${snapshot.client.name}'.`);

  // Apply L1 revert
  await ctx.db
    .update(projects)
    .set({ ...projectFields, updatedAt: new Date() })
    .where(eq(projects.id, snapshot.project.id));
  ctx.log(`Reverted L1 '${snapshot.project.name}'.`);

  // Apply L2 reverts
  for (const w of weekItemFields) {
    await ctx.db
      .update(weekItems)
      .set({ ...w.fields, updatedAt: new Date() })
      .where(eq(weekItems.id, w.id));
  }
  ctx.log(`Reverted ${weekItemFields.length} L2(s).`);

  ctx.log("=== Bonterra v4 Touchup REVERT complete ===");
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Extract the subset of client fields the forward migration could have touched.
 * Forward migration writes no client fields — this exists only as belt-and-
 * suspenders in case a future amendment adds a client-field write.
 */
function extractClientRevertFields(
  client: ClientRow
): Pick<ClientRow, "team" | "nicknames" | "contractStatus"> {
  return {
    team: client.team,
    nicknames: client.nicknames,
    contractStatus: client.contractStatus,
  };
}

/**
 * Extract the L1 fields the forward migration touches + any v4 fields worth
 * restoring for safety (startDate/endDate are derived by other jobs but we
 * restore exactly what was captured).
 */
function extractProjectRevertFields(
  project: ProjectRow
): Pick<
  ProjectRow,
  | "resources"
  | "engagementType"
  | "status"
  | "category"
  | "owner"
  | "waitingOn"
  | "notes"
  | "target"
  | "dueDate"
  | "startDate"
  | "endDate"
  | "contractStart"
  | "contractEnd"
> {
  return {
    resources: project.resources,
    engagementType: project.engagementType,
    status: project.status,
    category: project.category,
    owner: project.owner,
    waitingOn: project.waitingOn,
    notes: project.notes,
    target: project.target,
    dueDate: project.dueDate,
    startDate: project.startDate,
    endDate: project.endDate,
    contractStart: project.contractStart,
    contractEnd: project.contractEnd,
  };
}

/** Extract every v1+v4 week-item field worth restoring. */
function extractWeekItemRevertFields(
  w: WeekItemRow
): Pick<
  WeekItemRow,
  | "projectId"
  | "dayOfWeek"
  | "weekOf"
  | "date"
  | "startDate"
  | "endDate"
  | "blockedBy"
  | "title"
  | "status"
  | "category"
  | "owner"
  | "resources"
  | "notes"
> {
  return {
    projectId: w.projectId,
    dayOfWeek: w.dayOfWeek,
    weekOf: w.weekOf,
    date: w.date,
    startDate: w.startDate,
    endDate: w.endDate,
    blockedBy: w.blockedBy,
    title: w.title,
    status: w.status,
    category: w.category,
    owner: w.owner,
    resources: w.resources,
    notes: w.notes,
  };
}

async function assertCapturedRowsStillExist(
  ctx: MigrationContext,
  snapshot: Snapshot
): Promise<void> {
  if (!snapshot.client || !snapshot.project) {
    throw new Error("assertCapturedRowsStillExist: snapshot missing client/project.");
  }

  const liveClient = await ctx.db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, snapshot.client.id));
  if (liveClient.length === 0) {
    throw new Error(
      `REVERT aborted: client id ${snapshot.client.id} no longer exists in prod.`
    );
  }

  const liveProject = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, snapshot.project.id));
  if (liveProject.length === 0) {
    throw new Error(
      `REVERT aborted: Impact Report L1 id ${snapshot.project.id} no longer exists in prod.`
    );
  }

  for (const w of snapshot.weekItems) {
    const live = await ctx.db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.id, w.id));
    if (live.length === 0) {
      throw new Error(
        `REVERT aborted: captured L2 '${w.title}' (id=${w.id}) no longer exists in prod. REVERT would silently skip it — abort to surface drift.`
      );
    }
  }
}

function loadSnapshot(ctx: MigrationContext): Snapshot {
  const path = resolvePath(process.cwd(), getSnapshotPath());
  if (!existsSync(path)) {
    throw new Error(
      `Snapshot not found at ${path}. REVERT requires the apply-mode pre-snapshot from bonterra-v4-touchup-2026-04-21.ts. Abort.`
    );
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Snapshot at ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`
    );
  }
  const snapshot = parsed as Partial<Snapshot>;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.capturedAt !== "string" ||
    !snapshot.client ||
    !snapshot.project ||
    !Array.isArray(snapshot.weekItems)
  ) {
    throw new Error(`Snapshot at ${path} has unexpected shape. Abort.`);
  }
  if (snapshot.mode !== "apply") {
    ctx.log(
      `WARNING: snapshot mode is "${snapshot.mode}", expected "apply". REVERT may revert against the wrong baseline.`
    );
  }
  return snapshot as Snapshot;
}
