/**
 * _R1#154 item 2: freshness check. Given a registered sheet, look for a
 * sibling in the frozen Drive listing with the same client prefix and the
 * same explicit planSlug, and a higher version number. If one exists,
 * refuse the run and name the file.
 *
 * Pure function of the registry entry and the listing: no Drive call here.
 * The live read path is a service account with spreadsheets.readonly, and
 * the credential is blocked on the operator under #161, so both this check
 * and discoverPlans (discovery.ts) take a frozen listing captured the same
 * way sheet fixtures are.
 *
 * TP's ruling after PR 202's gate-1: an optional parameter that defaults to
 * skipping is off in practice, the same failure shape as a check nobody
 * remembers to switch on. The CLI and runSheet's own signature both require
 * an explicit FreshnessDecision now: checked, with a listing and its age,
 * or skipped, with a reason that gets printed loudly rather than read as a
 * clean run.
 */
import { readFileSync, statSync } from "node:fs";
import { clientPrefix, isPendingClearanceOrTest, normalizeSlug, parsePlanTitle } from "./plan-title";
import type { SheetConfig } from "./types";

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
}

export interface FreshnessResult {
  fresh: boolean;
  reason?: string;
  sibling?: { id: string; name: string };
}

export const MAX_LISTING_AGE_DAYS = 7;
export const SKIP_REASON_FLAG = "--skip-freshness-check";

export type FreshnessDecision =
  | { checked: true; listing: DriveFile[]; listingPath: string; listingAgeDays: number }
  | { checked: false; reason: string };

/**
 * The age/skip decision logic, taking an already-measured age so a test can
 * drive the 7-day boundary without faking a real file's mtime on disk.
 * Throws, rather than returning an error value, since both call sites
 * (resolveFreshnessDecision below, and the CLI) need to stop the run before
 * touching any sheet, the same shape as every other refusal in this file.
 */
export function freshnessDecisionForAge(args: {
  listingPath: string;
  listing: DriveFile[];
  ageDays: number;
  skip: boolean;
}): FreshnessDecision {
  if (args.skip) return { checked: false, reason: SKIP_REASON_FLAG };
  if (args.ageDays > MAX_LISTING_AGE_DAYS) {
    throw new Error(
      `--drive-listing ${args.listingPath} is ${args.ageDays.toFixed(1)} days old, over the ${MAX_LISTING_AGE_DAYS}-day freshness limit. A stale listing could miss a newer sibling created since it was captured. Re-capture the listing, or pass ${SKIP_REASON_FLAG} to proceed anyway.`,
    );
  }
  return { checked: true, listing: args.listing, listingPath: args.listingPath, listingAgeDays: args.ageDays };
}

/**
 * Resolves the CLI's own --drive-listing/--skip-freshness-check flags into a
 * FreshnessDecision, reading the listing file's real mtime from disk.
 * Neither flag given: throws naming both, so a run cannot proceed with an
 * unmade decision.
 */
export function resolveFreshnessDecision(opts: { listingPath?: string; skip: boolean }): FreshnessDecision {
  if (opts.skip) return { checked: false, reason: SKIP_REASON_FLAG };
  if (!opts.listingPath) {
    throw new Error(
      `A freshness decision is required: pass --drive-listing <path> to check for a newer sibling plan, or ${SKIP_REASON_FLAG} to run without checking. The live Drive read path has no credential yet (#161), so there is no default listing to fall back on.`,
    );
  }
  const stat = statSync(opts.listingPath);
  const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  const parsed = JSON.parse(readFileSync(opts.listingPath, "utf8")) as { files?: unknown };
  if (!Array.isArray(parsed.files)) {
    throw new Error(
      `--drive-listing ${opts.listingPath} does not have the expected shape, { "files": [...] }. Recapture the listing with the google-api skill at a large page size, or check for a hand-edited file.`,
    );
  }
  const listing = parsed.files as DriveFile[];
  return freshnessDecisionForAge({ listingPath: opts.listingPath, listing, ageDays, skip: false });
}

export function checkFreshness(config: SheetConfig, listing: DriveFile[]): FreshnessResult {
  // TP's follow-up on 7243643: reporting fresh here, for a registry entry
  // with no planSlug, is the same failure shape as the CLI's own optional
  // parameter this ticket already fixed. Absence of the input this check
  // needs must never read as a pass. Refuse and name the sheet instead;
  // --skip-freshness-check still bypasses this sheet entirely, since
  // checkFreshness is never called on a skipped decision.
  if (!config.planSlug) {
    return {
      fresh: false,
      reason: `Registry entry ${config.sheetId} (${config.label}) has no planSlug configured, so freshness cannot be checked for it. Add a planSlug to this sheet's config.ts entry, or pass --skip-freshness-check to run without checking freshness.`,
    };
  }

  const registeredEntry = listing.find((f) => f.id === config.sheetId);

  // TP's second follow-up on 9a950bd: this is the same shape again, one
  // level down. A listing that does not even contain the sheet cannot vouch
  // for it, whether that is because the listing was truncated (TP's own
  // 25-of-165 page-size miss this morning) or the sheet moved in Drive.
  // Refuse on the absence itself, before comparing any candidate sibling
  // against an unknown version. An absent id is not the same fact as "no
  // newer sibling exists," and treating it that way is what a truncated
  // listing looks like from the inside.
  if (!registeredEntry) {
    return {
      fresh: false,
      reason: `Registry entry ${config.sheetId} (${config.label}) is not present in this Drive listing. A listing missing the sheet it is meant to vouch for could be truncated, or the sheet may have moved in Drive. Recapture the listing with a large page size and confirm there is no next-page token, or pass --skip-freshness-check to run without checking freshness.`,
    };
  }

  const registeredPrefix = clientPrefix(config.engagementCode);
  const registeredSlug = normalizeSlug(config.planSlug);
  const registeredVersion = parsePlanTitle(registeredEntry.name)?.version ?? null;

  let newest: { file: DriveFile; version: number; code: string } | null = null;

  for (const file of listing) {
    if (file.id === config.sheetId) continue;
    if (isPendingClearanceOrTest(file.name)) continue;

    const parsed = parsePlanTitle(file.name);
    // Only the new title shape carries an explicit slug. Old-shape and
    // unrecognised titles have nothing comparable to a registry's planSlug,
    // so they can never match as a sibling here; this is the tool refusing
    // to guess, not a gap.
    if (!parsed || parsed.slug === null) continue;
    if (clientPrefix(parsed.code) !== registeredPrefix) continue;
    if (normalizeSlug(parsed.slug) !== registeredSlug) continue;
    if (registeredVersion !== null && parsed.version <= registeredVersion) continue;
    if (!newest || parsed.version > newest.version) {
      newest = { file, version: parsed.version, code: parsed.code };
    }
  }

  if (!newest) return { fresh: true };

  const codeChanged = newest.code !== config.engagementCode;
  const reason = codeChanged
    ? `A newer sibling exists: ${newest.file.name} (id ${newest.file.id}). Its engagement code, ${newest.code}, differs from the registry's ${config.engagementCode}: a re-coded engagement is itself worth a person's eyes.`
    : `A newer sibling exists: ${newest.file.name} (id ${newest.file.id}).`;

  return {
    fresh: false,
    reason,
    sibling: { id: newest.file.id, name: newest.file.name },
  };
}
