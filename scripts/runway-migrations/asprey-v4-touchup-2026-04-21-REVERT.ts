/**
 * Reverse Migration: Asprey v4 Touchup — 2026-04-21 REVERT
 *
 * Reads the apply-mode pre-apply snapshot written by
 * `asprey-v4-touchup-2026-04-21.ts` and restores each affected row's column
 * values to their pre-migration state:
 *
 *   L1 (projects):   engagementType, contractEnd
 *   Client:          team
 *
 * The forward migration also calls `recomputeProjectDates`, but that call is a
 * no-op in practice (L2 set unchanged; derivation yields the same 4/20→4/30
 * window). No L1 startDate/endDate revert is required.
 *
 * Expects `docs/tmp/asprey-v4-pre-apply-snapshot-2026-04-21.json` (the
 * apply-mode snapshot, not the dry-run variant). Aborts loudly if the file is
 * missing, has unexpected shape, or is in dry-run mode.
 *
 * No audit records are written on revert (this is an emergency undo path,
 * matching the Soundly/HDL revert convention).
 *
 * Dry-run: logs planned reverts. Apply: writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects } from "@/lib/db/runway-schema";

const DEFAULT_SNAPSHOT_PATH = "docs/tmp/asprey-v4-pre-apply-snapshot-2026-04-21.json";

function getSnapshotPath(): string {
  return process.env.ASPREY_V4_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
}

export const description =
  "REVERT Asprey v4 touchup (2026-04-21): restore L1 engagementType/contractEnd and client.team from apply-mode pre-snapshot.";

// ── Types ────────────────────────────────────────────────

interface SnapshotClient {
  id: string;
  slug: string;
  team: string | null;
  [k: string]: unknown;
}

interface SnapshotL1 {
  id: string;
  name: string;
  engagementType: string | null;
  contractEnd: string | null;
  [k: string]: unknown;
}

interface Snapshot {
  capturedAt: string;
  mode: "dry-run" | "apply";
  client: SnapshotClient;
  L1s: SnapshotL1[];
  L2s: Array<{ id: string; [k: string]: unknown }>;
}

// Forward-migration-affected rows. REVERT only touches these.
const L1_PREFIXES_TO_REVERT = [
  "00a4e855", // Social Retainer — Wind Down
];

// ── Entry ────────────────────────────────────────────────

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Asprey v4 Touchup REVERT (2026-04-21) ===");

  const snapshot = loadSnapshot();
  ctx.log(
    `Snapshot captured ${snapshot.capturedAt} (${snapshot.mode}). Client id=${snapshot.client.id}.`
  );

  const l1sToRevert = snapshot.L1s.filter((p) =>
    L1_PREFIXES_TO_REVERT.some((prefix) => p.id.startsWith(prefix))
  );

  if (l1sToRevert.length !== L1_PREFIXES_TO_REVERT.length) {
    throw new Error(
      `Snapshot L1 coverage mismatch: expected ${L1_PREFIXES_TO_REVERT.length}, found ${l1sToRevert.length}. Abort.`
    );
  }

  ctx.log(
    `Planned reverts: ${l1sToRevert.length} L1 (engagementType, contractEnd) + 1 client (team).`
  );

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed.");
    for (const p of l1sToRevert) {
      ctx.log(
        `  L1 ${p.id.slice(0, 8)} (${p.name}): engagementType → ${p.engagementType === null ? "null" : `"${p.engagementType}"`}, contractEnd → ${p.contractEnd === null ? "null" : `"${p.contractEnd}"`}`
      );
    }
    ctx.log(
      `  Client ${snapshot.client.slug}: team → ${snapshot.client.team === null ? "null" : `"${snapshot.client.team}"`}`
    );
    return;
  }

  // Apply L1 reverts (engagementType + contractEnd)
  for (const p of l1sToRevert) {
    await ctx.db
      .update(projects)
      .set({
        engagementType: p.engagementType,
        contractEnd: p.contractEnd,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, p.id));
  }
  ctx.log(`Reverted ${l1sToRevert.length} L1 row(s) (engagementType, contractEnd).`);

  // Apply client team revert
  await ctx.db
    .update(clients)
    .set({ team: snapshot.client.team, updatedAt: new Date() })
    .where(eq(clients.id, snapshot.client.id));
  ctx.log(`Reverted client ${snapshot.client.slug} team.`);

  ctx.log("=== Asprey v4 Touchup REVERT complete ===");
}

// ── Helpers ──────────────────────────────────────────────

function loadSnapshot(): Snapshot {
  const path = resolvePath(process.cwd(), getSnapshotPath());
  if (!existsSync(path)) {
    throw new Error(
      `Snapshot not found at ${path}. REVERT requires the apply-mode pre-snapshot from asprey-v4-touchup-2026-04-21.ts. Abort.`
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
    typeof (s.client as { slug: unknown }).slug !== "string" ||
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
