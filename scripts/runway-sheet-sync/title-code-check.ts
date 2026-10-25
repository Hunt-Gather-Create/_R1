/**
 * Title code check, operator ruling C on _R1#195, 2026-10-24. The code at
 * the start of a sheet's Drive file name must agree with the job number, or
 * the run stops: a title that disagrees is the sign of a wrong sheet. A
 * sheet_registry row that names the sheet accepts its title, for old
 * documents that keep their labels. Banner drift is not checked here; R7 tolerates it.
 */
import type { DriveFile } from "./schedule-files";
import type { SheetConfig } from "./types";

/** Leading engagement code of a file name, up to the first space, pipe or underscore. */
const TITLE_CODE = /^\s*([A-Za-z]+-\d[\dA-Za-z]*(?:-[\dA-Za-z]+)*)/;

export function titleCode(name: string): string | null {
  return name.match(TITLE_CODE)?.[1] ?? null;
}

/** New-shape titles drop the sub-number, so BPC-2602 names the same engagement as BPC-2602-01. */
function codesAgree(title: string, job: string): boolean {
  return title === job || title === job.replace(/-\d{2}$/, "");
}

/**
 * Throws when the title code disagrees with the job number and no registry row
 * accepts it. Returns a note for the report when there is something to say,
 * or null when the codes agree.
 */
export function checkTitleCode(config: SheetConfig, listing: DriveFile[] | null): string | null {
  const file = listing?.find((f) => f.id === config.sheetId);
  if (!file) return "TITLE CODE NOT CHECKED: no Drive listing entry for this sheet, so its file name was not compared";
  const code = titleCode(file.name);
  if (code === null) return `TITLE CODE NOT CHECKED: no engagement code at the start of file name "${file.name}"`;
  if (codesAgree(code, config.engagementCode)) return null;
  if (config.fromRegistry) {
    return `TITLE CODE: title code ${code} != job number ${config.engagementCode}, accepted because a sheet_registry row names this sheet`;
  }
  throw new Error(
    `Sheet ${config.sheetId} (${config.label}): title code ${code} disagrees with job number ${config.engagementCode}. This may be the wrong sheet. If the title is known to carry this code for good, a sheet_registry row for ${config.engagementCode} naming this sheet accepts it; that row is a data change through the data-integrity pipeline.`,
  );
}
