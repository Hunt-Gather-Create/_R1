/**
 * Reverse Migration: Soundly v4 Realign — 2026-04-21 REVERT
 *
 * Reads the apply-mode pre-snapshot written by
 * `soundly-v4-realign-2026-04-21.ts` and restores each affected row's column
 * values to their pre-migration state:
 *
 *   L1 (projects):   resources, engagementType, contractEnd
 *   L2 (week_items): title
 *
 * Expects `docs/tmp/soundly-v4-pre-snapshot-2026-04-21.json` (the apply-mode
 * snapshot, not the dry-run variant). Aborts loudly if the file is missing,
 * has unexpected shape, or is in dry-run mode.
 *
 * The pre-snapshot dumps *every* Soundly L1 + L2 at capture time, so this
 * script only restores the fields the forward migration touches. No audit
 * records are written on revert (this is a local emergency undo, not a normal
 * Runway operation path).
 *
 * Dry-run: logs planned reverts. Apply: writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/soundly-v4-pre-snapshot-2026-04-21.json";

function getSnapshotPath(): string {
  return process.env.SOUNDLY_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

export const description =
  "REVERT Soundly v4 realign (2026-04-21): restore 3 L1 resources/engagementType/contractEnd and 1 L2 title from apply-mode pre-snapshot.";

// ── Types ────────────────────────────────────────────────

interface SnapshotL1 {
  id: string;
  name: string;
  resources: string | null;
  engagementType: string | null;
  contractEnd: string | null;
  // other fields present but not relevant to revert
  [k: string]: unknown;
}

interface SnapshotL2 {
  id: string;
  title: string;
  [k: string]: unknown;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: { id: string; slug: string; [k: string]: unknown };
  L1s: SnapshotL1[];
  L2s: SnapshotL2[];
}

// Forward-migration-affected IDs. REVERT only touches these (even though the
// snapshot contains all Soundly L1s/L2s) so we don't accidentally roll back
// fields the forward script never changed.
const L1_PREFIXES_TO_REVERT = [
  "cf4d6575", // iFrame Provider Search
  "8279d9eb", // Payment Gateway Page
  "54d65143", // AARP Member Login + Landing Page
];

const L2_PREFIXES_TO_REVERT = [
  "9c3fc2bb", // iFrame launch (evening) — only L2 whose title changed
];

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Soundly v4 Realign REVERT (2026-04-21) ===");

  const snapshot = loadSnapshot(ctx);

  ctx.log(
    `Snapshot captured ${snapshot.capturedAt} (${snapshot.mode}). Soundly client id=${snapshot.client.id}.`
  );

  // Filter snapshot down to the rows the forward migration touched
  const l1sToRevert = snapshot.L1s.filter((p) =>
    L1_PREFIXES_TO_REVERT.some((prefix) => p.id.startsWith(prefix))
  );
  const l2sToRevert = snapshot.L2s.filter((w) =>
    L2_PREFIXES_TO_REVERT.some((prefix) => w.id.startsWith(prefix))
  );

  if (l1sToRevert.length !== L1_PREFIXES_TO_REVERT.length) {
    throw new Error(
      `Snapshot L1 coverage mismatch: expected ${L1_PREFIXES_TO_REVERT.length}, found ${l1sToRevert.length}. Abort.`
    );
  }
  if (l2sToRevert.length !== L2_PREFIXES_TO_REVERT.length) {
    throw new Error(
      `Snapshot L2 coverage mismatch: expected ${L2_PREFIXES_TO_REVERT.length}, found ${l2sToRevert.length}. Abort.`
    );
  }

  ctx.log(`Planned reverts: ${l1sToRevert.length} L1s, ${l2sToRevert.length} L2s.`);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed.");
    for (const p of l1sToRevert) {
      ctx.log(
        `  L1 ${p.id.slice(0, 8)} (${p.name}): resources → "${p.resources ?? "null"}", engagementType → "${p.engagementType ?? "null"}", contractEnd → "${p.contractEnd ?? "null"}"`
      );
    }
    for (const w of l2sToRevert) {
      ctx.log(`  L2 ${w.id.slice(0, 8)}: title → "${w.title}"`);
    }
    return;
  }

  // Apply L1 reverts
  for (const p of l1sToRevert) {
    await ctx.db
      .update(projects)
      .set({
        resources: p.resources,
        engagementType: p.engagementType,
        contractEnd: p.contractEnd,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, p.id));
  }
  ctx.log(`Reverted ${l1sToRevert.length} L1 rows (resources, engagementType, contractEnd).`);

  // Apply L2 reverts
  for (const w of l2sToRevert) {
    await ctx.db
      .update(weekItems)
      .set({ title: w.title, updatedAt: new Date() })
      .where(eq(weekItems.id, w.id));
  }
  ctx.log(`Reverted ${l2sToRevert.length} L2 rows (title).`);

  ctx.log("=== Soundly v4 Realign REVERT complete ===");
}

// ── Helpers ──────────────────────────────────────────────

function loadSnapshot(ctx: MigrationContext): Snapshot {
  const path = resolvePath(process.cwd(), getSnapshotPath());
  if (!existsSync(path)) {
    throw new Error(
      `Snapshot not found at ${path}. REVERT requires the apply-mode pre-snapshot from soundly-v4-realign-2026-04-21.ts. Abort.`
    );
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Snapshot at ${path} is not valid JSON: ${err instanceof Error ? err.message : err}`
    );
  }
  const s = parsed as Partial<Snapshot>;
  if (
    !s ||
    typeof s !== "object" ||
    typeof s.capturedAt !== "string" ||
    !s.client ||
    typeof (s.client as { id: unknown }).id !== "string" ||
    !Array.isArray(s.L1s) ||
    !Array.isArray(s.L2s)
  ) {
    throw new Error(`Snapshot at ${path} has unexpected shape. Abort.`);
  }
  if (s.mode !== "apply") {
    throw new Error(
      `Snapshot at ${path} has mode "${s.mode}", expected "apply". Refusing to revert from dry-run snapshot. Abort.`
    );
  }
  return s as Snapshot;
}
