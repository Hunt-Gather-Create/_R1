/**
 * _R1#154 item 3: discovery CLI. Lists every plan sheet in a frozen Drive
 * listing against the registry (config.ts's SHEETS): registered,
 * unregistered, superseded, registered but not found, a same-title
 * duplicate, or a pending-clearance/test file. Never auto-registers
 * anything; a person decides which sheet is master.
 *
 * Usage:
 *   pnpm runway:sheet-discovery -- --drive-listing <path>
 *
 * Input is a frozen JSON listing, the same shape the google-api skill's
 * drive:search step produces (files: { id, name, modifiedTime }[]),
 * never a live Drive call: the live read path's service account has
 * spreadsheets.readonly only, and the credential is blocked on the
 * operator under #161.
 *
 * No DB dependency here, unlike scripts/runway-sheet-sync.ts's main;
 * direct-execution guard checked inline for the same reason
 * scripts/check-base-ancestry.ts does, so this never pulls in
 * scripts/lib/run-script.ts's Turso factory for a command that never
 * touches a database.
 */
import { readFileSync } from "node:fs";
import { SHEETS } from "./runway-sheet-sync/config";
import { discoverPlans, type DriveFile } from "./runway-sheet-sync/discovery";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

export function loadDriveListing(path: string): DriveFile[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { files: DriveFile[] };
  return raw.files;
}

export function main(): void {
  const listingPath = arg("drive-listing");
  if (!listingPath) {
    console.error("runway-sheet-discovery: --drive-listing <path> is required. No live Drive call is made here.");
    process.exit(1);
  }

  const listing = loadDriveListing(listingPath!);
  const report = discoverPlans(SHEETS, listing);

  console.log(JSON.stringify(report, null, 2));

  const counts = {
    unregistered: report.unregistered.length,
    superseded: report.superseded.length,
    registeredNotFound: report.registeredNotFound.length,
    noPlanSlug: report.noPlanSlug.length,
    registeredClean: report.registeredClean.length,
    duplicates: report.duplicates.length,
    pendingClearanceOrTest: report.pendingClearanceOrTest.length,
    unrecognizedShape: report.unrecognizedShape.length,
  };
  console.error(`runway-sheet-discovery: ${JSON.stringify(counts)}`);
}

// Direct-execution guard, matching scripts/check-base-ancestry.ts's inline
// pattern, not scripts/lib/run-script.ts's runIfDirect: this command has no
// DB dependency and must not pull in the Turso connection factory to run.
const isDirectExecution =
  typeof process !== "undefined" && Boolean(process.argv[1]) && process.argv[1]!.endsWith("runway-sheet-discovery.ts");

if (isDirectExecution) {
  main();
}
