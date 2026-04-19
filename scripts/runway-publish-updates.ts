/**
 * Runway Publish Updates — query audit records, group, deduplicate, and post to Slack
 *
 * Usage:
 *   pnpm runway:publish-updates --batch "001-april-14-updates"          # dry-run (default)
 *   pnpm runway:publish-updates --batch "001-april-14-updates" --apply  # post to Slack
 *   pnpm runway:publish-updates --batch "001-april-14-updates" --apply --file draft.md
 *   pnpm runway:publish-updates --by migration --since "2026-04-18"
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, desc, gte, and } from "drizzle-orm";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { updates, clients, projects } from "@/lib/db/runway-schema";
import { runIfDirect } from "./lib/run-script";

// ── Types ──────────────────────────────────────────────────

type DrizzleDb = ReturnType<typeof drizzle>;

interface AuditRecord {
  id: string;
  clientId: string | null;
  projectId: string | null;
  updatedBy: string | null;
  updateType: string | null;
  previousValue: string | null;
  newValue: string | null;
  summary: string | null;
  metadata: string | null;
  batchId: string | null;
  createdAt: Date;
}

// ── Core Logic (exported for testing) ─────────────────────

/** Query audit records filtered by batchId or updatedBy + since. */
export async function queryUpdates(
  db: DrizzleDb,
  opts: { batchId?: string; updatedBy?: string; since?: string }
): Promise<AuditRecord[]> {
  const conditions = [];

  if (opts.batchId) {
    conditions.push(eq(updates.batchId, opts.batchId));
  }
  if (opts.updatedBy) {
    conditions.push(eq(updates.updatedBy, opts.updatedBy));
  }
  if (opts.since) {
    const sinceDate = new Date(opts.since + "T00:00:00Z");
    conditions.push(gte(updates.createdAt, sinceDate));
  }

  if (conditions.length === 0) {
    console.error("Provide --batch or --by/--since to filter updates.");
    return [];
  }

  const rows = await db
    .select()
    .from(updates)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(desc(updates.createdAt));

  return rows as AuditRecord[];
}

/** Build lookup maps for client and project names. */
async function buildNameMaps(db: DrizzleDb) {
  const allClients = await db.select({ id: clients.id, name: clients.name }).from(clients);
  const allProjects = await db.select({ id: projects.id, name: projects.name }).from(projects);

  const clientNames = new Map(allClients.map((c) => [c.id, c.name]));
  const projectNames = new Map(allProjects.map((p) => [p.id, p.name]));

  return { clientNames, projectNames };
}

