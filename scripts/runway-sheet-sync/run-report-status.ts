/**
 * Reads a sheet's most recent sync run report, the diff-<sheetId>-<date>.md
 * file runway-sheet-sync.ts writes, and says what it shows.
 *
 * A missing folder or file is an absence, "none". A read that errors for any
 * other reason, a permission error or a timeout, is a positive signal of not
 * knowing, "could-not-tell", and is never folded into "none".
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export type RunReportStatus =
  | { kind: "clean"; path: string }
  | { kind: "failed"; path: string; reason: string }
  | { kind: "none" }
  | { kind: "could-not-tell"; reason: string };

export type RunReportReader = (sheetId: string) => RunReportStatus;

// renderReport writes this marker for a run that must be treated as failure.
const ERROR_LINE = /^> \*\*ERROR:[^\n]*/m;

function errorCode(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  return e?.code ?? (e instanceof Error ? e.message : String(err));
}

export function readRunReportStatus(outDir: string, sheetId: string): RunReportStatus {
  let names: string[];
  try {
    names = readdirSync(outDir);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { kind: "none" };
    return { kind: "could-not-tell", reason: `report folder ${outDir} could not be read: ${errorCode(err)}` };
  }

  const prefix = `diff-${sheetId}-`;
  const latest = names
    .filter((n) => n.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.md$/.test(n.slice(prefix.length)))
    .sort()
    .pop();
  if (!latest) return { kind: "none" };

  const path = join(outDir, latest);
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { kind: "none" };
    return { kind: "could-not-tell", reason: `run report ${path} could not be read: ${errorCode(err)}` };
  }

  const error = body.match(ERROR_LINE);
  if (error) return { kind: "failed", path, reason: error[0].replace(/^> /, "").replace(/\*\*/g, "") };
  return { kind: "clean", path };
}

export function reportStatusReader(outDir: string): RunReportReader {
  return (sheetId) => readRunReportStatus(outDir, sheetId);
}
