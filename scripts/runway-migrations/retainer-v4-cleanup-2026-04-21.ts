/**
 * Migration: Retainer + v4 Cleanup - 2026-04-21
 *
 * 35 discrete data changes across 7 clients (Convergix, Asprey, Hopdoddy,
 * Soundly, LPPC, TAP, HDL) aligning prod Turso with the v4 convention
 * locked in PR #86. See docs/tmp/retainer-v4-cleanup-migration-spec.md
 * for the authoritative change list (sections A-D).
 *
 * Sections:
 *   A  (5 ops)  - Retainer tier classification
 *                 A.1  Convergix 15 L1s -> retainer + contract dates (45 writes)
 *                 A.2  Asprey Social Retainer - Wind Down -> contract_start
 *                 A.3  Hopdoddy Digital Retainer -> retainer + dates + owner
 *                 A.4  Hopdoddy Brand Refresh Website -> owner/resources/engagementType
 *                 A.5  Soundly Payment Gateway -> flip to project (engagement_type,
 *                      contract_end=null, end_date overwrite)
 *   B  (12 ops) - Convergix polish
 *                 B.1-B.4 L1 end_date + waitingOn
 *                 B.5-B.10 6 null-status L2 fixes
 *                 B.11-B.12 2 multi-day L2 endDates
 *   C  (2 ops)  - Soundly AARP dates + Asprey retainer L2 endDate
 *   D  (16 ops) - LPPC Slack-alignment + in-flight past-end fixes
 *                 D.1-D.2 R3 Design Review endDate + Map Client Clarity Ping status
 *                 D.3-D.5 3 new LPPC L2s
 *                 D.6 Website Revamp L1 notes APPEND
 *                 D.7-D.12 6 LPPC L2 status -> NULL (un-blanket-block)
 *                 D.13 LPPC Development Kickoff end_date + resources
 *                 D.14-D.16 TAP/HDL/Soundly in-flight past-end fixes
 *
 * Safety:
 *   - Pre-state assertions abort with clear error on drift. Doubles as
 *     idempotency guard - 2nd run fails because data moved.
 *   - Trust-preservation check: rows with updatedAt > 2026-04-21T14:00:00Z
 *     are Kathy's touches; only the spec-enumerated ones pass.
 *   - Full-column pre-apply snapshot written before any writes.
 *   - CREATE ids written to sidecar SYNCHRONOUSLY after each create so a
 *     crash mid-batch still leaves the revert able to DELETE every created row.
 *
 * Atomicity:
 *   - Per-call atomicity is provided by the writes-layer helpers (each wraps
 *     its writes in db.transaction). Cross-call atomicity across 35 ops is
 *     NOT achievable via the helper surface; the snapshot + REVERT script is
 *     the authoritative safety net for crash recovery.
 *
 * Entrypoints:
 *   - `DRY_RUN=1 npx tsx scripts/runway-migrations/retainer-v4-cleanup-2026-04-21.ts`
 *   - `npx tsx scripts/runway-migrations/retainer-v4-cleanup-2026-04-21.ts`  (applies)
 *   - `pnpm runway:migrate scripts/runway-migrations/retainer-v4-cleanup-2026-04-21.ts [--apply]`
 *
 * Null writes use the extended writes-layer helpers shipped in the prior
 * commit (updateProjectField / updateWeekItemField now accept newValue: null).
 *
 * Revert: scripts/runway-migrations/retainer-v4-cleanup-2026-04-21-REVERT.ts
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient as createLibsqlClient } from "@libsql/client";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";
import {
  createWeekItem,
  findWeekItemByFuzzyTitle,
  generateIdempotencyKey,
  getClientOrFail,
  insertAuditRecord,
  PROJECT_FIELDS,
  setBatchId,
  updateProjectField,
  updateWeekItemField,
  WEEK_ITEM_FIELDS,
} from "@/lib/runway/operations";
import { runIfDirect } from "../lib/run-script";

// =====================================================================
// Constants
// =====================================================================

const BATCH_ID = "retainer-v4-cleanup-2026-04-21-retry";
const UPDATED_BY = "migration-retry";
const DEFAULT_SNAPSHOT_PATH = "docs/tmp/retainer-v4-cleanup-pre-apply-snapshot.json";
const DEFAULT_CREATED_IDS_PATH = "docs/tmp/retainer-v4-cleanup-created-ids.json";
// Raised from 14:00Z to 22:00Z on 2026-04-21 after a partial-apply-then-revert
// cycle. The revert stamped 37 rows with updatedAt ≈ 21:20Z (all migration-touched
// rows, legitimate revert drift — not human edits). TP ran an audit-log sweep at
// ~21:50Z confirming the only human touches since 14:00Z were Kathy's 14:04 LPPC
// edits, which remain in EXPECTED_KATHY_TOUCHES. New threshold still fires on
// any genuine post-threshold human edit that isn't in the expected set.
const TRUST_PRESERVATION_THRESHOLD_MS = Date.parse("2026-04-21T22:00:00Z");

/** Ids of rows Kathy touched at 2026-04-21T14:04:*Z whose drift is expected
 *  per spec's trust-preservation rules. Keyed by "client:entity:title" for
 *  readability in error messages. Populated in-place at runtime. */
type KathyTouchKey =
  | "lppc:project:Interactive Map"
  | "lppc:project:Website Revamp"
  | "lppc:weekItem:R3 Design Review"
  | "lppc:weekItem:Map Client Clarity Ping";

const EXPECTED_KATHY_TOUCHES: Set<KathyTouchKey> = new Set([
  "lppc:project:Interactive Map",
  "lppc:project:Website Revamp",
  "lppc:weekItem:R3 Design Review",
  "lppc:weekItem:Map Client Clarity Ping",
]);

// =====================================================================
// Plan data (sections A-D)
// =====================================================================

// ---- Section A.1: Convergix 15 L1s -> retainer ----------------------
const CONVERGIX_L1_NAMES = [
  "New Capacity (PPT, brochure, one-pager)",
  "Fanuc Award Article + LI Post",
  "Events Page Updates (5 tradeshows)",
  "Rockwell PartnerNetwork Article",
  "Texas Instruments Article",
  "Social Content (12 posts/mo)",
  "Brand Guide v2 (secondary palette)",
  "Certifications Page",
  "Industry Vertical Campaigns",
  "Life Sciences Brochure",
  "Social Media Templates",
  "Organic Social Playbook",
  "Corporate Collateral Updates",
  "Big Win Template",
  "Rockwell Automation Co-Marketing Efforts",
] as const;