/** Deduplicate records: for each (entity, field) pair, keep first previousValue and last newValue. */
function deduplicateRecords(records: AuditRecord[]): AuditRecord[] {
  // Group by (clientId, projectId, updateType, field from metadata)
  const groups = new Map<string, AuditRecord[]>();

  for (const record of records) {
    let field = "";
    if (record.metadata) {
      try {
        const meta = JSON.parse(record.metadata);
        field = meta.field ?? "";
      } catch { /* ignore */ }
    }
    const key = `${record.clientId ?? ""}|${record.projectId ?? ""}|${record.updateType ?? ""}|${field}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  // For each group, produce a single record with first previousValue, last newValue
  const deduped: AuditRecord[] = [];
  for (const group of groups.values()) {
    // Sort by createdAt ascending for first/last logic
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const first = group[0];
    const last = group[group.length - 1];

    // Net no-op: skip if previousValue equals newValue
    if (first.previousValue === last.newValue && first.previousValue !== null) {
      continue;
    }

    deduped.push({
      ...last,
      previousValue: first.previousValue,
      summary: last.summary,
    });
  }

  return deduped;
}

/** Group deduplicated records by client, then format as markdown. */
export function formatDraft(
  records: AuditRecord[],
  clientNames: Map<string, string>,
  projectNames: Map<string, string>
): string {
  const deduped = deduplicateRecords(records);

  // Group by clientId
  const byClient = new Map<string | null, AuditRecord[]>();
  for (const record of deduped) {
    const key = record.clientId;
    const group = byClient.get(key) ?? [];
    group.push(record);
    byClient.set(key, group);
  }

  const sections: string[] = [];

  for (const [clientId, clientRecords] of byClient) {
    const clientName = clientId ? (clientNames.get(clientId) ?? clientId) : "Team / Global";
    const lines: string[] = [`## ${clientName}`];

    for (const record of clientRecords) {
      const projectName = record.projectId ? projectNames.get(record.projectId) : null;

      let line: string;
      if (record.summary) {
        line = record.summary;
      } else {
        const prefix = projectName ? `${projectName}: ` : "";
        const change = record.previousValue && record.newValue
          ? `${record.previousValue} → ${record.newValue}`
          : record.newValue ?? record.previousValue ?? "";
        line = `${prefix}${record.updateType ?? "change"} — ${change}`;
      }

      lines.push(`- ${line}`);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n") + "\n";
}

/** Format the draft for Slack (mrkdwn formatting). */
function formatSlackMessage(draft: string): string {
  // Convert markdown headers to bold
  return draft
    .replace(/^## (.+)$/gm, "*$1*")
    .trim();
}

// ── CLI ────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);

  const batchIdx = args.indexOf("--batch");
  const batchId = batchIdx !== -1 ? args[batchIdx + 1] : undefined;

  const byIdx = args.indexOf("--by");
  const updatedBy = byIdx !== -1 ? args[byIdx + 1] : undefined;

  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx !== -1 ? args[sinceIdx + 1] : undefined;

  const shouldApply = args.includes("--apply");

  const fileIdx = args.indexOf("--file");
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : undefined;

  if (!batchId && !updatedBy) {
    console.error("Usage: pnpm runway:publish-updates --batch <id> [--apply] [--file <path>]");
    console.error("   or: pnpm runway:publish-updates --by <updatedBy> --since <date> [--apply]");
    process.exit(1);
  }

  // Connect to DB
  const url = process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db";
  const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
  const db = drizzle(client);

  // Query
  const records = await queryUpdates(db, { batchId, updatedBy, since });
  if (records.length === 0) {
    console.log("No matching audit records found.");
    return;
  }
  console.log(`Found ${records.length} audit record(s).`);

  // Build name maps for display
  const { clientNames, projectNames } = await buildNameMaps(db);

  // Generate or load draft
  let draft: string;
  if (filePath && shouldApply) {
    try {
      draft = readFileSync(resolve(process.cwd(), filePath), "utf-8");
    } catch (err) {
      console.error(`Could not read draft file: ${filePath}`);
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    console.log(`Using edited draft from: ${filePath}`);
  } else {
    draft = formatDraft(records, clientNames, projectNames);

    // Write draft to file
    const draftId = batchId ?? `${updatedBy}-${since ?? "recent"}`;
    const draftDir = resolve(process.cwd(), "docs/tmp");
    mkdirSync(draftDir, { recursive: true });
    const draftPath = resolve(draftDir, `batch-draft-${draftId}.md`);
    writeFileSync(draftPath, draft, "utf-8");
    console.log(`\nDraft written to: ${draftPath}`);
  }

  console.log("\n--- Draft ---\n");
  console.log(draft);

  if (!shouldApply) {
    console.log("--- End Draft ---\n");
    console.log("Dry-run complete. Review the draft above, edit if needed, then run with --apply.");
    console.log(`  pnpm runway:publish-updates --batch "${batchId}" --apply`);
    console.log(`  pnpm runway:publish-updates --batch "${batchId}" --apply --file <edited-draft.md>`);
    return;
  }

  // Post to Slack
  const { postFormattedMessage } = await import("@/lib/slack/updates-channel");
  const slackText = formatSlackMessage(draft);

  try {
    const ts = await postFormattedMessage(slackText);
    console.log(`Posted to Slack updates channel. Message ts: ${ts}`);
  } catch (err) {
    console.error("Failed to post to Slack:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

runIfDirect("runway-publish-updates", run);
