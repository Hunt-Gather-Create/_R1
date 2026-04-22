/**
 * Hot sheet data cleanup — 2026-04-22
 *
 * 24 effective ops on Convergix + LPPC L1s/L2s, derived from:
 *   - Convergix hot sheet reconciliation (operator + CC walk 2026-04-22)
 *   - Jill's pending website updates sheet (3 items, due 2026-05-01)
 *   - Kathy's LPPC Slack update 2026-04-22 (R3 feedback, images, advocacy)
 *   - Today's Slack: Big Win Template brief to Lane, Siemens logo live
 *
 * Bypasses MCP because MCP tool surface is too narrow for this set:
 *   - update_project_field enum excludes startDate, endDate, engagementType,
 *     contractStart, contractEnd, parentProjectId
 *   - update_week_item can't set startDate/endDate independent of `date`
 *   - add_project can't set retainer metadata on create
 *   - create_week_item can't create multi-day L2s
 *
 * Pattern mirrors apply-target-to-notes-raw.ts — pre-fetch targets, raw SQL
 * UPDATE/INSERT per op, one audit row per op with unique batch_id +
 * updated_by salting idempotency keys (per feedback_mcp_batch_hygiene memory).
 *
 * Op labels HS.05 ... HS.28 match the consolidated TP prompt numbering.
 * HS.16 is a no-op by design (status unchanged), skipped silently.
 * HS.26 splits into HS.26a (rename existing) + HS.26b (new L2) = 25 items
 * total but one is a no-op so 24 effective.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   DRY_RUN=1 npx tsx scripts/runway-migrations/hotsheet-cleanup-2026-04-22.ts
 *   npx tsx scripts/runway-migrations/hotsheet-cleanup-2026-04-22.ts
 */

import { createClient, type Client } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";

const BATCH_ID = "hotsheet-cleanup-2026-04-22";
const UPDATED_BY = "hotsheet-cleanup";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function generateIdemKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function mondayOf(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(isoDate: string): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date(isoDate + "T00:00:00Z").getUTCDay()];
}

function genId(): string {
  return randomUUID().replace(/-/g, "");
}

type L1Row = {
  id: string;
  clientId: string;
  name: string;
  notes: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  engagementType: string | null;
  waitingOn: string | null;
  resources: string | null;
  parentProjectId: string | null;
};

type L2Row = {
  id: string;
  projectId: string;
  clientId: string;
  title: string;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
  notes: string | null;
};

// ------------------------------------------------------------
// Targets (hardcoded IDs from operator + CC's hot-sheet walk)
// ------------------------------------------------------------

const CONVERGIX_CLIENT_SLUG = "convergix";
const LPPC_CLIENT_SLUG = "lppc";

const L1_IDS = {
  // Convergix
  EventsPage: "135c5a61d5c343b1b5b39fe08",
  RockwellPartnerNetwork: "394f9e5e5b864c2eb2260f468",
  TexasInstruments: "c0935359406e40709a0790372",
  BrandGuide: "51f39e5cdfbe446992aa155d6",
  CorporateCollateral: "65b2cac113a048f592867a71c",
  SocialContent: "f391dff5ceaf45279a807ace9",
  IndustryVerticals: "0e4214c60728476db177f4de1",
  BigWinTemplate: "0157c4232d5c4db58333bb744",
  CertificationsPage: "68a4ee3791b24d72abb5afc62",
  NewCapacity: "0c208308ff48427092776c0da",
  FanucAward: "3d5215f4a3964f38a1b2afda0",
  RockwellCoMarketing: "1923fc1a36524a9c810a73763",
  // LPPC
  LppcWebsiteRevamp: "6422e5f4b0fa483ea88c7b94e",
} as const;

const L2_IDS = {
  AIStechL2: "9e432ae4ccac4b24ab1628eaf",
  LppcR3Review: "ea35d61957e14fd48c4602369",
  LppcPencilsDownImages: "87074daa09664bcc86b7dc6e1",
  LppcPolicyMaterials: "63e4aeab1d6d47449458e9d5b",
} as const;

// The 2 existing Corporate Collateral L2s (HS.12 flips both statuses)
const CORP_COLLATERAL_L2_IDS = [
  "43701263775d49c7a0f17ae60", // Corporate Overview Brochure — Updates
  "c13178e12ca3476fb88db9d92", // Corporate PPT — Updates
];

