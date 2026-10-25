/**
 * Reads the job ledger sheet: the Job Numbers tab and the Client Prefixes
 * tab, each found by its header row. The sheet id is configuration from the
 * environment, never a value in code.
 */
import { runGoogleApiCli } from "./google-api-cli";
import { JOB_NUMBER } from "./schedule-files";

export const JOB_LEDGER_ENV = "RUNWAY_JOB_LEDGER_SHEET_ID";

const JOB_TAB = "Job Numbers";
const PREFIX_TAB = "Client Prefixes";
const JOB_COLUMNS = ["Job #", "Client", "Engagement", "Status", "Year", "SOW Signed", "SOW File ID", "Folder ID"];
const PREFIX_COLUMNS = ["Prefix", "Client Full Name", "Drive Root ID", "Active?", "Notes"];

export interface LedgerJob {
  jobNumber: string;
  client: string;
  engagement: string;
  /** Lowercased, for example live, shipped or proposed. */
  status: string;
}

export interface ClientPrefix {
  prefix: string;
  fullName: string;
  active: boolean;
}

export interface JobLedger {
  jobs: LedgerJob[];
  prefixes: ClientPrefix[];
}

export type Grid = (string | undefined)[][];
export type ReadRange = (sheetId: string, range: string) => Promise<Grid>;

export function requireJobLedgerSheetId(env: NodeJS.ProcessEnv): string {
  const id = env[JOB_LEDGER_ENV]?.trim();
  if (!id) {
    throw new Error(`${JOB_LEDGER_ENV} is not set, so the job ledger cannot be read and no schedule can be found.`);
  }
  return id;
}

/** Column index for each required header name; throws naming every missing one. */
function columnIndex(grid: Grid, tab: string, required: string[]): Map<string, number> {
  const header = (grid[0] ?? []).map((c) => (c ?? "").trim());
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    throw new Error(`Job ledger tab "${tab}" has no column ${missing.map((m) => `"${m}"`).join(", ")} in its header row.`);
  }
  return new Map(required.map((name) => [name, header.indexOf(name)]));
}

const cell = (row: (string | undefined)[], i: number) => (row[i] ?? "").trim();

export function parseJobLedger(jobGrid: Grid, prefixGrid: Grid): JobLedger {
  const jc = columnIndex(jobGrid, JOB_TAB, JOB_COLUMNS);
  const jobs: LedgerJob[] = [];
  const seen = new Set<string>();
  for (const row of jobGrid.slice(1)) {
    const jobNumber = cell(row, jc.get("Job #")!).toUpperCase();
    if (!jobNumber) continue;
    if (!JOB_NUMBER.test(jobNumber)) {
      throw new Error(`Job ledger tab "${JOB_TAB}" has job number "${jobNumber}", which is not shaped like ABC-2604 or ABC-2604-02.`);
    }
    if (seen.has(jobNumber)) throw new Error(`Job ledger tab "${JOB_TAB}" lists job ${jobNumber} twice.`);
    seen.add(jobNumber);
    jobs.push({
      jobNumber,
      client: cell(row, jc.get("Client")!),
      engagement: cell(row, jc.get("Engagement")!),
      status: cell(row, jc.get("Status")!).toLowerCase(),
    });
  }

  const pc = columnIndex(prefixGrid, PREFIX_TAB, PREFIX_COLUMNS);
  const prefixes: ClientPrefix[] = prefixGrid
    .slice(1)
    .filter((row) => cell(row, pc.get("Prefix")!) !== "")
    .map((row) => ({
      prefix: cell(row, pc.get("Prefix")!).toUpperCase(),
      fullName: cell(row, pc.get("Client Full Name")!),
      active: /^(true|yes|y)$/i.test(cell(row, pc.get("Active?")!)),
    }));

  return { jobs, prefixes };
}

/** sheets:read through the google-api CLI; throws when the output has no values array. */
export const readRangeWithCli: ReadRange = async (sheetId, range) => {
  const out = (await runGoogleApiCli("sheets:read", [sheetId, range])) as { values?: unknown } | null;
  if (!out || !Array.isArray(out.values)) throw new Error(`google-api CLI sheets:read of ${range} printed no values array`);
  return out.values as Grid;
};

export async function readJobLedger(sheetId: string, read: ReadRange = readRangeWithCli): Promise<JobLedger> {
  const [jobGrid, prefixGrid] = await Promise.all([
    read(sheetId, `'${JOB_TAB}'!A:Z`),
    read(sheetId, `'${PREFIX_TAB}'!A:Z`),
  ]);
  return parseJobLedger(jobGrid, prefixGrid);
}