// ---- L1 field-update plans -----------------------------------------
interface L1FieldPlan {
  specId: string;
  clientSlug: string;
  projectName: string;
  field: string;
  newValue: string | null;
  pre: string | null;
}

// Section A misc (A.2-A.5) + Section B (B.1-B.4) + Section C (C.1)
export const L1_FIELD_PLANS: L1FieldPlan[] = [
  // A.2 - Asprey Social Retainer - Wind Down
  { specId: "A.2", clientSlug: "dave-asprey", projectName: "Social Retainer — Wind Down", field: "contractStart", newValue: "2025-11-14", pre: null },

  // A.3 - Hopdoddy Digital Retainer (195 hrs)
  { specId: "A.3", clientSlug: "hopdoddy", projectName: "Digital Retainer (195 hrs)", field: "engagementType", newValue: "retainer", pre: null },
  { specId: "A.3", clientSlug: "hopdoddy", projectName: "Digital Retainer (195 hrs)", field: "contractStart", newValue: "2026-01-01", pre: null },
  { specId: "A.3", clientSlug: "hopdoddy", projectName: "Digital Retainer (195 hrs)", field: "contractEnd", newValue: "2026-12-31", pre: null },
  { specId: "A.3", clientSlug: "hopdoddy", projectName: "Digital Retainer (195 hrs)", field: "owner", newValue: "Jill", pre: null },

  // A.4 - Hopdoddy Brand Refresh Website
  { specId: "A.4", clientSlug: "hopdoddy", projectName: "Brand Refresh Website", field: "owner", newValue: "Jill", pre: "Leslie" },
  { specId: "A.4", clientSlug: "hopdoddy", projectName: "Brand Refresh Website", field: "resources", newValue: "AM: Jill, CD: Lane, Dev: Leslie", pre: null },
  { specId: "A.4", clientSlug: "hopdoddy", projectName: "Brand Refresh Website", field: "engagementType", newValue: "project", pre: null },

  // A.5 - Soundly Payment Gateway Page - flip back to project
  //   pre-check accepts engagement_type='retainer' + contract_end='2026-05-31' (sanity-pass-validated).
  //   end_date pre may be '2026-04-23' per sanity pass; we overwrite to the correct project deadline.
  { specId: "A.5", clientSlug: "soundly", projectName: "Payment Gateway Page", field: "engagementType", newValue: "project", pre: "retainer" },
  { specId: "A.5", clientSlug: "soundly", projectName: "Payment Gateway Page", field: "contractEnd", newValue: null, pre: "2026-05-31" },
  // A.5 end_date: special-cased - accepts either pre='2026-04-23' (sanity pass) or pre=null.
  // Encoded as a dedicated entry with sentinel pre; handled specially below.
  { specId: "A.5", clientSlug: "soundly", projectName: "Payment Gateway Page", field: "endDate", newValue: "2026-05-31", pre: "__A5_END_DATE_SENTINEL__" },

  // B.1 - Convergix Events Page Updates (5 tradeshows) end_date
  { specId: "B.1", clientSlug: "convergix", projectName: "Events Page Updates (5 tradeshows)", field: "endDate", newValue: "2026-11-30", pre: "2026-05-04" },

  // B.2 - Convergix Corporate Collateral Updates end_date
  { specId: "B.2", clientSlug: "convergix", projectName: "Corporate Collateral Updates", field: "endDate", newValue: "2026-06-30", pre: "2026-04-30" },

  // B.3 - Convergix Industry Vertical Campaigns end_date + waitingOn
  { specId: "B.3", clientSlug: "convergix", projectName: "Industry Vertical Campaigns", field: "endDate", newValue: "2026-07-31", pre: "2026-04-30" },
  { specId: "B.3", clientSlug: "convergix", projectName: "Industry Vertical Campaigns", field: "waitingOn", newValue: "Jared, Bob", pre: null },

  // B.4 - Convergix Brand Guide v2 (secondary palette) waitingOn
  { specId: "B.4", clientSlug: "convergix", projectName: "Brand Guide v2 (secondary palette)", field: "waitingOn", newValue: "JJ", pre: null },

  // C.1 - Soundly AARP Member Login + Landing Page dates
  { specId: "C.1", clientSlug: "soundly", projectName: "AARP Member Login + Landing Page", field: "startDate", newValue: "2026-04-17", pre: null },
  { specId: "C.1", clientSlug: "soundly", projectName: "AARP Member Login + Landing Page", field: "endDate", newValue: "2026-07-15", pre: null },
];

// ---- L2 field-update plans -----------------------------------------
interface L2FieldPlan {
  specId: string;
  clientSlug: string;
  /** Exact L2 title; resolved at runtime to get weekOf for helper lookup. */
  title: string;
  field: string;
  newValue: string | null;
  pre: string | null;
  /** Optional parent L1 name - used in duplicate create checks and for error context. */
  parentName?: string;
}