// ------------------------------------------------------------
// Op execution
// ------------------------------------------------------------

type OpReport = { id: string; label: string; action: string; applied: boolean };

async function fetchL1(db: Client, id: string): Promise<L1Row> {
  const r = await db.execute({
    sql: `SELECT id, client_id, name, notes, status, start_date, end_date, engagement_type, waiting_on, resources, parent_project_id
          FROM projects WHERE id = ?`,
    args: [id],
  });
  if (r.rows.length === 0) throw new Error(`L1 not found: ${id}`);
  const row = r.rows[0];
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    notes: row.notes == null ? null : String(row.notes),
    status: row.status == null ? null : String(row.status),
    startDate: row.start_date == null ? null : String(row.start_date),
    endDate: row.end_date == null ? null : String(row.end_date),
    engagementType: row.engagement_type == null ? null : String(row.engagement_type),
    waitingOn: row.waiting_on == null ? null : String(row.waiting_on),
    resources: row.resources == null ? null : String(row.resources),
    parentProjectId: row.parent_project_id == null ? null : String(row.parent_project_id),
  };
}

async function fetchL2(db: Client, id: string): Promise<L2Row> {
  const r = await db.execute({
    sql: `SELECT id, project_id, client_id, title, date, start_date, end_date, status, category, notes
          FROM week_items WHERE id = ?`,
    args: [id],
  });
  if (r.rows.length === 0) throw new Error(`L2 not found: ${id}`);
  const row = r.rows[0];
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    clientId: String(row.client_id),
    title: String(row.title),
    date: row.date == null ? null : String(row.date),
    startDate: row.start_date == null ? null : String(row.start_date),
    endDate: row.end_date == null ? null : String(row.end_date),
    status: row.status == null ? null : String(row.status),
    category: row.category == null ? null : String(row.category),
    notes: row.notes == null ? null : String(row.notes),
  };
}

