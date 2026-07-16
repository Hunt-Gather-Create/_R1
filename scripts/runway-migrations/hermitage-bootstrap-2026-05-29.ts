/**
 * Hermitage — Bootstrap new client + L1 + intro-call WI + Pipeline item
 *
 * Operator decisions (2026-05-29):
 *   - New client: Hermitage (slug=hermitage, contract unsigned)
 *   - L1: "BI Power Reports - Middleware" (engagementType=project, scoped work)
 *   - WI: "Schedule Intro Call" — Monday 6/1, owner Jason, AM: Jason, scheduled
 *   - Pipeline item: name matches L1, status=scoping, value=$20,000, owner Jason
 *
 * Order of ops (lookup-key safety):
 *   1. Create client (others depend on slug existing)
 *   2. Create L1 project
 *   3. Create WI under L1
 *   4. Create Pipeline item (independent, but linked by clientSlug)
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
} from "@/lib/db/runway-schema";
import { createClient } from "@/lib/runway/operations-writes-client";
import { addProject } from "@/lib/runway/operations-add";
import { createWeekItem } from "@/lib/runway/operations-writes-week";
import { createPipelineItem } from "@/lib/runway/operations-writes-pipeline";

const UPDATED_BY = "hermitage-bootstrap-2026-05-29";

const CLIENT = {
  name: "Hermitage",
  slug: "hermitage",
  contractStatus: "unsigned",
};

const L1 = {
  name: "BI Power Reports - Middleware",
  engagementType: "project",
  status: "not-started",
  category: "active",
};

const WI = {
  title: "Schedule Intro Call",
  startDate: "2026-06-01",
  endDate: "2026-06-01",
  weekOf: "2026-06-01",
  dayOfWeek: "monday",
  status: "scheduled",
  owner: "Jason",
  resources: "AM: Jason",
  notes:
    "Get the intro call on the calendar with Hermitage to kick off BI Power Reports - Middleware scoping.",
};

const PIPELINE = {
  name: "BI Power Reports - Middleware",
  status: "scoping",
  estimatedValue: "$20,000",
  owner: "Jason",
  notes: "Intro call scheduled for Monday 6/1. New opportunity.",
};

const PRE_SNAPSHOT_PATH = "docs/tmp/hermitage-bootstrap-pre-2026-05-29.json";
const POST_SNAPSHOT_PATH = "docs/tmp/hermitage-bootstrap-post-2026-05-29.json";

export const description =
  "Hermitage — Bootstrap new client + L1 BI Power Reports - Middleware + intro-call WI + Pipeline ($20K)";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("--- Step 1: Pre-check ---");
  await preChecks(ctx);

  if (!ctx.dryRun) {
    await snapshot(ctx, PRE_SNAPSHOT_PATH, "pre");
    ctx.log(`  Pre-snapshot written: ${PRE_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would write pre-snapshot");
  }

  // ── Phase A — Create client ─────────────────────────────
  ctx.log(
    `--- Phase A: Create client "${CLIENT.name}" (slug=${CLIENT.slug}) ---`
  );
  if (!ctx.dryRun) {
    const r = await createClient({
      name: CLIENT.name,
      slug: CLIENT.slug,
      contractStatus: CLIENT.contractStatus,
      updatedBy: UPDATED_BY,
    });
    if (!r.ok) throw new Error(`createClient failed: ${r.error}`);
  }

  // ── Phase B — Create L1 project ─────────────────────────
  ctx.log(
    `--- Phase B: Create L1 "${L1.name}" (engType=${L1.engagementType}) ---`
  );
  if (!ctx.dryRun) {
    const r = await addProject({
      clientSlug: CLIENT.slug,
      name: L1.name,
      engagementType: L1.engagementType,
      status: L1.status,
      category: L1.category,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`addProject failed: ${r.error}`);
  }

  // ── Phase C — Create WI under L1 ────────────────────────
  ctx.log(`--- Phase C: Create WI "${WI.title}" Monday ${WI.startDate} ---`);
  if (!ctx.dryRun) {
    const r = await createWeekItem({
      clientSlug: CLIENT.slug,
      projectName: L1.name,
      weekOf: WI.weekOf,
      dayOfWeek: WI.dayOfWeek,
      title: WI.title,
      status: WI.status,
      owner: WI.owner,
      resources: WI.resources,
      notes: WI.notes,
      startDate: WI.startDate,
      endDate: WI.endDate,
      updatedBy: UPDATED_BY,
      source: "migration",
    });
    if (!r.ok) throw new Error(`createWeekItem failed: ${r.error}`);
  }

  // ── Phase D — Create Pipeline item ──────────────────────
  ctx.log(
    `--- Phase D: Create Pipeline item "${PIPELINE.name}" @ ${PIPELINE.estimatedValue} (${PIPELINE.status}) ---`
  );
  if (!ctx.dryRun) {
    const r = await createPipelineItem({
      clientSlug: CLIENT.slug,
      name: PIPELINE.name,
      status: PIPELINE.status,
      estimatedValue: PIPELINE.estimatedValue,
      owner: PIPELINE.owner,
      notes: PIPELINE.notes,
      updatedBy: UPDATED_BY,
    });
    if (!r.ok) throw new Error(`createPipelineItem failed: ${r.error}`);
  }

  ctx.log("--- Step 3: Verify ---");
  if (!ctx.dryRun) {
    await verify(ctx);
    await snapshot(ctx, POST_SNAPSHOT_PATH, "post");
    ctx.log(`  Post-snapshot written: ${POST_SNAPSHOT_PATH}`);
  } else {
    ctx.log("  [DRY] would verify + write post-snapshot");
  }

  ctx.log("--- Done ---");
}

async function preChecks(ctx: MigrationContext): Promise<void> {
  // Hermitage must NOT already exist.
  const [existingClient] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, CLIENT.slug));
  if (existingClient) {
    throw new Error(
      `Client slug '${CLIENT.slug}' already exists (name='${existingClient.name}', id=${existingClient.id}). Migration assumes Hermitage is brand new.`
    );
  }

  // No collision on the L1 name (across all clients, since names should be unique-ish)
  const allProjects = await ctx.db.select().from(projects);
  const projCollision = allProjects.find((p) => p.name === L1.name);
  if (projCollision) {
    throw new Error(
      `Project name "${L1.name}" already exists (id=${projCollision.id}). Pick a different name or expand to handle merge.`
    );
  }

  // No collision on the WI title
  const [wiCollision] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, WI.title));
  if (wiCollision) {
    throw new Error(
      `WI title "${WI.title}" already exists (id=${wiCollision.id}). Pick a different title.`
    );
  }

  // No collision on the Pipeline name
  const allPipeline = await ctx.db.select().from(pipelineItems);
  const pipeCollision = allPipeline.find((p) => p.name === PIPELINE.name);
  if (pipeCollision) {
    throw new Error(
      `Pipeline item "${PIPELINE.name}" already exists (id=${pipeCollision.id}).`
    );
  }

  ctx.log(
    `  Pre-checks pass: no Hermitage client, no project/WI/pipeline collisions`
  );
}

async function verify(ctx: MigrationContext): Promise<void> {
  const [client] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, CLIENT.slug));
  if (!client) throw new Error(`Post: Hermitage client not found.`);
  if (client.name !== CLIENT.name)
    throw new Error(`Post: client name '${client.name}'.`);
  if (client.contractStatus !== CLIENT.contractStatus) {
    throw new Error(`Post: client contractStatus '${client.contractStatus}'.`);
  }

  const [l1] = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.name, L1.name));
  if (!l1) throw new Error(`Post: L1 "${L1.name}" not found.`);
  if (l1.clientId !== client.id) throw new Error(`Post: L1 clientId mismatch.`);
  if (l1.engagementType !== L1.engagementType) {
    throw new Error(`Post: L1 engType '${l1.engagementType}'.`);
  }
  if (l1.status !== L1.status)
    throw new Error(`Post: L1 status '${l1.status}'.`);
  if (l1.parentProjectId !== null)
    throw new Error(`Post: L1 should be top-level (parentProjectId=null).`);

  const [wi] = await ctx.db
    .select()
    .from(weekItems)
    .where(eq(weekItems.title, WI.title));
  if (!wi) throw new Error(`Post: WI "${WI.title}" not found.`);
  if (wi.projectId !== l1.id)
    throw new Error(`Post: WI projectId not pointing at new L1.`);
  if (wi.startDate !== WI.startDate || wi.endDate !== WI.endDate) {
    throw new Error(`Post: WI dates drift.`);
  }
  if (wi.owner !== WI.owner) throw new Error(`Post: WI owner '${wi.owner}'.`);
  if (wi.resources !== WI.resources)
    throw new Error(`Post: WI resources '${wi.resources}'.`);

  const [pipeline] = await ctx.db
    .select()
    .from(pipelineItems)
    .where(eq(pipelineItems.name, PIPELINE.name));
  if (!pipeline)
    throw new Error(`Post: Pipeline "${PIPELINE.name}" not found.`);
  if (pipeline.clientId !== client.id)
    throw new Error(`Post: Pipeline clientId mismatch.`);
  if (pipeline.status !== PIPELINE.status) {
    throw new Error(`Post: Pipeline status '${pipeline.status}'.`);
  }
  if (pipeline.estimatedValue !== PIPELINE.estimatedValue) {
    throw new Error(
      `Post: Pipeline estimatedValue '${pipeline.estimatedValue}'.`
    );
  }

  ctx.log(
    `  Verified: client + L1 + WI + Pipeline all created and linked correctly`
  );
}

async function snapshot(
  ctx: MigrationContext,
  relativePath: string,
  phase: "pre" | "post"
): Promise<void> {
  // Pre-snapshot: no Hermitage yet, capture pipeline-wide for diffing.
  // Post-snapshot: full Hermitage state.
  const allClients = await ctx.db.select().from(clients);
  const allProjects = await ctx.db.select().from(projects);
  const allWis = await ctx.db.select().from(weekItems);
  const allPipeline = await ctx.db.select().from(pipelineItems);
  const payload = {
    pulledAt: new Date().toISOString(),
    phase,
    clients: allClients,
    projects: allProjects,
    weekItems: allWis,
    pipelineItems: allPipeline,
  };
  const fullPath = resolvePath(process.cwd(), relativePath);
  if (!existsSync(dirname(fullPath)))
    mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}
