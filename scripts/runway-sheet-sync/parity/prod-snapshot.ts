/**
 * Independent prod read for the parity harness (_R1#151).
 *
 * Deliberately does NOT import or call runway-read.ts's `readClientBundle`.
 * That function selects `id, projectId, title, weekOf, startDate, endDate,
 * status, category, notes` — no `owner`, no `resources` — because diff.ts
 * never needs them. Reusing it here would silently reproduce the exact
 * blind spot this ticket exists to catch (plan §2.3, "the one idea worth
 * more than the rest: a second instrument" — comparing a port against
 * itself proves nothing).
 *
 * This module owns its own query, selecting every field the parity
 * comparator needs, and its own frozen-file format. Freezing (write once,
 * read many) is what makes a run reproducible — a live query re-run five
 * minutes later could read a cell Kathy just edited and manufacture a fake
 * disagreement (lessons doc, "the one trap to design out, every time").
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { eq } from "drizzle-orm";
import { clients, projects, weekItems } from "../../../src/lib/db/runway-schema";
import type { createRunwayDb } from "../../lib/run-script";
import type { ProdSnapshot } from "./types";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

export async function captureProdSnapshot(db: RunwayDb, clientSlug: string): Promise<ProdSnapshot> {
  const clientRows = await db
    .select({ id: clients.id, slug: clients.slug, name: clients.name })
    .from(clients)
    .where(eq(clients.slug, clientSlug));
  if (clientRows.length === 0) {
    throw new Error(`Client slug "${clientSlug}" not found in Runway prod`);
  }
  const client = clientRows[0];

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      category: projects.category,
      notes: projects.notes,
    })
    .from(projects)
    .where(eq(projects.clientId, client.id));

  const weekItemRows = await db
    .select({
      id: weekItems.id,
      projectId: weekItems.projectId,
      title: weekItems.title,
      weekOf: weekItems.weekOf,
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      status: weekItems.status,
      category: weekItems.category,
      owner: weekItems.owner,
      resources: weekItems.resources,
      notes: weekItems.notes,
    })
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));

  return {
    clientSlug,
    capturedAt: new Date().toISOString(),
    client,
    projects: projectRows,
    weekItems: weekItemRows,
  };
}

export function writeProdSnapshot(snapshot: ProdSnapshot, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
}

export function loadProdSnapshot(path: string): ProdSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as ProdSnapshot;
}
