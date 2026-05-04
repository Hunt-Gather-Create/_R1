/**
 * Runway Gantt — local CLI that renders an HTML Gantt chart for a project
 * (wrapper, sub-project, or normal L1) or every top-level project under a
 * client.
 *
 * Usage:
 *   pnpm runway:gantt --project "<name|id>"       # one Gantt
 *   pnpm runway:gantt --client "<name|slug|id>"   # one Gantt per top-level project
 *
 * Output: ~/runway-gantts/[client-slug]-[project-slug]-[YYYY-MM-DD].html
 *
 * Date stamping uses LOCAL timezone (via toLocaleDateString('en-CA')) so the
 * filename slug doesn't drift across UTC midnight.
 */

import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { clients } from "@/lib/db/runway-schema";
import { createRunwayDb, runIfDirect } from "./lib/run-script";
import { resolveClient, resolveProject } from "./lib/gantt/resolve-entity";
import { extractData } from "./lib/gantt/extract-data";
import { extractClientRundown } from "./lib/gantt/rundown";
import {
  computeAxis,
  formatDateRange,
  transformRows,
} from "./lib/gantt/transform-rows";
import { detectAllIssues } from "./lib/gantt/detect-issues";
import {
  formatCounterConsole,
  formatSeverityLine,
  summarize,
} from "./lib/gantt/counter";
import {
  renderClientRundown,
  renderGantt,
} from "./lib/gantt/GanttTemplate";
import type {
  ClientRow,
  GanttData,
  ResolvedSubject,
} from "./lib/gantt/types";

type DrizzleDb = ReturnType<typeof createRunwayDb>["db"];

const USAGE = `Usage:
  pnpm runway:gantt --project "<name|id>"
  pnpm runway:gantt --client  "<name|slug|id>"`;

// ── Pure helpers (exported for testing) ───────────────────

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * YYYY-MM-DD in the LOCAL timezone (or an injected one for tests). 'en-CA'
 * locale conveniently formats as YYYY-MM-DD by default. Operator-locked to
 * local TZ so the filename stamp doesn't drift when the script runs after
 * UTC midnight but before local midnight.
 */
export function localISODate(d: Date = new Date(), timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (timeZone) opts.timeZone = timeZone;
  return d.toLocaleDateString("en-CA", opts);
}

export function buildOutputPath(
  clientName: string,
  projectName: string,
  dateStr: string,
): string {
  const filename = `${slugify(clientName)}-${slugify(projectName)}-${dateStr}.html`;
  return join(homedir(), "runway-gantts", filename);
}

export function buildRundownOutputPath(clientName: string, dateStr: string): string {
  const filename = `${slugify(clientName)}-rundown-${dateStr}.html`;
  return join(homedir(), "runway-gantts", filename);
}

export type ParsedArgs =
  | { ok: true; mode: "project"; value: string }
  | { ok: true; mode: "client"; value: string }
  | { ok: false; error: string };

export function parseArgs(argv: string[]): ParsedArgs {
  let project: string | undefined;
  let client: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) {
        return { ok: false, error: "Missing value after --project." };
      }
      project = v;
      i += 1;
    } else if (arg === "--client") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) {
        return { ok: false, error: "Missing value after --client." };
      }
      client = v;
      i += 1;
    } else if (arg.startsWith("--")) {
      return { ok: false, error: `Unknown flag '${arg}'.` };
    }
  }

  if (project && client) {
    return { ok: false, error: "--project and --client are mutually exclusive." };
  }
  if (!project && !client) {
    return { ok: false, error: "Provide either --project or --client." };
  }
  if (project) return { ok: true, mode: "project", value: project };
  return { ok: true, mode: "client", value: client! };
}

// ── Pipeline ──────────────────────────────────────────────

