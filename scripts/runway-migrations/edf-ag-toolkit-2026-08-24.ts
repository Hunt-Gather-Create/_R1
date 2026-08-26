/**
 * EDF Ag Toolkit — build project from the client schedule sheet (2026-08-24)
 *
 * Source sheet: 11MhM5qbVKGAvOUHYK46wA5lnVFC5u5beoRljQ6TxhlQ
 *   "EDF-2606-01 | CPG Toolkit Website - Project Plan v2" → "Task Tracker & Gantt Chart"
 *
 * Operator: Kathy Horn (full authority confirmed by Jason Burks 2026-08-24).
 *
 * Kathy's rulings applied:
 *   - Project is named "Ag Toolkit" (sheet title says CPG Toolkit; she overrode).
 *   - Roles: Lead Kathy Horn, Dev Martin (freelance), QA Leslie Crosby.
 *     Sheet had Leslie on the build rows; those move to Martin.
 *   - Checked box = complete, EXCEPT section 3 where she corrected per-row:
 *     3.1-3.4 done, 3.5 NOT done. 3.5 moves Aug 10 → Aug 27 (design lock date).
 *   - EDF contract flipped unsigned → signed.
 *   - EDF lead Jill (inactive) → Kathy.
 *   - The 8 "*** STAGE N COMPLETE ***" marker rows are NOT imported (the
 *     section carries its own end date + status; markers would duplicate).
 *
 * Shape: L1 project → L3 sections (7) → L4 tasks (29).
 * NOTE: this is the FIRST production use of the L3 sections layer (0 rows
 * before this batch). Verify render on the live board before extending.
 *
 * REVERT: scripts/runway-migrations/edf-ag-toolkit-2026-08-24-REVERT.ts
 */

import { writeFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, sections, weekItems } from "@/lib/db/runway-schema";
import { addProject } from "@/lib/runway/operations-add";
import { createSection } from "@/lib/runway/operations-writes-section";
import { createWeekItem } from "@/lib/runway/operations-writes-week";
import { createTeamMember } from "@/lib/runway/operations-writes-team";
import { updateClientField } from "@/lib/runway/operations-writes-client";

const UPDATED_BY = "kathy-freshness-2026-08-24";
const PROJECT_NAME = "Ag Toolkit";
const POST_PATH = "docs/tmp/data/edf-ag-toolkit-2026-08-24-post.json";

const KATHY = "Kathy Horn";
const LANE = "Lane Jordan";
const LESLIE = "Leslie Crosby";
const MARTIN = "Martin";

type Task = {
  no: string; title: string; start: string; end: string;
  status: string; owner: string; resources: string;
};
type Section = {
  title: string; start: string; end: string; status: string; tasks: Task[];
};

