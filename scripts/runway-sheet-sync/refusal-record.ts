/**
 * The one owner of refusal: why a row or a sheet was not written, and the
 * ERROR marker the run report and the refusal record both carry.
 *
 * A sheet the sync refuses before it writes a diff report still leaves a
 * record, refused-<sheetId>-<time>.md, in the same output folder. The
 * coverage reader treats it as a failed run, so a refused sheet never reads
 * DEPLOYED off an older clean report.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { RowDiff } from "./types";

export const REFUSAL_PREFIX = "refused-";
/** The time part of a refusal record name, as refusalStamp writes it. */
export const REFUSAL_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(\.\d+)?Z$/;

const ERROR_LINE = /^> \*\*ERROR:[^\n]*/m;

/** The marker line for a run that must be treated as failure. */
export function errorLine(headline: string, detail: string): string {
  return `> **ERROR: ${headline}** ${detail}`;
}

/** The first ERROR marker in a report or record, without its markdown, or null. */
export function readErrorLine(body: string): string | null {
  const error = body.match(ERROR_LINE);
  return error ? error[0].replace(/^> /, "").replace(/\*\*/g, "") : null;
}

/** The column J labels the role map refused on this row; owner and resources are not planned for it. */
export function refusedLabels(rd: RowDiff): string[] {
  return rd.leaf && rd.people?.kind === "refused" ? rd.people.unmapped : [];
}

/** Why a row refused by the role map gets a review item instead of an owner. */
export function roleMapRefusalReason(label: string, clientSlug: string): string {
  return `column J label "${label}" is not in the role map for "${clientSlug}", owner and resources not planned for this row`;
}

/** File-safe form of an ISO time: colons become dashes, so names still sort by time. */
export function refusalStamp(at: Date): string {
  return at.toISOString().replace(/:/g, "-");
}

/** The ISO time a refusal file name carries, the inverse of refusalStamp. */
export function refusalTime(stamp: string): string {
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
}

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
}

export function writeRefusalRecord(outDir: string, sheetId: string, err: unknown, at = new Date()): string {
  const path = join(outDir, `${REFUSAL_PREFIX}${sheetId}-${refusalStamp(at)}.md`);
  const body = [
    "# Runway Sheet Sync: Refused Before the Diff",
    "",
    `- Sheet: \`${sheetId}\``,
    `- Refused at ${at.toISOString()}`,
    "",
    // The reader keys on this ERROR line, the same marker a failed diff report carries.
    errorLine("refused before the diff.", messageOf(err)),
    "",
  ].join("\n");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, body);
  return path;
}

/**
 * Runs one sheet's sync. A throw before the run calls diffWritten leaves a
 * refusal record and is rethrown unchanged; a throw after it does not, since
 * the diff report already speaks for that run.
 */
export async function recordingRefusal<T>(
  outDir: string,
  sheetId: string,
  run: (diffWritten: () => void) => Promise<T>
): Promise<T> {
  let written = false;
  try {
    return await run(() => {
      written = true;
    });
  } catch (err) {
    if (!written) writeRefusalRecord(outDir, sheetId, err);
    throw err;
  }
}

/** A refusal that stops the whole run before any sheet is read leaves a record for every target. */
export function refusingAll<T>(outDir: string, sheetIds: string[], decide: () => T): T {
  try {
    return decide();
  } catch (err) {
    const at = new Date();
    for (const id of sheetIds) writeRefusalRecord(outDir, id, err, at);
    throw err;
  }
}