async function renderSubject(
  db: DrizzleDb,
  subject: ResolvedSubject,
  client: ClientRow,
  today: Date,
  generatedAt: string,
): Promise<{ outputPath: string; consoleMirror: string }> {
  const data = await extractData(db, subject, client);
  const rows = transformRows(data);
  const axis = computeAxis(data, rows, today);
  const det = detectAllIssues(data, rows, today);
  const summary = summarize({
    rows: det.rows,
    chartIssues: det.chartIssues,
    entity: data.entity,
  });
  const headerRange = formatDateRange(data.entity.startDate, data.entity.endDate);
  const ganttData: GanttData = {
    raw: data,
    rows: det.rows,
    chartIssues: det.chartIssues,
    axis,
    headerRange,
    generatedAt,
    summary,
  };
  const html = renderGantt(ganttData);
  const outputPath = buildOutputPath(client.name, data.entity.name, generatedAt);
  mkdirSync(join(homedir(), "runway-gantts"), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  return { outputPath, consoleMirror: formatCounterConsole(summary, outputPath) };
}

async function runProjectFlow(
  db: DrizzleDb,
  input: string,
  today: Date,
  generatedAt: string,
): Promise<void> {
  const result = await resolveProject(db, input);
  if (!result.ok) {
    console.error(result.error);
    if (result.available && result.available.length > 0) {
      for (const opt of result.available.slice(0, 25)) {
        console.error(`  - ${opt}`);
      }
      if (result.available.length > 25) {
        console.error(`  … (${result.available.length - 25} more)`);
      }
    }
    process.exit(1);
  }

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, result.subject.project.clientId));
  if (!client) {
    console.error(
      `Resolver returned a project (${result.subject.project.id}) but its clientId (${result.subject.project.clientId}) does not exist.`,
    );
    process.exit(1);
  }

  const { consoleMirror } = await renderSubject(
    db,
    result.subject,
    client,
    today,
    generatedAt,
  );
  console.log(consoleMirror);
}

async function runClientFlow(
  db: DrizzleDb,
  input: string,
  today: Date,
  generatedAt: string,
): Promise<void> {
  const result = await resolveClient(db, input);
  if (!result.ok) {
    console.error(result.error);
    if (result.available && result.available.length > 0) {
      for (const opt of result.available.slice(0, 25)) {
        console.error(`  - ${opt}`);
      }
    }
    process.exit(1);
  }

  if (result.topLevelProjects.length === 0) {
    // Empty result is a valid finding, not a failure (operator-locked).
    console.log(`No top-level projects found for ${result.client.name}`);
    return;
  }

  const todayISO = today.toISOString().slice(0, 10);
  const rundown = await extractClientRundown(
    db,
    result.client,
    result.topLevelProjects,
    generatedAt,
    todayISO,
  );

  const html = renderClientRundown(rundown);
  const outputPath = buildRundownOutputPath(result.client.name, generatedAt);
  mkdirSync(join(homedir(), "runway-gantts"), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");

  // Console mirror: one line per section with its severity tally.
  console.log(`${result.client.name} — ${rundown.sections.length} section${rundown.sections.length === 1 ? "" : "s"}`);
  console.log(`  Overall: ${formatSeverityLine(rundown.overallSeverity)}`);
  for (const s of rundown.sections) {
    const indent = s.kind === "wrapper-child" ? "    " : "  ";
    console.log(`${indent}- ${s.title}: ${formatSeverityLine(s.data.summary.severity)}`);
  }
  console.log(`Wrote: ${outputPath}`);
}

// ── CLI entry ─────────────────────────────────────────────

async function run(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exit(1);
  }

  const { db } = createRunwayDb();
  const today = new Date();
  const generatedAt = localISODate(today);

  try {
    if (parsed.mode === "project") {
      await runProjectFlow(db, parsed.value, today, generatedAt);
    } else {
      await runClientFlow(db, parsed.value, today, generatedAt);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`runway-gantt failed: ${msg}`);
    if (msg.includes("RUNWAY_DATABASE_URL") || msg.toLowerCase().includes("connection")) {
      console.error("Hint: ensure RUNWAY_DATABASE_URL is set in .env.local.");
    }
    process.exit(1);
  }
}

// `runIfDirect` matches script name without extension; the runner script in
// package.json invokes with the .tsx path, so we still match the basename.
runIfDirect("runway-gantt", run);
