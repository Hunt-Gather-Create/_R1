/**
 * Migration: Soundly v4 Realign — 2026-04-21
 *
 * Wave 1 Batch A of PR #86 overnight-client v4 cleanup. Realigns the Soundly
 * client (3 L1s, 2 L2s) from v1 convention (resources = single helper, no
 * engagement_type) to v4 convention (resources = full team roster,
 * engagement_type set, title format standardized, contract_end populated for
 * retainers).
 *
 * Locked TP decisions (applied verbatim — no re-derivation in this script):
 *   1. Payment Gateway Page `contract_end = '2026-05-31'` (standard business
 *      reading of "Through May 2026").
 *   2. All 3 L1s get `resources` = full `clients.team` roster.
 *   3. engagement_type: Payment Gateway Page = 'retainer'; other two = 'project'.
 *   4. PROJECT_FIELDS whitelist does NOT yet include engagementType/
 *      contractStart/contractEnd. This script uses `updateProjectField()` only
 *      for `resources`, and raw `ctx.db.update(projects).set()` plus explicit
 *      `insertAuditRecord()` calls for `engagementType` and `contractEnd`
 *      (matches bonterra-cleanup-2026-04-19.ts status-null raw-update pattern).
 *      Whitelist expansion is a separate follow-up.
 *
 * Operation order (pinned):
 *   pre-checks → pre-write JSON snapshot → L1 field updates
 *   (resources → engagement_type → contract_end) → L2 title realign → verify.
 *
 * Pre-checks abort loudly if expected pre-state is missing. No partial-apply
 * recovery path.
 *
 * Reverse script: `soundly-v4-realign-2026-04-21-REVERT.ts` — reads the
 * apply-mode snapshot this script writes and restores each affected row's
 * pre-migration column values.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq, like } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  insertAuditRecord,
  updateProjectField,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const SOUNDLY_SLUG = "soundly";
const UPDATED_BY = "migration";

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/soundly-v4-pre-snapshot-2026-04-21.json";

/** Resolve snapshot path. Tests override via env var to avoid clobbering prod artifact. */
function getSnapshotPath(): string {
  return process.env.SOUNDLY_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

type L1Plan = {
  idPrefix: string;
  expectedName: string;
  newResources: string; // v4: full team roster
  engagementType: "project" | "retainer" | "break-fix";
  contractEnd: string | null; // ISO date or null
};

type L2Plan = {
  idPrefix: string;
  expectedWeekOf: string;
  expectedCurrentTitle: string;
  newTitle: string | null; // null = no title change
};

/**
 * Full team roster per TP decision (#2): copy `clients.team` verbatim to each
 * L1's `resources`. Hard-coded here (not read from prod) to keep pre-checks
 * deterministic; pre-check step 1 verifies prod still holds this exact value.
 */
const SOUNDLY_TEAM_FULL = "AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason";

const L1_PLANS: L1Plan[] = [
  {
    idPrefix: "cf4d6575",
    expectedName: "iFrame Provider Search",
    newResources: SOUNDLY_TEAM_FULL,
    engagementType: "project",
    contractEnd: null,
  },
  {
    idPrefix: "8279d9eb",
    expectedName: "Payment Gateway Page",
    newResources: SOUNDLY_TEAM_FULL,
    engagementType: "retainer",
    contractEnd: "2026-05-31",
  },
  {
    idPrefix: "54d65143",
    expectedName: "AARP Member Login + Landing Page",
    newResources: SOUNDLY_TEAM_FULL,
    engagementType: "project",
    contractEnd: null,
  },
];

const L2_PLANS: L2Plan[] = [
  {
    idPrefix: "9c3fc2bb",
    expectedWeekOf: "2026-04-20",
    expectedCurrentTitle: "iFrame launch (evening)",
    newTitle: "iFrame Provider Search — Evening Launch",
  },
  {
    idPrefix: "8ef611c4",
    expectedWeekOf: "2026-04-20",
    expectedCurrentTitle: "Payment Gateway Page — In Dev",
    newTitle: null, // already v4-compliant
  },
];

// ── Exports ──────────────────────────────────────────────

export const description =
  "Soundly v4 realign 2026-04-21: expand L1 resources to full team; set engagement_type on all 3 L1s; set contract_end on Payment Gateway retainer; realign 1 L2 title to v4 format.";

// ── Types ────────────────────────────────────────────────

interface ResolvedState {
  soundly: typeof clients.$inferSelect;
  l1ById: Map<string, typeof projects.$inferSelect>; // key = actual id
  l2ById: Map<string, typeof weekItems.$inferSelect>;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: typeof clients.$inferSelect;
  L1s: Array<typeof projects.$inferSelect>;
  L2s: Array<typeof weekItems.$inferSelect>;
}

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Soundly v4 Realign (2026-04-21) ===");

  // Step 1 — Pre-checks + resolve IDs
  const resolved = await preChecks(ctx);

  // Step 2 — Pre-write snapshot (written in both modes; apply-mode is what REVERT reads)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // Step 3 — L1 updates
  for (const plan of L1_PLANS) {
    const l1 = findByIdPrefix(resolved.l1ById, plan.idPrefix);
    if (!l1) throw new Error(`Missing resolved L1 for prefix ${plan.idPrefix}`);

    // 3a — resources (PROJECT_FIELDS whitelist supports this via updateProjectField)
    if (l1.resources !== plan.newResources) {
      ctx.log(
        `L1 ${plan.idPrefix} (${plan.expectedName}) resources: "${l1.resources}" → "${plan.newResources}"`
      );
      if (!ctx.dryRun) {
        const result = await updateProjectField({
          clientSlug: SOUNDLY_SLUG,
          projectName: plan.expectedName,
          field: "resources",
          newValue: plan.newResources,
          updatedBy: UPDATED_BY,
        });
        if (!result.ok) {
          throw new Error(`L1 ${plan.idPrefix} resources update failed: ${result.error}`);
        }
      }
    } else {
      ctx.log(`L1 ${plan.idPrefix} resources already "${plan.newResources}", skipping.`);
    }

    // 3b — engagement_type (not in PROJECT_FIELDS; raw UPDATE + explicit audit)
    if (l1.engagementType !== plan.engagementType) {
      ctx.log(
        `L1 ${plan.idPrefix} (${plan.expectedName}) engagement_type: "${l1.engagementType}" → "${plan.engagementType}" (raw UPDATE)`
      );
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ engagementType: plan.engagementType, updatedAt: new Date() })
          .where(eq(projects.id, l1.id));

        const idemKey = generateIdempotencyKey(
          "field-change",
          l1.id,
          "engagementType",
          plan.engagementType,
          UPDATED_BY
        );
        await insertAuditRecord({
          idempotencyKey: idemKey,
          projectId: l1.id,
          clientId: l1.clientId,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: l1.engagementType ?? "(null)",
          newValue: plan.engagementType,
          summary: `Project '${l1.name}': engagement_type changed from "${
            l1.engagementType ?? "null"
          }" to "${plan.engagementType}"`,
          metadata: JSON.stringify({ field: "engagementType" }),
        });
      }
    } else {
      ctx.log(
        `L1 ${plan.idPrefix} engagement_type already "${plan.engagementType}", skipping.`
      );
    }

    // 3c — contract_end (not in PROJECT_FIELDS; raw UPDATE + explicit audit; only retainers)
    if (plan.contractEnd !== null && l1.contractEnd !== plan.contractEnd) {
      ctx.log(
        `L1 ${plan.idPrefix} (${plan.expectedName}) contract_end: "${l1.contractEnd}" → "${plan.contractEnd}" (raw UPDATE)`
      );
      if (!ctx.dryRun) {
        await ctx.db
          .update(projects)
          .set({ contractEnd: plan.contractEnd, updatedAt: new Date() })
          .where(eq(projects.id, l1.id));

        const idemKey = generateIdempotencyKey(
          "field-change",
          l1.id,
          "contractEnd",
          plan.contractEnd,
          UPDATED_BY
        );
        await insertAuditRecord({
          idempotencyKey: idemKey,
          projectId: l1.id,
          clientId: l1.clientId,
          updatedBy: UPDATED_BY,
          updateType: "field-change",
          previousValue: l1.contractEnd ?? "(null)",
          newValue: plan.contractEnd,
          summary: `Project '${l1.name}': contract_end changed from "${
            l1.contractEnd ?? "null"
          }" to "${plan.contractEnd}"`,
          metadata: JSON.stringify({ field: "contractEnd" }),
        });
      }
    } else if (plan.contractEnd !== null) {
      ctx.log(
        `L1 ${plan.idPrefix} contract_end already "${plan.contractEnd}", skipping.`
      );
    }
  }

  // Step 4 — L2 title realign (the only L2 changes needed per spec + pre-snapshot analysis)
  for (const plan of L2_PLANS) {
    if (plan.newTitle === null) {
      ctx.log(
        `L2 ${plan.idPrefix} title "${plan.expectedCurrentTitle}" already v4-compliant, skipping.`
      );
      continue;
    }
    const l2 = findByIdPrefix(resolved.l2ById, plan.idPrefix);
    if (!l2) throw new Error(`Missing resolved L2 for prefix ${plan.idPrefix}`);
    ctx.log(
      `L2 ${plan.idPrefix} title: "${l2.title}" → "${plan.newTitle}"`
    );
    if (!ctx.dryRun) {
      const result = await updateWeekItemField({
        weekOf: plan.expectedWeekOf,
        weekItemTitle: l2.title,
        field: "title",
        newValue: plan.newTitle,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`L2 ${plan.idPrefix} title update failed: ${result.error}`);
      }
    }
  }

  // Step 5 — Verification (apply mode only)
  if (!ctx.dryRun) {
    await verify(ctx, resolved.soundly.id);
  }

  ctx.log("=== Soundly v4 Realign complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Soundly client
  const soundlyRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, SOUNDLY_SLUG));
  const soundly = soundlyRows[0];
  if (!soundly) throw new Error(`Pre-check failed: client '${SOUNDLY_SLUG}' not found.`);

  // Verify team roster still matches the hard-coded roster this script assumes
  if (soundly.team !== SOUNDLY_TEAM_FULL) {
    throw new Error(
      `Pre-check failed: Soundly team is "${soundly.team}", expected "${SOUNDLY_TEAM_FULL}". Abort — TP decision #2 assumes this roster.`
    );
  }

  // Resolve L1s by id prefix
  const l1ById = new Map<string, typeof projects.$inferSelect>();
  for (const plan of L1_PLANS) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(like(projects.id, `${plan.idPrefix}%`));
    const forSoundly = matches.filter((p) => p.clientId === soundly.id);
    if (forSoundly.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 L1 with id prefix '${plan.idPrefix}' (${plan.expectedName}) under Soundly, got ${forSoundly.length}.`
      );
    }
    const row = forSoundly[0];
    if (row.name !== plan.expectedName) {
      throw new Error(
        `Pre-check failed: L1 ${plan.idPrefix} name is "${row.name}", expected "${plan.expectedName}".`
      );
    }
    l1ById.set(row.id, row);
  }

  // Resolve L2s by id prefix
  const l2ById = new Map<string, typeof weekItems.$inferSelect>();
  for (const plan of L2_PLANS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(like(weekItems.id, `${plan.idPrefix}%`));
    const forSoundly = matches.filter((w) => w.clientId === soundly.id);
    if (forSoundly.length !== 1) {
      throw new Error(
        `Pre-check failed: expected exactly 1 L2 with id prefix '${plan.idPrefix}' (${plan.expectedCurrentTitle}) under Soundly, got ${forSoundly.length}.`
      );
    }
    const row = forSoundly[0];
    if (row.title !== plan.expectedCurrentTitle) {
      throw new Error(
        `Pre-check failed: L2 ${plan.idPrefix} title is "${row.title}", expected "${plan.expectedCurrentTitle}".`
      );
    }
    if (row.weekOf !== plan.expectedWeekOf) {
      throw new Error(
        `Pre-check failed: L2 ${plan.idPrefix} weekOf is "${row.weekOf}", expected "${plan.expectedWeekOf}".`
      );
    }
    l2ById.set(row.id, row);
  }

  ctx.log(
    `Pre-checks passed. Soundly id=${soundly.id}; resolved 3 L1s and 2 L2s.`
  );

  return { soundly, l1ById, l2ById };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(ctx: MigrationContext, r: ResolvedState): Promise<void> {
  // Capture *all* client-scope L1s and L2s (not just the ones we plan to touch)
  // so REVERT has a complete picture of the client before any writes.
  const L1s = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, r.soundly.id));
  const L2s = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, r.soundly.id));

  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.soundly,
    L1s,
    L2s,
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

async function verify(ctx: MigrationContext, soundlyId: string): Promise<void> {
  ctx.log("--- Verification ---");

  const L1s = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, soundlyId));

  for (const plan of L1_PLANS) {
    const row = L1s.find((p) => p.id.startsWith(plan.idPrefix));
    if (!row) throw new Error(`VERIFY FAILED: L1 ${plan.idPrefix} not found.`);
    if (row.resources !== plan.newResources) {
      throw new Error(
        `VERIFY FAILED: L1 ${plan.idPrefix} resources is "${row.resources}", expected "${plan.newResources}".`
      );
    }
    if (row.engagementType !== plan.engagementType) {
      throw new Error(
        `VERIFY FAILED: L1 ${plan.idPrefix} engagement_type is "${row.engagementType}", expected "${plan.engagementType}".`
      );
    }
    if (plan.contractEnd !== null && row.contractEnd !== plan.contractEnd) {
      throw new Error(
        `VERIFY FAILED: L1 ${plan.idPrefix} contract_end is "${row.contractEnd}", expected "${plan.contractEnd}".`
      );
    }
  }

  const L2s = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.clientId, soundlyId));

  for (const plan of L2_PLANS) {
    if (plan.newTitle === null) continue;
    const row = L2s.find((w) => w.id.startsWith(plan.idPrefix));
    if (!row) throw new Error(`VERIFY FAILED: L2 ${plan.idPrefix} not found.`);
    if (row.title !== plan.newTitle) {
      throw new Error(
        `VERIFY FAILED: L2 ${plan.idPrefix} title is "${row.title}", expected "${plan.newTitle}".`
      );
    }
  }

  ctx.log("Verification passed.");
}

// ── Helpers ──────────────────────────────────────────────

function findByIdPrefix<T extends { id: string }>(
  map: Map<string, T>,
  prefix: string
): T | undefined {
  for (const v of map.values()) {
    if (v.id.startsWith(prefix)) return v;
  }
  return undefined;
}
