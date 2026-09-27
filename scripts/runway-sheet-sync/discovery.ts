/**
 * _R1#154 item 3: discovery. A pure function of the registry (config.ts's
 * SHEETS) and a frozen Drive listing, so a plan nobody registered shows up
 * as a gap instead of as silence. Never auto-registers anything: a person
 * decides which sheet is master, this only reports what exists.
 *
 * Candidate gate is deliberately loose (any title containing "Project Plan"
 * or "Project-Plan", case-insensitive), not the two strict naming shapes:
 * TP's ruling on this ticket, after a strict-shape gate silently dropped
 * the registered Soundly sheet's own third title shape. A candidate whose
 * shape cannot be parsed lands in its own named bucket, never dropped.
 */
import { checkFreshness, type DriveFile } from "./freshness";
import { isPendingClearanceOrTest, parsePlanTitle, PLAN_TITLE_CANDIDATE } from "./plan-title";
import type { SheetConfig } from "./types";

export type { DriveFile };

export interface DiscoveryEntry {
  id: string;
  name: string;
}

export interface DuplicateEntry {
  name: string;
  ids: string[];
}

export interface SupersededEntry {
  sheetId: string;
  name: string;
  sibling: { id: string; name: string };
  reason: string;
}

export interface RegisteredNotFoundEntry {
  sheetId: string;
  clientSlug: string;
  label: string;
}

export interface DiscoveryReport {
  unregistered: DiscoveryEntry[];
  superseded: SupersededEntry[];
  registeredNotFound: RegisteredNotFoundEntry[];
  /** Registered, present in the listing, but has no planSlug configured: freshness could not be checked for it (TP's follow-up on 9a950bd). */
  noPlanSlug: RegisteredNotFoundEntry[];
  /** Registered, present, has a planSlug, and freshness found no newer sibling. Exists so every registry entry lands in exactly one bucket here, never silently absent from all of them. */
  registeredClean: RegisteredNotFoundEntry[];
  duplicates: DuplicateEntry[];
  pendingClearanceOrTest: DiscoveryEntry[];
  unrecognizedShape: DiscoveryEntry[];
}

export function discoverPlans(registry: SheetConfig[], listing: DriveFile[]): DiscoveryReport {
  const registeredIds = new Set(registry.map((r) => r.sheetId));

  const registeredNotFound: RegisteredNotFoundEntry[] = registry
    .filter((r) => !listing.some((f) => f.id === r.sheetId))
    .map((r) => ({ sheetId: r.sheetId, clientSlug: r.clientSlug, label: r.label }));

  // TP's follow-up on 9a950bd: every registered entry must land in exactly
  // one bucket here, or in registeredClean. Not-found, no-slug, and
  // superseded are checked in that order per entry so none of them overlap.
  const superseded: SupersededEntry[] = [];
  const noPlanSlug: RegisteredNotFoundEntry[] = [];
  const registeredClean: RegisteredNotFoundEntry[] = [];
  for (const entry of registry) {
    const registeredFile = listing.find((f) => f.id === entry.sheetId);
    if (!registeredFile) continue; // already reported in registeredNotFound

    if (!entry.planSlug) {
      noPlanSlug.push({ sheetId: entry.sheetId, clientSlug: entry.clientSlug, label: entry.label });
      continue;
    }

    const freshness = checkFreshness(entry, listing);
    if (!freshness.fresh && freshness.sibling && freshness.reason) {
      superseded.push({
        sheetId: entry.sheetId,
        name: registeredFile.name,
        sibling: freshness.sibling,
        reason: freshness.reason,
      });
    } else {
      registeredClean.push({ sheetId: entry.sheetId, clientSlug: entry.clientSlug, label: entry.label });
    }
  }

  const pendingClearanceOrTest: DiscoveryEntry[] = [];
  const unregistered: DiscoveryEntry[] = [];
  const unrecognizedShape: DiscoveryEntry[] = [];
  const byName = new Map<string, string[]>();

  for (const file of listing) {
    if (!PLAN_TITLE_CANDIDATE.test(file.name)) continue;

    if (isPendingClearanceOrTest(file.name)) {
      pendingClearanceOrTest.push({ id: file.id, name: file.name });
      continue;
    }

    const existingIds = byName.get(file.name) ?? [];
    existingIds.push(file.id);
    byName.set(file.name, existingIds);

    if (registeredIds.has(file.id)) continue;

    const parsed = parsePlanTitle(file.name);
    if (!parsed) {
      unrecognizedShape.push({ id: file.id, name: file.name });
      continue;
    }
    unregistered.push({ id: file.id, name: file.name });
  }

  const duplicates: DuplicateEntry[] = [...byName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, ids }));

  return {
    unregistered,
    superseded,
    registeredNotFound,
    noPlanSlug,
    registeredClean,
    duplicates,
    pendingClearanceOrTest,
    unrecognizedShape,
  };
}