async function writeAudit(
  db: Client,
  opts: {
    projectId: string;
    clientId: string;
    updateType: string;
    previousValue: string | null;
    newValue: string | null;
    summary: string;
    idemSeed: string;
    metadata: Record<string, unknown>;
    now: number;
  },
): Promise<void> {
  const idemKey = generateIdemKey("hotsheet-cleanup", opts.idemSeed, UPDATED_BY);
  const id = randomUUID();
  try {
    await db.execute({
      sql: `INSERT INTO updates (id, idempotency_key, project_id, client_id, updated_by, update_type, previous_value, new_value, summary, metadata, batch_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        idemKey,
        opts.projectId,
        opts.clientId,
        UPDATED_BY,
        opts.updateType,
        opts.previousValue ?? "(null)",
        opts.newValue ?? "(null)",
        opts.summary,
        JSON.stringify(opts.metadata),
        BATCH_ID,
        opts.now,
      ],
    });
  } catch (err) {
    console.log(`      [WARN] audit insert failed: ${err}`);
  }
}

// ------------------------------------------------------------
// Single-field L1 updates (notes / status / waitingOn / etc.)
// ------------------------------------------------------------

async function updateL1Field(
  db: Client,
  dryRun: boolean,
  label: string,
  l1Id: string,
  column: string, // raw SQL column name, e.g. "notes", "status", "waiting_on"
  fieldLogical: string, // e.g. "notes", "status", "waitingOn"
  newValue: string | null,
  summaryDetail: string,
  reports: OpReport[],
): Promise<void> {
  const l1 = await fetchL1(db, l1Id);
  const prev =
    column === "notes"
      ? l1.notes
      : column === "status"
        ? l1.status
        : column === "waiting_on"
          ? l1.waitingOn
          : column === "resources"
            ? l1.resources
            : null;
  const action = `${label}: ${l1.name} [${fieldLogical}] "${truncate(prev)}" → "${truncate(newValue)}"`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return;
  }
  const now = Date.now();
  await db.execute({
    sql: `UPDATE projects SET ${column} = ?, updated_at = ? WHERE id = ?`,
    args: [newValue, now, l1Id],
  });
  await writeAudit(db, {
    projectId: l1.id,
    clientId: l1.clientId,
    updateType: fieldLogical === "status" ? "status-change" : "field-change",
    previousValue: prev,
    newValue,
    summary: `${l1.name}: ${summaryDetail}`,
    idemSeed: `${label}|${fieldLogical}|${l1Id}`,
    metadata: { field: fieldLogical, op: label },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
}

// ------------------------------------------------------------
// L1 date updates (startDate / endDate — not in helper whitelist)
// ------------------------------------------------------------

async function updateL1Dates(
  db: Client,
  dryRun: boolean,
  label: string,
  l1Id: string,
  newStart: string | null,
  newEnd: string | null,
  summaryDetail: string,
  reports: OpReport[],
): Promise<void> {
  const l1 = await fetchL1(db, l1Id);
  const action = `${label}: ${l1.name} [dates] (${l1.startDate ?? "null"} → ${newStart ?? "null"}) / (${l1.endDate ?? "null"} → ${newEnd ?? "null"})`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return;
  }
  const now = Date.now();
  await db.execute({
    sql: `UPDATE projects SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?`,
    args: [newStart, newEnd, now, l1Id],
  });
  const prev = `${l1.startDate ?? "null"}|${l1.endDate ?? "null"}`;
  const next = `${newStart ?? "null"}|${newEnd ?? "null"}`;
  await writeAudit(db, {
    projectId: l1.id,
    clientId: l1.clientId,
    updateType: "field-change",
    previousValue: prev,
    newValue: next,
    summary: `${l1.name}: ${summaryDetail}`,
    idemSeed: `${label}|dates|${l1Id}`,
    metadata: { field: "startDate,endDate", op: label },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
}

// ------------------------------------------------------------
// L1 create
// ------------------------------------------------------------

async function createL1(
  db: Client,
  dryRun: boolean,
  label: string,
  clientId: string,
  newId: string,
  fields: {
    name: string;
    status: string | null;
    category: string | null;
    owner: string | null;
    resources: string | null;
    waitingOn: string | null;
    notes: string | null;
    startDate: string | null;
    endDate: string | null;
    engagementType: string | null;
    contractStart: string | null;
    contractEnd: string | null;
    parentProjectId: string | null;
  },
  reports: OpReport[],
): Promise<string> {
  const action = `${label}: NEW L1 "${fields.name}" (engagementType=${fields.engagementType ?? "null"}, start=${fields.startDate ?? "null"}, end=${fields.endDate ?? "null"})`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return newId;
  }
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO projects
          (id, client_id, name, status, category, owner, resources, waiting_on, due_date, start_date, end_date,
           contract_start, contract_end, engagement_type, parent_project_id, notes, stale_days, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId,
      clientId,
      fields.name,
      fields.status,
      fields.category,
      fields.owner,
      fields.resources,
      fields.waitingOn,
      null,
      fields.startDate,
      fields.endDate,
      fields.contractStart,
      fields.contractEnd,
      fields.engagementType,
      fields.parentProjectId,
      fields.notes,
      null,
      0,
      now,
      now,
    ],
  });
  await writeAudit(db, {
    projectId: newId,
    clientId,
    updateType: "new-item",
    previousValue: null,
    newValue: fields.name,
    summary: `New project created: ${fields.name}`,
    idemSeed: `${label}|create|${newId}`,
    metadata: { field: "project-create", op: label, engagementType: fields.engagementType },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
  return newId;
}

// ------------------------------------------------------------
// L2 operations
// ------------------------------------------------------------

async function updateL2Field(
  db: Client,
  dryRun: boolean,
  label: string,
  l2Id: string,
  column: string,
  fieldLogical: string,
  newValue: string | null,
  summaryDetail: string,
  reports: OpReport[],
): Promise<void> {
  const l2 = await fetchL2(db, l2Id);
  const prev =
    column === "title"
      ? l2.title
      : column === "notes"
        ? l2.notes
        : column === "status"
          ? l2.status
          : null;
  const action = `${label}: L2 "${l2.title}" [${fieldLogical}] "${truncate(prev)}" → "${truncate(newValue)}"`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return;
  }
  const now = Date.now();
  await db.execute({
    sql: `UPDATE week_items SET ${column} = ?, updated_at = ? WHERE id = ?`,
    args: [newValue, now, l2Id],
  });
  await writeAudit(db, {
    projectId: l2.projectId,
    clientId: l2.clientId,
    updateType: "field-change",
    previousValue: prev,
    newValue,
    summary: `L2 ${l2.title}: ${summaryDetail}`,
    idemSeed: `${label}|${fieldLogical}|${l2Id}`,
    metadata: { field: fieldLogical, op: label, weekItemId: l2Id },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
}

async function updateL2Dates(
  db: Client,
  dryRun: boolean,
  label: string,
  l2Id: string,
  newDate: string | null,
  newStart: string | null,
  newEnd: string | null,
  summaryDetail: string,
  reports: OpReport[],
): Promise<void> {
  const l2 = await fetchL2(db, l2Id);
  const newWeekOf = newStart ? mondayOf(newStart) : null;
  const newDow = newStart ? dayOfWeek(newStart) : null;
  const action = `${label}: L2 "${l2.title}" [dates] date=${l2.date ?? "null"}→${newDate ?? "null"}, start=${l2.startDate ?? "null"}→${newStart ?? "null"}, end=${l2.endDate ?? "null"}→${newEnd ?? "null"}`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return;
  }
  const now = Date.now();
  await db.execute({
    sql: `UPDATE week_items SET date = ?, start_date = ?, end_date = ?, week_of = ?, day_of_week = ?, updated_at = ? WHERE id = ?`,
    args: [newDate, newStart, newEnd, newWeekOf, newDow, now, l2Id],
  });
  const prev = `${l2.date ?? "null"}|${l2.startDate ?? "null"}|${l2.endDate ?? "null"}`;
  const next = `${newDate ?? "null"}|${newStart ?? "null"}|${newEnd ?? "null"}`;
  await writeAudit(db, {
    projectId: l2.projectId,
    clientId: l2.clientId,
    updateType: "field-change",
    previousValue: prev,
    newValue: next,
    summary: `L2 ${l2.title}: ${summaryDetail}`,
    idemSeed: `${label}|dates|${l2Id}`,
    metadata: { field: "date,startDate,endDate,weekOf,dayOfWeek", op: label, weekItemId: l2Id },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
}

async function createL2(
  db: Client,
  dryRun: boolean,
  label: string,
  parentL1Id: string,
  clientId: string,
  fields: {
    title: string;
    category: string | null;
    status: string | null;
    owner: string | null;
    resources: string | null;
    notes: string | null;
    startDate: string;
    endDate: string | null;
  },
  reports: OpReport[],
): Promise<string> {
  const date = fields.startDate;
  const weekOf = mondayOf(date);
  const dow = dayOfWeek(date);
  const newId = genId();
  const action = `${label}: NEW L2 "${fields.title}" under ${parentL1Id} (${date}${fields.endDate && fields.endDate !== date ? ` → ${fields.endDate}` : ""})`;
  console.log(`  ${action}`);
  if (dryRun) {
    reports.push({ id: label, label, action, applied: false });
    return newId;
  }
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO week_items
          (id, project_id, client_id, day_of_week, week_of, date, start_date, end_date, blocked_by, title, status, category, owner, resources, notes, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId,
      parentL1Id,
      clientId,
      dow,
      weekOf,
      date,
      fields.startDate,
      fields.endDate,
      null,
      fields.title,
      fields.status,
      fields.category,
      fields.owner,
      fields.resources,
      fields.notes,
      999,
      now,
      now,
    ],
  });
  await writeAudit(db, {
    projectId: parentL1Id,
    clientId,
    updateType: "new-item",
    previousValue: null,
    newValue: fields.title,
    summary: `New week item created: ${fields.title}`,
    idemSeed: `${label}|create|${newId}`,
    metadata: { field: "week-item-create", op: label, weekItemId: newId, parentL1Id },
    now,
  });
  reports.push({ id: label, label, action, applied: true });
  return newId;
}

function truncate(s: string | null | undefined): string {
  if (s == null) return "null";
  const t = String(s).replace(/\n/g, "\\n");
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
}

// ------------------------------------------------------------
// main
// ------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) throw new Error("RUNWAY_DATABASE_URL not set");

  const db = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
  const reports: OpReport[] = [];

  console.log(`=== hotsheet-cleanup-2026-04-22 === mode: ${dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`BATCH_ID=${BATCH_ID} UPDATED_BY=${UPDATED_BY}`);
  console.log("");

  // Resolve client IDs for inserts
  const cvxRow = await db.execute({
    sql: `SELECT id FROM clients WHERE slug = ?`,
    args: [CONVERGIX_CLIENT_SLUG],
  });
  if (cvxRow.rows.length === 0) throw new Error("Convergix client not found");
  const convergixClientId = String(cvxRow.rows[0].id);

  // ==========================================================
  // Waves (operator has pre-approved the full set; we run in
  // human-readable order: notes first, then dates, then status,
  // then new creations)
  // ==========================================================

  console.log("── Wave 1: notes refreshes ──");

  // HS.07 Rockwell PartnerNetwork notes refresh
  await updateL1Field(db, dryRun, "HS.07", L1_IDS.RockwellPartnerNetwork, "notes", "notes",
    `Article LIVE at /news-insights/convergix-awarded-oem-partner-of-the-year. Partner-of-Year image swap pending (per Jill's sheet, due 2026-05-01). Social post potentially 4/23 — Nicole confirming with Daniel on repost.`,
    "notes refresh (article live, image swap pending)", reports);

  // HS.09 Texas Instruments notes refresh
  await updateL1Field(db, dryRun, "HS.09", L1_IDS.TexasInstruments, "notes", "notes",
    `Site page being presented W/O 4/20. TI award copy to be posted on /news per Jill's sheet (due 2026-05-01). Social asset pending Daniel confirm on repost (originally posted ~3 weeks ago).`,
    "notes refresh (site page presentation, social pending)", reports);

  // HS.14 Social Content notes refresh
  await updateL1Field(db, dryRun, "HS.14", L1_IDS.SocialContent, "notes", "notes",
    `Monthly cadence. Current: April analytics + May content calendar present next week (Monday meeting). June tradeshow posts feeding into May + June. General automotive post option 1 posting 4/22. Ongoing: Kathy onboarding Sami, Lane oversight on Figma templates.`,
    "notes refresh (current deliverables vs prior ops-only framing)", reports);

  // HS.18 Certifications Page — Siemens logo live
  {
    const l1 = await fetchL1(db, L1_IDS.CertificationsPage);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "Siemens logo live on partners page 2026-04-21 (Leslie). Remaining: Daniel's cert logos + info.";
    await updateL1Field(db, dryRun, "HS.18", L1_IDS.CertificationsPage, "notes", "notes",
      newNotes, "append Siemens logo live 2026-04-21", reports);
  }

  // HS.19 New Capacity — JJ feedback due 4/24
  {
    const l1 = await fetchL1(db, L1_IDS.NewCapacity);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "JJ feedback due 2026-04-24.";
    await updateL1Field(db, dryRun, "HS.19", L1_IDS.NewCapacity, "notes", "notes",
      newNotes, "append JJ feedback due 2026-04-24", reports);
  }

  // HS.20 Fanuc Award — ASI angle
  {
    const l1 = await fetchL1(db, L1_IDS.FanucAward);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "Post angle: Fanuc ASI status possible.";
    await updateL1Field(db, dryRun, "HS.20", L1_IDS.FanucAward, "notes", "notes",
      newNotes, "append ASI status angle", reports);
  }

  // HS.21 Rockwell Co-Marketing — technical detail
  {
    const l1 = await fetchL1(db, L1_IDS.RockwellCoMarketing);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "Digital twin, 3D animation, simulation. Virtual FAT/SAT. More info next week from Nicole.";
    await updateL1Field(db, dryRun, "HS.21", L1_IDS.RockwellCoMarketing, "notes", "notes",
      newNotes, "append technical detail from hot sheet", reports);
  }

  // HS.17 Big Win Template — notes only (dates handled in HS.17b below)
  {
    const l1 = await fetchL1(db, L1_IDS.BigWinTemplate);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "Brief sent to Lane 2026-04-22 (CC Jill). Target EOD 2026-04-23 — CGX just won largest project to-date, Kathy pushing for speed.";
    await updateL1Field(db, dryRun, "HS.17a", L1_IDS.BigWinTemplate, "notes", "notes",
      newNotes, "append brief-sent-4/22 context", reports);
  }

  // HS.24 LPPC Website Revamp — waitingOn + notes
  await updateL1Field(db, dryRun, "HS.24a", L1_IDS.LppcWebsiteRevamp, "waiting_on", "waitingOn",
    "Bill", "set waitingOn to Bill (LPPC owes 3 deliverables this week)", reports);
  {
    const l1 = await fetchL1(db, L1_IDS.LppcWebsiteRevamp);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "R3 pages reviewed (Leadership, Public Power, Advocacy). LPPC owes R3 feedback 2026-04-23, images all due 2026-04-24 (Friday), advocacy articles + tags due 2026-04-24. Per Kathy Slack 2026-04-22.";
    await updateL1Field(db, dryRun, "HS.24b", L1_IDS.LppcWebsiteRevamp, "notes", "notes",
      newNotes, "append LPPC Q-week deliverables (R3 feedback / images / advocacy)", reports);
  }

  // HS.28 LPPC Policy Materials Import — notes append
  {
    const l2 = await fetchL2(db, L2_IDS.LppcPolicyMaterials);
    const newNotes = (l2.notes ? l2.notes.trim() + "\n\n" : "") +
      "LPPC advocacy content delivery expected Friday 2026-04-24; import work starts 2026-04-27 once content lands.";
    await updateL2Field(db, dryRun, "HS.28", L2_IDS.LppcPolicyMaterials, "notes", "notes",
      newNotes, "append LPPC advocacy content delivery date", reports);
  }

  console.log("");
  console.log("── Wave 2: date rollbacks + L2 date fixes ──");

  // HS.06 AISTech 2026 L2 rename + date fix (5/4-5/7 → 5/4-5/6, title change)
  //   Rename happens via title update; date compression via updateL2Dates.
  await updateL2Field(db, dryRun, "HS.06a", L2_IDS.AIStechL2, "title", "title",
    "AISTech 2026", "rename from 'AIST tradeshow' to 'AISTech 2026' (hot sheet actual)", reports);
  await updateL2Dates(db, dryRun, "HS.06b", L2_IDS.AIStechL2,
    "2026-05-04", "2026-05-04", "2026-05-06",
    "tradeshow dates compressed May 4-6 per hot sheet (was May 4-7)", reports);

  // HS.05 B.1 Events Page endDate rollback — drop manual override, let L2 widths drive
  //   Current L1 endDate = 2026-11-30 (my tonight's override), mis-set.
  //   L2 max post-HS.06 = 2026-05-06 (AISTech end). Set endDate = 2026-05-06
  //   directly. startDate stays current.
  {
    const l1 = await fetchL1(db, L1_IDS.EventsPage);
    await updateL1Dates(db, dryRun, "HS.05", L1_IDS.EventsPage,
      l1.startDate, "2026-05-06",
      "endDate rolled back from manual override (11-30) to L2-width reality (5-06 = AISTech end); hot sheet shows W/O 4/20-4/27 as the update window, not Nov ongoing",
      reports);
  }

  // HS.17b Big Win Template dates (startDate 4/24 → 4/22, endDate 4/24 → 4/23)
  await updateL1Dates(db, dryRun, "HS.17b", L1_IDS.BigWinTemplate,
    "2026-04-22", "2026-04-23",
    "startDate 4/24 → 4/22 (brief received), endDate 4/24 → 4/23 (Lane's EOD target)", reports);

  // HS.25 LPPC R3 Design Review endDate 4/22 → 4/23
  {
    const l2 = await fetchL2(db, L2_IDS.LppcR3Review);
    const newNotes = "3 pages: Leadership, Public Power, Advocacy. Presented to client 4/21. Client feedback due 2026-04-23 (per Kathy Slack 2026-04-22).";
    await updateL2Dates(db, dryRun, "HS.25a", L2_IDS.LppcR3Review,
      l2.date, l2.startDate, "2026-04-23",
      "endDate 4/22 → 4/23 per Kathy Slack (client feedback slipped by a day)", reports);
    await updateL2Field(db, dryRun, "HS.25b", L2_IDS.LppcR3Review, "notes", "notes",
      newNotes, "notes refresh (feedback due 4/23)", reports);
  }

  // HS.26a — rename existing "Pencils Down + Images Due" → "Pencils Down", endDate stays 4/23, notes refresh
  await updateL2Field(db, dryRun, "HS.26a-title", L2_IDS.LppcPencilsDownImages, "title", "title",
    "Pencils Down",
    "rename — splitting images into dedicated L2 HS.26b", reports);
  await updateL2Field(db, dryRun, "HS.26a-notes", L2_IDS.LppcPencilsDownImages, "notes", "notes",
    "Our pencils-down date. LPPC-side image delivery tracked separately (HS.26b).",
    "notes refresh for split", reports);
  // Date stays 2026-04-23 single-day. No date change needed.

  console.log("");
  console.log("── Wave 3: status flips ──");

  // HS.11 Brand Guide v2 — blocked → in-production (trust hot sheet per operator)
  await updateL1Field(db, dryRun, "HS.11a", L1_IDS.BrandGuide, "status", "status",
    "in-production", "status flip: blocked → in-production (hot sheet authoritative per operator 2026-04-22)", reports);
  {
    const l1 = await fetchL1(db, L1_IDS.BrandGuide);
    const newNotes = (l1.notes ? l1.notes.trim() + "\n\n" : "") +
      "Hot sheet 2026-04-22: secondary palette build + Microsoft icons swap underway. Final files to Nicole 2026-04-23.";
    await updateL1Field(db, dryRun, "HS.11b", L1_IDS.BrandGuide, "notes", "notes",
      newNotes, "append hot sheet context for in-production flip", reports);
  }
  await updateL1Field(db, dryRun, "HS.11c", L1_IDS.BrandGuide, "waiting_on", "waitingOn",
    null, "clear waitingOn (JJ approval block released per hot sheet)", reports);

  // HS.12 Corporate Collateral — awaiting-client → in-production + notes + L2 statuses
  await updateL1Field(db, dryRun, "HS.12a", L1_IDS.CorporateCollateral, "status", "status",
    "in-production", "status flip: awaiting-client → in-production (R3 iteration active per hot sheet)", reports);
  await updateL1Field(db, dryRun, "HS.12b", L1_IDS.CorporateCollateral, "notes", "notes",
    `Brochure R3 shared 3/25 — active iteration: Passion Icon replacement, Awards + Certifications section, Siemens logo to partners bottom row. PPT parallel: new slide for recent Awards + Certifications. Both held as one release until Daniel's certs + Fanuc details arrive (post-4/28).`,
    "notes refresh reflecting active design per hot sheet", reports);
  for (let i = 0; i < CORP_COLLATERAL_L2_IDS.length; i++) {
    const l2Id = CORP_COLLATERAL_L2_IDS[i];
    await updateL2Field(db, dryRun, `HS.12c-${i + 1}`, l2Id, "status", "status",
      "in-progress", "L2 status blocked → in-progress (parent L1 flipped to in-production)", reports);
  }

  console.log("");
  console.log("── Wave 4: new L2 creations ──");

  // HS.08 New L2 — Rockwell PartnerNetwork: Partner-of-Year image swap (Jill update #1)
  await createL2(db, dryRun, "HS.08", L1_IDS.RockwellPartnerNetwork, convergixClientId, {
    title: "Partner-of-Year image swap — push live",
    category: "delivery",
    status: "in-progress",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Swap the OEM Partner-of-Year article image per Jill's updates sheet. Image: PNC2026_AwardWinners_PartneroftheYear-OEM.jpg. Deadline 2026-05-01.",
    startDate: "2026-04-22",
    endDate: "2026-05-01",
  }, reports);

  // HS.10 New L2 — TI award copy + image to /news (Jill update #2)
  await createL2(db, dryRun, "HS.10", L1_IDS.TexasInstruments, convergixClientId, {
    title: "TI award copy + image — post to /news",
    category: "delivery",
    status: "in-progress",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Post TI award copy + image to /news per Jill's sheet. Deadline 2026-05-01.",
    startDate: "2026-04-22",
    endDate: "2026-05-01",
  }, reports);

  // HS.13 New L2 — Corporate Collateral v2026 — Live (launch milestone)
  await createL2(db, dryRun, "HS.13", L1_IDS.CorporateCollateral, convergixClientId, {
    title: "Corporate Collateral v2026 — Live",
    category: "delivery",
    status: null,
    owner: "Kathy",
    resources: "CD: Lane",
    notes: "Delivery milestone for brochure + PPT bundle. Anchors L1 endDate under retainer-v4 recompute. Flip to in-progress when kickoff L2s complete.",
    startDate: "2026-06-30",
    endDate: "2026-06-30",
  }, reports);

  // HS.15 New L2 — Industry Verticals Retainer Period Close
  await createL2(db, dryRun, "HS.15", L1_IDS.IndustryVerticals, convergixClientId, {
    title: "Industry Verticals — Retainer Period Close",
    category: "delivery",
    status: null,
    owner: "Kathy",
    resources: "CW: Kathy, CD: Lane, Dev: Leslie",
    notes: "End-of-retainer milestone anchor for CDS + Industrial/Battery Assembly verticals. Held for retainer-aware L1 endDate anchoring.",
    startDate: "2026-07-31",
    endDate: "2026-07-31",
  }, reports);

  // HS.26b New LPPC L2 — Images Due (split from HS.26a)
  {
    const l1 = await fetchL1(db, L1_IDS.LppcWebsiteRevamp);
    await createL2(db, dryRun, "HS.26b", L1_IDS.LppcWebsiteRevamp, l1.clientId, {
      title: "LPPC Images Due",
      category: "approval",
      status: null,
      owner: "Kathy",
      resources: null,
      notes: "LPPC images all due Friday 2026-04-24. Per Kathy Slack 2026-04-22.",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    }, reports);
  }

  // HS.27 New LPPC L2 — Advocacy Articles + Tags Due
  {
    const l1 = await fetchL1(db, L1_IDS.LppcWebsiteRevamp);
    await createL2(db, dryRun, "HS.27", L1_IDS.LppcWebsiteRevamp, l1.clientId, {
      title: "LPPC Advocacy Articles + Tags Due",
      category: "approval",
      status: null,
      owner: "Kathy",
      resources: null,
      notes: "Upstream of Policy Materials Import L2 (2026-04-27). Per Kathy Slack 2026-04-22.",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    }, reports);
  }

  console.log("");
  console.log("── Wave 5: new L1 + L2 (AUTOMATE Booth Design) ──");

  // HS.22 New L1 — AUTOMATE 2026 Booth Design
  const boothL1Id = genId();
  await createL1(db, dryRun, "HS.22", convergixClientId, boothL1Id, {
    name: "AUTOMATE 2026 Booth Design",
    status: "in-production",
    category: "active",
    owner: "Kathy",
    resources: "CD: Lane",
    waitingOn: "Nicole",
    notes: "8-wall booth for AUTOMATE June 22-25 (Detroit). 4 walls industry focuses, 1 map, 1 Convergix overview, plus storage + meeting room inside booth. Nicole sending panel designs. Room dimensions needed.",
    startDate: "2026-04-22",
    endDate: "2026-06-22",
    engagementType: "retainer",
    contractStart: "2026-02-01",
    contractEnd: "2026-07-31",
    parentProjectId: null,
  }, reports);

  // HS.23 New L2 under booth L1 — Booth Layout + Room Dimensions
  //   In DRY_RUN, boothL1Id is provisional — L2 create is still logged so
  //   operator sees the full plan; actual insert gated by APPLY branch of
  //   createL2 (which skips if dryRun).
  await createL2(db, dryRun, "HS.23", boothL1Id, convergixClientId, {
    title: "Booth Layout + Room Dimensions — Nicole",
    category: "kickoff",
    status: "in-progress",
    owner: "Kathy",
    resources: "CD: Lane",
    notes: "Booth layout due end of week 2026-04-24 from Nicole. 8 walls, storage + meeting room. Room dimensions required for layout.",
    startDate: "2026-04-22",
    endDate: "2026-04-24",
  }, reports);

  // ==========================================================
  // Summary
  // ==========================================================

  console.log("");
  console.log("=== Summary ===");
  const applied = reports.filter((r) => r.applied).length;
  const dry = reports.filter((r) => !r.applied).length;
  console.log(`  Ops reported: ${reports.length}`);
  console.log(`  Applied: ${applied}`);
  console.log(`  Dry-run logged: ${dry}`);
  console.log(`  Mode: ${dryRun ? "DRY-RUN (no changes)" : "APPLIED"}`);
  console.log(`  Batch: ${BATCH_ID}`);

  db.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