export const L2_FIELD_PLANS: L2FieldPlan[] = [
  // Section B L2 ops
  { specId: "B.5", clientSlug: "convergix", title: "Events Page — 2026 Updates Live", field: "status", newValue: "in-progress", pre: null },
  { specId: "B.5", clientSlug: "convergix", title: "Events Page — 2026 Updates Live", field: "endDate", newValue: "2026-04-23", pre: null },
  { specId: "B.6", clientSlug: "convergix", title: "April Social — Week of 4/20 Posts (4 posts)", field: "status", newValue: "in-progress", pre: null },
  { specId: "B.6", clientSlug: "convergix", title: "April Social — Week of 4/20 Posts (4 posts)", field: "endDate", newValue: "2026-04-27", pre: null },
  { specId: "B.7", clientSlug: "convergix", title: "Rockwell Partner Award — Image Swap", field: "status", newValue: "blocked", pre: null },
  { specId: "B.8", clientSlug: "convergix", title: "Rockwell Partner Award — Social Post", field: "status", newValue: "blocked", pre: null },
  { specId: "B.9", clientSlug: "convergix", title: "Texas Instruments Award — Page Build", field: "status", newValue: "blocked", pre: null },
  { specId: "B.10", clientSlug: "convergix", title: "Texas Instruments Award — Social Post", field: "status", newValue: "blocked", pre: null },
  { specId: "B.11", clientSlug: "convergix", title: "CDS Creative Wrapper", field: "endDate", newValue: "2026-05-07", pre: null },
  { specId: "B.12", clientSlug: "convergix", title: "AIST tradeshow", field: "endDate", newValue: "2026-05-07", pre: null },

  // C.2 - Asprey Daily Social Posts + ManyChat Retainer endDate
  { specId: "C.2", clientSlug: "dave-asprey", title: "Daily Social Posts + ManyChat — Retainer (through 4/30)", field: "endDate", newValue: "2026-04-30", pre: null },

  // D.1 - LPPC R3 Design Review endDate
  { specId: "D.1", clientSlug: "lppc", title: "R3 Design Review", field: "endDate", newValue: "2026-04-22", pre: null },

  // D.2 - LPPC Map Client Clarity Ping status
  { specId: "D.2", clientSlug: "lppc", title: "Map Client Clarity Ping", field: "status", newValue: "completed", pre: "blocked" },

  // D.7-D.11 - LPPC Website Revamp blanket-blocked L2s -> NULL
  { specId: "D.7", clientSlug: "lppc", title: "Pencils Down + Images Due", field: "status", newValue: null, pre: "blocked" },
  { specId: "D.8", clientSlug: "lppc", title: "Staging Links Due", field: "status", newValue: null, pre: "blocked" },
  { specId: "D.9", clientSlug: "lppc", title: "LPPC Staging Feedback Due", field: "status", newValue: null, pre: "blocked" },
  { specId: "D.10", clientSlug: "lppc", title: "QA Phase", field: "status", newValue: null, pre: "blocked" },
  { specId: "D.11", clientSlug: "lppc", title: "Website Launch", field: "status", newValue: null, pre: "blocked" },

  // D.12 - LPPC Interactive Map Launch -> NULL
  { specId: "D.12", clientSlug: "lppc", title: "Interactive Map Launch", field: "status", newValue: null, pre: "blocked" },

  // D.13 - LPPC Development Kickoff - add endDate + resources
  { specId: "D.13", clientSlug: "lppc", title: "Development Kickoff", field: "endDate", newValue: "2026-04-23", pre: null },
  { specId: "D.13", clientSlug: "lppc", title: "Development Kickoff", field: "resources", newValue: "AM: Kathy, Dev: Leslie", pre: "Dev: Leslie" },

  // D.14 - TAP ERP Rebuild - Development endDate
  { specId: "D.14", clientSlug: "tap", title: "ERP Rebuild — Development", field: "endDate", newValue: "2026-08-15", pre: null },

  // D.15 - HDL Full Site Design - Civ Delivers endDate
  { specId: "D.15", clientSlug: "hdl", title: "Full Site Design — Civ Delivers", field: "endDate", newValue: "2026-04-24", pre: null },

  // D.16 - Soundly Payment Gateway Page - In Dev endDate
  { specId: "D.16", clientSlug: "soundly", title: "Payment Gateway Page — In Dev", field: "endDate", newValue: "2026-05-31", pre: null },
];

// ---- L2 creates (D.3, D.4, D.5) ------------------------------------
interface L2CreatePlan {
  specId: string;
  clientSlug: string;
  projectName: string;
  title: string;
  /** `date` is passed to createWeekItem (mirrored into start_date); dayOfWeek derived. */
  date: string;
  dayOfWeek: string;
  /** Set later via updateWeekItemField if non-null. createWeekItem doesn't accept endDate. */
  endDate: string | null;
  status: string | null;
  category: string;
  owner: string;
  notes: string;
}

const L2_CREATE_PLANS: L2CreatePlan[] = [
  {
    specId: "D.3",
    clientSlug: "lppc",
    projectName: "Interactive Map",
    title: "Interactive Map — Dev Revisions",
    date: "2026-04-22",
    dayOfWeek: "wednesday",
    endDate: "2026-04-24",
    status: null,
    category: "delivery",
    owner: "Leslie",
    notes:
      "Dev revisions after client clarity resolved 4/21. Deliver by 4/24 for Kathy to present. QA window 4/21-4/23, launch 4/27.",
  },
  {
    specId: "D.4",
    clientSlug: "lppc",
    projectName: "Interactive Map",
    title: "Present Revised Map",
    date: "2026-04-24",
    dayOfWeek: "friday",
    endDate: null,
    status: null,
    category: "delivery",
    owner: "Kathy",
    notes:
      "Present revised Interactive Map to LPPC. Follows Leslie's dev revisions completing 4/24. Then launch 4/27.",
  },
  {
    specId: "D.5",
    clientSlug: "lppc",
    projectName: "Website Revamp",
    title: "Policy Materials Import (LPPC)",
    date: "2026-04-27",
    dayOfWeek: "monday",
    endDate: null,
    status: "blocked",
    category: "kickoff",
    owner: "Kathy",
    notes:
      "Matt organizing policy materials for tagging in CMS - will import into Advocacy collection. Upstream of Advocacy page launch. Per Kathy 4/17. Waiting on: Matt (LPPC).",
  },
];

// ---- D.6: LPPC Website Revamp L1 notes APPEND ----------------------
const D6_APPEND_TEXT =
  " Pending from LPPC: Bill collecting member photo/video contributions - no timeline yet (per Kathy 4/17 Slack).";

// =====================================================================
// Pre-writes field-name validator
// =====================================================================

// L1 endDate/startDate are v4-derived columns excluded from PROJECT_FIELDS.
// applyL1FieldWrite handles them via raw-drizzle, so the validator exempts
// them. Any other field name must be in the helper whitelist.
const L1_RAW_DRIZZLE_FIELDS = new Set(["endDate", "startDate"]);

/** Throws if any plan references a field not in the helper whitelist.
 *  Runs in both DRY_RUN and APPLY before the snapshot so a field-name typo
 *  fails in DRY_RUN rather than partway through apply. */
