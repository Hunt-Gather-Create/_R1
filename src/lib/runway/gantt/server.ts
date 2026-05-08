/**
 * Gantt share server module — generateGanttShare() and supporting resolvers.
 *
 * This module is the src/-side equivalent of scripts/lib/gantt/{resolve-entity,
 * extract-data, rundown}.ts. It authors fresh async DB-coupled wrappers that
 * use the same pure helpers from src/lib/runway/gantt/* so both paths are
 * byte-equivalent by construction.
 *
 * Do NOT import from scripts/lib/gantt/ here — scripts/ is operator-locked
 * until Phase D. Use @/lib/runway/gantt/* aliases for pure helpers.
 */

import crypto from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects as projectsTable,
  weekItems,
} from "@/lib/db/runway-schema";
import { uploadContent } from "@/lib/storage/r2-client";
import { withRunwayRetry } from "@/lib/runway/retry";
import {
  classifyProject,
  resolveClientFromList,
  resolveProjectFromList,
} from "@/lib/runway/gantt/resolve-helpers";
import { buildRawData } from "@/lib/runway/gantt/build-raw-data";
import {
  detectChildProjectIssues,
} from "@/lib/runway/gantt/detect-issues";
import {
  addSeverity,
  buildL1SectionData,
  buildWrapperSectionData,
  slugAnchor,
} from "@/lib/runway/gantt/section-builders";
import {
  renderGantt,
  renderClientRundown,
} from "@/lib/runway/gantt/GanttTemplate";
import { makePayload, signPayload } from "@/lib/runway/gantt/share-token";
import type {
  ClientRow,
  ClientRundownData,
  ProjectRow,
  RawData,
  ResolveClientResult,
  ResolveProjectResult,
  ResolvedSubject,
  RundownSection,
  SeverityCounts,
  WeekItemRow,
} from "@/lib/runway/gantt/types";
import type { Theme } from "@/lib/runway/gantt/types";

// ── R2 config check ───────────────────────────────────────

function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

// ── DB type alias ──────────────────────────────────────────

type DrizzleDb = ReturnType<typeof getRunwayDb>;

// ── Async resolvers (src/-side, mirrors scripts/lib/gantt/) ──

export async function resolveClient(
  db: DrizzleDb,
  input: string,
): Promise<ResolveClientResult> {
  const allClients = await db.select().from(clients);
  const result = resolveClientFromList(allClients, input);
  if (!result.ok) return result;

  const topLevelProjects = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.clientId, result.client.id),
        isNull(projectsTable.parentProjectId),
      ),
    );

  return { ok: true, client: result.client, topLevelProjects };
}

export async function resolveProject(
  db: DrizzleDb,
  input: string,
): Promise<ResolveProjectResult> {
  const [allClients, allProjects] = await Promise.all([
    db.select().from(clients),
    db.select().from(projectsTable),
  ]);
  const clientsById = new Map(allClients.map((c) => [c.id, c]));

  const result = resolveProjectFromList(allProjects, clientsById, input);
  if (!result.ok) return result;

  const childProjects = allProjects.filter(
    (p) => p.parentProjectId === result.project.id,
  );
  return { ok: true, subject: classifyProject(result.project, childProjects) };
}

export async function extractData(
  db: DrizzleDb,
  subject: ResolvedSubject,
  client: ClientRow,
): Promise<RawData> {
  const items = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.projectId, subject.project.id));
  return buildRawData(subject, client, items);
}

const ZERO: SeverityCounts = { critical: 0, warn: 0, info: 0 };