const PLAN: Section[] = [
  {
    title: "Kickoff & Brief", start: "2026-06-30", end: "2026-06-30", status: "completed",
    tasks: [
      { no: "1.1", title: "Walk Creative Brief & Q/A", start: "2026-06-30", end: "2026-06-30", status: "completed", owner: KATHY, resources: `Lead: ${KATHY}, Client: EDF` },
      { no: "1.2", title: "Schedule EDF dev team call", start: "2026-06-30", end: "2026-06-30", status: "completed", owner: KATHY, resources: `Lead: ${KATHY}` },
    ],
  },
  {
    title: "Design Round 1", start: "2026-07-06", end: "2026-07-17", status: "completed",
    tasks: [
      { no: "2.1", title: "Design build (two look options)", start: "2026-07-06", end: "2026-07-10", status: "completed", owner: LANE, resources: `Design: ${LANE}` },
      { no: "2.2", title: "Internal design review", start: "2026-07-10", end: "2026-07-10", status: "completed", owner: LANE, resources: `Design: ${LANE}, Lead: ${KATHY}` },
      { no: "2.3", title: "Send Round 1 to Client", start: "2026-07-10", end: "2026-07-10", status: "completed", owner: KATHY, resources: `Lead: ${KATHY}` },
      { no: "2.4", title: "EDF Round 1 review", start: "2026-07-15", end: "2026-07-17", status: "completed", owner: KATHY, resources: "Client: EDF" },
      { no: "2.5", title: "Round 1 feedback received", start: "2026-07-17", end: "2026-07-17", status: "completed", owner: KATHY, resources: "Client: EDF" },
    ],
  },
  {
    title: "Design Round 2", start: "2026-07-20", end: "2026-08-27", status: "in-progress",
    tasks: [
      { no: "3.1", title: "Round 1 revisions (narrow to single direction)", start: "2026-07-20", end: "2026-07-29", status: "completed", owner: LANE, resources: `Design: ${LANE}` },
      { no: "3.2", title: "Internal QA + Proofing", start: "2026-07-29", end: "2026-07-30", status: "completed", owner: LESLIE, resources: `QA: ${LESLIE}` },
      { no: "3.3", title: "EDF Round 2 review", start: "2026-07-31", end: "2026-07-31", status: "completed", owner: KATHY, resources: "Client: EDF" },
      { no: "3.4", title: "Send Round 2 to Client (final approval pass)", start: "2026-07-31", end: "2026-08-10", status: "completed", owner: KATHY, resources: `Lead: ${KATHY}` },
      { no: "3.5", title: "Design approval received", start: "2026-08-27", end: "2026-08-27", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
    ],
  },
  {
    title: "Build", start: "2026-08-28", end: "2026-09-21", status: "scheduled",
    tasks: [
      { no: "4.1", title: "Design to build handoff", start: "2026-08-28", end: "2026-09-03", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}, Design: ${LANE}` },
      { no: "4.2", title: "Dev requirements alignment with EDF", start: "2026-08-28", end: "2026-08-28", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}, Lead: ${KATHY}` },
      { no: "4.3", title: "Site build", start: "2026-09-04", end: "2026-09-17", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}` },
      { no: "4.4", title: "Internal Dev QA (accessibility, browser, perf)", start: "2026-09-17", end: "2026-09-21", status: "scheduled", owner: LESLIE, resources: `QA: ${LESLIE}` },
    ],
  },
  {
    title: "Client Review", start: "2026-09-21", end: "2026-10-07", status: "scheduled",
    tasks: [
      { no: "5.1", title: "Send build to Client", start: "2026-09-21", end: "2026-09-21", status: "scheduled", owner: KATHY, resources: `Lead: ${KATHY}` },
      { no: "5.2", title: "EDF review", start: "2026-09-21", end: "2026-09-25", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
      { no: "5.3", title: "Feedback received", start: "2026-09-25", end: "2026-09-25", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
      { no: "5.4", title: "Feedback adjustments", start: "2026-09-28", end: "2026-10-02", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}` },
      { no: "5.5", title: "Send final to Client", start: "2026-10-02", end: "2026-10-02", status: "scheduled", owner: KATHY, resources: `Lead: ${KATHY}` },
      { no: "5.6", title: "Final approval (light pass)", start: "2026-10-05", end: "2026-10-06", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
    ],
  },
  {
    title: "Soft Launch", start: "2026-10-08", end: "2026-10-22", status: "scheduled",
    tasks: [
      { no: "6.1", title: "Soft Launch", start: "2026-10-08", end: "2026-10-08", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}` },
      { no: "6.2", title: "Post-soft launch review", start: "2026-10-09", end: "2026-10-22", status: "scheduled", owner: KATHY, resources: `Lead: ${KATHY}, Client: EDF` },
    ],
  },
  {
    title: "Post-Launch Edits", start: "2026-10-23", end: "2026-11-06", status: "scheduled",
    tasks: [
      { no: "7.1", title: "EDF provides consolidated company feedback", start: "2026-10-23", end: "2026-10-29", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
      { no: "7.2", title: "Feedback received", start: "2026-10-29", end: "2026-10-29", status: "scheduled", owner: KATHY, resources: "Client: EDF" },
      { no: "7.3", title: "Feedback adjustments", start: "2026-10-29", end: "2026-11-06", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}, Client: EDF` },
      { no: "7.4", title: "Adjustments Pushed Live", start: "2026-11-06", end: "2026-11-06", status: "scheduled", owner: MARTIN, resources: `Dev: ${MARTIN}` },
      { no: "7.5", title: "Sign-off", start: "2026-11-06", end: "2026-11-06", status: "scheduled", owner: KATHY, resources: `Lead: ${KATHY}, Client: EDF` },
    ],
  },
];

export const description =
  "EDF Ag Toolkit — create Martin (contractor), flip EDF to signed, reassign lead to Kathy, and build the L1 project + 7 L3 sections + 29 L4 tasks from the client schedule sheet.";

function ok<T>(label: string, r: { ok: boolean; error?: string; data?: T }): T {
  if (!r.ok) throw new Error(`${label} FAILED: ${r.error}`);
  return r.data as T;
}

