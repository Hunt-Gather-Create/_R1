/**
 * Lists every plan spreadsheet Drive holds through the google-api CLI's
 * drive:search, paged until Drive owes no next page.
 *
 * This is the coverage denominator, so every failure throws: a failed page,
 * a wrong shape, an empty result, or a page cap reached with pages still owed.
 * A short or empty list is never returned as if it were the whole set.
 */
import type { DriveFile } from "./discovery";
import { GoogleApiCliError, runGoogleApiCli, type GoogleApiCliOptions } from "./google-api-cli";

// The old title shape, "Project Plan v1" with spaces, is matched too, since
// registered sheets use it and a query that misses them would shrink the set.
// Plans titled "Schedule v3" and the like are plan sheets too.
export const DRIVE_PLAN_QUERY =
  "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and " +
  "(name contains 'Project-Plan-v' or name contains 'Project Plan' or name contains 'Schedule v')";

const PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;

export interface DrivePlanListingOptions extends GoogleApiCliOptions {
  maxPages?: number;
}

function asDriveFile(raw: unknown): DriveFile {
  const f = raw as Partial<DriveFile> | null;
  if (!f || typeof f.id !== "string" || typeof f.name !== "string") {
    throw new GoogleApiCliError("drive:search returned a file without a string id and name");
  }
  return { id: f.id, name: f.name, modifiedTime: typeof f.modifiedTime === "string" ? f.modifiedTime : "" };
}

export async function listDrivePlanSheets(opts: DrivePlanListingOptions = {}): Promise<DriveFile[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const byId = new Map<string, DriveFile>();
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const pageOpts = JSON.stringify(pageToken ? { pageSize: PAGE_SIZE, pageToken } : { pageSize: PAGE_SIZE });
    const out = (await runGoogleApiCli("drive:search", [DRIVE_PLAN_QUERY, pageOpts], opts)) as {
      files?: unknown;
      nextPageToken?: unknown;
    } | null;
    if (!out || !Array.isArray(out.files)) {
      throw new GoogleApiCliError("drive:search output has no files array");
    }
    for (const raw of out.files) {
      const f = asDriveFile(raw);
      if (!byId.has(f.id)) byId.set(f.id, f);
    }
    if (typeof out.nextPageToken !== "string" || out.nextPageToken === "") {
      if (byId.size === 0) throw new GoogleApiCliError("drive:search found no plan sheets");
      return [...byId.values()];
    }
    pageToken = out.nextPageToken;
  }
  throw new GoogleApiCliError(`drive:search still owed a next page after ${maxPages} pages`);
}