export async function extractClientRundown(
  db: DrizzleDb,
  client: ClientRow,
  topLevelProjects: ProjectRow[],
  generatedAt: string,
  todayISO: string,
): Promise<ClientRundownData> {
  type ClassifiedTop =
    | { kind: "wrapper"; project: ProjectRow; children: ProjectRow[] }
    | { kind: "standalone"; project: ProjectRow };

  // Batch-fetch all children for top-level projects in a single query, then
  // group by parentProjectId via a Map. Replaces a prior N+1 loop that issued
  // one query per top-level project.
  const childrenByParent = new Map<string, ProjectRow[]>();
  if (topLevelProjects.length > 0) {
    const allChildren = await withRunwayRetry(
      () =>
        db
          .select()
          .from(projectsTable)
          .where(
            inArray(
              projectsTable.parentProjectId,
              topLevelProjects.map((p) => p.id),
            ),
          ),
      "extractClientRundown:children",
    );
    for (const child of allChildren) {
      const pid = child.parentProjectId;
      if (!pid) continue;
      const arr = childrenByParent.get(pid);
      if (arr) arr.push(child);
      else childrenByParent.set(pid, [child]);
    }
  }

  const classified: ClassifiedTop[] = [];
  for (const top of topLevelProjects) {
    const children = childrenByParent.get(top.id) ?? [];
    if (
      top.parentProjectId === null &&
      top.engagementType === "retainer" &&
      children.length > 0
    ) {
      classified.push({ kind: "wrapper", project: top, children });
    } else {
      classified.push({ kind: "standalone", project: top });
    }
  }

  const idsNeedingWeekItems = new Set<string>();
  for (const c of classified) {
    if (c.kind === "wrapper") {
      idsNeedingWeekItems.add(c.project.id);
      for (const child of c.children) idsNeedingWeekItems.add(child.id);
    } else {
      idsNeedingWeekItems.add(c.project.id);
    }
  }

  const wiByProject = new Map<string, WeekItemRow[]>();
  if (idsNeedingWeekItems.size > 0) {
    const all = await withRunwayRetry(
      () =>
        db
          .select()
          .from(weekItems)
          .where(inArray(weekItems.projectId, Array.from(idsNeedingWeekItems))),
      "extractClientRundown:weekItems",
    );
    for (const w of all) {
      const pid = w.projectId;
      if (!pid) continue;
      const arr = wiByProject.get(pid);
      if (arr) arr.push(w);
      else wiByProject.set(pid, [w]);
    }
  }

  function hasContent(c: ClassifiedTop): boolean {
    if (c.kind === "wrapper") return true;
    return (wiByProject.get(c.project.id) ?? []).length > 0;
  }
  classified.sort((a, b) => {
    const ac = hasContent(a) ? 0 : 1;
    const bc = hasContent(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return a.project.name.localeCompare(b.project.name);
  });

  const sections: RundownSection[] = [];
  const overall: SeverityCounts = { ...ZERO };

  for (const c of classified) {
    if (c.kind === "wrapper") {
      const orphanItems = (wiByProject.get(c.project.id) ?? []).map((w) => ({
        id: w.id,
        title: w.title,
      }));
      const wrapperData = buildWrapperSectionData(
        c.project,
        client,
        c.children,
        orphanItems,
        generatedAt,
        todayISO,
      );
      sections.push({
        anchor: slugAnchor(c.project.name),
        kind: "wrapper",
        title: c.project.name,
        data: wrapperData,
      });
      addSeverity(overall, wrapperData.summary.severity);

      const sortedChildren = [...c.children].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const child of sortedChildren) {
        const wis = wiByProject.get(child.id) ?? [];
        // Issue 2 (operator-locked 2026-05-05, Option A HIGH confidence):
        // wrapper-children with 0 weekItems do NOT render as their own
        // expanded section block — the L1 still appears in the wrapper's
        // top rows as a bar (data-gap surface), but skip the orphan
        // empty-section that has no L2s to drill into. This filter is
        // extract-time so both light + dark render paths pick it up
        // uniformly without duplicated logic.
        if (wis.length === 0) continue;
        const relationship = detectChildProjectIssues(child, c.project);
        const extraChart = [...relationship.inline, ...relationship.subRow];
        const childData = buildL1SectionData(
          child,
          client,
          wis,
          todayISO,
          generatedAt,
          extraChart,
        );
        sections.push({
          anchor: slugAnchor(`${c.project.name}-${child.name}`),
          kind: "wrapper-child",
          title: child.name,
          parentTitle: c.project.name,
          data: childData,
        });
        addSeverity(overall, childData.summary.severity);
      }
    } else {
      const wis = wiByProject.get(c.project.id) ?? [];
      const data = buildL1SectionData(
        c.project,
        client,
        wis,
        todayISO,
        generatedAt,
      );
      sections.push({
        anchor: slugAnchor(c.project.name),
        kind: "standalone",
        title: c.project.name,
        data,
      });
      addSeverity(overall, data.summary.severity);
    }
  }

  return {
    client,
    sections,
    generatedAt,
    overallSeverity: overall,
  };
}

// ── GenerateGanttShare ────────────────────────────────────

export type GenerateGanttShareInput = {
  clientSlug: string;
  projectSlug?: string;
  theme: Theme;
  /**
   * Override the base URL for the share link.
   *
   * Fallback chain (Q1 amendment):
   *   1. input.origin — explicit caller override
   *   2. process.env.NEXT_PUBLIC_APP_URL — set in .env.local for dev/staging
   *   3. "https://runway.startround1.com" — hardcoded production default
   *
   * This lets dev and staging environments override the origin without code
   * changes by setting NEXT_PUBLIC_APP_URL in their respective env files.
   */
  origin?: string;
  /** TTL in days. Default: 7. */
  ttlDays?: number;
};

export type GenerateGanttShareResult = {
  shareUrl: string;
  expiresAt: string;
  summary: {
    kind: "client" | "project";
    clientName: string;
    projectName?: string;
    sectionCount?: number;
    rowCount?: number;
    severity: { critical: number; warn: number; info: number };
  };
};