export function validateFieldNames(): void {
  for (const plan of L1_FIELD_PLANS) {
    if (L1_RAW_DRIZZLE_FIELDS.has(plan.field)) continue;
    if (!PROJECT_FIELDS.includes(plan.field as (typeof PROJECT_FIELDS)[number])) {
      throw new Error(
        `Field validation failed (${plan.specId}): field '${plan.field}' not in PROJECT_FIELDS whitelist. Allowed: ${PROJECT_FIELDS.join(", ")}.`
      );
    }
  }
  // A.1 Convergix sweep writes these three fields per L1. Validate them too.
  for (const field of ["engagementType", "contractStart", "contractEnd"] as const) {
    if (!PROJECT_FIELDS.includes(field)) {
      throw new Error(
        `Field validation failed (A.1 sweep): field '${field}' not in PROJECT_FIELDS whitelist. Allowed: ${PROJECT_FIELDS.join(", ")}.`
      );
    }
  }
  for (const plan of L2_FIELD_PLANS) {
    if (!WEEK_ITEM_FIELDS.includes(plan.field as (typeof WEEK_ITEM_FIELDS)[number])) {
      throw new Error(
        `Field validation failed (${plan.specId}): field '${plan.field}' not in WEEK_ITEM_FIELDS whitelist. Allowed: ${WEEK_ITEM_FIELDS.join(", ")}.`
      );
    }
  }
}

// =====================================================================
// Exports (for pnpm runway:migrate) and standalone main
// =====================================================================

