/**
 * Migration: Asprey v4 Touchup — 2026-04-21
 *
 * PR #86 Wave 2 (background). Asprey was partially migrated earlier; this
 * script applies the remaining v4 convention fixes:
 *
 *   1. L1 `engagement_type` = null → 'retainer'   (raw UPDATE + audit)
 *   2. L1 `contract_end`    = null → '2026-04-30' (raw UPDATE + audit)
 *   3. Client `team`        = "Allison (lead)" → "AM: Allison, CM: Sami, PM: Jason"
 *      (v4 role-prefix format, engaged-roles-per-L1 semantics consistent with
 *      Convergix/LPPC/TAP/HDL roster handling; `team` IS in CLIENT_FIELDS so
 *      `updateClientField()` handles this on the whitelist path.)
 *
 * After writes, an explicit `recomputeProjectDates()` call re-derives L1
 * start/end from children for safety (TP decision #4). The derivation is
 * already correct in prod pre-scan (start=2026-04-20, end=2026-04-30) so this
 * call is a no-op in practice but keeps the guarantee visible in the log.
 *
 * Locked TP decisions (applied verbatim):
 *   1. engagement_type='retainer', contract_end='2026-04-30' per spec.
 *   2. Team roster interpretation: engaged-roles-per-L1. L1.resources is
 *      "AM: Allison, CM: Sami, PM: Jason" (already v4). Aligning client.team
 *      to match.
 *   3. Raw `ctx.db.update()` + `insertAuditRecord()` for engagement_type /
 *      contract_end (PROJECT_FIELDS whitelist gap).
 *   4. No L2 writes in this migration. L1 start/end already correct; explicit
 *      recomputeProjectDates call at end for safety.
 *
 * Pre-checks abort loudly if prod drift from the 2026-04-20 snapshot:
 *   - client slug `dave-asprey` exists, team = "Allison (lead)"
 *   - exactly 1 L1 ("Social Retainer — Wind Down"), engagement_type=null, contract_end=null
 *   - exactly 3 L2s (by id prefix), all linked to the L1
 *
 * Reverse script: `asprey-v4-touchup-2026-04-21-REVERT.ts`
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
  updateClientField,
} from "@/lib/runway/operations";
import { recomputeProjectDates } from "@/lib/runway/operations-writes-week";

// ── Constants ────────────────────────────────────────────

const ASPREY_SLUG = "dave-asprey";
const UPDATED_BY = "migration";

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/asprey-v4-pre-apply-snapshot-2026-04-21.json";

/** Resolve snapshot path. Tests override via env var to avoid clobbering prod artifact. */
function getSnapshotPath(): string {
  return process.env.ASPREY_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

// Expected pre-state (prod pre-scan 2026-04-20)
const CLIENT_OLD_TEAM = "Allison (lead)";
const CLIENT_NEW_TEAM = "AM: Allison, CM: Sami, PM: Jason";

const L1_ID_PREFIX = "00a4e855";
const L1_EXPECTED_NAME = "Social Retainer — Wind Down";
const L1_NEW_ENGAGEMENT_TYPE = "retainer";
const L1_NEW_CONTRACT_END = "2026-04-30";

// L2 id prefixes (used only to verify snapshot integrity; no L2 writes)
const L2_EXPECTED_ID_PREFIXES = [
  "46ef1edc", // Disconnect Google Sheet from ManyChat
  "f88098fe", // Daily Social Posts + ManyChat — Retainer (through 4/30)
  "0c665655", // Retainer Close — Final Post
] as const;

// ── Types ────────────────────────────────────────────────

interface ResolvedState {
  client: typeof clients.$inferSelect;
  l1: typeof projects.$inferSelect;
  l2s: Array<typeof weekItems.$inferSelect>;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: typeof clients.$inferSelect;
  L1s: Array<typeof projects.$inferSelect>;
  L2s: Array<typeof weekItems.$inferSelect>;
}

// ── Exports ──────────────────────────────────────────────

export const description =
  "Asprey v4 touchup 2026-04-21: set L1 engagement_type='retainer' and contract_end='2026-04-30'; realign client team to v4 role-prefix format; re-derive L1 start/end from children.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Asprey v4 Touchup (2026-04-21) ===");

  // Step 1 — Pre-checks + resolve
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot (apply-mode is what REVERT consumes)
  writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — L1 engagement_type (raw UPDATE + audit; not in PROJECT_FIELDS)
  ctx.log(
    `L1 ${L1_ID_PREFIX} (${L1_EXPECTED_NAME}) engagement_type: "${resolved.l1.engagementType ?? "null"}" → "${L1_NEW_ENGAGEMENT_TYPE}" (raw UPDATE)`
  );
  if (!ctx.dryRun) {
    await ctx.db
      .update(projects)
      .set({ engagementType: L1_NEW_ENGAGEMENT_TYPE, updatedAt: new Date() })
      .where(eq(projects.id, resolved.l1.id));

    const idemKey = generateIdempotencyKey(
      "field-change",
      resolved.l1.id,
      "engagementType",
      L1_NEW_ENGAGEMENT_TYPE,
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: resolved.l1.id,
      clientId: resolved.client.id,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue: resolved.l1.engagementType ?? "(null)",
      newValue: L1_NEW_ENGAGEMENT_TYPE,
      summary: `Project '${resolved.l1.name}': engagement_type changed from "${
        resolved.l1.engagementType ?? "null"
      }" to "${L1_NEW_ENGAGEMENT_TYPE}"`,
      metadata: JSON.stringify({ field: "engagementType" }),
    });
  }

  // Step 4 — L1 contract_end (raw UPDATE + audit; not in PROJECT_FIELDS)
  ctx.log(
    `L1 ${L1_ID_PREFIX} contract_end: "${resolved.l1.contractEnd ?? "null"}" → "${L1_NEW_CONTRACT_END}" (raw UPDATE)`
  );
  if (!ctx.dryRun) {
    await ctx.db
      .update(projects)
      .set({ contractEnd: L1_NEW_CONTRACT_END, updatedAt: new Date() })
      .where(eq(projects.id, resolved.l1.id));

    const idemKey = generateIdempotencyKey(
      "field-change",
      resolved.l1.id,
      "contractEnd",
      L1_NEW_CONTRACT_END,
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: resolved.l1.id,
      clientId: resolved.client.id,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue: resolved.l1.contractEnd ?? "(null)",
      newValue: L1_NEW_CONTRACT_END,
      summary: `Project '${resolved.l1.name}': contract_end changed from "${
        resolved.l1.contractEnd ?? "null"
      }" to "${L1_NEW_CONTRACT_END}"`,
      metadata: JSON.stringify({ field: "contractEnd" }),
    });
  }

  // Step 5 — Client team realign (CLIENT_FIELDS whitelist path)
  ctx.log(`Client '${ASPREY_SLUG}' team: "${resolved.client.team}" → "${CLIENT_NEW_TEAM}"`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: ASPREY_SLUG,
      field: "team",
      newValue: CLIENT_NEW_TEAM,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) {
      throw new Error(`Client team update failed: ${result.error}`);
    }
  }

  // Step 6 — Explicit L1 date derivation (safety; TP decision #4)
  ctx.log(
    `recomputeProjectDates(${resolved.l1.id.slice(0, 8)}) — expected startDate=2026-04-20, endDate=2026-04-30`
  );
  if (!ctx.dryRun) {
    const derived = await recomputeProjectDates(resolved.l1.id);
    ctx.log(
      `Derived: startDate="${derived?.startDate ?? "null"}", endDate="${derived?.endDate ?? "null"}"`
    );
  }

  // Step 7 — Verification
  if (!ctx.dryRun) {
    await verify(ctx, resolved);
  }

  ctx.log("=== Asprey v4 Touchup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve client
  const clientRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, ASPREY_SLUG));
  const client = clientRows[0];
  if (!client) {
    throw new Error(`Pre-check failed: client '${ASPREY_SLUG}' not found.`);
  }
  if (client.team !== CLIENT_OLD_TEAM) {
    throw new Error(
      `Pre-check failed: Asprey client team is "${client.team}", expected "${CLIENT_OLD_TEAM}". DB drift — abort.`
    );
  }
  ctx.log(`Client: ${client.name} (${client.id})`);

  // Resolve L1 — must be exactly 1
  const projectRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, client.id));
  if (projectRows.length !== 1) {
    throw new Error(
      `Pre-check failed: expected exactly 1 Asprey L1, got ${projectRows.length}.`
    );
  }
  const l1 = projectRows[0];
  if (!l1.id.startsWith(L1_ID_PREFIX)) {
    throw new Error(
      `Pre-check failed: Asprey L1 id "${l1.id}" does not start with expected prefix "${L1_ID_PREFIX}". DB drift — abort.`
    );
  }
  if (l1.name !== L1_EXPECTED_NAME) {
    throw new Error(
      `Pre-check failed: Asprey L1 name is "${l1.name}", expected "${L1_EXPECTED_NAME}". DB drift — abort.`
    );
  }
  if (l1.engagementType !== null) {
    throw new Error(
      `Pre-check failed: Asprey L1 engagement_type is "${l1.engagementType}", expected null. DB drift — abort.`
    );
  }
  if (l1.contractEnd !== null) {
    throw new Error(
      `Pre-check failed: Asprey L1 contract_end is "${l1.contractEnd}", expected null. DB drift — abort.`
    );
  }
  ctx.log(`L1: ${l1.id} ("${l1.name}")`);

  // Resolve L2s — must be exactly 3, all linked, with expected id prefixes
  const l2s = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));
  if (l2s.length !== 3) {
    throw new Error(
      `Pre-check failed: expected exactly 3 Asprey L2s, got ${l2s.length}.`
    );
  }
  for (const prefix of L2_EXPECTED_ID_PREFIXES) {
    const found = l2s.find((w) => w.id.startsWith(prefix));
    if (!found) {
      throw new Error(
        `Pre-check failed: no Asprey L2 with id prefix "${prefix}". DB drift — abort.`
      );
    }
    if (found.projectId !== l1.id) {
      throw new Error(
        `Pre-check failed: L2 ${prefix} projectId is "${found.projectId}", expected "${l1.id}" (orphan or mis-linked).`
      );
    }
  }

  ctx.log(
    `Pre-checks passed. Ready to apply 3 ops (L1 engagement_type + L1 contract_end + client team) plus 1 derivation recompute.`
  );

  return { client, l1, l2s };
}

