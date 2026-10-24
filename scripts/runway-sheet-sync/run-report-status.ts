/**
 * Reads a sheet's most recent sync record and says what it shows. A record
 * is either the diff-<sheetId>-<date>.md report runway-sheet-sync.ts writes,
 * or the refused-<sheetId>-<time>.md record it writes when it refuses the
 * sheet before the diff. The most recent record wins, whatever its kind.
 *
 * A missing folder or file is an absence, "none". A read that errors for any
 * other reason, a permission error or a timeout, is a positive signal of not
 * knowing, "could-not-tell", and is never folded into "none".
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { REFUSAL_PREFIX, refusalTime } from "./refusal-record";

export type RunReportStatus =
  | { kind: "clean"; path: string }
  | { kind: "failed"; path: string; reason: string }
  | { kind: "none" }
  | { kind: "could-not-tell"; reason: string };

export type RunReportReader = (sheetId: string) => RunReportStatus;

// renderReport and writeRefusalRecord write this marker for a run that must be treated as failure.
const ERROR_LINE = /^> \*\*ERROR:[^\n]*/m;
// renderReport stamps the run's ISO time on this line.
const RUN_LINE = /^- Run: `[^`]*` at (\S+)/m;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(\.\d+)?Z$/;

function errorCode(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  return e?.code ?? (e instanceof Error ? e.message : String(err));
}

/** Newest file name that is prefix plus a suffix matching shape, then ext. */
function newest(names: string[], prefix: string, shape: RegExp, ext: string): string | undefined {
  return names
    .filter((n) => n.startsWith(prefix) && n.endsWith(ext) && shape.test(n.slice(prefix.length, -ext.length)))
    .sort()
    .pop();
}

type Body = { ok: true; body: string } | { ok: false; status: RunReportStatus };

function readBody(path: string, what: string): Body {
  try {
    return { ok: true, body: readFileSync(path, "utf8") };
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { ok: false, status: { kind: "none" } };
    return { ok: false, status: { kind: "could-not-tell", reason: `${what} ${path} could not be read: ${errorCode(err)}` } };
  }
}

function errorReason(body: string): string | null {
  const error = body.match(ERROR_LINE);
  return error ? error[0].replace(/^> /, "").replace(/\*\*/g, "") : null;
}

export function readRunReportStatus(outDir: string, sheetId: string): RunReportStatus {
  let names: string[];
  try {
    names = readdirSync(outDir);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { kind: "none" };
    return { kind: "could-not-tell", reason: `report folder ${outDir} could not be read: ${errorCode(err)}` };
  }

  const reportName = newest(names, `diff-${sheetId}-`, DATE, ".md");
  const refusalName = newest(names, `${REFUSAL_PREFIX}${sheetId}-`, STAMP, ".md");

  let report: { path: string; body: string; at: string } | null = null;
  if (reportName) {
    const path = join(outDir, reportName);
    const read = readBody(path, "run report");
    if (!read.ok) return read.status;
    // A report with no run time counts from the start of its date, so a same-day refusal wins.
    const at = read.body.match(RUN_LINE)?.[1] ?? `${reportName.slice(-13, -3)}T00:00:00.000Z`;
    report = { path, body: read.body, at };
  }

  if (refusalName) {
    const stamp = refusalName.slice(`${REFUSAL_PREFIX}${sheetId}-`.length, -".md".length);
    if (!report || refusalTime(stamp) >= report.at) {
      const path = join(outDir, refusalName);
      const read = readBody(path, "refusal record");
      if (!read.ok) return read.status;
      return { kind: "failed", path, reason: errorReason(read.body) ?? "refused before the diff" };
    }
  }

  if (!report) return { kind: "none" };
  const reason = errorReason(report.body);
  if (reason) return { kind: "failed", path: report.path, reason };
  return { kind: "clean", path: report.path };
}

export function reportStatusReader(outDir: string): RunReportReader {
  return (sheetId) => readRunReportStatus(outDir, sheetId);
}
