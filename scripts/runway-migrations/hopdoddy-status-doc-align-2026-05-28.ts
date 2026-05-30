/**
 * Migration: Hopdoddy Status Doc + Burndown Alignment — 2026-05-28
 *
 * Aligns Runway prod state with the client-facing Status Doc + Burndown after
 * the 5/21/26 brand refresh launch. Operator approved the plan in the
 * 2026-05-28 session (post-compact).
 *
 * Actions (all routed through whitelist helpers — no raw UPDATE):
 *
 * A. Close out 5/21 launch (12 entities)
 *    - 6 WIs under L2 "Brand Refresh Revisions": status=in-progress→completed,
 *      endDate=2026-06-05→2026-05-21
 *    - WI "Website Refresh" (dc248132, direct child of retainer L1):
 *      status=in-progress→completed, endDate=2026-06-05→2026-05-21
 *    - WI "Civilization provides timing on Rewards + Happy Hour pages":
 *      status=in-progress→completed (single-day 5/26; happened in Leslie 1:1)
 *    - L2 "Brand Refresh Revisions": category=active→completed,
 *      status=in-production→completed (cascade target — all 6 WIs already in
 *      TERMINAL state by this point, so cascade is a no-op)
 *    - L1 "Brand Refresh Website": category=active→completed,
 *      status=in-production→completed
 *    - L1 "National Burger Day Landing Page": category=active→completed,
 *      status=in-production→completed
 *    - recomputeProjectDates() on each closed L1 + L2 (derive endDate from
 *      WI children; expect 2026-05-21)
 *
 * B. Rename Kaci WI to mirror Status Doc row 4
 *    - notes: "Add Kaci's hand-drawn illustrations to the Sourcing page."
 *    - title: "Kaci illustrations integration (post-launch)" →
 *             "Sourcing Page: Updates"
 *    - (title written LAST — lookup key)
 *
 * C. Delete stale WI superseded by 4 new pages
 *    - WI "Website Refresh: Reward and Happy Hour pages" (b55dfe15)
 *
 * D. Create 7 new WIs under retainer L1 "Digital Retainer (195 hrs)"
 *    All owner=Jason, category=delivery. Dates lifted from Status Doc F
 *    column (operator-locked 2026-05-28). Notes mirror Status Doc D column,
 *    trimmed to ≤280 (NOTES_MAX_LEN_L2).
 *    | Title | Start | End | Status | Resources |
 *    | Global Site Nav: Updates | 6/2 | 6/8 | scheduled | Dev: Leslie |
 *    | Homepage: Updates | 6/9 | 6/15 | scheduled | Dev: Leslie |
 *    | Culture Page: Updates | 6/9 | 6/15 | scheduled | Dev: Leslie |
 *    | Rewards Page: Refresh | 6/9 | 6/26 | scheduled | CD: Lane, Dev: Leslie |
 *    | Happy Hour Page: Refresh | 6/15 | 6/22 | scheduled | Dev: Leslie |
 *    | Careers Page: Refresh | 6/15 | 7/15 | scheduled | Dev: Leslie |
 *    | Locations Page: Refresh | 6/15 | 7/15 | scheduled | Dev: Leslie |
 *
 * Order rationale (compat-safe + key-stable):
 *   1. WI endDate writes (FORWARD ordering rule moot — only endDate moves
 *      BACKWARD; new endDate 5/21 ≥ startDate 5/11+; safe to write alone).
 *   2. WI status writes (after endDate, since L1 cascade fires next).
 *   3. L1/L2 category writes (must precede status flip — `completed + active`
 *      is a HARD reject in validateStatusCategoryCompatibility).
 *   4. L1/L2 status writes (cascade no-ops since WIs already terminal).
 *   5. recomputeProjectDates per closed L1 + L2.
 *   6. Kaci notes write, then title write LAST (title is lookup key).
 *   7. Delete b55dfe15 by id.
 *   8. Create 7 new WIs.
 *
 * Pre-checks abort on prod drift from the 2026-05-27 PM snapshot.
 *
 * Verification at end:
 *   - 2 L1s + 1 L2 in status=completed, category=completed.
 *   - 9 WI updates landed (status=completed; 7 of them with endDate=2026-05-21).
 *   - Kaci WI renamed.
 *   - b55dfe15 deleted (lookup returns nothing).
 *   - 7 new WIs present under retainer L1, dates correct.
 *
 * Idempotency: every write helper passes through generateIdempotencyKey;
 * re-running with the same UPDATED_BY string will be a no-op for already-
 * applied writes. Bump UPDATED_BY on revert+retry per feedback memory
 * feedback_revert_idempotency_poisoning.md.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq, and } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  updateProjectField,
} from "@/lib/runway/operations-writes-project";
import {
  updateWeekItemField,
  createWeekItem,
  deleteWeekItem,
  recomputeProjectDates,
} from "@/lib/runway/operations-writes-week";
import { updateProjectStatus } from "@/lib/runway/operations-writes";

// ── Constants ────────────────────────────────────────────

const HOPDODDY_SLUG = "hopdoddy";
const UPDATED_BY = "hopdoddy-status-doc-align-2026-05-28";

const SNAPSHOT_PATH = "docs/tmp/hopdoddy-status-doc-align-pre-2026-05-28.json";

// L1s
const L1_BRAND_REFRESH_WEBSITE_ID = "c323e450e0a14060b0ca8d216";
const L1_BRAND_REFRESH_WEBSITE_NAME = "Brand Refresh Website";
const L1_NBD_LP_ID = "89c96bd32b424a979293b10f2";
const L1_NBD_LP_NAME = "National Burger Day Landing Page";
const L1_RETAINER_ID = "bc55c0b734df418cb308e79d3";
const L1_RETAINER_NAME = "Digital Retainer (195 hrs)";

// L2 wrapper
const L2_BRR_ID = "678b8f1e880940a0aafb44386";
const L2_BRR_NAME = "Brand Refresh Revisions";

// 6 WIs under L2 Brand Refresh Revisions
// Prod convention: weekOf = Monday of endDate week. Current endDate=2026-06-05
// (Fri) → weekOf=2026-06-01 (Mon). After close-out, endDate moves to
// 2026-05-21 (Thu) → new weekOf=2026-05-18 (Mon), new dayOfWeek=thursday.
const REVISION_WIS: Array<{ id: string; title: string; weekOf: string }> = [
  { id: "4407781d", title: "Overall: Typography + brand book application", weekOf: "2026-06-01" },
  { id: "b29eb922", title: "Home Page revisions", weekOf: "2026-06-01" },
  { id: "f032607f", title: "Culture Page revisions", weekOf: "2026-06-01" },
  { id: "b7dea36a", title: "Sourcing Page revisions", weekOf: "2026-06-01" },
  { id: "27adaf7c", title: "Sourcing: NEW Tillamook Module build", weekOf: "2026-06-01" },
  { id: "6060ee50", title: "Quality Page revisions (incl. Our Story rename decision)", weekOf: "2026-06-01" },
];

// 2 WIs direct child of retainer L1 — close out
const RETAINER_CLOSEOUT_WIS = {
  websiteRefresh: { id: "dc248132", title: "Website Refresh", weekOf: "2026-06-01" },
  civTiming: { id: "ad787e3f", title: "Civilization provides timing on Rewards + Happy Hour pages", weekOf: "2026-05-25" },
};

// New weekOf/dayOfWeek for the 7 close-out WIs (6 brand revisions + 1
// Website Refresh) after endDate moves to 2026-05-21 (Thursday).
const CLOSEOUT_NEW_WEEK_OF = "2026-05-18";
const CLOSEOUT_NEW_DAY_OF_WEEK = "thursday";

// Kaci WI to rename
const KACI_WI = {
  id: "2e1b3627",
  currentTitle: "Kaci illustrations integration (post-launch)",
  newTitle: "Sourcing Page: Updates",
  weekOf: "2026-06-15",
  newNotes: "Add Kaci's hand-drawn illustrations to the Sourcing page.",
};

// WI to delete (weekOf already correct — start=end=6/1-6/3 same week)
const STALE_WI = {
  id: "b55dfe15",
  title: "Website Refresh: Reward and Happy Hour pages",
  weekOf: "2026-06-01",
};

// 7 new WIs — all under retainer L1
interface NewWIConfig {
  title: string;
  startDate: string;
  endDate: string;
  weekOf: string;
  dayOfWeek: string;
  status: string;
  resources: string;
  notes: string;
}

// Prod convention: weekOf = Monday of endDate week, dayOfWeek = endDate's day
// of week (lowercase). Verified against HDL multi-day WIs in same snapshot.
const NEW_WIS: NewWIConfig[] = [
  {
    title: "Global Site Nav: Updates",
    startDate: "2026-06-02",
    endDate: "2026-06-08",
    weekOf: "2026-06-08",
    dayOfWeek: "monday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes: "Add the new social icons to the global nav (desktop + mobile hamburger menu).",
  },
  {
    title: "Homepage: Updates",
    startDate: "2026-06-09",
    endDate: "2026-06-15",
    weekOf: "2026-06-15",
    dayOfWeek: "monday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes: "Swap the homepage thumbnail image to the new branded version.",
  },
  {
    title: "Culture Page: Updates",
    startDate: "2026-06-09",
    endDate: "2026-06-15",
    weekOf: "2026-06-15",
    dayOfWeek: "monday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes: "Switch the Obsession Wanted module on the Culture page to a polaroid layout.",
  },
  {
    title: "Rewards Page: Refresh",
    startDate: "2026-06-09",
    endDate: "2026-06-26",
    weekOf: "2026-06-22",
    dayOfWeek: "friday",
    status: "scheduled",
    resources: "CD: Lane, Dev: Leslie",
    notes:
      "Apply the new brand to Rewards. Includes mobile rewards-app GIF/video for Level Up. Modules: page header, Get to the Points, Level Up, Let's Talk Perks. Update fonts/colors/CTAs.",
  },
  {
    title: "Happy Hour Page: Refresh",
    startDate: "2026-06-15",
    endDate: "2026-06-22",
    weekOf: "2026-06-22",
    dayOfWeek: "monday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes:
      "Apply the new brand to HH pages (core + ATL). Core: update fonts/colors/CTAs, simplify menu to 4 boxes, drop hashtag callout, replace tie-dye bg. ATL: fonts/colors/CTAs only.",
  },
  {
    title: "Careers Page: Refresh",
    startDate: "2026-06-15",
    endDate: "2026-07-15",
    weekOf: "2026-07-13",
    dayOfWeek: "wednesday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes:
      "Refresh the 512 module. Update fonts/colors/CTAs + cosmetic refresh of 512 module. Blog link depends on Hopdoddy's evergreen blog (pending).",
  },
  {
    title: "Locations Page: Refresh",
    startDate: "2026-06-15",
    endDate: "2026-07-15",
    weekOf: "2026-07-13",
    dayOfWeek: "wednesday",
    status: "scheduled",
    resources: "Dev: Leslie",
    notes:
      "Apply the new brand to Location pages. Update fonts/colors/CTAs. Page is a template, one update applies to all locations.",
  },
];

const WI_NEW_END_DATE = "2026-05-21";

// ── Types ────────────────────────────────────────────────

interface ResolvedState {
  client: typeof clients.$inferSelect;
  l1BrandRefresh: typeof projects.$inferSelect;
  l1Nbd: typeof projects.$inferSelect;
  l1Retainer: typeof projects.$inferSelect;
  l2Brr: typeof projects.$inferSelect;
  revisionWis: Array<typeof weekItems.$inferSelect>;
  websiteRefreshWi: typeof weekItems.$inferSelect;
  civTimingWi: typeof weekItems.$inferSelect;
  kaciWi: typeof weekItems.$inferSelect;
  staleWi: typeof weekItems.$inferSelect;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: typeof clients.$inferSelect;
  L1s: Array<typeof projects.$inferSelect>;
  L2s: Array<typeof projects.$inferSelect>;
  weekItems: Array<typeof weekItems.$inferSelect>;
}

// ── Exports ──────────────────────────────────────────────

export const description =
  "Hopdoddy Status Doc + Burndown alignment 2026-05-28: close out 5/21 launch (2 L1s + 1 L2 + 8 WIs), rename Kaci WI, delete stale Rewards+HH lump WI, create 7 new WIs under retainer L1 for June/July work.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Hopdoddy Status Doc Align (2026-05-28) ===");

  // ── Step 1 — Pre-checks + resolve ────────────────────
  const r = await preChecks(ctx);

  // ── Step 2 — Pre-write snapshot ──────────────────────
  writeSnapshot(ctx, r);

  if (ctx.dryRun) {
    ctx.log("[DRY-RUN] No writes will be performed. Operation plan follows.");
  }

  // ── Step 3 — Close out 6 brand-revision WIs ──────────
  // Per-WI order: endDate → status → dayOfWeek → weekOf (LAST — lookup key).
  ctx.log("--- Phase A: Close out 6 brand-revision WIs ---");
  for (const wi of r.revisionWis) {
    // 3a. endDate
    ctx.log(`  WI ${wi.id.slice(0, 8)} "${wi.title}" endDate: ${wi.endDate} → ${WI_NEW_END_DATE}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: wi.weekOf!,
        weekItemTitle: wi.title,
        field: "endDate",
        newValue: WI_NEW_END_DATE,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${wi.id.slice(0, 8)} endDate update failed: ${res.error}`);
    }
    // 3b. status
    ctx.log(`  WI ${wi.id.slice(0, 8)} status: ${wi.status} → completed`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: wi.weekOf!,
        weekItemTitle: wi.title,
        field: "status",
        newValue: "completed",
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${wi.id.slice(0, 8)} status update failed: ${res.error}`);
    }
    // 3c. dayOfWeek (re-anchor to new endDate)
    ctx.log(`  WI ${wi.id.slice(0, 8)} dayOfWeek: ${wi.dayOfWeek} → ${CLOSEOUT_NEW_DAY_OF_WEEK}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: wi.weekOf!,
        weekItemTitle: wi.title,
        field: "dayOfWeek",
        newValue: CLOSEOUT_NEW_DAY_OF_WEEK,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${wi.id.slice(0, 8)} dayOfWeek update failed: ${res.error}`);
    }
    // 3d. weekOf — LAST (lookup key)
    ctx.log(`  WI ${wi.id.slice(0, 8)} weekOf: ${wi.weekOf} → ${CLOSEOUT_NEW_WEEK_OF}`);
    if (!ctx.dryRun) {
      const res = await updateWeekItemField({
        weekOf: wi.weekOf!,
        weekItemTitle: wi.title,
        field: "weekOf",
        newValue: CLOSEOUT_NEW_WEEK_OF,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`WI ${wi.id.slice(0, 8)} weekOf update failed: ${res.error}`);
    }
  }

  // ── Step 4 — Close out "Website Refresh" (dc248132) ──
  ctx.log("--- Phase A: Close out WI Website Refresh (dc248132) ---");
  ctx.log(
    `  WI ${r.websiteRefreshWi.id.slice(0, 8)} endDate: ${r.websiteRefreshWi.endDate} → ${WI_NEW_END_DATE}`,
  );
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: r.websiteRefreshWi.weekOf!,
      weekItemTitle: r.websiteRefreshWi.title,
      field: "endDate",
      newValue: WI_NEW_END_DATE,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Website Refresh endDate update failed: ${res.error}`);
  }
  ctx.log(`  WI ${r.websiteRefreshWi.id.slice(0, 8)} status: ${r.websiteRefreshWi.status} → completed`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: r.websiteRefreshWi.weekOf!,
      weekItemTitle: r.websiteRefreshWi.title,
      field: "status",
      newValue: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Website Refresh status update failed: ${res.error}`);
  }
  ctx.log(`  WI ${r.websiteRefreshWi.id.slice(0, 8)} dayOfWeek: ${r.websiteRefreshWi.dayOfWeek} → ${CLOSEOUT_NEW_DAY_OF_WEEK}`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: r.websiteRefreshWi.weekOf!,
      weekItemTitle: r.websiteRefreshWi.title,
      field: "dayOfWeek",
      newValue: CLOSEOUT_NEW_DAY_OF_WEEK,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Website Refresh dayOfWeek update failed: ${res.error}`);
  }
  ctx.log(`  WI ${r.websiteRefreshWi.id.slice(0, 8)} weekOf: ${r.websiteRefreshWi.weekOf} → ${CLOSEOUT_NEW_WEEK_OF}`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: r.websiteRefreshWi.weekOf!,
      weekItemTitle: r.websiteRefreshWi.title,
      field: "weekOf",
      newValue: CLOSEOUT_NEW_WEEK_OF,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Website Refresh weekOf update failed: ${res.error}`);
  }

  // ── Step 5 — Close out "Civilization provides timing" ─
  ctx.log("--- Phase A: Close out WI Civilization provides timing (ad787e3f) ---");
  ctx.log(`  WI ${r.civTimingWi.id.slice(0, 8)} status: ${r.civTimingWi.status} → completed`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: r.civTimingWi.weekOf!,
      weekItemTitle: r.civTimingWi.title,
      field: "status",
      newValue: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Civ timing status update failed: ${res.error}`);
  }

  // ── Step 6 — L2 + L1 close-out (category FIRST, then status) ──
  ctx.log("--- Phase A: L2 + L1 close-out (category before status, compat-safe) ---");

  // L2 Brand Refresh Revisions
  ctx.log(`  L2 ${r.l2Brr.id.slice(0, 8)} "${L2_BRR_NAME}" category: ${r.l2Brr.category} → completed`);
  if (!ctx.dryRun) {
    const res = await updateProjectField({
      clientSlug: HOPDODDY_SLUG,
      projectName: L2_BRR_NAME,
      field: "category",
      newValue: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L2 BRR category update failed: ${res.error}`);
  }
  ctx.log(`  L2 ${r.l2Brr.id.slice(0, 8)} status: ${r.l2Brr.status} → completed`);
  if (!ctx.dryRun) {
    const res = await updateProjectStatus({
      clientSlug: HOPDODDY_SLUG,
      projectName: L2_BRR_NAME,
      newStatus: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L2 BRR status update failed: ${res.error}`);
  }

  // L1 Brand Refresh Website
  ctx.log(
    `  L1 ${r.l1BrandRefresh.id.slice(0, 8)} "${L1_BRAND_REFRESH_WEBSITE_NAME}" category: ${r.l1BrandRefresh.category} → completed`,
  );
  if (!ctx.dryRun) {
    const res = await updateProjectField({
      clientSlug: HOPDODDY_SLUG,
      projectName: L1_BRAND_REFRESH_WEBSITE_NAME,
      field: "category",
      newValue: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L1 BR Website category update failed: ${res.error}`);
  }
  ctx.log(`  L1 ${r.l1BrandRefresh.id.slice(0, 8)} status: ${r.l1BrandRefresh.status} → completed`);
  if (!ctx.dryRun) {
    const res = await updateProjectStatus({
      clientSlug: HOPDODDY_SLUG,
      projectName: L1_BRAND_REFRESH_WEBSITE_NAME,
      newStatus: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L1 BR Website status update failed: ${res.error}`);
  }

  // L1 National Burger Day LP
  ctx.log(`  L1 ${r.l1Nbd.id.slice(0, 8)} "${L1_NBD_LP_NAME}" category: ${r.l1Nbd.category} → completed`);
  if (!ctx.dryRun) {
    const res = await updateProjectField({
      clientSlug: HOPDODDY_SLUG,
      projectName: L1_NBD_LP_NAME,
      field: "category",
      newValue: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L1 NBD category update failed: ${res.error}`);
  }
  ctx.log(`  L1 ${r.l1Nbd.id.slice(0, 8)} status: ${r.l1Nbd.status} → completed`);
  if (!ctx.dryRun) {
    const res = await updateProjectStatus({
      clientSlug: HOPDODDY_SLUG,
      projectName: L1_NBD_LP_NAME,
      newStatus: "completed",
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`L1 NBD status update failed: ${res.error}`);
  }

  // ── Step 7 — recomputeProjectDates ────────────────────
  ctx.log("--- Phase A: recomputeProjectDates on closed L1 + L2 ---");
  for (const p of [r.l2Brr, r.l1BrandRefresh, r.l1Nbd]) {
    ctx.log(`  recompute ${p.id.slice(0, 8)} ("${p.name}")`);
    if (!ctx.dryRun) {
      const derived = await recomputeProjectDates(p.id);
      ctx.log(
        `    derived: startDate=${derived?.startDate ?? "null"}, endDate=${derived?.endDate ?? "null"}`,
      );
    }
  }

  // ── Step 8 — Kaci rename (notes first, title LAST) ────
  ctx.log("--- Phase B: Kaci WI rename ---");
  ctx.log(`  WI ${KACI_WI.id} notes → "${KACI_WI.newNotes}"`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: KACI_WI.weekOf,
      weekItemTitle: KACI_WI.currentTitle,
      field: "notes",
      newValue: KACI_WI.newNotes,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Kaci notes update failed: ${res.error}`);
  }
  ctx.log(`  WI ${KACI_WI.id} title: "${KACI_WI.currentTitle}" → "${KACI_WI.newTitle}"`);
  if (!ctx.dryRun) {
    const res = await updateWeekItemField({
      weekOf: KACI_WI.weekOf,
      weekItemTitle: KACI_WI.currentTitle,
      field: "title",
      newValue: KACI_WI.newTitle,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Kaci title update failed: ${res.error}`);
  }

  // ── Step 9 — Delete stale WI by id ────────────────────
  ctx.log("--- Phase C: Delete stale WI b55dfe15 ---");
  ctx.log(`  delete WI ${STALE_WI.id} "${STALE_WI.title}"`);
  if (!ctx.dryRun) {
    const res = await deleteWeekItem({
      id: r.staleWi.id,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) throw new Error(`Delete stale WI failed: ${res.error}`);
  }

  // ── Step 10 — Create 7 new WIs ────────────────────────
  ctx.log("--- Phase D: Create 7 new WIs under retainer L1 ---");
  for (const wi of NEW_WIS) {
    ctx.log(
      `  create "${wi.title}" ${wi.startDate}→${wi.endDate} (${wi.dayOfWeek}, weekOf ${wi.weekOf}, status=${wi.status}, resources="${wi.resources}")`,
    );
    if (!ctx.dryRun) {
      const res = await createWeekItem({
        clientSlug: HOPDODDY_SLUG,
        projectName: L1_RETAINER_NAME,
        weekOf: wi.weekOf,
        dayOfWeek: wi.dayOfWeek,
        date: wi.startDate,
        startDate: wi.startDate,
        endDate: wi.endDate,
        title: wi.title,
        status: wi.status,
        category: "delivery",
        owner: "Jason",
        resources: wi.resources,
        notes: wi.notes,
        updatedBy: UPDATED_BY,
      });
      if (!res.ok) throw new Error(`Create WI "${wi.title}" failed: ${res.error}`);
    }
  }

  // ── Step 11 — Verification ────────────────────────────
  if (!ctx.dryRun) {
    await verify(ctx);
  }

  ctx.log("=== Hopdoddy Status Doc Align complete ===");
}

// ── Pre-checks ────────────────────────────────────────────

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Client
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, HOPDODDY_SLUG));
  const client = clientRows[0];
  if (!client) throw new Error(`Pre-check failed: client '${HOPDODDY_SLUG}' not found.`);
  ctx.log(`Client: ${client.name} (${client.id})`);

  // L1s
  const projectRows = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  const l1BrandRefresh = projectRows.find((p) => p.id === L1_BRAND_REFRESH_WEBSITE_ID);
  const l1Nbd = projectRows.find((p) => p.id === L1_NBD_LP_ID);
  const l1Retainer = projectRows.find((p) => p.id === L1_RETAINER_ID);
  const l2Brr = projectRows.find((p) => p.id === L2_BRR_ID);
  if (!l1BrandRefresh) throw new Error(`Pre-check failed: L1 Brand Refresh Website (${L1_BRAND_REFRESH_WEBSITE_ID.slice(0, 8)}) not found.`);
  if (!l1Nbd) throw new Error(`Pre-check failed: L1 NBD LP (${L1_NBD_LP_ID.slice(0, 8)}) not found.`);
  if (!l1Retainer) throw new Error(`Pre-check failed: L1 Retainer (${L1_RETAINER_ID.slice(0, 8)}) not found.`);
  if (!l2Brr) throw new Error(`Pre-check failed: L2 BRR (${L2_BRR_ID.slice(0, 8)}) not found.`);

  // Expected pre-state on each
  for (const [label, p, expectedStatus] of [
    ["L1 BR Website", l1BrandRefresh, "in-production"] as const,
    ["L1 NBD LP", l1Nbd, "in-production"] as const,
    ["L2 BRR", l2Brr, "in-production"] as const,
  ]) {
    if (p.status !== expectedStatus) {
      throw new Error(`Pre-check failed: ${label} status="${p.status}", expected "${expectedStatus}". Drift — abort.`);
    }
    if (p.category !== "active") {
      throw new Error(`Pre-check failed: ${label} category="${p.category}", expected "active". Drift — abort.`);
    }
  }
  ctx.log(`L1/L2 status+category pre-state OK.`);

  // WIs
  const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));
  const findWi = (id: string) => allWis.find((w) => w.id === id);

  const revisionWis = REVISION_WIS.map((expected) => {
    const wi = allWis.find((w) => w.id.startsWith(expected.id));
    if (!wi) throw new Error(`Pre-check failed: brand-revision WI ${expected.id} ("${expected.title}") not found.`);
    if (wi.title !== expected.title) {
      throw new Error(`Pre-check failed: WI ${expected.id} title="${wi.title}", expected "${expected.title}".`);
    }
    if (wi.weekOf !== expected.weekOf) {
      throw new Error(`Pre-check failed: WI ${expected.id} weekOf="${wi.weekOf}", expected "${expected.weekOf}".`);
    }
    if (wi.status !== "in-progress") {
      throw new Error(`Pre-check failed: WI ${expected.id} status="${wi.status}", expected "in-progress".`);
    }
    if (wi.endDate !== "2026-06-05") {
      throw new Error(`Pre-check failed: WI ${expected.id} endDate="${wi.endDate}", expected "2026-06-05".`);
    }
    return wi;
  });

  const websiteRefreshWi = allWis.find((w) => w.id.startsWith(RETAINER_CLOSEOUT_WIS.websiteRefresh.id) && w.title === RETAINER_CLOSEOUT_WIS.websiteRefresh.title && w.weekOf === RETAINER_CLOSEOUT_WIS.websiteRefresh.weekOf);
  if (!websiteRefreshWi) throw new Error(`Pre-check failed: Website Refresh WI (${RETAINER_CLOSEOUT_WIS.websiteRefresh.id}) not found.`);
  if (websiteRefreshWi.status !== "in-progress") {
    throw new Error(`Pre-check failed: Website Refresh WI status="${websiteRefreshWi.status}", expected "in-progress".`);
  }

  const civTimingWi = allWis.find((w) => w.id.startsWith(RETAINER_CLOSEOUT_WIS.civTiming.id));
  if (!civTimingWi) throw new Error(`Pre-check failed: Civ timing WI (${RETAINER_CLOSEOUT_WIS.civTiming.id}) not found.`);
  if (civTimingWi.status !== "in-progress") {
    throw new Error(`Pre-check failed: Civ timing WI status="${civTimingWi.status}", expected "in-progress".`);
  }

  const kaciWi = allWis.find((w) => w.id.startsWith(KACI_WI.id));
  if (!kaciWi) throw new Error(`Pre-check failed: Kaci WI (${KACI_WI.id}) not found.`);
  if (kaciWi.title !== KACI_WI.currentTitle) {
    throw new Error(`Pre-check failed: Kaci WI title="${kaciWi.title}", expected "${KACI_WI.currentTitle}".`);
  }

  const staleWi = allWis.find((w) => w.id.startsWith(STALE_WI.id));
  if (!staleWi) throw new Error(`Pre-check failed: stale WI (${STALE_WI.id}) not found — already deleted?`);

  // Confirm none of the 7 new WI titles already exist (avoid duplicate create)
  for (const wi of NEW_WIS) {
    const dup = allWis.find((w) => w.title === wi.title && w.projectId === L1_RETAINER_ID);
    if (dup) {
      throw new Error(`Pre-check failed: a WI titled "${wi.title}" already exists under retainer (${dup.id.slice(0, 8)}). Duplicate — abort.`);
    }
  }

  ctx.log(
    `Pre-checks passed: 4 projects + ${revisionWis.length + 2 + 1 + 1} WIs resolved, no naming collisions for 7 new WIs.`,
  );

  return {
    client,
    l1BrandRefresh,
    l1Nbd,
    l1Retainer,
    l2Brr,
    revisionWis,
    websiteRefreshWi,
    civTimingWi,
    kaciWi,
    staleWi,
  };
}

// ── Snapshot ──────────────────────────────────────────────

function writeSnapshot(ctx: MigrationContext, r: ResolvedState): void {
  const allWis = [
    ...r.revisionWis,
    r.websiteRefreshWi,
    r.civTimingWi,
    r.kaciWi,
    r.staleWi,
  ];
  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.client,
    L1s: [r.l1BrandRefresh, r.l1Nbd, r.l1Retainer],
    L2s: [r.l2Brr],
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

  const clientRows = await ctx.db.select().from(clients).where(eq(clients.slug, HOPDODDY_SLUG));
  const client = clientRows[0];

  // L1/L2 status+category
  const projectRows = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
  for (const [label, id] of [
    ["L1 BR Website", L1_BRAND_REFRESH_WEBSITE_ID] as const,
    ["L1 NBD LP", L1_NBD_LP_ID] as const,
    ["L2 BRR", L2_BRR_ID] as const,
  ]) {
    const p = projectRows.find((x) => x.id === id);
    if (!p) throw new Error(`Verify: ${label} disappeared.`);
    if (p.status !== "completed" || p.category !== "completed") {
      throw new Error(`Verify: ${label} status="${p.status}", category="${p.category}" (expected completed/completed).`);
    }
    ctx.log(`  ✓ ${label} completed/completed (endDate=${p.endDate})`);
  }

  // WIs — brand revisions + 2 retainer-direct
  const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));
  for (const expected of REVISION_WIS) {
    const wi = allWis.find((w) => w.id.startsWith(expected.id));
    if (!wi) throw new Error(`Verify: WI ${expected.id} missing.`);
    if (wi.status !== "completed" || wi.endDate !== WI_NEW_END_DATE) {
      throw new Error(`Verify: WI ${expected.id} status="${wi.status}" endDate="${wi.endDate}" (expected completed / ${WI_NEW_END_DATE}).`);
    }
    if (wi.weekOf !== CLOSEOUT_NEW_WEEK_OF || wi.dayOfWeek !== CLOSEOUT_NEW_DAY_OF_WEEK) {
      throw new Error(`Verify: WI ${expected.id} weekOf="${wi.weekOf}" dayOfWeek="${wi.dayOfWeek}" (expected ${CLOSEOUT_NEW_WEEK_OF}/${CLOSEOUT_NEW_DAY_OF_WEEK}).`);
    }
  }
  ctx.log(`  ✓ 6 brand-revision WIs completed @ ${WI_NEW_END_DATE} (weekOf=${CLOSEOUT_NEW_WEEK_OF})`);

  const wr = allWis.find((w) => w.id.startsWith(RETAINER_CLOSEOUT_WIS.websiteRefresh.id));
  if (!wr || wr.status !== "completed" || wr.endDate !== WI_NEW_END_DATE) {
    throw new Error(`Verify: Website Refresh WI not closed correctly.`);
  }
  if (wr.weekOf !== CLOSEOUT_NEW_WEEK_OF || wr.dayOfWeek !== CLOSEOUT_NEW_DAY_OF_WEEK) {
    throw new Error(`Verify: Website Refresh WI weekOf="${wr.weekOf}" dayOfWeek="${wr.dayOfWeek}".`);
  }
  ctx.log(`  ✓ Website Refresh WI completed @ ${WI_NEW_END_DATE} (weekOf=${CLOSEOUT_NEW_WEEK_OF})`);

  const ct = allWis.find((w) => w.id.startsWith(RETAINER_CLOSEOUT_WIS.civTiming.id));
  if (!ct || ct.status !== "completed") {
    throw new Error(`Verify: Civ timing WI not closed.`);
  }
  ctx.log(`  ✓ Civilization provides timing WI completed`);

  // Kaci rename
  const kaci = allWis.find((w) => w.id.startsWith(KACI_WI.id));
  if (!kaci) throw new Error(`Verify: Kaci WI disappeared.`);
  if (kaci.title !== KACI_WI.newTitle) {
    throw new Error(`Verify: Kaci WI title="${kaci.title}", expected "${KACI_WI.newTitle}".`);
  }
  if (kaci.notes !== KACI_WI.newNotes) {
    throw new Error(`Verify: Kaci WI notes did not update.`);
  }
  ctx.log(`  ✓ Kaci WI renamed to "${KACI_WI.newTitle}"`);

  // Stale deleted
  const stale = allWis.find((w) => w.id.startsWith(STALE_WI.id));
  if (stale) throw new Error(`Verify: stale WI ${STALE_WI.id} still present.`);
  ctx.log(`  ✓ Stale WI ${STALE_WI.id} deleted`);

  // 7 new WIs present
  for (const wi of NEW_WIS) {
    const found = allWis.find(
      (w) => w.title === wi.title && w.projectId === L1_RETAINER_ID,
    );
    if (!found) throw new Error(`Verify: new WI "${wi.title}" not found.`);
    if (found.startDate !== wi.startDate || found.endDate !== wi.endDate) {
      throw new Error(`Verify: new WI "${wi.title}" dates wrong (got ${found.startDate}→${found.endDate}, expected ${wi.startDate}→${wi.endDate}).`);
    }
    if (found.status !== wi.status) {
      throw new Error(`Verify: new WI "${wi.title}" status="${found.status}", expected "${wi.status}".`);
    }
  }
  ctx.log(`  ✓ 7 new WIs created under retainer L1`);

  ctx.log("Verification passed.");
}