// ── Snapshot ─────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, r: ResolvedState): void {
  // Capture full client-scope rows so REVERT has a complete picture, not just
  // the fields we plan to touch.
  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.client,
    L1s: [r.l1],
    L2s: r.l2s,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const base = getSnapshotPath();
  const outPath = resolvePath(
    process.cwd(),
    base.replace(".json", `${suffix}.json`)
  );
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Verification ─────────────────────────────────────────

async function verify(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  ctx.log("--- Verification ---");

  const l1After = (
    await ctx.db.select().from(projects).where(eq(projects.id, r.l1.id))
  )[0];
  if (!l1After) {
    throw new Error("VERIFICATION FAILED: L1 row not found after writes.");
  }
  if (l1After.engagementType !== L1_NEW_ENGAGEMENT_TYPE) {
    throw new Error(
      `VERIFICATION FAILED: L1 engagement_type is "${l1After.engagementType}", expected "${L1_NEW_ENGAGEMENT_TYPE}".`
    );
  }
  if (l1After.contractEnd !== L1_NEW_CONTRACT_END) {
    throw new Error(
      `VERIFICATION FAILED: L1 contract_end is "${l1After.contractEnd}", expected "${L1_NEW_CONTRACT_END}".`
    );
  }
  // Sanity-check the derivation didn't shift start/end off the expected values.
  if (l1After.startDate !== "2026-04-20") {
    throw new Error(
      `VERIFICATION FAILED: L1 startDate is "${l1After.startDate}", expected "2026-04-20".`
    );
  }
  if (l1After.endDate !== "2026-04-30") {
    throw new Error(
      `VERIFICATION FAILED: L1 endDate is "${l1After.endDate}", expected "2026-04-30".`
    );
  }

  const clientAfter = (
    await ctx.db.select().from(clients).where(eq(clients.id, r.client.id))
  )[0];
  if (!clientAfter) {
    throw new Error("VERIFICATION FAILED: client row not found after writes.");
  }
  if (clientAfter.team !== CLIENT_NEW_TEAM) {
    throw new Error(
      `VERIFICATION FAILED: client team is "${clientAfter.team}", expected "${CLIENT_NEW_TEAM}".`
    );
  }

  ctx.log("Verification passed.");
}