export async function up(ctx: MigrationContext): Promise<void> {
  const { db, dryRun } = ctx;

  // ── Step 0: preconditions ────────────────────────────────
  ctx.log("--- Step 0: preconditions ---");
  const edf = (await db.select().from(clients).where(eq(clients.slug, "edf")).limit(1))[0];
  if (!edf) throw new Error("EDF client not found — aborting.");
  ctx.log(`EDF found: id=${edf.id.slice(0, 8)} contractStatus=${edf.contractStatus} team=${edf.team}`);

  const dupe = (await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, edf.id), eq(projects.name, PROJECT_NAME)))
    .limit(1))[0];
  if (dupe) throw new Error(`Project '${PROJECT_NAME}' already exists for EDF (${dupe.id.slice(0, 8)}) — aborting to avoid a duplicate.`);
  ctx.log(`No existing '${PROJECT_NAME}' for EDF. Safe to create.`);

  const totalTasks = PLAN.reduce((n, s) => n + s.tasks.length, 0);
  ctx.log(`Plan: 1 team member, 2 client field updates, 1 project, ${PLAN.length} sections, ${totalTasks} tasks.`);

  if (dryRun) {
    ctx.log("--- DRY RUN: no writes performed. Planned shape: ---");
    for (const s of PLAN) {
      ctx.log(`  SECTION ${s.title}  ${s.start} -> ${s.end}  [${s.status}]`);
      for (const t of s.tasks) ctx.log(`     ${t.no} ${t.title}  ${t.start}->${t.end} [${t.status}] ${t.owner}`);
    }
    return;
  }

  // ── Step 1: Martin (freelance dev → contractor) ──────────
  ctx.log("--- Step 1: create team member Martin ---");
  ok("createTeamMember(Martin)", await createTeamMember({
    name: MARTIN,
    firstName: MARTIN,
    fullName: MARTIN,
    title: "Freelance Developer",
    roleCategory: "contractor",
    updatedBy: UPDATED_BY,
  }));
  ctx.log("Martin created (contractor, Freelance Developer). Slack ID not set — cannot self-report yet.");

  // ── Step 2: EDF client corrections ───────────────────────
  ctx.log("--- Step 2: EDF client field updates ---");
  ok("contractStatus", await updateClientField({
    clientSlug: "edf", field: "contractStatus", newValue: "signed", updatedBy: UPDATED_BY,
  }));
  ok("team", await updateClientField({
    clientSlug: "edf", field: "team", newValue: `${KATHY} (lead)`, updatedBy: UPDATED_BY,
  }));
  ctx.log("EDF: contractStatus unsigned -> signed; team Jill (lead) -> Kathy Horn (lead).");

  // ── Step 3: L1 project ───────────────────────────────────
  ctx.log("--- Step 3: create L1 project ---");
  ok("addProject", await addProject({
    clientSlug: "edf",
    name: PROJECT_NAME,
    status: "in-production",
    category: "active",
    owner: KATHY,
    resources: `Lead: ${KATHY}, Dev: ${MARTIN}, QA: ${LESLIE}, Design: ${LANE}`,
    engagementType: "project",
    startDate: "2026-06-30",
    endDate: "2026-11-06",
    notes: "EDF-2606-01. Built from the client schedule sheet 2026-08-24. Design locks 8/27, dev handoff 8/28 with no cushion between them. Sign-off 11/6.",
    updatedBy: UPDATED_BY,
  }));
  const proj = (await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.clientId, edf.id), eq(projects.name, PROJECT_NAME)))
    .limit(1))[0];
  if (!proj) throw new Error("Project created but could not be re-read — aborting before sections.");
  ctx.log(`Project created: ${proj.id.slice(0, 8)}`);

  // ── Step 4: L3 sections + L4 tasks ───────────────────────
  let sectionN = 0;
  let taskN = 0;
  for (const [i, s] of PLAN.entries()) {
    const created = ok(`createSection(${s.title})`, await createSection({
      projectId: proj.id,
      title: s.title,
      sortOrder: (i + 1) * 10,
      status: s.status,
      startDate: s.start,
      endDate: s.end,
      updatedBy: UPDATED_BY,
    })) as { sectionId: string };
    sectionN++;
    ctx.log(`  SECTION ${s.title} -> ${created.sectionId.slice(0, 8)} [${s.status}]`);

    for (const t of s.tasks) {
      ok(`createWeekItem(${t.no})`, await createWeekItem({
        sectionId: created.sectionId,
        taskNo: t.no,
        title: t.title,
        status: t.status,
        startDate: t.start,
        endDate: t.end,
        owner: t.owner,
        resources: t.resources,
        updatedBy: UPDATED_BY,
      }));
      taskN++;
      ctx.log(`     ${t.no} ${t.title} [${t.status}]`);
    }
  }

  // ── Step 5: post-state snapshot ──────────────────────────
  const postSections = await db.select().from(sections).where(eq(sections.projectId, proj.id));
  const postTasks = await db.select().from(weekItems).where(eq(weekItems.projectId, proj.id));
  writeFileSync(POST_PATH, JSON.stringify({ projectId: proj.id, sections: postSections, tasks: postTasks }, null, 1));

  ctx.log(`--- DONE: ${sectionN} sections, ${taskN} tasks. Post-state: ${POST_PATH} ---`);
  if (postSections.length !== PLAN.length) throw new Error(`Section count mismatch: expected ${PLAN.length}, got ${postSections.length}`);
  if (postTasks.length !== totalTasks) throw new Error(`Task count mismatch: expected ${totalTasks}, got ${postTasks.length}`);
  ctx.log("Counts verified against plan.");
}
