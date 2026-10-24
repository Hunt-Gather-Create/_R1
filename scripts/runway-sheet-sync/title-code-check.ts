/**
 * Title code check, operator ruling C on _R1#195, 2026-10-24. The code at
 * the start of a sheet's Drive file name must agree with the registry, or
 * the run stops: a title that disagrees is the sign of a wrong sheet. A
 * registry entry may list exact title codes it accepts, for old documents
 * that keep their labels. Banner drift is not checked here; R7 tolerates it.
 */
import type { DriveFile } from "./freshness";
import type { SheetConfig } from "./types";

/** Leading engagement code of a file name, up to the first space, pipe or underscore. */
const TITLE_CODE = /^\s*([A-Za-z]+-\d[\dA-Za-z]*(?:-[\dA-Za-z]+)*)/;

export function titleCode(name: string): string | null {
  return name.match(TITLE_CODE)?.[1] ?? null;
}

/** New-shape titles drop the sub-number, so BPC-2602 names the same engagement as BPC-2602-01. */
function codesAgree(title: string, registry: string): boolean {
  return title === registry || title === registry.replace(/-\d{2}$/, "");
}

/**
 * Throws when the title code disagrees with the registry and no exception
 * accepts it. Returns a note for the report when there is something to say,
 * or null when the codes agree.
 */
export function checkTitleCode(config: SheetConfig, listing: DriveFile[] | null): string | null {
  const file = listing?.find((f) => f.id === config.sheetId);
  if (!file) return "TITLE CODE NOT CHECKED: no Drive listing entry for this sheet, so its file name was not compared";
  const code = titleCode(file.name);
  if (code === null) return `TITLE CODE NOT CHECKED: no engagement code at the start of file name "${file.name}"`;
  if (codesAgree(code, config.engagementCode)) return null;
  if (config.acceptedTitleCodes?.includes(code)) {
    return `TITLE CODE: title code ${code} != registry code ${config.engagementCode}, accepted by a known exception in config.ts`;
  }
  throw new Error(
    `Sheet ${config.sheetId} (${config.label}): title code ${code} disagrees with registry code ${config.engagementCode}. This may be the wrong sheet. If the title is known to carry this code for good, add "${code}" to acceptedTitleCodes on this sheet's entry in scripts/runway-sheet-sync/config.ts.`,
  );
}