export const description =
  "Retainer + v4 cleanup (2026-04-21): 35 data ops across Convergix, Asprey, Hopdoddy, Soundly, LPPC, TAP, HDL. Retainer tier classification, L1/L2 date + status/waitingOn polish, 3 new LPPC L2s, 1 notes APPEND. Snapshot-based revert.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log(`=== Retainer + v4 Cleanup (${BATCH_ID}) ===`);
  ctx.log(`Mode: ${ctx.dryRun ? "DRY-RUN" : "APPLY"}`);

  validateFieldNames();
  ctx.log("Field-name validation passed.");

  const snapshotPath = resolveSnapshotPath(ctx.dryRun);
  const createdIdsPath = resolveCreatedIdsPath();

  // --- Step 1: Pre-fetch all state ----------------------------------
  ctx.log("--- Pre-fetch ---");
  const clientIds = await resolveClientIds(ctx, [
    "convergix",
    "dave-asprey",
    "hopdoddy",
    "soundly",
    "lppc",
    "tap",
    "hdl",
  ]);

  // Fetch L1s and L2s for each target
  const l1Rows = await fetchTargetL1Rows(ctx, clientIds);
  const l2Rows = await fetchTargetL2Rows(ctx, clientIds);

  // --- Step 2: Pre-state safety checks ------------------------------
  ctx.log("--- Pre-state safety checks ---");
  preStateChecksL1(ctx, l1Rows);
  preStateChecksL2(ctx, l2Rows);
  preStateChecksCreates(ctx, l2Rows);
  ctx.log(`Pre-state OK: ${L1_FIELD_PLANS.length} L1 field plans + ${L2_FIELD_PLANS.length} L2 field plans + ${L2_CREATE_PLANS.length} creates verified.`);

  // --- Step 3: Pre-apply snapshot -----------------------------------
  ctx.log("--- Pre-apply snapshot ---");
  const snapshot = buildSnapshot({
    mode: ctx.dryRun ? "dry-run" : "apply",
    l1Rows,
    l2Rows,
    // Capture current LPPC Interactive Map L1 id + Website Revamp L1 id for
    // the create operations (used by revert to locate the parent L1s).
    lppcClientId: clientIds.get("lppc")!.id,
  });
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot: ${snapshotPath}`);

  // Initialize the created-ids sidecar file (empty array) so revert can always read it.
  if (!ctx.dryRun) {
    writeFileSync(createdIdsPath, JSON.stringify([], null, 2), "utf8");
    ctx.log(`Initialized created-ids sidecar: ${createdIdsPath}`);
  }

  if (ctx.dryRun) {
    ctx.log("DRY-RUN: snapshot written, no mutations will follow.");
  }

  // --- Step 4: Ordered writes ---------------------------------------
  //
  // Phase order matters: L2 writes trigger parent-date derivation via
  // recomputeProjectDatesWith. Executing L2 field/create ops FIRST lets
  // derivation settle, then L1 explicit end_date writes (B.1/B.2/B.3) run
  // last and stick (until a future L2 write recomputes - out of scope per plan).
  //
  // Counters for end-of-run summary:
  const counts = { l1FieldWrites: 0, l2FieldWrites: 0, l2Creates: 0, notesAppends: 0 };

  // Phase 4a: all L2 field updates (B.5-B.12, C.2, D.1, D.2, D.7-D.13, D.14-D.16)
  ctx.log("--- Phase 4a: L2 field updates ---");
  for (const plan of L2_FIELD_PLANS) {
    const row = resolveL2Row(l2Rows, plan);
    await applyL2FieldWrite(ctx, plan, row);
    counts.l2FieldWrites++;
  }

  // Phase 4b: L2 creates (D.3, D.4, D.5)
  ctx.log("--- Phase 4b: L2 creates ---");
  for (const plan of L2_CREATE_PLANS) {
    const id = await applyL2Create(ctx, plan, createdIdsPath);
    if (id) ctx.log(`  Created L2 id=${id.slice(0, 8)}`);
    counts.l2Creates++;
  }

  // Phase 4c: L1 field updates (A.2-A.5, B.1-B.4, C.1)
  ctx.log("--- Phase 4c: L1 field updates ---");
  for (const plan of L1_FIELD_PLANS) {
    await applyL1FieldWrite(ctx, plan, l1Rows, clientIds);
    counts.l1FieldWrites++;
  }

  // Phase 4d: A.1 - Convergix 15 L1s to retainer
  ctx.log("--- Phase 4d: A.1 Convergix retainer sweep (15 L1s x 3 fields) ---");
  for (const projectName of CONVERGIX_L1_NAMES) {
    await applyConvergixRetainerSweep(ctx, projectName);
    counts.l1FieldWrites += 3;
  }

  // Phase 4e: D.6 Website Revamp notes APPEND
  ctx.log("--- Phase 4e: D.6 LPPC Website Revamp notes APPEND ---");
  await applyD6NotesAppend(ctx, l1Rows);
  counts.notesAppends++;

  // --- Step 5: Post-apply verification (apply only) -----------------
  if (!ctx.dryRun) {
    ctx.log("--- Post-apply verification ---");
    await verifyPostApply(ctx, clientIds);
  }

  // --- Step 6: Summary ----------------------------------------------
  ctx.log("");
  ctx.log("--- Planned ops summary ---");
  ctx.log(`  Section A: 5 ops (A.1 x15 L1s, A.2-A.5)`);
  ctx.log(`  Section B: 12 ops (B.1-B.12)`);
  ctx.log(`  Section C: 2 ops (C.1-C.2)`);
  ctx.log(`  Section D: 16 ops (D.1-D.16)`);
  ctx.log(`  Total: 35 spec ops`);
  ctx.log("");
  ctx.log(`  L1 field writes executed:   ${counts.l1FieldWrites}`);
  ctx.log(`  L2 field writes executed:   ${counts.l2FieldWrites}`);
  ctx.log(`  L2 creates executed:        ${counts.l2Creates}`);
  ctx.log(`  Notes APPEND operations:    ${counts.notesAppends}`);
  ctx.log("");
  ctx.log(`=== Retainer + v4 Cleanup complete (${ctx.dryRun ? "dry-run" : "applied"}) ===`);
}

// =====================================================================
// Pre-fetch helpers
// =====================================================================

async function resolveClientIds(
  ctx: MigrationContext,
  slugs: string[]
): Promise<Map<string, { id: string; name: string }>> {
  const m = new Map<string, { id: string; name: string }>();
  for (const slug of slugs) {
    const lookup = await getClientOrFail(slug);
    if (!lookup.ok) throw new Error(`Pre-fetch failed: client '${slug}' not found.`);
    m.set(slug, { id: lookup.client.id, name: lookup.client.name });
  }
  ctx.log(`Resolved ${m.size} client ids.`);
  return m;
}

type ProjectRow = typeof projects.$inferSelect;
type WeekItemRow = typeof weekItems.$inferSelect;

/** Keyed "<slug>|<projectName>" -> row. */
async function fetchTargetL1Rows(
  ctx: MigrationContext,
  clientIds: Map<string, { id: string; name: string }>
): Promise<Map<string, ProjectRow>> {
  const m = new Map<string, ProjectRow>();
  for (const [slug, cid] of clientIds.entries()) {
    const rows = await ctx.db.select().from(projects).where(eq(projects.clientId, cid.id));
    for (const row of rows) m.set(`${slug}|${row.name.trim()}`, row);
  }
  ctx.log(`Fetched ${m.size} L1 rows across ${clientIds.size} clients.`);
  return m;
}

/** Keyed "<slug>|<title>" -> row. L2 titles are unique within a client's board in practice. */
async function fetchTargetL2Rows(
  ctx: MigrationContext,
  clientIds: Map<string, { id: string; name: string }>
): Promise<Map<string, WeekItemRow>> {
  const m = new Map<string, WeekItemRow>();
  for (const [slug, cid] of clientIds.entries()) {
    const rows = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, cid.id));
    for (const row of rows) {
      const key = `${slug}|${row.title.trim()}`;
      // Duplicate title collision within a client is unexpected - log but don't throw;
      // the per-plan resolver will surface the issue precisely when it hits a plan.
      if (m.has(key)) {
        ctx.log(`  NOTE: duplicate L2 title under '${slug}': '${row.title}' - pre-checks will flag.`);
      }
      m.set(key, row);
    }
  }
  ctx.log(`Fetched ${m.size} L2 rows.`);
  return m;
}

// =====================================================================
// Pre-state safety checks
// =====================================================================

function isTrustPreservationOk(
  updatedAt: Date | number | string,
  key: string
): boolean {
  const t =
    typeof updatedAt === "number"
      ? updatedAt
      : updatedAt instanceof Date
      ? updatedAt.getTime()
      : Date.parse(String(updatedAt));
  if (t <= TRUST_PRESERVATION_THRESHOLD_MS) return true;
  return EXPECTED_KATHY_TOUCHES.has(key as KathyTouchKey);
}

function preStateChecksL1(
  ctx: MigrationContext,
  l1Rows: Map<string, ProjectRow>
): void {
  // Group plans by (slug, project) to apply per-field checks but report as one
  // block when a row is missing.
  const touchedRows = new Set<string>();

  for (const plan of L1_FIELD_PLANS) {
    const key = `${plan.clientSlug}|${plan.projectName}`;
    const row = l1Rows.get(key);
    if (!row) {
      throw new Error(
        `Pre-check failed (${plan.specId}): L1 '${plan.projectName}' not found for client '${plan.clientSlug}'.`
      );
    }
    touchedRows.add(key);

    // A.5 end_date special-case: accept either pre='2026-04-23' (sanity-pass-validated) or pre=null.
    if (plan.pre === "__A5_END_DATE_SENTINEL__") {
      const actual = row.endDate ?? null;
      if (actual !== null && actual !== "2026-04-23") {
        throw new Error(
          `Pre-check failed (A.5): Soundly Payment Gateway end_date expected null or '2026-04-23', got '${actual}'.`
        );
      }
      continue;
    }

    const actual = getColumnValue(row, plan.field);
    if (actual !== plan.pre) {
      throw new Error(
        `Pre-check failed (${plan.specId}): ${plan.clientSlug}/${plan.projectName}.${plan.field} expected '${plan.pre}', got '${actual}'.`
      );
    }
  }

  // Convergix retainer sweep (A.1): all 15 L1s pre-state is
  //   engagement_type='project', contract_start=null, contract_end=null
  for (const name of CONVERGIX_L1_NAMES) {
    const key = `convergix|${name}`;
    const row = l1Rows.get(key);
    if (!row) {
      throw new Error(`Pre-check failed (A.1): Convergix L1 '${name}' not found.`);
    }
    touchedRows.add(key);
    if ((row.engagementType ?? null) !== "project") {
      throw new Error(
        `Pre-check failed (A.1): ${name}.engagementType expected 'project', got '${row.engagementType ?? null}'.`
      );
    }
    if ((row.contractStart ?? null) !== null) {
      throw new Error(
        `Pre-check failed (A.1): ${name}.contractStart expected null, got '${row.contractStart}'.`
      );
    }
    if ((row.contractEnd ?? null) !== null) {
      throw new Error(
        `Pre-check failed (A.1): ${name}.contractEnd expected null, got '${row.contractEnd}'.`
      );
    }
  }

  // Trust-preservation check: every touched L1 must be pre-threshold OR on the
  // Kathy-expected set. (D.6 target Website Revamp is on the expected set.)
  for (const key of touchedRows) {
    const row = l1Rows.get(key)!;
    const [slug, projectName] = key.split("|");
    const touchKey = `${slug}:project:${projectName}`;
    if (!isTrustPreservationOk(row.updatedAt, touchKey)) {
      throw new Error(
        `Trust-preservation failed: L1 '${projectName}' (${slug}) has updatedAt ${row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt} past 2026-04-21T14:00:00Z and is not on the expected Kathy-touch list. Abort.`
      );
    }
  }

  // D.6 target also needs the row available
  const d6Key = "lppc|Website Revamp";
  if (!l1Rows.get(d6Key)) {
    throw new Error(`Pre-check failed (D.6): LPPC Website Revamp L1 not found.`);
  }

  ctx.log(`  L1 pre-checks passed (${touchedRows.size} unique L1 rows touched + D.6 notes append).`);
}

function preStateChecksL2(
  ctx: MigrationContext,
  l2Rows: Map<string, WeekItemRow>
): void {
  const touchedRows = new Set<string>();

  for (const plan of L2_FIELD_PLANS) {
    const key = `${plan.clientSlug}|${plan.title}`;
    const row = l2Rows.get(key);
    if (!row) {
      throw new Error(
        `Pre-check failed (${plan.specId}): L2 '${plan.title}' not found for client '${plan.clientSlug}'.`
      );
    }
    touchedRows.add(key);

    const actual = getColumnValue(row, plan.field);
    if (actual !== plan.pre) {
      throw new Error(
        `Pre-check failed (${plan.specId}): ${plan.clientSlug}/L2 '${plan.title}'.${plan.field} expected '${plan.pre}', got '${actual}'.`
      );
    }
  }

  for (const key of touchedRows) {
    const row = l2Rows.get(key)!;
    const [slug, title] = key.split("|");
    const touchKey = `${slug}:weekItem:${title}`;
    if (!isTrustPreservationOk(row.updatedAt, touchKey)) {
      throw new Error(
        `Trust-preservation failed: L2 '${title}' (${slug}) has updatedAt ${row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt} past 2026-04-21T14:00:00Z and is not on the expected Kathy-touch list. Abort.`
      );
    }
  }

  ctx.log(`  L2 pre-checks passed (${touchedRows.size} unique L2 rows touched).`);
}

function preStateChecksCreates(
  ctx: MigrationContext,
  l2Rows: Map<string, WeekItemRow>
): void {
  for (const plan of L2_CREATE_PLANS) {
    const key = `${plan.clientSlug}|${plan.title}`;
    if (l2Rows.has(key)) {
      throw new Error(
        `Pre-check failed (${plan.specId}): L2 '${plan.title}' already exists under '${plan.clientSlug}' - migration would create a duplicate. Abort (likely a re-run after successful apply).`
      );
    }
  }
  ctx.log(`  Create pre-checks passed (no duplicates).`);
}

// =====================================================================
// Snapshot + sidecar helpers
// =====================================================================

function buildSnapshot(args: {
  mode: "dry-run" | "apply";
  l1Rows: Map<string, ProjectRow>;
  l2Rows: Map<string, WeekItemRow>;
  lppcClientId: string;
}): Record<string, unknown> {
  const touchedL1Keys = new Set<string>();
  for (const plan of L1_FIELD_PLANS) touchedL1Keys.add(`${plan.clientSlug}|${plan.projectName}`);
  for (const name of CONVERGIX_L1_NAMES) touchedL1Keys.add(`convergix|${name}`);
  touchedL1Keys.add("lppc|Website Revamp"); // D.6

  const touchedL2Keys = new Set<string>();
  for (const plan of L2_FIELD_PLANS) touchedL2Keys.add(`${plan.clientSlug}|${plan.title}`);

  const l1Captures: Array<{ key: string; row: ProjectRow }> = [];
  for (const key of touchedL1Keys) {
    const row = args.l1Rows.get(key);
    if (!row) throw new Error(`Snapshot: missing L1 row for '${key}'`);
    l1Captures.push({ key, row });
  }

  const l2Captures: Array<{ key: string; row: WeekItemRow }> = [];
  for (const key of touchedL2Keys) {
    const row = args.l2Rows.get(key);
    if (!row) throw new Error(`Snapshot: missing L2 row for '${key}'`);
    l2Captures.push({ key, row });
  }

  return {
    batchId: BATCH_ID,
    capturedAt: new Date().toISOString(),
    mode: args.mode,
    trustThreshold: "2026-04-21T14:00:00Z",
    lppcClientId: args.lppcClientId,
    l1Rows: l1Captures,
    l2Rows: l2Captures,
    // D.6 notes baseline (current full text) for revert.
    lppcWebsiteRevampNotes: args.l1Rows.get("lppc|Website Revamp")?.notes ?? null,
  };
}

function resolveSnapshotPath(dryRun: boolean): string {
  const override = process.env.RETAINER_V4_CLEANUP_SNAPSHOT_PATH;
  const base = override ?? DEFAULT_SNAPSHOT_PATH;
  const withSuffix = dryRun && !override
    ? base.replace(/\.json$/, "-dryrun.json")
    : base;
  return resolvePath(process.cwd(), withSuffix);
}

function resolveCreatedIdsPath(): string {
  const override = process.env.RETAINER_V4_CLEANUP_CREATED_IDS_PATH;
  return resolvePath(process.cwd(), override ?? DEFAULT_CREATED_IDS_PATH);
}

function appendCreatedId(path: string, entry: { specId: string; id: string; title: string }): void {
  const current: Array<{ specId: string; id: string; title: string }> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : [];
  current.push(entry);
  writeFileSync(path, JSON.stringify(current, null, 2), "utf8");
}

// =====================================================================
// Write helpers
// =====================================================================

async function applyL1FieldWrite(
  ctx: MigrationContext,
  plan: L1FieldPlan,
  l1Rows: Map<string, ProjectRow>,
  clientMap: Map<string, { id: string; name: string }>
): Promise<void> {
  const preMarker = plan.pre === "__A5_END_DATE_SENTINEL__" ? "(null or 2026-04-23)" : (plan.pre ?? "(null)");
  const newMarker = plan.newValue ?? "(null)";
  ctx.log(`  [${plan.specId}] L1 ${plan.clientSlug}/${plan.projectName}.${plan.field}: "${preMarker}" -> "${newMarker}"`);

  // endDate/startDate are v4-derived columns excluded from PROJECT_FIELDS, so the
  // helper's validator rejects them. Route these writes through raw-drizzle +
  // insertAuditRecord using the same null-marker conventions as the helper. See
  // plan for context (commits 1 - 3 shipped; this branch was added in commit 4).
  if (plan.field === "endDate" || plan.field === "startDate") {
    const key = `${plan.clientSlug}|${plan.projectName}`;
    const row = l1Rows.get(key);
    if (!row) {
      throw new Error(`${plan.specId} raw-drizzle: L1 row missing for ${key}.`);
    }
    const client = clientMap.get(plan.clientSlug);
    if (!client) {
      throw new Error(`${plan.specId} raw-drizzle: client '${plan.clientSlug}' not in client map.`);
    }
    if (ctx.dryRun) return;

    // Audit `previousValue` reflects pre-migration state captured at Phase 1 pre-fetch,
    // NOT the live DB value at write time. Phase 4a L2 writes can mutate L1 endDate/startDate
    // via recomputeProjectDatesWith before this Phase 4c write fires. Intent > mechanical diff.
    const previousValue = getColumnValue(row, plan.field);
    const columnKey = plan.field;

    await ctx.db
      .update(projects)
      .set({ [columnKey]: plan.newValue, updatedAt: new Date() })
      .where(eq(projects.id, row.id));

    const idemKey = generateIdempotencyKey(
      "field-change",
      row.id,
      plan.field,
      plan.newValue ?? "(null)",
      UPDATED_BY
    );
    await insertAuditRecord({
      idempotencyKey: idemKey,
      projectId: row.id,
      clientId: row.clientId,
      updatedBy: UPDATED_BY,
      updateType: "field-change",
      previousValue,
      newValue: plan.newValue,
      summary: `${client.name} / ${plan.projectName}: ${plan.field} changed from "${previousValue}" to "${plan.newValue ?? "(null)"}"`,
      metadata: JSON.stringify({ field: plan.field }),
    });
    return;
  }

  if (ctx.dryRun) return;

  const result = await updateProjectField({
    clientSlug: plan.clientSlug,
    projectName: plan.projectName,
    field: plan.field,
    newValue: plan.newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`${plan.specId} write failed (${plan.clientSlug}/${plan.projectName}.${plan.field}): ${result.error}`);
  }
}

async function applyConvergixRetainerSweep(
  ctx: MigrationContext,
  projectName: string
): Promise<void> {
  const ops = [
    { field: "engagementType", newValue: "retainer" },
    { field: "contractStart", newValue: "2026-02-01" },
    { field: "contractEnd", newValue: "2026-07-31" },
  ];
  for (const op of ops) {
    ctx.log(`  [A.1] L1 convergix/${projectName}.${op.field}: "(null)" -> "${op.newValue}"`);
    if (ctx.dryRun) continue;
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName,
      field: op.field,
      newValue: op.newValue,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) {
      throw new Error(`A.1 write failed (convergix/${projectName}.${op.field}): ${result.error}`);
    }
  }
}

async function applyL2FieldWrite(
  ctx: MigrationContext,
  plan: L2FieldPlan,
  row: WeekItemRow
): Promise<void> {
  const preMarker = plan.pre ?? "(null)";
  const newMarker = plan.newValue ?? "(null)";
  ctx.log(`  [${plan.specId}] L2 ${plan.clientSlug}/'${plan.title}'.${plan.field}: "${preMarker}" -> "${newMarker}"`);
  if (ctx.dryRun) return;

  if (!row.weekOf) {
    throw new Error(`${plan.specId} write failed: L2 '${plan.title}' has no weekOf - cannot resolve via updateWeekItemField.`);
  }

  const result = await updateWeekItemField({
    weekOf: row.weekOf,
    weekItemTitle: plan.title,
    field: plan.field,
    newValue: plan.newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`${plan.specId} write failed (L2 '${plan.title}'.${plan.field}): ${result.error}`);
  }
}

function resolveL2Row(
  l2Rows: Map<string, WeekItemRow>,
  plan: L2FieldPlan
): WeekItemRow {
  const key = `${plan.clientSlug}|${plan.title}`;
  const row = l2Rows.get(key);
  if (!row) {
    throw new Error(`Write resolver: L2 '${plan.title}' disappeared between pre-check and write. Abort.`);
  }
  return row;
}

async function applyL2Create(
  ctx: MigrationContext,
  plan: L2CreatePlan,
  createdIdsPath: string
): Promise<string | null> {
  ctx.log(`  [${plan.specId}] CREATE L2 ${plan.clientSlug}/${plan.projectName} - '${plan.title}' (${plan.date})`);
  if (ctx.dryRun) return null;

  // Step 1: create with createWeekItem (mirrors date into start_date).
  const createResult = await createWeekItem({
    clientSlug: plan.clientSlug,
    projectName: plan.projectName,
    date: plan.date,
    dayOfWeek: plan.dayOfWeek,
    title: plan.title,
    status: plan.status ?? undefined,
    category: plan.category,
    owner: plan.owner,
    notes: plan.notes,
    updatedBy: UPDATED_BY,
  });
  if (!createResult.ok) {
    throw new Error(`${plan.specId} create failed: ${createResult.error}`);
  }

  // Step 2: re-query to get the id (createWeekItem doesn't return it).
  const weekOf = getMondayIso(plan.date);
  const row = await findWeekItemByFuzzyTitle(weekOf, plan.title);
  if (!row) {
    throw new Error(`${plan.specId} create: row not found after createWeekItem call (title='${plan.title}' weekOf='${weekOf}').`);
  }

  // Step 3: synchronously write the id to the sidecar BEFORE follow-up writes.
  appendCreatedId(createdIdsPath, {
    specId: plan.specId,
    id: row.id,
    title: plan.title,
  });

  // Step 4: if endDate specified, set it (createWeekItem doesn't accept endDate).
  if (plan.endDate !== null) {
    const res = await updateWeekItemField({
      weekOf,
      weekItemTitle: plan.title,
      field: "endDate",
      newValue: plan.endDate,
      updatedBy: UPDATED_BY,
    });
    if (!res.ok) {
      throw new Error(`${plan.specId} endDate follow-up failed: ${res.error}`);
    }
  }

  return row.id;
}

async function applyD6NotesAppend(
  ctx: MigrationContext,
  l1Rows: Map<string, ProjectRow>
): Promise<void> {
  const row = l1Rows.get("lppc|Website Revamp");
  if (!row) throw new Error("D.6: LPPC Website Revamp L1 not found at write time.");

  const currentNotes = row.notes ?? "";
  if (currentNotes.endsWith(D6_APPEND_TEXT.trim())) {
    ctx.log(`  [D.6] APPEND skipped - notes already end with expected sentence.`);
    return;
  }
  const newNotes = currentNotes + D6_APPEND_TEXT;

  ctx.log(`  [D.6] L1 lppc/Website Revamp notes APPEND (+${D6_APPEND_TEXT.length} chars).`);
  if (ctx.dryRun) return;

  const result = await updateProjectField({
    clientSlug: "lppc",
    projectName: "Website Revamp",
    field: "notes",
    newValue: newNotes,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`D.6 write failed: ${result.error}`);
  }
}

// =====================================================================
// Post-apply verification
// =====================================================================

async function verifyPostApply(
  ctx: MigrationContext,
  clientIds: Map<string, { id: string; name: string }>
): Promise<void> {
  // Re-fetch and spot-check a handful of critical post-state invariants.
  const convergixId = clientIds.get("convergix")!.id;
  const convergixRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, convergixId));
  const allRetainer = convergixRows.every((p) => p.engagementType === "retainer");
  if (!allRetainer) {
    throw new Error("VERIFICATION FAILED: A.1 - not all Convergix L1s have engagement_type='retainer'.");
  }
  const allHaveContract = convergixRows.every((p) => p.contractStart === "2026-02-01" && p.contractEnd === "2026-07-31");
  if (!allHaveContract) {
    throw new Error("VERIFICATION FAILED: A.1 - some Convergix L1s missing contract_start/contract_end.");
  }

  // Soundly Payment Gateway A.5
  const soundlyRows = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, clientIds.get("soundly")!.id));
  const pgw = soundlyRows.find((p) => p.name.trim() === "Payment Gateway Page");
  if (!pgw) throw new Error("VERIFICATION FAILED: A.5 - Soundly Payment Gateway L1 not found.");
  if (pgw.engagementType !== "project") {
    throw new Error(`VERIFICATION FAILED: A.5 - engagement_type='${pgw.engagementType}', expected 'project'.`);
  }
  if (pgw.contractEnd !== null) {
    throw new Error(`VERIFICATION FAILED: A.5 - contract_end='${pgw.contractEnd}', expected null.`);
  }
  if (pgw.endDate !== "2026-05-31") {
    throw new Error(`VERIFICATION FAILED: A.5 - end_date='${pgw.endDate}', expected '2026-05-31'.`);
  }

  // D.6 append - re-read notes
  const lppcId = clientIds.get("lppc")!.id;
  const lppcProjects = await ctx.db.select().from(projects).where(eq(projects.clientId, lppcId));
  const websiteRevamp = lppcProjects.find((p) => p.name.trim() === "Website Revamp");
  if (!websiteRevamp) throw new Error("VERIFICATION FAILED: D.6 - Website Revamp L1 not found.");
  if (!websiteRevamp.notes || !websiteRevamp.notes.endsWith(D6_APPEND_TEXT.trim())) {
    throw new Error("VERIFICATION FAILED: D.6 - Website Revamp notes do not end with appended sentence.");
  }

  // D.3/D.4/D.5 - created L2s present
  const lppcL2s = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, lppcId));
  for (const plan of L2_CREATE_PLANS) {
    const match = lppcL2s.find((w) => w.title.trim() === plan.title);
    if (!match) {
      throw new Error(`VERIFICATION FAILED: ${plan.specId} - created L2 '${plan.title}' not found.`);
    }
  }

  ctx.log(`  Post-apply verification passed.`);
}

// =====================================================================
// Small utilities
// =====================================================================

function getColumnValue(row: Record<string, unknown>, field: string): string | null {
  const v = row[field];
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function getMondayIso(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// =====================================================================
// Standalone entrypoint (for `DRY_RUN=1 npx tsx ...` direct invocation)
// =====================================================================

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error(
      "RUNWAY_DATABASE_URL is not set. This migration targets prod Turso; refusing to run against a local fallback."
    );
  }

  const libsql = createLibsqlClient({
    url,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });
  const db = drizzle(libsql);

  const logs: string[] = [];
  const ctx: MigrationContext = {
    db,
    dryRun,
    log: (msg: string) => {
      logs.push(msg);
      console.log(`  ${dryRun ? "[DRY-RUN]" : "[APPLY]"} ${msg}`);
    },
    logs,
  };

  if (!dryRun) setBatchId(BATCH_ID);
  try {
    await up(ctx);
    console.log(`\n${dryRun ? "Dry-run complete. Re-run without DRY_RUN=1 to apply." : "Migration applied."}`);
    console.log(`${logs.length} operation(s) logged.`);
  } finally {
    setBatchId(null);
  }
}

runIfDirect("retainer-v4-cleanup-2026-04-21", main);