/**
 * Generate a signed share URL for a Gantt view.
 *
 * Renders the requested view (client rundown or single-project triage) to
 * HTML, uploads it to R2 at `gantt-share/{nonce}/render.html`, and returns
 * the signed URL.
 *
 * Origin resolution (Q1 amendment):
 *   input.origin ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://runway.startround1.com"
 *
 * Throws on:
 * - R2 not configured (`isR2Configured()` false)
 * - RUNWAY_SHARE_SECRET missing
 * - DB resolution failure (with available slugs in the error message)
 * - Render failure
 */
export async function generateGanttShare(
  input: GenerateGanttShareInput,
): Promise<GenerateGanttShareResult> {
  // Fail-fast: R2 must be configured before we do any DB work
  if (!isR2Configured()) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }

  const db = getRunwayDb();
  const todayISO = new Date().toISOString().split("T")[0];
  const generatedAt = todayISO;

  // Resolve client
  const clientResult = await resolveClient(db, input.clientSlug);
  if (!clientResult.ok) {
    const available = clientResult.available?.join(", ") ?? "none";
    throw new Error(
      `Client not found: "${input.clientSlug}". Available: ${available}`,
    );
  }
  const { client, topLevelProjects } = clientResult;

  let html: string;
  let kind: "client" | "project";
  let projectName: string | undefined;
  let sectionCount: number | undefined;
  let rowCount: number | undefined;
  let severity: { critical: number; warn: number; info: number };

  if (input.projectSlug) {
    // Single-project triage
    const projectResult = await resolveProject(db, input.projectSlug);
    if (!projectResult.ok) {
      const available = projectResult.available?.join(", ") ?? "none";
      throw new Error(
        `Project not found: "${input.projectSlug}". Available: ${available}`,
      );
    }
    const { subject } = projectResult;

    // Assert project belongs to the requested client
    if (subject.project.clientId !== client.id) {
      throw new Error(
        `Project "${input.projectSlug}" does not belong to client "${input.clientSlug}".`,
      );
    }

    const rawData = await extractData(db, subject, client);
    const ganttData =
      rawData.kind === "wrapper"
        ? (() => {
            // Build wrapper gantt data inline
            const orphanItems = (rawData.orphanWeekItems ?? []).map((w) => ({
              id: w.id,
              title: w.title,
            }));
            return buildWrapperSectionData(
              subject.project,
              client,
              rawData.kind === "wrapper" ? rawData.children : [],
              orphanItems,
              generatedAt,
              todayISO,
            );
          })()
        : buildL1SectionData(
            subject.project,
            client,
            rawData.kind === "l1" ? rawData.children : [],
            todayISO,
            generatedAt,
          );

    html = renderGantt(ganttData, input.theme);
    kind = "project";
    projectName = subject.project.name;
    rowCount = ganttData.rows.length;
    severity = ganttData.summary.severity;
  } else {
    // Client rundown
    const rundownData = await extractClientRundown(
      db,
      client,
      topLevelProjects,
      generatedAt,
      todayISO,
    );
    html = renderClientRundown(rundownData, input.theme);
    kind = "client";
    sectionCount = rundownData.sections.length;
    rowCount = rundownData.sections.reduce((sum, s) => sum + s.data.rows.length, 0);
    severity = rundownData.overallSeverity;
  }

  // Build and sign token
  const nonce = crypto.randomBytes(6).toString("base64url");
  const payload = makePayload({
    kind,
    clientSlug: input.clientSlug,
    ...(input.projectSlug ? { projectSlug: input.projectSlug } : {}),
    theme: input.theme,
    ttlDays: input.ttlDays ?? 7,
  });
  // Override nonce with our pre-generated one for R2 key consistency
  const finalPayload = { ...payload, nonce };
  const token = signPayload(finalPayload);

  // Upload to R2
  const storageKey = `gantt-share/${nonce}/render.html`;
  await uploadContent(storageKey, html, "text/html; charset=utf-8", {
    "expires-at": finalPayload.expiresAt,
    "client-slug": input.clientSlug,
    kind,
    theme: input.theme,
  });

  // Build share URL (Q1 amendment: env-var fallback chain)
  const origin =
    input.origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://runway.startround1.com";
  const shareUrl = `${origin}/api/runway/gantt-share/${token}`;

  return {
    shareUrl,
    expiresAt: finalPayload.expiresAt,
    summary: {
      kind,
      clientName: client.name,
      ...(projectName ? { projectName } : {}),
      ...(sectionCount !== undefined ? { sectionCount } : {}),
      ...(rowCount !== undefined ? { rowCount } : {}),
      severity,
    },
  };
}
