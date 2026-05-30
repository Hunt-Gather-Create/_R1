/**
 * Migration: HDL Status Doc + Burndown Alignment — 2026-05-28
 *
 * Aligns Runway prod state with the HDL Status Doc / Schedule sheet absorbed
 * from TP handoff dated 2026-05-28 (sourced from 5/26 photo/video client call,
 * 5/27 Ken SEO audits + schema delivery, and HDL Schedule sheet updates rows
 * 11/13/20). Operator approved all decisions in the 2026-05-28 session.
 *
 * NOT in scope (operator-locked):
 *   - client.contractStatus="expired" + contractTerm 1/31/26 vs active work
 *     through 7/7/26 launch. Likely unrecorded SOW extension. FLAG ONLY —
 *     no mutation to the client record. (Op decision: "keep 1 expired".)
 *
 * Actions (all routed through whitelist helpers — no raw UPDATE):
 *
 * A. Close out 6 WIs (re-anchor endDate + status to true completion dates)
 *    | WI | true endDate | new weekOf | new dow |
 *    | 643f6221 Design K/O Batch 2 Pages | 2026-05-21 (Thu) | 2026-05-18 | thursday |
 *    | 8efef949 Shoot: Content Capture Reccos | 2026-05-26 (Tue) | 2026-05-25 | tuesday |
 *    | 312dbcbf Shoot: Client To Pick Vendor | 2026-05-26 (Tue) | 2026-05-25 | tuesday |
 *    | 6e9ad9f6 Dev K/O Batch 1 Pages | 2026-05-22 (Fri) | 2026-05-18 | friday |
 *    | 6a2c98c6 Lane B1 Mobile Section Designs | 2026-05-22 (Fri) | 2026-05-18 | friday |
 *    | 20fa2a07 Sami Photo Selects — Batch 2 Pages | 2026-05-20 (Wed) | 2026-05-18 | wednesday |
 *    Per-WI order: endDate → status → dayOfWeek → weekOf (LAST — lookup key).
 *
 * B. Delete stale WI (1)
 *    - b6019f8d Shoot: Pre Pro Meeting + Prep — Jay (external producer) now
 *      handles pre-pro. Delete by id.
 *
 * C. Update 3 WIs
 *    1. f690229f Content K/O Batch 2 Pages — keep in-progress, extend endDate
 *       5/27 → 6/3 (Wed). weekOf 5/25 → 6/1. dow wednesday (no change). Notes
 *       refresh to reflect Chris's 5/22 partial delivery.
 *    2. 5f1e1687 Shoot: Production Shoot in Bend — dates shift from single-day
 *       6/1 to multi-day 6/28 → 7/1. Resources flip from CD: Lane to external
 *       Director: Jay Blakesberg + Client: Dave + Client: Katie (Lane and
 *       Kathy NOT traveling per Dave's call). Notes add hair/makeup-in-budget
 *       note and "final go/no-go at 6/3 status".
 *    3. e69bf652 Shoot: Post-Shoot Editing — dates shift 6/2→6/19 to 7/2→7/31
 *       placeholder (Jay-driven editing timeline; exact end TBD at 6/3
 *       status). Resources flip from CD: Lane to Director: Jay + Client: Dave
 *       + Client: Katie. Notes updated.
 *
 *    Date-write order on each update WI: endDate FIRST (forward move), then
 *    startDate (if changing), then dayOfWeek, then resources, then notes,
 *    then weekOf (LAST — lookup key).
 *
 * D. Create 1 new WI under L1 "Website Build" (f9af3445)
 *    - "SEO Feedback Implementation" | 2026-05-28 (Thu) → 2026-06-01 (Mon)
 *    - weekOf 2026-06-01, dow monday, status scheduled, category delivery,
 *      owner Jason, resources "Dev: Leslie"
 *    - Notes: per-page audit fixes (1.0/2.0/2.1, 2.2 inferred), global items
 *      (phone, robots.txt, LLMS, sitemap), schema impl per Ken 5/27
 *      (LegalService, Attorney, Person, FAQPage). Includes ref doc URL.
 *
 * E. Pin L1 endDate to 2026-07-07
 *    - After all WI writes, the Post-Shoot Editing placeholder endDate 7/31
 *      would drift L1 envelope past launch (7/7). Use overrideProjectDate
 *      to pin endDate back to 2026-07-07 (the LAUNCH milestone, driven by
 *      "Dev LAUNCH Website" WI). engType=project so no retainer guard.
 *
 * Pre-checks abort on prod drift from the 2026-05-28 snapshot.
 *
 * Verification at end:
 *   - 6 closures completed at their true endDates.
 *   - b6019f8d deleted.
 *   - 3 updates landed with new dates + resources + notes.
 *   - SEO Feedback Implementation present under Website Build.
 *   - L1 Website Build endDate=2026-07-07 (pinned).
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  updateProjectField,
  overrideProjectDate,
} from "@/lib/runway/operations-writes-project";
import {
  updateWeekItemField,
  createWeekItem,
  deleteWeekItem,
} from "@/lib/runway/operations-writes-week";

// ── Constants ────────────────────────────────────────────

const HDL_SLUG = "hdl";
const UPDATED_BY = "hdl-status-doc-align-2026-05-28";
const SNAPSHOT_PATH = "docs/tmp/hdl-status-doc-align-pre-2026-05-28.json";

// L1
const L1_HDL_ID = "f9af344597ef4e45a8cca4743";
const L1_HDL_NAME = "Website Build";
const L1_PINNED_END_DATE = "2026-07-07";

// Phase A — closures
//
// `newStartDate` is set only when the WI is single-day at the current sd=ed
// and the new endDate is BEFORE the current startDate. Without a startDate
// write first, validateStartEndDateOrder rejects the endDate write
// (start 5/27 > end 5/26). When set, startDate is written BEFORE endDate.
// Otherwise the closure preserves the existing startDate untouched.
interface CloseoutWi {
  idPrefix: string;
  title: string;
  currentWeekOf: string;
  newStartDate?: string; // Only set when backward single-day move requires it
  newEndDate: string;
  newWeekOf: string;
  newDayOfWeek: string;
}

const CLOSEOUTS: CloseoutWi[] = [
  {
    idPrefix: "643f6221",
    title: "Design K/O Batch 2 Pages",
    currentWeekOf: "2026-05-25",
    newEndDate: "2026-05-21",
    newWeekOf: "2026-05-18",
    newDayOfWeek: "thursday",
  },
  {
    idPrefix: "8efef949",
    title: "Shoot: Content Capture Reccos",
    currentWeekOf: "2026-05-25",
    newStartDate: "2026-05-26", // Current sd=ed=5/27 → single-day move to 5/26
    newEndDate: "2026-05-26",
    newWeekOf: "2026-05-25",
    newDayOfWeek: "tuesday",
  },
  {
    idPrefix: "312dbcbf",
    title: "Shoot: Client To Pick Vendor",
    currentWeekOf: "2026-05-25",
    newStartDate: "2026-05-26", // Current sd=ed=5/27 → single-day move to 5/26
    newEndDate: "2026-05-26",
    newWeekOf: "2026-05-25",
    newDayOfWeek: "tuesday",
  },
  {
    idPrefix: "6e9ad9f6",
    title: "Dev K/O Batch 1 Pages",
    currentWeekOf: "2026-05-25",
    newEndDate: "2026-05-22",
    newWeekOf: "2026-05-18",
    newDayOfWeek: "friday",
  },
  {
    idPrefix: "6a2c98c6",
    title: "Lane B1 Mobile Section Designs (for Leslie)",
    currentWeekOf: "2026-05-25",
    newEndDate: "2026-05-22",
    newWeekOf: "2026-05-18",
    newDayOfWeek: "friday",
  },
  {
    idPrefix: "20fa2a07",
    title: "Sami Photo Selects — Batch 2 Pages",
    currentWeekOf: "2026-05-25",
    newEndDate: "2026-05-20",
    newWeekOf: "2026-05-18",
    newDayOfWeek: "wednesday",
  },
];

// Phase B — delete
const DELETE_WI = {
  idPrefix: "b6019f8d",
  title: "Shoot: Pre Pro Meeting + Prep",
};

// Phase C — updates
interface UpdateWiConfig {
  idPrefix: string;
  title: string;
  currentWeekOf: string;
  // Optional fields — undefined means no change
  newEndDate?: string;
  newStartDate?: string;
  newDayOfWeek?: string;
  newWeekOf?: string;
  newResources?: string;
  newNotes?: string;
}

const UPDATES: UpdateWiConfig[] = [
  {
    idPrefix: "f690229f",
    title: "Content K/O Batch 2 Pages",
    currentWeekOf: "2026-05-25",
    newEndDate: "2026-06-03",
    newWeekOf: "2026-06-01",
    // dow stays wednesday
    newNotes:
      "Chris partial 5/22: 5.7 Featured Articles ready (lander + 17 articles). Still pending per Dave's 5/22 email: 5.0, 5.2, 5.3, 5.4, 6.0, 8.1, 8.2, 8.3.",
  },
  {
    idPrefix: "5f1e1687",
    title: "Shoot: Production Shoot in Bend",
    currentWeekOf: "2026-06-01",
    newEndDate: "2026-07-01",
    newStartDate: "2026-06-28",
    newDayOfWeek: "wednesday",
    newWeekOf: "2026-06-29",
    newResources: "Director: Jay Blakesberg, Client: Dave, Client: Katie",
    newNotes:
      "Photo shoot in Bend. External Director Jay Blakesberg, Katie on-site coordinator. Lane/Kathy NOT traveling. Hair/makeup is in (Civ recco, Dave agreed). Final go/no-go at 6/3 status.",
  },
  {
    idPrefix: "e69bf652",
    title: "Shoot: Post-Shoot Editing",
    currentWeekOf: "2026-06-15",
    newEndDate: "2026-07-31",
    newStartDate: "2026-07-02",
    // dow friday — no change
    newWeekOf: "2026-07-27",
    newResources: "Director: Jay Blakesberg, Client: Dave, Client: Katie",
    newNotes:
      "Jay handles editing post-7/1 shoot wrap. End placeholder 7/31; exact end TBD at 6/3 status meeting based on Jay's editing timeline.",
  },
];

// Phase D — create
const NEW_WI = {
  title: "SEO Feedback Implementation",
  startDate: "2026-05-28",
  endDate: "2026-06-01",
  weekOf: "2026-06-01",
  dayOfWeek: "monday",
  status: "scheduled",
  category: "delivery",
  owner: "Jason",
  resources: "Dev: Leslie",
  notes:
    "Per-page audit fixes (1.0, 2.0, 2.1, 2.2 inferred), global items (phone, robots.txt, LLMS, sitemap), schema impl per Ken 5/27 (LegalService, Attorney, Person, FAQPage). Ref: https://docs.google.com/document/d/1lgCQg1ZLpUy87DoPwIEV-xsKjSKFkBMFQJTSWcysFO8/edit",
};

// ── Types ────────────────────────────────────────────────

interface ResolvedState {
  client: typeof clients.$inferSelect;
  l1: typeof projects.$inferSelect;
  closeoutWis: Array<typeof weekItems.$inferSelect>;
  deleteWi: typeof weekItems.$inferSelect;
  updateWis: Array<typeof weekItems.$inferSelect>;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: typeof clients.$inferSelect;
  L1: typeof projects.$inferSelect;
  weekItems: Array<typeof weekItems.$inferSelect>;
}

// ── Exports ──────────────────────────────────────────────

export const description =
  "HDL Status Doc + Burndown alignment 2026-05-28: 6 closures, 1 delete, 3 updates (incl. Production Shoot dates + resource flip), 1 new WI (SEO Feedback Implementation), L1 endDate pinned to 2026-07-07.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== HDL Status Doc Align (2026-05-28) ===");

  // ── Step 1 — Pre-checks + resolve ────────────────────
  const r = await preChecks(ctx);

  // ── Step 2 — Pre-write snapshot ──────────────────────
  writeSnapshot(ctx, r);

  if (ctx.dryRun) {
    ctx.log("[DRY-RUN] No writes will be performed. Operation plan follows.");
  }

  // ── Step 3 — Phase A: Close out 6 WIs ────────────────
  // Per-WI order: [startDate (if backward)] → endDate → status → dayOfWeek → weekOf (LAST — lookup key).
  //
  // For BACKWARD single-day moves where current sd > new ed, startDate
  // must be written FIRST or validateStartEndDateOrder rejects the endDate
  // write. Applies to 8efef949 + 312dbcbf (both currently sd=ed=5/27,
  // new ed=5/26). All other closures preserve existing startDate.
  ctx.log("--- Phase A: Close out 6 WIs (re-anchor to true completion dates) ---");
  for (const cfg of CLOSEOUTS) {
    const wi = r.closeoutWis.find((w) => w.id.startsWith(cfg.idPrefix))!;

    // 3a. startDate FIRST (only when backward single-day move requires it)
    if (cfg.newStartDate !== undefined && wi.startDate !== cfg.newStartDate) {
      ctx.log(`  WI ${cfg.idPrefix} startDate: ${wi.startDate} → ${cfg.newStartDate} (backward move — write before endDate)`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "startDate",
          newValue: cfg.newStartDate,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} startDate update failed: ${res.error}`);
      }
    }

    // 3b. endDate
    ctx.log(`  WI ${cfg.idPrefix} "${cfg.title}" endDate: ${wi.endDate} → ${cfg.newEndDate}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: cfg.currentWeekOf,
        weekItemTitle: cfg.title,
        field: "endDate",
        newValue: cfg.newEndDate,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${cfg.idPrefix} endDate update failed: ${res.error}`);
    }

    // 3c. status
    ctx.log(`  WI ${cfg.idPrefix} status: ${wi.status} → completed`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: cfg.currentWeekOf,
        weekItemTitle: cfg.title,
        field: "status",
        newValue: "completed",
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${cfg.idPrefix} status update failed: ${res.error}`);
    }

    // 3d. dayOfWeek
    ctx.log(`  WI ${cfg.idPrefix} dayOfWeek: ${wi.dayOfWeek} → ${cfg.newDayOfWeek}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: cfg.currentWeekOf,
        weekItemTitle: cfg.title,
        field: "dayOfWeek",
        newValue: cfg.newDayOfWeek,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${cfg.idPrefix} dayOfWeek update failed: ${res.error}`);
    }

    // 3e. weekOf — LAST (lookup key)
    ctx.log(`  WI ${cfg.idPrefix} weekOf: ${wi.weekOf} → ${cfg.newWeekOf}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: cfg.currentWeekOf,
        weekItemTitle: cfg.title,
        field: "weekOf",
        newValue: cfg.newWeekOf,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${cfg.idPrefix} weekOf update failed: ${res.error}`);
    }
  }

  // ── Step 4 — Phase B: Delete stale WI ────────────────
  ctx.log("--- Phase B: Delete stale WI b6019f8d (Shoot: Pre Pro Meeting + Prep) ---");
  ctx.log(`  delete WI ${DELETE_WI.idPrefix} "${DELETE_WI.title}"`);
  if (!ctx.dryRun) {
    const res = await deleteWeekItem({
      id: r.deleteWi.id,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Delete WI ${DELETE_WI.idPrefix} failed: ${res.error}`);
  }

  // ── Step 5 — Phase C: Update 3 WIs ───────────────────
  // Per-WI order: endDate → startDate → dayOfWeek → resources → notes → weekOf (LAST).
  ctx.log("--- Phase C: Update 3 WIs ---");
  for (const cfg of UPDATES) {
    const wi = r.updateWis.find((w) => w.id.startsWith(cfg.idPrefix))!;

    // endDate (forward move first)
    if (cfg.newEndDate !== undefined && wi.endDate !== cfg.newEndDate) {
      ctx.log(`  WI ${cfg.idPrefix} "${cfg.title}" endDate: ${wi.endDate} → ${cfg.newEndDate}`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "endDate",
          newValue: cfg.newEndDate,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} endDate update failed: ${res.error}`);
      }
    }

    // startDate (forward move next)
    if (cfg.newStartDate !== undefined && wi.startDate !== cfg.newStartDate) {
      ctx.log(`  WI ${cfg.idPrefix} startDate: ${wi.startDate} → ${cfg.newStartDate}`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "startDate",
          newValue: cfg.newStartDate,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} startDate update failed: ${res.error}`);
      }
    }

    // dayOfWeek
    if (cfg.newDayOfWeek !== undefined && wi.dayOfWeek !== cfg.newDayOfWeek) {
      ctx.log(`  WI ${cfg.idPrefix} dayOfWeek: ${wi.dayOfWeek} → ${cfg.newDayOfWeek}`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "dayOfWeek",
          newValue: cfg.newDayOfWeek,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} dayOfWeek update failed: ${res.error}`);
      }
    }

    // resources
    if (cfg.newResources !== undefined && wi.resources !== cfg.newResources) {
      ctx.log(`  WI ${cfg.idPrefix} resources: "${wi.resources}" → "${cfg.newResources}"`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "resources",
          newValue: cfg.newResources,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} resources update failed: ${res.error}`);
      }
    }

    // notes
    if (cfg.newNotes !== undefined && wi.notes !== cfg.newNotes) {
      ctx.log(`  WI ${cfg.idPrefix} notes refreshed`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "notes",
          newValue: cfg.newNotes,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} notes update failed: ${res.error}`);
      }
    }

    // weekOf — LAST (lookup key)
    if (cfg.newWeekOf !== undefined && wi.weekOf !== cfg.newWeekOf) {
      ctx.log(`  WI ${cfg.idPrefix} weekOf: ${wi.weekOf} → ${cfg.newWeekOf}`);
      if (!ctx.dryRun) {
        const res = await updateWeekItemField({
          weekOf: cfg.currentWeekOf,
          weekItemTitle: cfg.title,
          field: "weekOf",
          newValue: cfg.newWeekOf,
          updatedBy: UPDATED_BY,
        });
        if (!res.ok) throw new Error(`WI ${cfg.idPrefix} weekOf update failed: ${res.error}`);
      }
    }
  }

  // ── Step 6 — Phase D: Create SEO Feedback Implementation ──
  ctx.log("--- Phase D: Create 1 new WI under L1 'Website Build' ---");
  ctx.log(
    `  create "${NEW_WI.title}" ${NEW_WI.startDate}→${NEW_WI.endDate} (${NEW_WI.dayOfWeek}, weekOf ${NEW_WI.weekOf}, status=${NEW_WI.status}, resources="${NEW_WI.resources}")`,
  );
  if (!ctx.dryRun) {
    const res = await createWeekItem({
      clientSlug: HDL_SLUG,
      projectName: L1_HDL_NAME,
      weekOf: NEW_WI.weekOf,
      dayOfWeek: NEW_WI.dayOfWeek,
      date: NEW_WI.startDate,
      startDate: NEW_WI.startDate,
      endDate: NEW_WI.endDate,
      title: NEW_WI.title,
      status: NEW_WI.status,
      category: NEW_WI.category,
      owner: NEW_WI.owner,
      resources: NEW_WI.resources,
      notes: NEW_WI.notes,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Create WI "${NEW_WI.title}" failed: ${res.error}`);
  }

  // ── Step 7 — Phase E: Pin L1 endDate to 2026-07-07 ───
  ctx.log(`--- Phase E: Pin L1 '${L1_HDL_NAME}' endDate to ${L1_PINNED_END_DATE} ---`);
  ctx.log(
    `  WI-derived endDate after Phase C would be ~7/31 (Post-Shoot Editing placeholder). Pinning back to 7/7 (launch milestone).`,
  );
  if (!ctx.dryRun) {
    const res = await overrideProjectDate({
      clientSlug: HDL_SLUG,
      projectName: L1_HDL_NAME,
      field: "endDate",
      newValue: L1_PINNED_END_DATE,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L1 endDate pin failed: ${res.error}`);
  }

  // ── Step 8 — Verification ────────────────────────────
  if (!ctx.dryRun) {
    await verify(ctx);
  }

  ctx.log("=== HDL Status Doc Align complete ===");
}

// ── Pre-checks ────────────────────────────────────────────

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Client
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, HDL_SLUG));
  const client = clientRows[0];
  if (!client) throw new Error(`Pre-check failed: client '${HDL_SLUG}' not found.`);
  ctx.log(`Client: ${client.name} (${client.id}) — contractStatus="${client.contractStatus}" (flag-only, not mutating)`);

  // L1
  const projectRows = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  const l1 = projectRows.find((p) => p.id === L1_HDL_ID);
  if (!l1) throw new Error(`Pre-check failed: L1 '${L1_HDL_NAME}' (${L1_HDL_ID.slice(0, 8)}) not found.`);
  if (l1.name !== L1_HDL_NAME) {
    throw new Error(`Pre-check failed: L1 name="${l1.name}", expected "${L1_HDL_NAME}".`);
  }
  if (l1.engagementType !== "project") {
    throw new Error(`Pre-check failed: L1 engagementType="${l1.engagementType}", expected "project".`);
  }
  ctx.log(`L1: ${l1.name} (${l1.id.slice(0, 8)}) — status=${l1.status}, category=${l1.category}, ${l1.startDate}→${l1.endDate}`);

  // WIs — fetch all HDL WIs in one query
  const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));

  // Closeout WIs
  const closeoutWis = CLOSEOUTS.map((cfg) => {
    const wi = allWis.find((w) => w.id.startsWith(cfg.idPrefix));
    if (!wi) throw new Error(`Pre-check failed: closeout WI ${cfg.idPrefix} ("${cfg.title}") not found.`);
    if (wi.title !== cfg.title) {
      throw new Error(`Pre-check failed: WI ${cfg.idPrefix} title="${wi.title}", expected "${cfg.title}".`);
    }
    if (wi.weekOf !== cfg.currentWeekOf) {
      throw new Error(`Pre-check failed: WI ${cfg.idPrefix} weekOf="${wi.weekOf}", expected "${cfg.currentWeekOf}".`);
    }
    if (wi.status !== "in-progress") {
      throw new Error(`Pre-check failed: WI ${cfg.idPrefix} status="${wi.status}", expected "in-progress".`);
    }
    return wi;
  });

  // Delete WI
  const deleteWi = allWis.find((w) => w.id.startsWith(DELETE_WI.idPrefix));
  if (!deleteWi) throw new Error(`Pre-check failed: delete WI ${DELETE_WI.idPrefix} not found — already deleted?`);
  if (deleteWi.title !== DELETE_WI.title) {
    throw new Error(`Pre-check failed: delete WI title="${deleteWi.title}", expected "${DELETE_WI.title}".`);
  }

  // Update WIs
  const updateWis = UPDATES.map((cfg) => {
    const wi = allWis.find((w) => w.id.startsWith(cfg.idPrefix));
    if (!wi) throw new Error(`Pre-check failed: update WI ${cfg.idPrefix} ("${cfg.title}") not found.`);
    if (wi.title !== cfg.title) {
      throw new Error(`Pre-check failed: WI ${cfg.idPrefix} title="${wi.title}", expected "${cfg.title}".`);
    }
    if (wi.weekOf !== cfg.currentWeekOf) {
      throw new Error(`Pre-check failed: WI ${cfg.idPrefix} weekOf="${wi.weekOf}", expected "${cfg.currentWeekOf}".`);
    }
    return wi;
  });

  // No collision on new WI title
  const dup = allWis.find((w) => w.title === NEW_WI.title && w.projectId === L1_HDL_ID);
  if (dup) {
    throw new Error(`Pre-check failed: a WI titled "${NEW_WI.title}" already exists under L1 Website Build (${dup.id.slice(0, 8)}). Duplicate — abort.`);
  }

  ctx.log(`Pre-checks passed: 1 L1 + ${closeoutWis.length} closeouts + 1 delete + ${updateWis.length} updates resolved, no collision for new WI.`);

  return {
    client,
    l1,
    closeoutWis,
    deleteWi,
    updateWis,
  };
}

// ── Snapshot ──────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, r: ResolvedState): void {
  const allWis = [...r.closeoutWis, r.deleteWi, ...r.updateWis];
  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.client,
    L1: r.l1,
    weekItems: allWis,
  };
  const fullPath = resolvePath(SNAPSHOT_PATH);
  if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(snapshot, null, 2));
  ctx.log(`Snapshot written: ${SNAPSHOT_PATH}`);
}

// ── Verification ──────────────────────────────────────────

async function verify(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Verification ---");

  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, HDL_SLUG));
  const client = clientRows[0];

  const projectRows = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  const l1 = projectRows.find((p) => p.id === L1_HDL_ID);
  if (!l1) throw new Error(`Verify: L1 ${L1_HDL_ID.slice(0, 8)} disappeared.`);
  if (l1.endDate !== L1_PINNED_END_DATE) {
    throw new Error(`Verify: L1 endDate="${l1.endDate}", expected pinned "${L1_PINNED_END_DATE}".`);
  }
  ctx.log(`  ✓ L1 '${L1_HDL_NAME}' endDate pinned to ${L1_PINNED_END_DATE}`);

  const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));

  // Closures
  for (const cfg of CLOSEOUTS) {
    const wi = allWis.find((w) => w.id.startsWith(cfg.idPrefix));
    if (!wi) throw new Error(`Verify: closeout WI ${cfg.idPrefix} missing.`);
    if (wi.status !== "completed") {
      throw new Error(`Verify: WI ${cfg.idPrefix} status="${wi.status}", expected "completed".`);
    }
    if (wi.endDate !== cfg.newEndDate) {
      throw new Error(`Verify: WI ${cfg.idPrefix} endDate="${wi.endDate}", expected "${cfg.newEndDate}".`);
    }
    if (cfg.newStartDate !== undefined && wi.startDate !== cfg.newStartDate) {
      throw new Error(`Verify: WI ${cfg.idPrefix} startDate="${wi.startDate}", expected "${cfg.newStartDate}".`);
    }
    if (wi.weekOf !== cfg.newWeekOf) {
      throw new Error(`Verify: WI ${cfg.idPrefix} weekOf="${wi.weekOf}", expected "${cfg.newWeekOf}".`);
    }
    if (wi.dayOfWeek !== cfg.newDayOfWeek) {
      throw new Error(`Verify: WI ${cfg.idPrefix} dayOfWeek="${wi.dayOfWeek}", expected "${cfg.newDayOfWeek}".`);
    }
  }
  ctx.log(`  ✓ ${CLOSEOUTS.length} closures completed at re-anchored dates`);

  // Delete
  const deleted = allWis.find((w) => w.id.startsWith(DELETE_WI.idPrefix));
  if (deleted) throw new Error(`Verify: delete WI ${DELETE_WI.idPrefix} still present.`);
  ctx.log(`  ✓ WI ${DELETE_WI.idPrefix} deleted`);

  // Updates
  for (const cfg of UPDATES) {
    const wi = allWis.find((w) => w.id.startsWith(cfg.idPrefix));
    if (!wi) throw new Error(`Verify: update WI ${cfg.idPrefix} disappeared.`);
    if (cfg.newEndDate !== undefined && wi.endDate !== cfg.newEndDate) {
      throw new Error(`Verify: WI ${cfg.idPrefix} endDate="${wi.endDate}", expected "${cfg.newEndDate}".`);
    }
    if (cfg.newStartDate !== undefined && wi.startDate !== cfg.newStartDate) {
      throw new Error(`Verify: WI ${cfg.idPrefix} startDate="${wi.startDate}", expected "${cfg.newStartDate}".`);
    }
    if (cfg.newWeekOf !== undefined && wi.weekOf !== cfg.newWeekOf) {
      throw new Error(`Verify: WI ${cfg.idPrefix} weekOf="${wi.weekOf}", expected "${cfg.newWeekOf}".`);
    }
    if (cfg.newDayOfWeek !== undefined && wi.dayOfWeek !== cfg.newDayOfWeek) {
      throw new Error(`Verify: WI ${cfg.idPrefix} dayOfWeek="${wi.dayOfWeek}", expected "${cfg.newDayOfWeek}".`);
    }
    if (cfg.newResources !== undefined && wi.resources !== cfg.newResources) {
      throw new Error(`Verify: WI ${cfg.idPrefix} resources mismatch.`);
    }
    if (cfg.newNotes !== undefined && wi.notes !== cfg.newNotes) {
      throw new Error(`Verify: WI ${cfg.idPrefix} notes mismatch.`);
    }
  }
  ctx.log(`  ✓ ${UPDATES.length} updates landed (dates, resources, notes)`);

  // New WI
  const created = allWis.find((w) => w.title === NEW_WI.title && w.projectId === L1_HDL_ID);
  if (!created) throw new Error(`Verify: new WI "${NEW_WI.title}" not found under L1.`);
  if (created.startDate !== NEW_WI.startDate || created.endDate !== NEW_WI.endDate) {
    throw new Error(`Verify: new WI dates wrong (got ${created.startDate}→${created.endDate}, expected ${NEW_WI.startDate}→${NEW_WI.endDate}).`);
  }
  if (created.status !== NEW_WI.status) {
    throw new Error(`Verify: new WI status="${created.status}", expected "${NEW_WI.status}".`);
  }
  ctx.log(`  ✓ New WI '${NEW_WI.title}' created under L1`);

  ctx.log("Verification passed.");
}
